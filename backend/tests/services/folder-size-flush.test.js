import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * What the folder-size index takes in, and what it refuses to take in yet.
 *
 * Sizes are recorded by a background pass: directories a listing touched are
 * marked, and a flush aggregates them into the index in one transaction. Half
 * of that was uncovered — the marking and the flush both.
 *
 * The refusals are the part worth stating. A directory in the middle of a copy
 * has a size that is true for an instant and wrong afterwards; recording it
 * leaves a number nobody will correct until something else happens to that
 * folder. An excluded tree is excluded because reading it is the whole cost the
 * exclusion exists to avoid.
 *
 * Driven through `start`, `touch` and `stop`, which is how the application
 * drives it — and `stop` flushing what is pending is itself the promise that a
 * restart loses nothing.
 */

let currentEnv;
let manager;

const setup = async (extraEnv = {}) => {
  currentEnv = await setupTestEnv({
    tag: 'folder-size-flush-',
    env: { FOLDER_SIZE_MODE: 'full', ...extraEnv },
    modules: [
      'src/config/env',
      'src/config/index',
      'src/services/folderSizeIndex',
      'src/services/folderSizeIndexer',
      'src/services/folderSizeTransferState',
      'src/services/folderSizeManager',
    ],
  });

  // The transfer state before the manager, deliberately. `requireFresh` builds
  // a new module each time it is asked, and the manager captures whichever one
  // exists when it is loaded — asking for it afterwards hands the test a second
  // instance holding a set the manager never reads.
  const transferState = currentEnv.requireFresh('src/services/folderSizeTransferState');
  const folderSizeIndex = currentEnv.requireFresh('src/services/folderSizeIndex');
  manager = currentEnv.requireFresh('src/services/folderSizeManager');
  const db = await currentEnv.requireFresh('src/services/db').getDb();

  await manager.start();

  return { manager, folderSizeIndex, transferState, db, volume: currentEnv.volumeDir };
};

/** A folder holding one file of a known size. */
const folderWith = async (volume, name, bytes) => {
  const dir = path.join(volume, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'content.bin'), Buffer.alloc(bytes, 1));
  return dir;
};

/** Mark it, then shut down — which flushes everything still pending. */
const settle = async (dirs) => {
  await manager.touch(dirs);
  await manager.stop();
};

const sizeOf = (folderSizeIndex, db, dir) => folderSizeIndex.getByAbsolutePath(db, dir)?.sizeBytes;

afterEach(async () => {
  try {
    await manager?.stop();
  } catch (_) {
    // Already stopped.
  }
  manager = null;
  if (currentEnv) {
    await currentEnv.cleanup();
    currentEnv = null;
  }
});

describe('a folder a listing has touched', () => {
  it('has its size recorded', async () => {
    const { folderSizeIndex, db, volume } = await setup();
    const dir = await folderWith(volume, 'Photos', 2048);

    await settle([dir]);

    expect(sizeOf(folderSizeIndex, db, dir)).toBe(2048);
  });

  it('has it corrected when the folder grows', async () => {
    const { folderSizeIndex, db, volume } = await setup();
    const dir = await folderWith(volume, 'Photos', 1024);
    await manager.touch([dir]);
    await fs.writeFile(path.join(dir, 'more.bin'), Buffer.alloc(3072, 1));

    await settle([dir]);

    expect(sizeOf(folderSizeIndex, db, dir)).toBe(4096);
  });

  /** Shutting down is not a reason to lose what was already measured. */
  it('is recorded even when the flush only happens on the way out', async () => {
    const { folderSizeIndex, db, volume } = await setup();
    const dir = await folderWith(volume, 'Photos', 512);

    await manager.touch([dir]);
    await manager.stop();

    expect(sizeOf(folderSizeIndex, db, dir)).toBe(512);
  });
});

