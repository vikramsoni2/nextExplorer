/**
 * Folder size indexer — core logic.
 *
 * This module owns the three ways the `folder_size_index` table is kept up to
 * date, all designed to keep HTTP reads O(1) and filesystem load negligible:
 *
 *   1. `runBaseline`  — a one-off recursive walk of a volume, run once (or on
 *                       explicit rebuild) with bounded concurrency and event
 *                       loop yields, writing authoritative sizes in batches.
 *   2. `applyDelta`   — incremental, ancestor-propagating updates (re-exported
 *                       from the storage layer) used by the write hooks and by
 *                       the watcher flush; never recomputes a subtree.
 *   3. `reconcile`    — a low-cost safety net that stat()s the mtime of every
 *                       known folder and only re-aggregates the *direct* level
 *                       of folders that changed since their last scan, then
 *                       propagates the resulting delta upward.
 *
 * Every function takes an explicit `db` and `scope` ({ root, label }) so the
 * logic can be unit tested against a temp database and directory tree, and so
 * the same code runs unchanged in the worker thread.
 */
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const pLimit = require('p-limit');

const config = require('../config/index');
const folderSizeIndex = require('./folderSizeIndex');
const { nowIso } = require('../utils/ids');

const NETWORK_FS_TYPES = new Set(['nfs', 'nfs4', 'cifs', 'smbfs', 'smb', 'smb2', 'fuse.sshfs']);

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const activeStalledIo = new Map();
let nextStalledIoId = 1;

const createIoError = (code, message, details) => {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, details);
  return err;
};

const isIoTimeoutError = (err) => err?.code === 'FOLDER_SIZE_IO_TIMEOUT';

const isIoCircuitOpenError = (err) => err?.code === 'FOLDER_SIZE_IO_CIRCUIT_OPEN';

const isMissingPathError = (err) => err?.code === 'ENOENT' || err?.code === 'ENOTDIR';

const createScanAbortedError = (absolutePath) =>
  createIoError(
    'FOLDER_SIZE_SCAN_ABORTED',
    'Folder-size subtree scan was invalidated by a mutation',
    {
      path: absolutePath,
    }
  );

/**
 * Bound a filesystem request without pretending Node can cancel it. When the
 * deadline wins, the caller is released immediately; the original fs request
 * stays tracked until it actually settles. A small circuit breaker prevents a
 * pathological mount from consuming all libuv filesystem workers over time.
 */
const withIoTimeout = (operation, absolutePath, run, options = {}) => {
  const timeoutMs = options.timeoutMs ?? config.folderSize.ioTimeoutMs;
  const maxStalledIo = options.maxStalledIo ?? config.folderSize.maxStalledIo;
  if (!timeoutMs || timeoutMs < 0) return Promise.resolve().then(run);

  if (activeStalledIo.size >= maxStalledIo) {
    return Promise.reject(
      createIoError(
        'FOLDER_SIZE_IO_CIRCUIT_OPEN',
        'Folder-size filesystem safety circuit is open',
        { operation, path: absolutePath, stalledOperations: activeStalledIo.size, maxStalledIo }
      )
    );
  }

  const operationPromise = Promise.resolve().then(run);
  return new Promise((resolve, reject) => {
    let settled = false;
    let stalledId = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stalledId = nextStalledIoId++;
      const timedOutAt = Date.now();
      activeStalledIo.set(stalledId, { operation, path: absolutePath, timedOutAt });
      reject(
        createIoError('FOLDER_SIZE_IO_TIMEOUT', 'Folder-size filesystem operation timed out', {
          operation,
          path: absolutePath,
          timeoutMs,
        })
      );
    }, timeoutMs);
    if (timer.unref) timer.unref();

    operationPromise.then(
      (value) => {
        clearTimeout(timer);
        if (stalledId !== null) {
          activeStalledIo.delete(stalledId);
          return;
        }
        if (!settled) {
          settled = true;
          resolve(value);
        }
      },
      (err) => {
        clearTimeout(timer);
        if (stalledId !== null) {
          activeStalledIo.delete(stalledId);
          return;
        }
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    );
  });
};

