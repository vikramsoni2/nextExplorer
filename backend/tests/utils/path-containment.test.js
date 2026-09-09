import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * Path containment used to be a pure string comparison, so a symbolic link
 * planted inside the volume (an archive can carry one) pointed anywhere while
 * still looking contained. These pin both halves: links inside are refused,
 * and a volume root that is itself a link still works — which is the normal
 * setup on a NAS and what a naive realpath check would break.
 */

let currentEnv;

afterEach(async () => {
  if (currentEnv) {
    await currentEnv.cleanup();
    currentEnv = null;
  }
});

describe('Volume path containment', () => {
  it('refuses a path that escapes through a symbolic link', async () => {
    const env = await setupTestEnv({
      tag: 'containment-symlink-',
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;

    const outside = path.join(env.tmpRoot, 'outside');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'not yours');
    await fs.symlink(outside, path.join(env.volumeDir, 'escape'));

    const { resolveVolumePath } = env.requireFresh('src/utils/pathUtils');

    // The lexical check passes (the string starts with the volume root), so
    // only the real-path check can catch this.
    await expect(resolveVolumePath('escape/secret.txt')).rejects.toThrow(/outside the configured volume/i);
    await expect(resolveVolumePath('escape')).rejects.toThrow(/outside the configured volume/i);
  });

  it('still resolves normal paths, including ones not created yet', async () => {
    const env = await setupTestEnv({
      tag: 'containment-normal-',
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;

    await fs.mkdir(path.join(env.volumeDir, 'docs'), { recursive: true });
    const { resolveVolumePath } = env.requireFresh('src/utils/pathUtils');

    expect(await resolveVolumePath('docs')).toContain('docs');
    // A file about to be created must resolve through its existing parent.
    expect(await resolveVolumePath('docs/new-file.txt')).toContain('new-file.txt');
    expect(await resolveVolumePath('brand/new/tree.txt')).toContain('tree.txt');
  });

  it('accepts a volume root that is itself a symbolic link', async () => {
    const env = await setupTestEnv({
      tag: 'containment-linked-root-',
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;

    // Mimic /mnt -> /volume1: point VOLUME_ROOT at a link to the real dir.
    const realStorage = path.join(env.tmpRoot, 'real-storage');
    await fs.mkdir(path.join(realStorage, 'media'), { recursive: true });
    const linkedRoot = path.join(env.tmpRoot, 'linked-root');
    await fs.symlink(realStorage, linkedRoot);

    process.env.VOLUME_ROOT = linkedRoot;
    try {
      const { resolveVolumePath } = env.requireFresh('src/utils/pathUtils');
      await expect(resolveVolumePath('media')).resolves.not.toThrow();
    } finally {
      process.env.VOLUME_ROOT = env.volumeDir;
    }
  });

  it('refuses a broken symbolic link pointing outside', async () => {
    const env = await setupTestEnv({
      tag: 'containment-dangling-',
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;

    // The target does not exist, so realpath fails on the link itself. Treating
    // that as "not created yet" and checking the parent instead would accept it
    // — and the next write would land in /etc.
    await fs.symlink(path.join(env.tmpRoot, 'nowhere', 'passwd'), path.join(env.volumeDir, 'dead'));
    const { resolveVolumePath } = env.requireFresh('src/utils/pathUtils');

    await expect(resolveVolumePath('dead')).rejects.toThrow(/outside the configured volume/i);
    await expect(resolveVolumePath('dead/child.txt')).rejects.toThrow(/outside the configured volume/i);
  });

  it('accepts a broken link whose target stays inside the volume', async () => {
    const env = await setupTestEnv({
      tag: 'containment-dangling-inside-',
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;

    await fs.symlink(path.join(env.volumeDir, 'not-yet.txt'), path.join(env.volumeDir, 'pending'));
    const { resolveVolumePath } = env.requireFresh('src/utils/pathUtils');

    await expect(resolveVolumePath('pending')).resolves.not.toThrow();
  });

  it('gives up on a symbolic link loop instead of spinning', async () => {
    const env = await setupTestEnv({
      tag: 'containment-loop-',
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;

    await fs.symlink(path.join(env.volumeDir, 'b'), path.join(env.volumeDir, 'a'));
    await fs.symlink(path.join(env.volumeDir, 'a'), path.join(env.volumeDir, 'b'));
    const { resolveVolumePath } = env.requireFresh('src/utils/pathUtils');

    await expect(resolveVolumePath('a')).rejects.toThrow(/symbolic links/i);
  });
});

/**
 * The volume was the only space whose containment survived a symbolic link.
 * A personal folder and an assigned user volume are just as reachable — the
 * archive that plants the link does not care which space it lands in.
 */
describe('Other spaces containment', () => {
  it('refuses an escape from a personal folder', async () => {
    const env = await setupTestEnv({
      tag: 'containment-personal-',
      env: { USER_DIR_ENABLED: 'true' },
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;

    const { resolvePersonalPath } = env.requireFresh('src/utils/pathUtils');
    const user = { id: 'user-1', username: 'alice' };
    const userRoot = await resolvePersonalPath('', user);
    await fs.mkdir(userRoot, { recursive: true });

    const outside = path.join(env.tmpRoot, 'outside-personal');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'not yours');
    await fs.symlink(outside, path.join(userRoot, 'escape'));

    await expect(resolvePersonalPath('escape/secret.txt', user)).rejects.toThrow(
      /outside the configured user directory/i
    );
    await expect(resolvePersonalPath('docs/report.txt', user)).resolves.not.toThrow();
  });

  /**
   * The same escape, asked for the way the application asks for it.
   *
   * The test above calls `resolvePersonalPath` directly, one layer below where
   * the application actually resolves a path — and that is why it went on
   * passing while every personal path was broken. `resolveLogicalPath` called
   * it without awaiting, so it handed back a promise as if it were a path:
   * `pathExists` was given a promise, and My Files answered "Path not found"
   * for a directory that was right there.
   *
   * The refusal went the same way. A promise nobody awaits is a rejection
   * nobody handles, and Node ends the process for one of those — so a path that
   * should have been turned down took the server with it instead. These three
   * ask at the layer the defect was in.
   */
  it('resolves a personal path to a path, not to a promise', async () => {
    const env = await setupTestEnv({
      tag: 'containment-personal-logical-',
      env: { USER_DIR_ENABLED: 'true' },
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;

    const { resolveLogicalPath, resolvePersonalPath } = env.requireFresh('src/utils/pathUtils');
    const user = { id: 'user-1', username: 'alice' };
    const userRoot = await resolvePersonalPath('', user);
    await fs.mkdir(path.join(userRoot, 'docs'), { recursive: true });

    const { absolutePath } = await resolveLogicalPath('personal/docs', { user });

    expect(typeof absolutePath).toBe('string');
    expect(absolutePath).toBe(path.join(userRoot, 'docs'));
  });

  it('refuses an escape asked for through the logical path', async () => {
    const env = await setupTestEnv({
      tag: 'containment-personal-escape-',
      env: { USER_DIR_ENABLED: 'true' },
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;

    const { resolveLogicalPath, resolvePersonalPath } = env.requireFresh('src/utils/pathUtils');
    const user = { id: 'user-1', username: 'alice' };
    const userRoot = await resolvePersonalPath('', user);
    await fs.mkdir(userRoot, { recursive: true });
    const outside = path.join(env.tmpRoot, 'outside-personal-logical');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'not yours');
    await fs.symlink(outside, path.join(userRoot, 'escape'));

    await expect(
      resolveLogicalPath('personal/escape/secret.txt', { user })
    ).rejects.toThrow(/outside the configured user directory/i);
  });

  /** A refusal must reach the caller, not the process. */
  it('leaves no unhandled rejection behind when it refuses', async () => {
    const env = await setupTestEnv({
      tag: 'containment-personal-unhandled-',
      env: { USER_DIR_ENABLED: 'true' },
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;

    const { resolveLogicalPath, resolvePersonalPath } = env.requireFresh('src/utils/pathUtils');
    const user = { id: 'user-1', username: 'alice' };
    const userRoot = await resolvePersonalPath('', user);
    await fs.mkdir(userRoot, { recursive: true });
    const outside = path.join(env.tmpRoot, 'outside-personal-unhandled');
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, path.join(userRoot, 'escape'));

    const unhandled = [];
    const collect = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', collect);
    try {
      await resolveLogicalPath('personal/escape', { user }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', collect);
    }
  });

  it('refuses an escape from an assigned user volume', async () => {
    const env = await setupTestEnv({
      tag: 'containment-user-volume-',
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;

    const assigned = path.join(env.tmpRoot, 'assigned');
    await fs.mkdir(assigned, { recursive: true });
    const outside = path.join(env.tmpRoot, 'outside-assigned');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'not yours');
    await fs.symlink(outside, path.join(assigned, 'escape'));

    const { resolveLogicalPath } = env.requireFresh('src/utils/pathUtils');
    const userVolume = { id: 'vol-1', userId: 'user-1', label: 'Work', path: assigned };

    await expect(
      resolveLogicalPath('Work/escape/secret.txt', { user: { id: 'user-1' }, userVolume })
    ).rejects.toThrow(/outside the assigned volume/i);
  });
});

/**
 * Entries in a directory share every path segment but the last, so the check
 * resolves the parent once and then only asks whether each entry is itself a
 * link. That shortcut must not become a hole: the escapes below all sit in a
 * directory whose parent is perfectly legitimate.
 */
describe('Containment with a warm parent', () => {
  it('still refuses a link, a broken link and a nested escape', async () => {
    const env = await setupTestEnv({
      tag: 'containment-warm-parent-',
      modules: [
        'src/config/env',
        'src/config/index',
        'src/utils/requestContext',
        'src/utils/pathUtils',
      ],
    });
    currentEnv = env;

    const context = env.requireFresh('src/utils/requestContext');
    const { resolveVolumePath } = env.requireFresh('src/utils/pathUtils');

    const outside = path.join(env.tmpRoot, 'outside-warm');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'not yours');

    const inside = path.join(env.volumeDir, 'folder');
    await fs.mkdir(inside, { recursive: true });
    await fs.writeFile(path.join(inside, 'ok.txt'), 'fine');
    await fs.symlink(outside, path.join(inside, 'escape'));
    await fs.symlink(path.join(env.tmpRoot, 'nowhere'), path.join(inside, 'dead'));

    await context.runInRequestContext(async () => {
      // Warms the parent, which is what the shortcut relies on.
      expect(await resolveVolumePath('folder/ok.txt')).toContain('ok.txt');

      await expect(resolveVolumePath('folder/escape')).rejects.toThrow(/outside/i);
      await expect(resolveVolumePath('folder/escape/secret.txt')).rejects.toThrow(/outside/i);
      await expect(resolveVolumePath('folder/dead')).rejects.toThrow(/outside/i);

      // And a legitimate sibling still resolves afterwards.
      expect(await resolveVolumePath('folder/ok.txt')).toContain('ok.txt');
    });
  });

  it('refuses an entry whose parent is itself a link out', async () => {
    const env = await setupTestEnv({
      tag: 'containment-warm-parent-link-',
      modules: [
        'src/config/env',
        'src/config/index',
        'src/utils/requestContext',
        'src/utils/pathUtils',
      ],
    });
    currentEnv = env;

    const context = env.requireFresh('src/utils/requestContext');
    const { resolveVolumePath } = env.requireFresh('src/utils/pathUtils');

    const outside = path.join(env.tmpRoot, 'outside-parent');
    await fs.mkdir(path.join(outside, 'sub'), { recursive: true });
    await fs.writeFile(path.join(outside, 'sub', 'secret.txt'), 'not yours');
    await fs.symlink(outside, path.join(env.volumeDir, 'linked'));

    await context.runInRequestContext(async () => {
      // The entry is a plain file; it is the directory holding it that escapes.
      await expect(resolveVolumePath('linked/sub/secret.txt')).rejects.toThrow(/outside/i);
    });
  });
});

/**
 * `assertRealPathWithinRoot` is the check the resolvers lean on, and its name
 * is a promise. It used to accept a path it could not resolve once the walk
 * climbed above the root — safe only because every caller happened to have
 * checked containment just before. The promise is now the function's own.
 */
describe('the containment check on its own', () => {
  const withRoot = async (tag) => {
    const env = await setupTestEnv({
      tag,
      modules: ['src/config/env', 'src/config/index', 'src/utils/pathUtils'],
    });
    currentEnv = env;
    const { assertRealPathWithinRoot } = env.requireFresh('src/utils/pathUtils');
    return { env, assertRealPathWithinRoot };
  };

  // The caller this was waiting for: one that trusts the name and passes a
  // path it has not checked itself.
  it('refuses a path outside the root when none of it exists', async () => {
    const { env, assertRealPathWithinRoot } = await withRoot('containment-direct-');

    await expect(assertRealPathWithinRoot('/etc/nothing/here', env.volumeDir)).rejects.toThrow(
      /outside the configured volume/i
    );
    await expect(assertRealPathWithinRoot(path.join(env.tmpRoot, 'elsewhere', 'file.txt'), env.volumeDir)).rejects.toThrow(/outside the configured volume/i);
  });

  it('refuses a path outside the root when it does exist', async () => {
    const { env, assertRealPathWithinRoot } = await withRoot('containment-direct-real-');
    const outside = path.join(env.tmpRoot, 'outside');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'not yours');

    await expect(assertRealPathWithinRoot(path.join(outside, 'secret.txt'), env.volumeDir)).rejects.toThrow(
      /outside the configured volume/i
    );
  });

  it('accepts what is inside, existing or not', async () => {
    const { env, assertRealPathWithinRoot } = await withRoot('containment-direct-inside-');
    await fs.mkdir(path.join(env.volumeDir, 'Documents'), { recursive: true });

    await expect(assertRealPathWithinRoot(path.join(env.volumeDir, 'Documents'), env.volumeDir)).resolves.not.toThrow();
    // A file about to be created is not an escape.
    await expect(assertRealPathWithinRoot(path.join(env.volumeDir, 'Documents', 'new.txt'), env.volumeDir)).resolves.not.toThrow();
    await expect(assertRealPathWithinRoot(env.volumeDir, env.volumeDir)).resolves.not.toThrow();
  });

  // A volume root that has not been created yet is the startup case the walk
  // was written to allow, and it still is.
  it('accepts a root that does not exist yet', async () => {
    const { env, assertRealPathWithinRoot } = await withRoot('containment-direct-absent-');
    const absent = path.join(env.tmpRoot, 'not-mounted-yet');

    await expect(assertRealPathWithinRoot(path.join(absent, 'file.txt'), absent)).resolves.not.toThrow();
  });
});