describe('a folder in the middle of a copy', () => {
  /**
   * Its size is true for an instant and wrong immediately after. Recording it
   * leaves a number nobody corrects until something else happens to that
   * folder.
   *
   * The rule is enforced twice — once where a folder is marked and once where
   * the marks are aggregated — so removing either guard alone changes nothing
   * these can see. Removing both does. What is pinned here is the property,
   * not either of the two places that keep it.
   */
  it('is left out of the index', async () => {
    const { folderSizeIndex, db, transferState, volume } = await setup();
    const dir = await folderWith(volume, 'Incoming', 4096);
    transferState.begin(dir);

    await settle([dir]);

    expect(sizeOf(folderSizeIndex, db, dir)).toBeUndefined();
  });

  it('is taken in once the copy has finished', async () => {
    const { folderSizeIndex, db, transferState, volume } = await setup();
    const dir = await folderWith(volume, 'Incoming', 4096);
    transferState.begin(dir);
    await manager.touch([dir]);
    transferState.finish(dir);

    await settle([dir]);

    expect(sizeOf(folderSizeIndex, db, dir)).toBe(4096);
  });

  /** A copy into a subfolder makes the folder above it just as uncertain. */
  it('keeps its parent out as well', async () => {
    const { folderSizeIndex, db, transferState, volume } = await setup();
    const parent = await folderWith(volume, 'Media', 1024);
    const child = path.join(parent, 'Incoming');
    await fs.mkdir(child, { recursive: true });
    transferState.begin(child);

    await settle([parent]);

    expect(sizeOf(folderSizeIndex, db, parent)).toBeUndefined();
  });
});

describe('what the index will not walk into', () => {
  /**
   * The property, and only the property.
   *
   * Exclusion is applied in four places: where a folder is marked, where the
   * marks are aggregated, in a prune at startup, and inside the aggregator
   * itself. Removing any pair of them leaves the folder out all the same, so
   * nothing below can say which one is doing the work — see TODO.md, where the
   * same shape is already open against the search bounds.
   */
  it('leaves an excluded folder out', async () => {
    const { folderSizeIndex, db, volume } = await setup({ FOLDER_SIZE_EXCLUDE_PATHS: 'Excluded' });
    const dir = await folderWith(volume, 'Excluded', 8192);

    await settle([dir]);

    expect(sizeOf(folderSizeIndex, db, dir)).toBeUndefined();
  });

  it('still takes in the folder beside it', async () => {
    const { folderSizeIndex, db, volume } = await setup({ FOLDER_SIZE_EXCLUDE_PATHS: 'Excluded' });
    await folderWith(volume, 'Excluded', 8192);
    const kept = await folderWith(volume, 'Kept', 256);

    await settle([kept]);

    expect(sizeOf(folderSizeIndex, db, kept)).toBe(256);
  });

  it('ignores a path outside the volume entirely', async () => {
    const { folderSizeIndex, db } = await setup();
    const outside = path.join(currentEnv.tmpRoot, 'outside');
    await fs.mkdir(outside, { recursive: true });

    await settle([outside]);

    expect(sizeOf(folderSizeIndex, db, outside)).toBeUndefined();
  });

  it('ignores something that is a file rather than a folder', async () => {
    const { folderSizeIndex, db, volume } = await setup();
    const file = path.join(volume, 'note.txt');
    await fs.writeFile(file, 'not a folder');

    await settle([file]);

    expect(sizeOf(folderSizeIndex, db, file)).toBeUndefined();
  });
});

describe('a folder that is no longer there', () => {
  /** The entry has to go, or the total keeps counting something deleted. */
  it('is removed from the index', async () => {
    const { folderSizeIndex, db, volume } = await setup();
    const dir = await folderWith(volume, 'Temporary', 1024);
    await settle([dir]);
    expect(sizeOf(folderSizeIndex, db, dir)).toBe(1024);

    await manager.start();
    await fs.rm(dir, { recursive: true, force: true });
    await settle([dir]);

    expect(sizeOf(folderSizeIndex, db, dir)).toBeUndefined();
  });
});

describe('being asked to take in nothing', () => {
  it('is not an error', async () => {
    const { volume } = await setup();

    await expect(manager.touch([])).resolves.toBeUndefined();
    await expect(manager.touch()).resolves.toBeUndefined();
    expect(volume).toBeTruthy();
  });
});