const getIoDiagnostics = () => ({
  stalledOperations: Array.from(activeStalledIo.values()).map(
    ({ operation, path: absolutePath, timedOutAt }) => ({
      operation,
      path: absolutePath,
      ageMs: Date.now() - timedOutAt,
    })
  ),
  maxStalledIo: config.folderSize.maxStalledIo,
  timeoutMs: config.folderSize.ioTimeoutMs,
});

/**
 * Whether a folder needs re-aggregation given a fresh stat of it: it is unknown
 * to the index, or its on-disk mtime is newer than the most recent time we
 * recorded a size for it (a full scan or an incremental delta). Used by the
 * on-view refresh and the reconciler to skip untouched folders for free.
 */
const isStale = (entry, mtimeMs) => {
  if (!entry) return true;
  if (entry.dirty) return true;
  const lastKnown = Math.max(
    entry.lastFullScanAt ? Date.parse(entry.lastFullScanAt) : 0,
    entry.lastDeltaAt ? Date.parse(entry.lastDeltaAt) : 0
  );
  return !Number.isFinite(lastKnown) || mtimeMs > lastKnown;
};

/**
 * Next adaptive reconciliation delay: reset to `minMs` whenever the last pass
 * found external changes (stay responsive while activity continues), otherwise
 * double the previous delay up to `maxMs` (back off while idle). Mirrors the
 * accelerate-on-change / decelerate-when-idle scheduling that keeps periodic
 * scanning cheap without a filesystem watcher.
 */
const nextReconcileDelay = (prevDelay, changed, { minMs, maxMs }) => {
  if (changed > 0) return minMs;
  const base = prevDelay > 0 ? prevDelay : minMs;
  return Math.min(base * 2, maxMs);
};

/** The default volume scope derived from configuration (main volume root). */
const getVolumeScope = () => ({ root: config.directories.volume, label: 'volume' });

/**
 * Best-effort detection of whether `absPath` sits on a network filesystem, so
 * the baseline can throttle concurrency there. Linux-only (reads /proc/mounts);
 * anywhere else it conservatively reports "not network".
 */
const detectNetworkFs = (absPath) => {
  try {
    const mounts = fsSync.readFileSync('/proc/mounts', 'utf8');
    let best = null;
    for (const line of mounts.split('\n')) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) continue;
      const mountPoint = parts[1];
      const fsType = parts[2];
      if (absPath === mountPoint || absPath.startsWith(mountPoint.replace(/\/?$/, '/'))) {
        // Longest matching mount point wins (most specific).
        if (!best || mountPoint.length > best.mountPoint.length) {
          best = { mountPoint, fsType };
        }
      }
    }
    if (!best) return false;
    const type = best.fsType.toLowerCase();
    return NETWORK_FS_TYPES.has(type) || type.startsWith('fuse.');
  } catch {
    // /proc/mounts absent (non-Linux) or unreadable — assume local.
    return false;
  }
};

/** Resolve the effective baseline concurrency for a scope. */
const resolveConcurrency = (scope, overrides = {}) => {
  const isNetwork =
    typeof overrides.isNetwork === 'boolean' ? overrides.isNetwork : detectNetworkFs(scope.root);
  const local = overrides.concurrency ?? config.folderSize.concurrency ?? 6;
  const network = overrides.networkConcurrency ?? config.folderSize.networkConcurrency ?? 2;
  return Math.max(1, isNetwork ? network : local);
};

const absOf = (scope, relativePath) =>
  relativePath ? path.join(scope.root, relativePath) : scope.root;

/**
 * Recursively walk `rootAbs`, writing an authoritative index entry for every
 * folder. Directory sizes are recursive in `full` mode and direct-entries-only
 * in `shallow` mode. Writes happen in batched transactions and the event loop
 * is yielded between batches so the walk never starves concurrent HTTP work.
 *
 * @returns {Promise<{ folders: number, bytes: number }>}
 */
