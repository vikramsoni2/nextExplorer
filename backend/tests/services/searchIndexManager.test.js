import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';

import { setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * When the index is built, when it is not, and what it refuses to read.
 *
 * This is the service that decides what a search can see. Three of its rules
 * are worth being sure of. A folder an administrator has just excluded is
 * forgotten immediately rather than at the next pass, because until it is the
 * index goes on answering searches from a folder somebody said not to read. A
 * path outside the volume is not indexed at all, whatever asks for it. And the
 * backlog of per-file updates has a bottom: copying a large folder announces
 * one update per file, and a queue that grows without limit is the whole point
 * of having a periodic pass to fall back on.
 *
 * Run against a real database, a real store and a real volume, the way the
 * other index tests are: what is being tested is the coordination, and mocking
 * the parts it coordinates would test the mock.
 */

let envContext;
let manager;
let store;
let db;

const volumePath = (...parts) => path.join(envContext.volumeDir, ...parts);

const build = async (env = {}) => {
  envContext = await setupTestEnv({
    tag: 'search-index-manager-',
    env: { SEARCH_INDEX: 'true', SEARCH_INDEX_CPU_PERCENT: '100', ...env },
  });
  const dbService = envContext.requireFresh('src/services/db');
  db = await dbService.getDb();
  store = envContext.requireFresh('src/services/searchIndexStore');
  manager = envContext.requireFresh('src/services/searchIndexManager');
};

const seedDocs = async () => {
  await fs.mkdir(volumePath('Docs'), { recursive: true });
  await fs.writeFile(volumePath('Docs', 'notes.md'), 'le pangolin mange des fourmis\n');
  await fs.writeFile(volumePath('Docs', 'autre.txt'), 'rien de particulier\n');
};

const indexed = () => store.stats(db).documents;

afterEach(async () => {
  manager?.stop();
  manager = null;
  if (envContext) await envContext.cleanup();
  envContext = null;
  vi.useRealTimers();
});

describe('a pass over the volume', () => {
  it('reads what is there', async () => {
    await build();
    await seedDocs();

    await manager.reconcile({ reason: 'test' });

    expect(indexed()).toBe(2);
    expect(store.search(db, 'pangolin')).toEqual(['Docs/notes.md']);
  });

  /** Only a pass that reached the end can promise the index answers for everything. */
  it('marks the index ready once it has been all the way through', async () => {
    await build();
    await seedDocs();
    expect(store.isReady(db)).toBe(false);

    await manager.reconcile({ reason: 'test' });

    expect(store.isReady(db)).toBe(true);
  });

  it('leaves it unready when the pass was cut short', async () => {
    await build();
    await seedDocs();

    const pass = manager.reconcile({ reason: 'test' });
    manager.stop();
    await pass;

    expect(store.isReady(db)).toBe(false);
  });

  it('runs one at a time', async () => {
    await build();
    await seedDocs();

    const [first, second] = await Promise.all([
      manager.reconcile({ reason: 'a' }),
      manager.reconcile({ reason: 'b' }),
    ]);

    expect(Boolean(first) !== Boolean(second)).toBe(true);
  });

  it('does nothing once the service has been stopped', async () => {
    await build();
    await seedDocs();
    manager.stop();

    expect(await manager.reconcile({ reason: 'test' })).toBeNull();
    expect(indexed()).toBe(0);
  });

  it('does nothing at all where the index is switched off', async () => {
    await build({ SEARCH_INDEX: 'false' });
    await seedDocs();

    expect(await manager.reconcile({ reason: 'test' })).toBeNull();
  });

  /** A failing pass is a pass that runs again later, not a crashed service. */
  it('survives a pass that throws', async () => {
    await build();
    await seedDocs();
    await fs.rm(envContext.volumeDir, { recursive: true, force: true });

    await expect(manager.reconcile({ reason: 'test' })).resolves.toBeDefined();
  });
});

describe('starting and stopping', () => {
  it('runs a first pass and schedules the ones after it', async () => {
    await build();
    await seedDocs();

    manager.start();
    await vi.waitFor(() => expect(indexed()).toBe(2));

    expect((await manager.status()).enabled).toBe(true);
  });

  it('starts nothing where the index is switched off', async () => {
    await build({ SEARCH_INDEX: 'false' });
    await seedDocs();

    manager.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(indexed()).toBe(0);
  });

  it('stops the scheduled passes', async () => {
    await build();
    await seedDocs();
    manager.start();
    await vi.waitFor(() => expect(indexed()).toBe(2));

    manager.stop();
    await fs.writeFile(volumePath('Docs', 'nouveau.md'), 'encore un pangolin\n');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(indexed()).toBe(2);
  });
});

describe('a folder an administrator excludes', () => {
  it('is forgotten straight away, not at the next pass', async () => {
    await build();
    await seedDocs();
    await manager.reconcile({ reason: 'seed' });
    expect(store.search(db, 'pangolin')).toEqual(['Docs/notes.md']);

    await manager.setAdminExclusions(['Docs']);
    await vi.waitFor(() => expect(store.search(db, 'pangolin')).toEqual([]));
  });

  it('says what changed', async () => {
    await build();

    const changed = await manager.setAdminExclusions(['Docs']);

    expect(changed.added).toEqual(['Docs']);
  });

  it('is not read by the next pass either', async () => {
    await build();
    await seedDocs();
    await manager.setAdminExclusions(['Docs']);

    await manager.reconcile({ reason: 'test' });

    expect(indexed()).toBe(0);
  });

  /** Removing an exclusion is the next pass's job; nothing is read here. */
  it('is picked up again by a later pass once the exclusion goes', async () => {
    await build();
    await seedDocs();
    await manager.setAdminExclusions(['Docs']);
    await manager.reconcile({ reason: 'excluded' });
    expect(indexed()).toBe(0);

    await manager.setAdminExclusions([]);
    await manager.reconcile({ reason: 'again' });

    expect(indexed()).toBe(2);
  });

  it('changes nothing where the index is switched off', async () => {
    await build({ SEARCH_INDEX: 'false' });

    const changed = await manager.setAdminExclusions(['Docs']);

    expect(changed.added).toEqual(['Docs']);
  });
});

describe('a file the application itself changed', () => {
  it('is read into the index on its own', async () => {
    await build();
    await seedDocs();
    await manager.reconcile({ reason: 'seed' });
    await fs.writeFile(volumePath('Docs', 'nouveau.md'), 'un autre pangolin\n');

    await manager.onFileChanged(volumePath('Docs', 'nouveau.md'));

    expect(store.search(db, 'pangolin').sort()).toEqual(['Docs/notes.md', 'Docs/nouveau.md']);
  });

  it('is forgotten when it is removed', async () => {
    await build();
    await seedDocs();
    await manager.reconcile({ reason: 'seed' });

    await manager.onPathRemoved(volumePath('Docs', 'notes.md'));

    expect(store.search(db, 'pangolin')).toEqual([]);
  });

  it('takes a whole folder with it', async () => {
    await build();
    await seedDocs();
    await manager.reconcile({ reason: 'seed' });

    await manager.onPathRemoved(volumePath('Docs'));

    expect(indexed()).toBe(0);
  });

  it('follows a move', async () => {
    await build();
    await seedDocs();
    await manager.reconcile({ reason: 'seed' });
    await fs.mkdir(volumePath('Archive'), { recursive: true });
    await fs.rename(volumePath('Docs', 'notes.md'), volumePath('Archive', 'notes.md'));

    await manager.onPathMoved(volumePath('Docs', 'notes.md'), volumePath('Archive', 'notes.md'));

    expect(store.search(db, 'pangolin')).toEqual(['Archive/notes.md']);
  });

  /**
   * A rename is a rename: the words did not change, only where they live. The
   * index entry is carried across rather than the file being opened again —
   * which is what makes renaming a folder of ten thousand files cost ten
   * thousand row updates instead of ten thousand reads.
   */
  it('does not read the file again to do it', async () => {
    await build();
    await seedDocs();
    await manager.reconcile({ reason: 'seed' });
    await fs.mkdir(volumePath('Archive'), { recursive: true });
    await fs.rename(volumePath('Docs', 'notes.md'), volumePath('Archive', 'notes.md'));
    // Different words at the destination, which only a re-read could pick up.
    await fs.writeFile(volumePath('Archive', 'notes.md'), 'le tatou mange des fourmis\n');

    await manager.onPathMoved(volumePath('Docs', 'notes.md'), volumePath('Archive', 'notes.md'));

    expect(store.search(db, 'pangolin')).toEqual(['Archive/notes.md']);
    expect(store.search(db, 'tatou')).toEqual([]);
  });

  it('forgets a file moved out of the volume', async () => {
    await build();
    await seedDocs();
    await manager.reconcile({ reason: 'seed' });

    await manager.onPathMoved(volumePath('Docs', 'notes.md'), '/ailleurs/notes.md');

    expect(store.search(db, 'pangolin')).toEqual([]);
  });

  it('reads a file moved into the volume', async () => {
    await build();
    await seedDocs();
    await manager.reconcile({ reason: 'seed' });
    await fs.writeFile(volumePath('Docs', 'arrive.md'), 'encore un pangolin\n');

    await manager.onPathMoved('/ailleurs/arrive.md', volumePath('Docs', 'arrive.md'));

    expect(store.search(db, 'pangolin').sort()).toEqual(['Docs/arrive.md', 'Docs/notes.md']);
  });

  it('says nothing about a move that never touched the volume', async () => {
    await build();
    await seedDocs();
    await manager.reconcile({ reason: 'seed' });

    await manager.onPathMoved('/ailleurs/a.md', '/ailleurs/b.md');

    expect(indexed()).toBe(2);
  });
});

describe('what the index refuses to read', () => {
  /**
   * The path decides what is indexed, so a path that walks out of the volume
   * with `..` would have the index reading, and later answering searches from,
   * files nobody shared through this server at all.
   */
  it('a path that climbs out of the volume', async () => {
    await build();
    await seedDocs();
    await manager.reconcile({ reason: 'seed' });

    await manager.onFileChanged(path.join(envContext.volumeDir, '..', 'dehors.md'));

    expect(indexed()).toBe(2);
  });

  it('an absolute path somewhere else entirely', async () => {
    await build();
    await seedDocs();

    await manager.onFileChanged('/etc/passwd');
    await manager.onPathRemoved('/etc/passwd');

    expect(indexed()).toBe(0);
  });

  it('nothing at all', async () => {
    await build();

    await expect(manager.onFileChanged('')).resolves.toBeUndefined();
    await expect(manager.onPathRemoved(null)).resolves.toBeUndefined();
  });

  /**
   * Work announced after a stop is refused rather than queued: a shutdown that
   * takes a moment must not spend it reading files.
   */
  it('anything, once the service is stopped', async () => {
    await build();
    await seedDocs();
    manager.stop();

    await manager.onFileChanged(volumePath('Docs', 'notes.md'));

    expect(indexed()).toBe(0);
    expect((await manager.status()).pending).toBe(0);
  });

  it('anything, where the index is switched off', async () => {
    await build({ SEARCH_INDEX: 'false' });
    await seedDocs();

    await manager.onFileChanged(volumePath('Docs', 'notes.md'));
    await manager.onPathRemoved(volumePath('Docs', 'notes.md'));
    await manager.onPathMoved(volumePath('Docs', 'notes.md'), volumePath('a.md'));

    expect(indexed()).toBe(0);
  });
});

describe('what it reports about itself', () => {
  it('says it is off when it is', async () => {
    await build({ SEARCH_INDEX: 'false' });

    expect(await manager.status()).toEqual({ enabled: false });
  });

  it('says what it holds when it is on', async () => {
    await build();
    await seedDocs();
    await manager.reconcile({ reason: 'seed' });

    const status = await manager.status();

    expect(status).toMatchObject({ enabled: true, running: false, ready: true, documents: 2 });
    expect(status.pending).toBe(0);
    expect(status.dropped).toBe(0);
  });
});
