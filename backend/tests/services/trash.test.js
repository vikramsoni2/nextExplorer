const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const { setupTestEnv } = require('../helpers/env-test-utils');

const TRASH_MODULES = [
  'src/services/db',
  'src/services/storage/jsonStorage',
  'src/services/settingsService',
  'src/services/accessControlService',
  'src/services/accessManager',
  'src/utils/pathUtils',
  'src/utils/fsUtils',
  'src/services/trashService',
  'src/services/fileTransferService',
];

const pathExists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

test('deleteItems moves volume files to trash and allows restore', async () => {
  const envContext = await setupTestEnv({
    tag: 'trash-service-test-',
    modules: TRASH_MODULES,
  });

  try {
    const fileTransferService = envContext.requireFresh('src/services/fileTransferService');
    const trashService = envContext.requireFresh('src/services/trashService');

    const volumeRoot = envContext.volumeDir;
    const projectDir = path.join(volumeRoot, 'Projects');
    await fs.mkdir(projectDir, { recursive: true });

    const originalAbsolute = path.join(projectDir, 'hello.txt');
    await fs.writeFile(originalAbsolute, 'hello');

    const user = { id: 'u1', roles: ['admin'] };
    const results = await fileTransferService.deleteItems(
      [{ path: 'Projects', name: 'hello.txt' }],
      { user }
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'trashed');
    assert.ok(results[0].trashId);
    assert.equal(await pathExists(originalAbsolute), false);

    const listing = await trashService.listTrashItems(user.id);
    assert.equal(listing.length, 1);
    assert.equal(listing[0].originalPath, 'Projects/hello.txt');
    assert.ok(typeof listing[0].trashAbsolutePath === 'string' && listing[0].trashAbsolutePath.length > 0);
    assert.equal(await pathExists(listing[0].trashAbsolutePath), true);

    const restored = await trashService.restoreTrashItem(results[0].trashId, { user });
    assert.equal(restored.restoredPath, 'Projects/hello.txt');
    assert.equal(await pathExists(originalAbsolute), true);

    const after = await trashService.listTrashItems(user.id);
    assert.equal(after.length, 0);
  } finally {
    await envContext.cleanup();
  }
});

test('restoreTrashItem auto-renames on destination conflicts', async () => {
  const envContext = await setupTestEnv({
    tag: 'trash-service-conflict-test-',
    modules: TRASH_MODULES,
  });

  try {
    const fileTransferService = envContext.requireFresh('src/services/fileTransferService');
    const trashService = envContext.requireFresh('src/services/trashService');

    const volumeRoot = envContext.volumeDir;
    const projectDir = path.join(volumeRoot, 'Projects');
    await fs.mkdir(projectDir, { recursive: true });

    const originalAbsolute = path.join(projectDir, 'hello.txt');
    await fs.writeFile(originalAbsolute, 'hello');

    const user = { id: 'u1', roles: ['admin'] };
    const results = await fileTransferService.deleteItems(
      [{ path: 'Projects', name: 'hello.txt' }],
      { user }
    );

    assert.equal(results[0].status, 'trashed');
    const trashedId = results[0].trashId;

    // Recreate the original file so restore must choose a new name.
    await fs.writeFile(originalAbsolute, 'new');

    const restored = await trashService.restoreTrashItem(trashedId, { user });
    assert.equal(restored.restoredPath, 'Projects/hello (1).txt');
    assert.equal(await pathExists(path.join(projectDir, 'hello (1).txt')), true);
  } finally {
    await envContext.cleanup();
  }
});