const scanTree = async (db, scope, rootAbs, options = {}) => {
  const {
    mode = config.folderSize.mode || 'full',
    concurrency = resolveConcurrency(scope, options),
    batchSize = 300,
    yieldEvery = 200,
    pauseMs = 0,
    signal,
    shouldExclude,
    ioTimeoutMs = config.folderSize.ioTimeoutMs,
    onProgress,
  } = options;

  if (typeof shouldExclude === 'function' && shouldExclude(rootAbs)) {
    return { folders: 0, files: 0, bytes: 0, entryCount: 0, batches: 0, pauses: 0, excluded: true };
  }

  const limit = pLimit(concurrency);
  const pending = [];
  let folders = 0;
  let files = 0;
  let batches = 0;
  let pauses = 0;
  let scanTimedOut = false;

  const throwIfAborted = () => {
    if (signal?.aborted) throw createScanAbortedError(rootAbs);
  };

  const reportProgress = (phase, absolutePath) => {
    if (typeof onProgress !== 'function') return;
    onProgress({
      phase,
      path: absolutePath,
      folders,
      files,
      batches,
      at: Date.now(),
    });
  };

  const guardedFs = async (operation, absolutePath, run) => {
    if (scanTimedOut) {
      throw createIoError('FOLDER_SIZE_IO_TIMEOUT', 'Folder-size subtree scan already timed out', {
        operation,
        path: absolutePath,
        timeoutMs: ioTimeoutMs,
      });
    }
    try {
      return await withIoTimeout(operation, absolutePath, run, { timeoutMs: ioTimeoutMs });
    } catch (err) {
      if (isIoTimeoutError(err) || isIoCircuitOpenError(err)) scanTimedOut = true;
      throw err;
    }
  };

  const yieldAndPause = async () => {
    batches += 1;
    await yieldToEventLoop();
    if (pauseMs > 0) {
      pauses += 1;
      await sleep(pauseMs);
    }
  };

  const flush = () => {
    if (!pending.length) return;
    const batch = pending.splice(0, pending.length);
    folderSizeIndex.bulkUpsertScanEntries(db, scope, batch);
  };

  const recordEntry = (absDir, sizeBytes, entryCount) => {
    pending.push({ absolutePath: absDir, sizeBytes, entryCount, lastFullScanAt: nowIso() });
    folders += 1;
    if (pending.length >= batchSize) flush();
  };

  const newFrame = (abs) => ({
    abs,
    childDirs: null, // null until the directory has been read
    next: 0,
    directFileBytes: 0,
    childrenBytes: 0,
    entryCount: 0,
  });

  // Iterative post-order DFS. The stack only ever holds the frames on the
  // current root-to-node path, so peak memory is O(sum of directory widths along
  // a single path) — never O(total directories in the tree). This is what keeps
  // the baseline's RAM flat on very large volumes: the previous recursive
  // version eagerly created a promise (and held the Dirent array) for *every*
  // directory in the whole tree simultaneously.
  //
  // Only the leaf I/O (readdir, stat) goes through the concurrency limiter, and a
  // frame never holds a limiter slot while awaiting a child — so it cannot
  // deadlock on deep trees the way limiting the recursion itself would.
  const stack = [newFrame(rootAbs)];
  let rootTotal = 0;
  let rootEntryCount = 0;

  while (stack.length) {
    throwIfAborted();
    const frame = stack[stack.length - 1];

    // First visit: read the directory, stat its files (bounded concurrency) and
    // remember its subdirectories to descend into. An unreadable directory is
    // still recorded (size 0) so it exists in the index.
    if (frame.childDirs === null) {
      let entries = null;
      try {
        reportProgress('readdir', frame.abs);
        // eslint-disable-next-line no-await-in-loop
        entries = await limit(() =>
          guardedFs('readdir', frame.abs, () => fs.readdir(frame.abs, { withFileTypes: true }))
        );
        throwIfAborted();
      } catch (err) {
        if (isIoTimeoutError(err) || isIoCircuitOpenError(err)) throw err;
        frame.childDirs = [];
      }

      if (entries) {
        const filePaths = [];
        const childDirs = [];
        for (const entry of entries) {
          const full = path.join(frame.abs, entry.name);
          if (entry.isDirectory()) {
            frame.entryCount += 1;
            if (typeof shouldExclude !== 'function' || !shouldExclude(full)) {
              childDirs.push(full);
            }
          } else if (entry.isFile()) {
            frame.entryCount += 1;
            filePaths.push(full);
          } else {
            // symlink / socket / fifo / device — counted but contributes no size
            frame.entryCount += 1;
          }
        }
        // Do not enqueue a promise for every file in a large directory. The
        // limiter bounds active I/O, but its pending queue would still retain
        // thousands of closures and immediately heat the filesystem cache.
        for (let offset = 0; offset < filePaths.length; offset += batchSize) {
          throwIfAborted();
          const paths = filePaths.slice(offset, offset + batchSize);
          reportProgress('stat', frame.abs);
          // eslint-disable-next-line no-await-in-loop
          const fileSizes = await Promise.all(
            paths.map((filePath) =>
              limit(async () => {
                try {
                  return (await guardedFs('stat', filePath, () => fs.stat(filePath))).size;
                } catch (err) {
                  if (isIoTimeoutError(err) || isIoCircuitOpenError(err)) throw err;
                  return 0;
                }
              })
            )
          );
          throwIfAborted();
          frame.directFileBytes += fileSizes.reduce((total, size) => total + size, 0);
          files += paths.length;
          if (offset + paths.length < filePaths.length) {
            // eslint-disable-next-line no-await-in-loop
            await yieldAndPause();
          }
        }
        frame.childDirs = childDirs;
      }
    }

    // Descend into the next unvisited subdirectory, if any.
    if (frame.next < frame.childDirs.length) {
      const childAbs = frame.childDirs[frame.next];
      frame.childDirs[frame.next] = null; // release the path as we descend
      frame.next += 1;
      stack.push(newFrame(childAbs));
      continue;
    }

    // All children processed: finalize this directory (post-order) and bubble
    // its recursive total up to its parent.
    stack.pop();
    const recursiveTotal = frame.directFileBytes + frame.childrenBytes;
    const sizeBytes = mode === 'full' ? recursiveTotal : frame.directFileBytes;
    recordEntry(frame.abs, sizeBytes, frame.entryCount);

    if (stack.length) {
      stack[stack.length - 1].childrenBytes += recursiveTotal;
    } else {
      rootTotal = recursiveTotal;
      rootEntryCount = frame.entryCount;
    }

    if (folders % yieldEvery === 0) {
      // eslint-disable-next-line no-await-in-loop
      await yieldAndPause();
    }
  }

  throwIfAborted();
  flush();
  return { folders, files, bytes: rootTotal, entryCount: rootEntryCount, batches, pauses };
};

