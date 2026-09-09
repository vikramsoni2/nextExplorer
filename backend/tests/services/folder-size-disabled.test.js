import { afterEach, describe, expect, it } from 'vitest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

const MODULES = [
  'src/config/env',
  'src/config/index',
  'src/services/folderSizeManager',
  'src/services/folderSizeTransferState',
];

describe('Folder size disabled mode', () => {
  let ctx;

  afterEach(async () => {
    if (ctx) {
      await ctx.env.cleanup();
      ctx = null;
    }
  });

  it.each([undefined, 'invalid-mode'])(
    'normalizes %s to off and leaves the indexer dormant',
    async (folderSizeMode) => {
      const env = await setupTestEnv({
        tag: 'folder-size-disabled-',
        modules: MODULES,
        env: { FOLDER_SIZE_MODE: folderSizeMode },
      });
      ctx = { env };

      const config = env.requireFresh('src/config/index');
      const manager = env.requireFresh('src/services/folderSizeManager');
      const transferState = env.requireFresh('src/services/folderSizeTransferState');

      expect(config.folderSize).toMatchObject({ mode: 'off', enabled: false });

      await manager.start();

      expect(transferState.isRelatedToActiveTransfer('/tmp/folder-size-disabled-transfer')).toBe(
        false
      );
      expect(await manager.refreshSubtree('/tmp/folder-size-disabled-transfer')).toBeNull();
      expect(manager.getDiagnosticsSnapshot()).toMatchObject({
        running: false,
        starting: false,
        flushing: false,
        reconciling: false,
        dirtyDirectories: 0,
        pendingSubtreeScans: 0,
      });
    }
  );
});
