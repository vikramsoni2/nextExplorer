import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setupTestEnv } from '../helpers/env-test-utils.js';

const INDEXER_MODULES = [
  'src/services/folderSizeIndex',
  'src/services/folderSizeIndexer',
  'src/services/folderSizeManager',
];

/**
 * Build a fresh, isolated indexer test context: temp volume + database and
 * freshly-required modules bound to that environment.
 */
const createContext = async (extraEnv = {}) => {
  const env = await setupTestEnv({
    tag: 'folder-size-indexer-',
    modules: INDEXER_MODULES,
    env: { FOLDER_SIZE_MODE: 'full', ...extraEnv },
  });
  const { getDb } = env.requireFresh('src/services/db');
  const folderSizeIndex = env.requireFresh('src/services/folderSizeIndex');
  const indexer = env.requireFresh('src/services/folderSizeIndexer');
  const db = await getDb();
  const scope = { root: env.volumeDir, label: 'volume' };
  return { env, db, folderSizeIndex, indexer, scope };
};

const sizeOf = (folderSizeIndex, db, absPath) => {
  const entry = folderSizeIndex.getByAbsolutePath(db, absPath);
  return entry ? entry.sizeBytes : null;
};

describe('folderSizeIndexer', () => {
  let ctx;
  let manager;

  afterEach(async () => {
    await manager?.stop();
    manager = null;
    if (ctx) {
      await ctx.env.cleanup();
      ctx = null;
    }
  });

  it('baseline scan aggregates recursive sizes across a tree', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;

    // vol/A/B/f1 (100), vol/A/f2 (50), vol/C/f3 (10)
    await fs.mkdir(path.join(vol, 'A', 'B'), { recursive: true });
    await fs.mkdir(path.join(vol, 'C'), { recursive: true });
    await fs.writeFile(path.join(vol, 'A', 'B', 'f1'), Buffer.alloc(100));
    await fs.writeFile(path.join(vol, 'A', 'f2'), Buffer.alloc(50));
    await fs.writeFile(path.join(vol, 'C', 'f3'), Buffer.alloc(10));

    const result = await indexer.runBaseline(db, scope, { mode: 'full' });
    expect(result.folders).toBe(4); // root, A, A/B, C
    expect(result.bytes).toBe(160);

    expect(sizeOf(folderSizeIndex, db, vol)).toBe(160);
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A'))).toBe(150);
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A', 'B'))).toBe(100);
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'C'))).toBe(10);

    const rootEntry = folderSizeIndex.getByAbsolutePath(db, vol);
    expect(rootEntry.entryCount).toBe(2); // A and C
  });

  it('does not traverse or index excluded directory trees', async () => {
    ctx = await createContext({ FOLDER_SIZE_EXCLUDE_PATHS: 'A/excluded' });
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;

    await fs.mkdir(path.join(vol, 'A', 'excluded', 'deep'), { recursive: true });
    await fs.mkdir(path.join(vol, 'A', 'included'), { recursive: true });
    await fs.writeFile(path.join(vol, 'A', 'excluded', 'deep', 'large.bin'), Buffer.alloc(200));
    await fs.writeFile(path.join(vol, 'A', 'included', 'kept.bin'), Buffer.alloc(50));

    const exclusions = env.requireFresh('src/services/folderSizeExclusions');
    const result = await indexer.runBaseline(db, scope, {
      mode: 'full',
      shouldExclude: (absolutePath) => exclusions.isExcluded(absolutePath, scope),
    });

    expect(result.bytes).toBe(50);
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A'))).toBe(50);
    expect(folderSizeIndex.getByAbsolutePath(db, path.join(vol, 'A', 'excluded'))).toBeNull();
  });

  it('releases callers when a filesystem operation stalls and opens a safety circuit', async () => {
    ctx = await createContext();
    const { indexer } = ctx;

    await expect(
      indexer.withIoTimeout('readdir', '/stalled/one', () => new Promise(() => {}), {
        timeoutMs: 10,
        maxStalledIo: 1,
      })
    ).rejects.toMatchObject({
      code: 'FOLDER_SIZE_IO_TIMEOUT',
      operation: 'readdir',
      path: '/stalled/one',
    });

    expect(indexer.getIoDiagnostics()).toMatchObject({
      maxStalledIo: 2,
      stalledOperations: [{ operation: 'readdir', path: '/stalled/one' }],
    });

    await expect(
      indexer.withIoTimeout('stat', '/stalled/two', () => Promise.resolve(), {
        timeoutMs: 10,
        maxStalledIo: 1,
      })
    ).rejects.toMatchObject({
      code: 'FOLDER_SIZE_IO_CIRCUIT_OPEN',
      operation: 'stat',
      path: '/stalled/two',
    });
  });

  it('a delta on a file propagates to every ancestor', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;

    await fs.mkdir(path.join(vol, 'A', 'B'), { recursive: true });
    await fs.writeFile(path.join(vol, 'A', 'B', 'f1'), Buffer.alloc(100));
    await indexer.runBaseline(db, scope, { mode: 'full' });

    const before = {
      root: sizeOf(folderSizeIndex, db, vol),
      a: sizeOf(folderSizeIndex, db, path.join(vol, 'A')),
      ab: sizeOf(folderSizeIndex, db, path.join(vol, 'A', 'B')),
    };

    // Simulate a 40-byte file added inside A/B.
    indexer.applyDelta(db, scope, path.join(vol, 'A', 'B'), 40, { entryDelta: 1 });

    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A', 'B'))).toBe(before.ab + 40);
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A'))).toBe(before.a + 40);
    expect(sizeOf(folderSizeIndex, db, vol)).toBe(before.root + 40);
    expect(folderSizeIndex.getByAbsolutePath(db, path.join(vol, 'A', 'B')).entryCount).toBe(2);
  });

  it('clones indexed directory metadata without another filesystem traversal', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;
    const source = path.join(vol, 'Source');
    const target = path.join(vol, 'Copies', 'Source copy');

    await fs.mkdir(path.join(source, 'nested'), { recursive: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(path.join(source, 'top.bin'), Buffer.alloc(30));
    await fs.writeFile(path.join(source, 'nested', 'deep.bin'), Buffer.alloc(70));
    await indexer.runBaseline(db, scope, { mode: 'full' });

    const copied = folderSizeIndex.cloneSubtree(db, scope, source, target);

    expect(copied).toBe(2);
    expect(sizeOf(folderSizeIndex, db, target)).toBe(100);
    expect(sizeOf(folderSizeIndex, db, path.join(target, 'nested'))).toBe(70);
    expect(folderSizeIndex.getByAbsolutePath(db, target).dirty).toBe(0);
  });

  it('indexes a newly-created subtree and updates its ancestors in one pass', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;

    await fs.mkdir(path.join(vol, 'Existing'), { recursive: true });
    await fs.writeFile(path.join(vol, 'Existing', 'before'), Buffer.alloc(10));
    await indexer.runBaseline(db, scope, { mode: 'full' });

    // Mirrors archive extraction: the new tree did not exist in the baseline.
    const extracted = path.join(vol, 'Existing', 'Extracted');
    await fs.mkdir(path.join(extracted, 'nested'), { recursive: true });
    await fs.writeFile(path.join(extracted, 'top.bin'), Buffer.alloc(20));
    await fs.writeFile(path.join(extracted, 'nested', 'payload.bin'), Buffer.alloc(70));

    const result = await indexer.indexSubtree(db, scope, extracted, { mode: 'full' });

    expect(result).toMatchObject({ folders: 2, bytes: 90 });
    expect(sizeOf(folderSizeIndex, db, extracted)).toBe(90);
    expect(sizeOf(folderSizeIndex, db, path.join(extracted, 'nested'))).toBe(70);
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'Existing'))).toBe(100);
    expect(sizeOf(folderSizeIndex, db, vol)).toBe(100);
  });

  it('replaces a pending transferred directory with an authoritative post-copy size', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;
    const parent = path.join(vol, 'Destination');
    const transferred = path.join(parent, 'Copied folder');

    await fs.mkdir(parent, { recursive: true });
    await fs.writeFile(path.join(parent, 'before.bin'), Buffer.alloc(10));
    await indexer.runBaseline(db, scope, { mode: 'full' });

    // During a copy, the folder is recorded as pending without estimating its
    // recursive bytes from possibly stale source metadata.
    await fs.mkdir(path.join(transferred, 'nested'), { recursive: true });
    await fs.writeFile(path.join(transferred, 'top.bin'), Buffer.alloc(20));
    await fs.writeFile(path.join(transferred, 'nested', 'payload.bin'), Buffer.alloc(70));
    folderSizeIndex.upsertPendingDirectoryEntry(db, scope, {
      absolutePath: transferred,
      sizeBytes: 0,
      entryCount: 0,
    });
    folderSizeIndex.applyDelta(db, scope, parent, 0, { entryDelta: 1 });

    expect(sizeOf(folderSizeIndex, db, parent)).toBe(10);
    expect(folderSizeIndex.getByAbsolutePath(db, transferred)).toMatchObject({ dirty: 1 });

    await indexer.indexSubtree(db, scope, transferred, { mode: 'full' });

    expect(sizeOf(folderSizeIndex, db, transferred)).toBe(90);
    expect(sizeOf(folderSizeIndex, db, parent)).toBe(100);
    expect(sizeOf(folderSizeIndex, db, vol)).toBe(100);
    expect(folderSizeIndex.getByAbsolutePath(db, transferred)).toMatchObject({ dirty: 0 });
  });

  it('allows only the transfer finalizer to scan a directory still protected from on-view refreshes', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;
    const target = path.join(vol, 'Destination', 'Transferred');

    await fs.mkdir(path.join(target, 'nested'), { recursive: true });
    await fs.writeFile(path.join(target, 'nested', 'payload.bin'), Buffer.alloc(90));
    await indexer.runBaseline(db, scope, { mode: 'full' });

    const transferState = env.requireFresh('src/services/folderSizeTransferState');
    manager = env.requireFresh('src/services/folderSizeManager');
    await manager.start();
    transferState.begin(target);

    await expect(manager.refreshSubtree(target)).resolves.toBeNull();
    await expect(
      manager.refreshSubtree(target, { allowActiveTransfer: true })
    ).resolves.toMatchObject({
      bytes: 90,
    });
    expect(sizeOf(folderSizeIndex, db, target)).toBe(90);

    transferState.finish(target);
  });

  it('cancels an active subtree scan when a mutation invalidates its path', async () => {
    ctx = await createContext();
    const { env, indexer } = ctx;
    const target = path.join(env.volumeDir, 'Mutating');
    await fs.mkdir(target, { recursive: true });

    manager = env.requireFresh('src/services/folderSizeManager');
    await manager.start();

    const originalIndexSubtree = indexer.indexSubtree;
    let scanStarted;
    const started = new Promise((resolve) => {
      scanStarted = resolve;
    });
    indexer.indexSubtree = (_db, _scope, _absolutePath, { signal }) =>
      new Promise((_resolve, reject) => {
        scanStarted();
        signal.addEventListener(
          'abort',
          () => {
            const error = new Error('scan aborted');
            error.code = 'FOLDER_SIZE_SCAN_ABORTED';
            reject(error);
          },
          { once: true }
        );
      });

    try {
      const refresh = manager.refreshSubtree(target);
      await started;

      expect(manager.invalidateSubtree(target, 'entry-deleted')).toMatchObject({ active: true });
      await expect(refresh).resolves.toBeNull();
      expect(manager.getDiagnosticsSnapshot().subtree.stats.cancelled).toBe(1);
    } finally {
      indexer.indexSubtree = originalIndexSubtree;
    }
  });

  it('bounds large-directory metadata work into paced batches', async () => {
    ctx = await createContext();
    const { env, db, indexer, scope } = ctx;
    const target = path.join(env.volumeDir, 'large-directory');
    await fs.mkdir(target, { recursive: true });

    for (let i = 0; i < 45; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(target, `file-${i}`), Buffer.alloc(1));
    }

    const result = await indexer.indexSubtree(db, scope, target, {
      mode: 'full',
      concurrency: 2,
      batchSize: 20,
      yieldEvery: 20,
      pauseMs: 0,
    });

    expect(result).toMatchObject({ folders: 1, files: 45, bytes: 45, pauses: 0 });
    // 45 files over batches of 20 means two cooperative yields before the
    // final batch. This guards against returning to an unbounded promise queue.
    expect(result.batches).toBe(2);
  });

  it('marks an aggregate incomplete when a direct child directory is missing from the index', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;

    await fs.mkdir(path.join(vol, 'Known'), { recursive: true });
    await indexer.runBaseline(db, scope, { mode: 'full' });

    await fs.mkdir(path.join(vol, 'Known', 'AddedLater', 'nested'), { recursive: true });
    await fs.writeFile(
      path.join(vol, 'Known', 'AddedLater', 'nested', 'payload.bin'),
      Buffer.alloc(25)
    );

    const aggregate = await indexer.aggregateDirectory(db, scope, path.join(vol, 'Known'), {
      mode: 'full',
    });

    expect(aggregate).toMatchObject({ hasUnindexedSubdirectories: true });
    expect(folderSizeIndex.getByAbsolutePath(db, path.join(vol, 'Known', 'AddedLater'))).toBeNull();
  });

  it('skips a directory explicitly marked as an active transfer during reconciliation', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;
    const transferring = path.join(vol, 'Transferring');

    await fs.mkdir(transferring, { recursive: true });
    await fs.writeFile(path.join(transferring, 'before.bin'), Buffer.alloc(10));
    await indexer.runBaseline(db, scope, { mode: 'full' });

    await fs.writeFile(path.join(transferring, 'during-copy.bin'), Buffer.alloc(90));
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(transferring, future, future);

    await indexer.reconcile(db, scope, {
      mode: 'full',
      shouldSkip: (absolutePath) => absolutePath === transferring,
    });
    expect(sizeOf(folderSizeIndex, db, transferring)).toBe(10);

    await indexer.reconcile(db, scope, { mode: 'full' });
    expect(sizeOf(folderSizeIndex, db, transferring)).toBe(100);
  });

  it('queues a targeted recovery when reconciliation finds an unindexed child subtree', async () => {
    ctx = await createContext();
    const { env, db, indexer, scope } = ctx;
    const vol = env.volumeDir;

    await fs.mkdir(path.join(vol, 'Known'), { recursive: true });
    await indexer.runBaseline(db, scope, { mode: 'full' });

    const added = path.join(vol, 'Known', 'AddedLater', 'nested');
    await fs.mkdir(added, { recursive: true });
    await fs.writeFile(path.join(added, 'payload.bin'), Buffer.alloc(25));
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(path.join(vol, 'Known'), future, future);

    const incomplete = [];
    await indexer.reconcile(db, scope, {
      mode: 'full',
      onIncompleteSubtree: (absolutePath) => incomplete.push(absolutePath),
    });

    expect(incomplete).toContain(path.join(vol, 'Known'));
  });

  it('stores a per-volume index version after a successful baseline', async () => {
    ctx = await createContext();
    const { db, folderSizeIndex, indexer, scope } = ctx;

    expect(folderSizeIndex.getIndexVersion(db, scope)).toBe(0);
    await indexer.runBaseline(db, scope, { mode: 'full' });
    folderSizeIndex.setIndexVersion(db, scope);

    expect(folderSizeIndex.getIndexVersion(db, scope)).toBe(folderSizeIndex.CURRENT_INDEX_VERSION);
  });

  it('rebuilds a populated legacy index once before serving folder sizes', async () => {
    const env = await setupTestEnv({
      tag: 'folder-size-manager-',
      modules: INDEXER_MODULES,
      env: { FOLDER_SIZE_MODE: 'full' },
    });
    ctx = { env };

    const { getDb } = env.requireFresh('src/services/db');
    const folderSizeIndex = env.requireFresh('src/services/folderSizeIndex');
    const scope = { root: env.volumeDir, label: 'volume' };
    const legacy = path.join(scope.root, 'Legacy');
    await fs.mkdir(path.join(legacy, 'nested'), { recursive: true });
    await fs.writeFile(path.join(legacy, 'nested', 'payload.bin'), Buffer.alloc(42));

    const db = await getDb();
    const scannedAt = new Date().toISOString();
    folderSizeIndex.upsertScanEntry(db, scope, {
      absolutePath: scope.root,
      sizeBytes: 0,
      entryCount: 1,
      lastFullScanAt: scannedAt,
    });
    folderSizeIndex.upsertScanEntry(db, scope, {
      absolutePath: legacy,
      sizeBytes: 0,
      entryCount: 1,
      lastFullScanAt: scannedAt,
    });

    expect(folderSizeIndex.getIndexVersion(db, scope)).toBe(0);

    manager = env.requireFresh('src/services/folderSizeManager');
    await manager.start();

    expect(folderSizeIndex.getIndexVersion(db, scope)).toBe(folderSizeIndex.CURRENT_INDEX_VERSION);
    expect(folderSizeIndex.getByAbsolutePath(db, legacy).sizeBytes).toBe(42);
    expect(folderSizeIndex.getByAbsolutePath(db, path.join(legacy, 'nested')).sizeBytes).toBe(42);
  });

  it('reconciliation detects and corrects an out-of-band change via mtime', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;

    await fs.mkdir(path.join(vol, 'A', 'B'), { recursive: true });
    await fs.mkdir(path.join(vol, 'C'), { recursive: true });
    await fs.writeFile(path.join(vol, 'A', 'B', 'f1'), Buffer.alloc(100));
    await fs.writeFile(path.join(vol, 'C', 'f3'), Buffer.alloc(10));
    await indexer.runBaseline(db, scope, { mode: 'full' });
    // Keep this untouched folder decisively older than its scan record. Some
    // filesystems expose mtimes with a coarser resolution than Date.now().
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(path.join(vol, 'C'), past, past);

    // Add a file directly on the filesystem WITHOUT going through applyDelta,
    // then bump the directory mtime so the reconciler notices it changed.
    await fs.writeFile(path.join(vol, 'A', 'B', 'f_ext'), Buffer.alloc(25));
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(path.join(vol, 'A', 'B'), future, future);

    const result = await indexer.reconcile(db, scope, { mode: 'full' });

    expect(result.changed).toBeGreaterThanOrEqual(1);
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A', 'B'))).toBe(125);
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A'))).toBe(125);
    expect(sizeOf(folderSizeIndex, db, vol)).toBe(135); // 125 + C(10)
    // The untouched C folder should have been skipped, not re-aggregated.
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'C'))).toBe(10);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('reconciliation removes vanished folders and subtracts their size', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;

    await fs.mkdir(path.join(vol, 'A', 'B'), { recursive: true });
    await fs.writeFile(path.join(vol, 'A', 'B', 'f1'), Buffer.alloc(100));
    await fs.writeFile(path.join(vol, 'A', 'f2'), Buffer.alloc(50));
    await indexer.runBaseline(db, scope, { mode: 'full' });

    // Remove A/B out of band.
    await fs.rm(path.join(vol, 'A', 'B'), { recursive: true, force: true });
    await indexer.reconcile(db, scope, { mode: 'full' });

    expect(folderSizeIndex.getByAbsolutePath(db, path.join(vol, 'A', 'B'))).toBeNull();
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A'))).toBe(50);
    expect(sizeOf(folderSizeIndex, db, vol)).toBe(50);
  });

  it('reconciles correctly when paging (batch smaller than the tree)', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;

    await fs.mkdir(path.join(vol, 'A', 'B'), { recursive: true });
    await fs.mkdir(path.join(vol, 'C'), { recursive: true });
    await fs.writeFile(path.join(vol, 'A', 'B', 'f1'), Buffer.alloc(100));
    await fs.writeFile(path.join(vol, 'A', 'f2'), Buffer.alloc(50));
    await fs.writeFile(path.join(vol, 'C', 'f3'), Buffer.alloc(10));
    await indexer.runBaseline(db, scope, { mode: 'full' });

    // Out of band: remove A/B (−100) and add 5 bytes in C.
    await fs.rm(path.join(vol, 'A', 'B'), { recursive: true, force: true });
    await fs.writeFile(path.join(vol, 'C', 'f4'), Buffer.alloc(5));
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(path.join(vol, 'C'), future, future);

    // batch=1 forces multiple pages; the DESC order must remove A/B's size from A
    // before A is re-aggregated (no double counting). pauseMs=0 keeps it fast.
    await indexer.reconcile(db, scope, { mode: 'full', batch: 1, pauseMs: 0 });

    expect(folderSizeIndex.getByAbsolutePath(db, path.join(vol, 'A', 'B'))).toBeNull();
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A'))).toBe(50); // only f2 remains
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'C'))).toBe(15); // f3 + f4
    expect(sizeOf(folderSizeIndex, db, vol)).toBe(65); // A(50) + C(15)
  });

  it('resumes a bounded reconciliation pass from its SQLite cursor', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;

    await fs.mkdir(path.join(vol, 'A', 'B'), { recursive: true });
    await fs.mkdir(path.join(vol, 'C'), { recursive: true });
    await fs.writeFile(path.join(vol, 'A', 'B', 'f1'), Buffer.alloc(100));
    await fs.writeFile(path.join(vol, 'C', 'f2'), Buffer.alloc(10));
    await indexer.runBaseline(db, scope, { mode: 'full' });

    await fs.writeFile(path.join(vol, 'A', 'B', 'external'), Buffer.alloc(25));
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(path.join(vol, 'A', 'B'), future, future);

    let cursor = null;
    let result;
    let slices = 0;
    do {
      // eslint-disable-next-line no-await-in-loop
      result = await indexer.reconcile(db, scope, {
        mode: 'full',
        batch: 1,
        pauseMs: 0,
        beforeRelativePath: cursor,
        maxDirectories: 2,
      });
      expect(result.processed).toBeLessThanOrEqual(2);
      cursor = result.nextCursor;
      slices += 1;
    } while (result.hasMore && slices < 10);

    expect(slices).toBeGreaterThan(1);
    expect(result.hasMore).toBe(false);
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A', 'B'))).toBe(125);
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A'))).toBe(125);
    expect(sizeOf(folderSizeIndex, db, vol)).toBe(135);
  });

  it('aggregates a deep tree (depth beyond the concurrency budget) correctly', async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;

    // A linear chain L0/L1/.../L9, each level holding a 10-byte file. Depth (10)
    // far exceeds the concurrency budget (1); the old recursive walk risked a
    // deadlock/blowup here, the iterative DFS must aggregate it cleanly.
    const depth = 10;
    let dir = vol;
    for (let i = 0; i < depth; i += 1) {
      dir = path.join(dir, `L${i}`);
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(dir, { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(dir, 'f'), Buffer.alloc(10));
    }

    const result = await indexer.runBaseline(db, scope, { mode: 'full', concurrency: 1 });
    expect(result.folders).toBe(depth + 1); // root + L0..L9
    expect(result.bytes).toBe(depth * 10); // 100

    // Each level Lk holds its own 10 bytes plus everything below it.
    dir = vol;
    for (let i = 0; i < depth; i += 1) {
      dir = path.join(dir, `L${i}`);
      expect(sizeOf(folderSizeIndex, db, dir)).toBe((depth - i) * 10);
    }
    expect(sizeOf(folderSizeIndex, db, vol)).toBe(100);
  });

  it("shallow mode stores only each folder's direct file bytes", async () => {
    ctx = await createContext();
    const { env, db, folderSizeIndex, indexer, scope } = ctx;
    const vol = env.volumeDir;

    await fs.mkdir(path.join(vol, 'A', 'B'), { recursive: true });
    await fs.writeFile(path.join(vol, 'A', 'B', 'f1'), Buffer.alloc(100));
    await fs.writeFile(path.join(vol, 'A', 'f2'), Buffer.alloc(50));

    await indexer.runBaseline(db, scope, { mode: 'shallow' });

    // Direct-entries-only: A counts f2 (50), not the 100 nested inside A/B.
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A'))).toBe(50);
    expect(sizeOf(folderSizeIndex, db, path.join(vol, 'A', 'B'))).toBe(100);
    expect(sizeOf(folderSizeIndex, db, vol)).toBe(0); // root has no direct files
  });

  it('isStale flags only unknown or mtime-advanced folders', async () => {
    ctx = await createContext();
    const { indexer } = ctx;
    expect(indexer.isStale(null, 1000)).toBe(true); // never indexed
    expect(indexer.isStale({ lastFullScanAt: new Date(1000).toISOString() }, 2000)).toBe(true);
    expect(indexer.isStale({ lastFullScanAt: new Date(5000).toISOString() }, 2000)).toBe(false);
    // A recent incremental delta also counts as "known".
    expect(indexer.isStale({ lastDeltaAt: new Date(5000).toISOString() }, 2000)).toBe(false);
  });

  it('nextReconcileDelay accelerates on change and backs off when idle', async () => {
    ctx = await createContext();
    const { indexer } = ctx;
    const bounds = { minMs: 300000, maxMs: 43200000 };
    expect(indexer.nextReconcileDelay(1000000, 3, bounds)).toBe(300000); // change -> reset to min
    expect(indexer.nextReconcileDelay(0, 0, bounds)).toBe(600000); // idle from cold -> min*2
    expect(indexer.nextReconcileDelay(600000, 0, bounds)).toBe(1200000); // idle -> double
    expect(indexer.nextReconcileDelay(40000000, 0, bounds)).toBe(43200000); // capped at max
  });

  it('does not monopolise the event loop during a baseline scan', async () => {
    ctx = await createContext();
    const { env, db, indexer, scope } = ctx;
    const vol = env.volumeDir;

    // Build enough folders that the baseline yields multiple times.
    for (let i = 0; i < 60; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(path.join(vol, `dir-${i}`, 'sub'), { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(vol, `dir-${i}`, 'sub', 'f'), Buffer.alloc(8));
    }

    let baselineDone = false;
    const heartbeat = [];
    const beat = async () => {
      for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 2));
        heartbeat.push(baselineDone);
      }
    };

    const scan = indexer
      .runBaseline(db, scope, { mode: 'full', yieldEvery: 5, concurrency: 2 })
      .then(() => {
        baselineDone = true;
      });

    await Promise.all([scan, beat()]);

    // At least one heartbeat must have fired while the scan was still running,
    // proving the event loop kept servicing other (HTTP-like) work.
    expect(heartbeat.some((done) => done === false)).toBe(true);
  });
});