/** Run a full authoritative scan of the configured volume root. */
const runBaseline = (db, scope, options = {}) => scanTree(db, scope, scope.root, options);

/**
 * Index a newly-created directory tree and apply its resulting size exactly
 * once to the parent chain. This is the completion path for operations such as
 * ZIP extraction and directory copy: it avoids an eventual, view-driven walk
 * while keeping the scan limited to the newly produced subtree.
 */
const indexSubtree = async (db, scope, absDir, options = {}) => {
  if (!folderSizeIndex.isWithinRoot(scope.root, absDir)) return null;
  if (typeof options.shouldExclude === 'function' && options.shouldExclude(absDir)) return null;

  const mode = options.mode || config.folderSize.mode || 'full';
  const previous = folderSizeIndex.getByAbsolutePath(db, absDir);
  const result = await scanTree(db, scope, absDir, { ...options, mode });

  if (absDir !== scope.root) {
    // In shallow mode parents deliberately exclude their child folders' bytes.
    const byteDelta = mode === 'full' ? result.bytes - (previous?.sizeBytes || 0) : 0;
    folderSizeIndex.applyDelta(db, scope, path.dirname(absDir), byteDelta, {
      entryDelta: previous ? 0 : 1,
    });
  }

  return result;
};

/**
 * Re-aggregate the *direct* level of a single folder: sum the sizes of files
 * directly inside it and (in `full` mode) the already-indexed sizes of its
 * direct subfolders. It also reports if one of those children has no index
 * entry yet, allowing the manager to schedule one targeted subtree rebuild
 * without adding a recursive scan to the read path.
 *
 * @returns {Promise<{
 *   sizeBytes: number,
 *   entryCount: number,
 *   hasUnindexedSubdirectories: boolean
 * } | null>} null if the path is not a readable directory.
 */
