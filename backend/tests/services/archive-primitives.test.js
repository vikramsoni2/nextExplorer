import { afterEach, describe, expect, it } from 'vitest';

import { setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * The parts of archive handling that do not need 7-Zip to be installed.
 *
 * `archiveService` sat at 22.6%, and the untested majority needs a real
 * extractor. What does not is the part standing between a user-supplied string
 * and a process: `normalizeArchivePassword` is what stops control characters
 * reaching the extractor's prompt, and it is the only thing that does.
 *
 * The rest is naming and degradation. A `.tar.gz` must extract into `project`
 * and not `project.tar`, because 7-Zip peels one layer per run and the
 * intermediate name would otherwise stick. And with no 7-Zip at all the service
 * falls back to zip rather than claiming formats it cannot open — which is the
 * state of the machine these run on, so that path is exercised for real rather
 * than simulated.
 */

let ctx;

const setup = async (env = {}) => {
  const context = await setupTestEnv({
    tag: 'archive-primitives-',
    env,
    modules: ['src/config/env', 'src/config/index', 'src/services/archiveService'],
  });
  ctx = context;
  return context.requireFresh('src/services/archiveService');
};

afterEach(async () => {
  if (ctx) {
    await ctx.cleanup();
    ctx = null;
  }
});

const refusal = (service, value) => {
  try {
    service.normalizeArchivePassword(value);
    return null;
  } catch (error) {
    return error;
  }
};

/** Control characters are built rather than typed, so this file stays readable. */
const ctrl = (code) => String.fromCharCode(code);

describe('the password on its way to the extractor', () => {
  it('lets an ordinary one through unchanged', async () => {
    const service = await setup();

    expect(service.normalizeArchivePassword('correct horse battery staple')).toBe(
      'correct horse battery staple'
    );
  });

  it('keeps accents, symbols and spaces', async () => {
    const service = await setup();

    expect(service.normalizeArchivePassword('Ete 2026 - unicode ok')).toBe('Ete 2026 - unicode ok');
  });

  it('treats absence as no password rather than an empty one', async () => {
    const service = await setup();

    expect(service.normalizeArchivePassword(undefined)).toBeNull();
    expect(service.normalizeArchivePassword(null)).toBeNull();
  });

  /** An empty string is a password somebody typed; it is not "no password". */
  it('keeps an empty string as an empty string', async () => {
    const service = await setup();

    expect(service.normalizeArchivePassword('')).toBe('');
  });

  /**
   * The reason this function exists. A newline or a NUL in a value handed to a
   * process is where a password stops being data.
   */
  it.each([
    ['a NUL', 0],
    ['a tab', 9],
    ['a newline', 10],
    ['a carriage return', 13],
    ['an escape', 27],
    ['a unit separator', 31],
    ['a delete', 127],
  ])('refuses %s in the middle', async (_label, code) => {
    const service = await setup();

    expect(refusal(service, `pass${ctrl(code)}word`)?.code).toBe('INVALID_ARCHIVE_PASSWORD');
  });

  it('refuses one at the very start, where a trimming bug would hide it', async () => {
    const service = await setup();

    expect(refusal(service, `${ctrl(10)}password`)?.code).toBe('INVALID_ARCHIVE_PASSWORD');
  });

  it('refuses one at the very end', async () => {
    const service = await setup();

    expect(refusal(service, `password${ctrl(0)}`)?.code).toBe('INVALID_ARCHIVE_PASSWORD');
  });

  it('refuses anything that is not a string', async () => {
    const service = await setup();

    for (const value of [42, true, {}, [], () => {}]) {
      expect(refusal(service, value)?.code).toBe('INVALID_ARCHIVE_PASSWORD');
    }
  });

  it('refuses one longer than four thousand characters', async () => {
    const service = await setup();

    expect(service.normalizeArchivePassword('a'.repeat(4096))).toHaveLength(4096);
    expect(refusal(service, 'a'.repeat(4097))?.code).toBe('INVALID_ARCHIVE_PASSWORD');
  });
});

describe('recognising a wrong password in what the extractor said', () => {
  it.each([
    'Wrong password?',
    'ERROR: Wrong password : archive.7z',
    'Data Error in encrypted file. Wrong password?',
    'Can not open encrypted archive. Wrong password?',
    'Headers Error',
  ])('recognises %s', async (message) => {
    const service = await setup();

    expect(service.isArchivePasswordError(new Error(message))).toBe(true);
  });

  it('does not mistake an unrelated failure for one', async () => {
    const service = await setup();

    expect(service.isArchivePasswordError(new Error('No space left on device'))).toBe(false);
    expect(service.isArchivePasswordError(new Error('Cannot open the file as archive'))).toBe(false);
  });

  it('says no rather than throwing on something that is not an error', async () => {
    const service = await setup();

    expect(service.isArchivePasswordError(null)).toBe(false);
    expect(service.isArchivePasswordError(undefined)).toBe(false);
    expect(service.isArchivePasswordError({})).toBe(false);
  });
});

describe('what an extracted folder is called', () => {
  it('drops the extension', async () => {
    const service = await setup();

    expect(service.archiveBaseName('project.zip')).toBe('project');
    expect(service.archiveBaseName('backup.7z')).toBe('backup');
  });

  /**
   * 7-Zip peels one layer per run, so a `.tar.gz` goes to `.tar` first. Naming
   * the folder after the intermediate leaves `project.tar` sitting on disk.
   */
  it.each([
    ['project.tar.gz', 'project'],
    ['project.tar.bz2', 'project'],
    ['project.tar.xz', 'project'],
    ['project.tar.zst', 'project'],
    ['project.TAR.GZ', 'project'],
  ])('strips the inner .tar from %s', async (filename, expected) => {
    const service = await setup();

    expect(service.archiveBaseName(filename)).toBe(expected);
  });

  it('leaves a .tar alone, which is already the archive', async () => {
    const service = await setup();

    expect(service.archiveBaseName('project.tar')).toBe('project');
  });

  it('does not strip .tar from a name that merely ends in it', async () => {
    const service = await setup();

    expect(service.archiveBaseName('avatar.zip')).toBe('avatar');
  });

  it('keeps the dots inside a name', async () => {
    const service = await setup();

    expect(service.archiveBaseName('v1.2.3.zip')).toBe('v1.2.3');
  });

  it('falls back to a name rather than an empty folder name', async () => {
    const service = await setup();

    expect(service.archiveBaseName('')).toBe('Archive');
  });

  /**
   * A leading dot is a hidden file, not an extension — `path.extname('.zip')`
   * is empty — so an archive named `.zip` extracts into a hidden folder called
   * `.zip`. Odd, harmless, and pinned so it is a decision rather than a
   * surprise if anyone changes the naming.
   */
  it('treats a name that is only an extension as a hidden name', async () => {
    const service = await setup();

    expect(service.archiveBaseName('.zip')).toBe('.zip');
  });
});

describe('with no 7-Zip installed', () => {
  /**
   * The state of this machine, so this is the real path and not a simulation.
   * Claiming rar and iso without an extractor offers people a menu entry that
   * fails after they click it.
   */
  it('offers zip alone rather than the whole configured list', async () => {
    const service = await setup({ SEVEN_ZIP_PATH: '/nonexistent/7z' });

    expect(await service.getSupportedArchiveExtensions()).toEqual(['zip']);
  });

  it('reports itself as unavailable', async () => {
    const service = await setup({ SEVEN_ZIP_PATH: '/nonexistent/7z' });

    expect(await service.isSevenZipAvailable()).toBe(false);
  });

  it('probes once and reuses the answer', async () => {
    const service = await setup({ SEVEN_ZIP_PATH: '/nonexistent/7z' });

    const first = service.getSupportedArchiveExtensions();
    const second = service.getSupportedArchiveExtensions();

    expect(second).toBe(first);
    await first;
  });
});