const aggregateDirectory = async (db, scope, absDir, options = {}) => {
  const mode = options.mode || config.folderSize.mode || 'full';
  const ioTimeoutMs = options.ioTimeoutMs ?? config.folderSize.ioTimeoutMs;
  const shouldExclude = options.shouldExclude;
  if (typeof shouldExclude === 'function' && shouldExclude(absDir)) return null;
  let entries;
  try {
    entries = await withIoTimeout(
      'readdir',
      absDir,
      () => fs.readdir(absDir, { withFileTypes: true }),
      {
        timeoutMs: ioTimeoutMs,
      }
    );
  } catch (err) {
    if (isIoTimeoutError(err) || isIoCircuitOpenError(err)) throw err;
    return null;
  }

  let directFileBytes = 0;
  let childrenBytes = 0;
  let entryCount = 0;
  let hasUnindexedSubdirectories = false;

  for (const entry of entries) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      entryCount += 1;
      if (typeof shouldExclude === 'function' && shouldExclude(full)) continue;
      if (mode === 'full') {
        const child = folderSizeIndex.getByAbsolutePath(db, full);
        if (child) {
          childrenBytes += child.sizeBytes;
        } else {
          hasUnindexedSubdirectories = true;
        }
      }
    } else if (entry.isFile()) {
      entryCount += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        directFileBytes += (
          await withIoTimeout('stat', full, () => fs.stat(full), { timeoutMs: ioTimeoutMs })
        ).size;
      } catch (err) {
        if (isIoTimeoutError(err) || isIoCircuitOpenError(err)) throw err;
        // Unreadable/removed file mid-scan — treat as zero.
      }
    } else {
      entryCount += 1;
    }
  }

  const sizeBytes = mode === 'full' ? directFileBytes + childrenBytes : directFileBytes;
  return { sizeBytes, entryCount, hasUnindexedSubdirectories };
};

/**
 * Reconcile the index for a folder against a freshly computed aggregate
 * (synchronous — safe to call inside a wrapping better-sqlite3 transaction).
 * Applies the size delta to the folder and its ancestors, then records the new
 * direct entry count / scan time. Returns the byte delta applied.
 */
const applyAggregate = (db, scope, absDir, agg) => {
  const existing = folderSizeIndex.getByAbsolutePath(db, absDir);
  const oldSize = existing ? existing.sizeBytes : 0;
  const delta = agg.sizeBytes - oldSize;
  if (delta !== 0 || !existing) {
    folderSizeIndex.applyDelta(db, scope, absDir, delta, {});
  }
  folderSizeIndex.setScanMeta(db, absDir, {
    entryCount: agg.entryCount,
    lastFullScanAt: nowIso(),
    dirty: 0,
  });
  return delta;
};

/**
 * Drop a folder that has disappeared (or is no longer a directory) from the
 * index and remove its recorded size from the ancestors that remain
 * (synchronous). Returns the negative byte delta applied (0 if it was unknown).
 */
const removeMissing = (db, scope, absDir) => {
  const existing = folderSizeIndex.getByAbsolutePath(db, absDir);
  if (!existing) return 0;
  const size = folderSizeIndex.removeSubtree(db, scope, absDir);
  if (absDir !== scope.root && size) {
    folderSizeIndex.applyDelta(db, scope, path.dirname(absDir), -size, {});
  }
  return -size;
};

/**
 * Re-aggregate one folder and reconcile the index with the result, propagating
 * any delta to the ancestors. Returns the byte delta applied (0 if unchanged,
 * null if the folder is no longer a readable directory — caller decides what to
 * do with a vanished folder).
 */
const reconcileDirectory = async (db, scope, absDir, options = {}) => {
  const agg = await aggregateDirectory(db, scope, absDir, options);
  if (!agg) return null;
  if (agg.hasUnindexedSubdirectories && options.onIncompleteSubtree) {
    options.onIncompleteSubtree(absDir);
  }
  return applyAggregate(db, scope, absDir, agg);
};

/**
 * mtime-based reconciliation pass (safety net for external writes that bypassed
 * the hooks and the on-view refresh, e.g. another Samba/NFS client on the same
 * mount).
 *
 * For every indexed folder it does a single stat(): folders whose mtime has not
 * advanced past their last scan (and are not flagged dirty) are skipped for
 * free; changed folders are re-aggregated at their direct level only and the
 * delta propagates upward. Vanished folders are pruned and their size removed
 * from the ancestors.
 *
 * Rows are streamed in pages ordered by relative_path DESC — i.e. children
 * before their parents — so a vanished folder's size is removed from an ancestor
 * before that ancestor is itself re-aggregated (no double counting), and peak
 * memory is O(page) rather than O(all folders). Between pages the pass sleeps for
 * `pauseMs`, so even a volume with hundreds of thousands of folders is scanned
 * as a gentle background trickle instead of one CPU/IO burst. Callers may also
 * set `maxDirectories` and resume from `beforeRelativePath`, making scheduled
 * reconciliation bounded rather than a permanently active full-volume sweep.
 *
 * @returns {Promise<{ checked, changed, removed, skipped, processed, hasMore, nextCursor }>}
 */
const reconcile = async (db, scope, options = {}) => {
  const {
    mode = config.folderSize.mode || 'full',
    signal,
    batch = config.folderSize.reconcileBatch || 100,
    pauseMs = options.pauseMs ?? config.folderSize.reconcilePauseMs ?? 0,
    maxDirectories = config.folderSize.reconcileMaxDirectories ?? 200,
    beforeRelativePath = null,
    ioTimeoutMs = options.ioTimeoutMs ?? config.folderSize.ioTimeoutMs,
    shouldSkip,
    shouldExclude,
    onIncompleteSubtree,
  } = options;

  let checked = 0;
  let changed = 0;
  let removed = 0;
  let skipped = 0;
  let processed = 0;

  const pruneStale = (abs) => {
    const size = folderSizeIndex.removeSubtree(db, scope, abs);
    if (abs !== scope.root && size) {
      folderSizeIndex.applyDelta(db, scope, path.dirname(abs), -size, {});
    }
    removed += 1;
  };

  const handleRow = async (row) => {
    const abs = absOf(scope, row.relativePath);
    if (typeof shouldExclude === 'function' && shouldExclude(abs)) {
      pruneStale(abs);
      skipped += 1;
      return;
    }
    if (typeof shouldSkip === 'function' && shouldSkip(abs)) {
      skipped += 1;
      return;
    }
    let stat;
    try {
      stat = await withIoTimeout('stat', abs, () => fs.stat(abs), { timeoutMs: ioTimeoutMs });
    } catch (err) {
      if (isIoTimeoutError(err) || isIoCircuitOpenError(err)) throw err;
      if (!isMissingPathError(err)) {
        skipped += 1;
        return;
      }
      pruneStale(abs); // gone entirely
      return;
    }
    if (!stat.isDirectory()) {
      pruneStale(abs); // replaced by a file of the same name
      return;
    }
    checked += 1;
    const lastScan = row.lastFullScanAt ? Date.parse(row.lastFullScanAt) : 0;
    const unchanged = !row.dirty && Number.isFinite(lastScan) && stat.mtimeMs <= lastScan;
    if (unchanged) {
      skipped += 1;
      return;
    }
    const delta = await reconcileDirectory(db, scope, abs, {
      mode,
      onIncompleteSubtree,
      shouldExclude,
    });
    if (delta !== 0) changed += 1;
  };

  let cursor = beforeRelativePath;
  let exhausted = false;
  for (;;) {
    if (signal?.aborted || (maxDirectories > 0 && processed >= maxDirectories)) break;
    const rows = folderSizeIndex.listScanTargetsPage(db, scope.label, cursor, batch);
    if (!rows.length) {
      exhausted = true;
      break;
    }
    for (const row of rows) {
      if (signal?.aborted || (maxDirectories > 0 && processed >= maxDirectories)) break;
      processed += 1;
      // eslint-disable-next-line no-await-in-loop
      await handleRow(row);
      cursor = row.relativePath;
    }
    if (signal?.aborted || (maxDirectories > 0 && processed >= maxDirectories)) break;
    if (rows.length < batch) {
      exhausted = true;
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    if (pauseMs > 0) await sleep(pauseMs);
  }

  const hasMore =
    !signal?.aborted &&
    !exhausted &&
    Boolean(cursor && folderSizeIndex.listScanTargetsPage(db, scope.label, cursor, 1).length);
  return {
    checked,
    changed,
    removed,
    skipped,
    processed,
    hasMore,
    nextCursor: hasMore ? cursor : null,
  };
};

module.exports = {
  getVolumeScope,
  isStale,
  nextReconcileDelay,
  withIoTimeout,
  getIoDiagnostics,
  runBaseline,
  indexSubtree,
  aggregateDirectory,
  applyAggregate,
  removeMissing,
  reconcile,
  // Re-export the propagating delta primitive so callers have a single import.
  applyDelta: folderSizeIndex.applyDelta,
};
