/**
 * Folder size indexer — in-process supervisor.
 *
 * Everything runs on the main thread to keep RAM low: no worker thread (no
 * second V8 isolate, no second SQLite connection) and no recursive filesystem
 * watcher (recursive inotify holds memory proportional to the directory count).
 * Heavy work stays out of read/navigation paths. A mutating operation may await
 * the final index of the subtree it created, but that scan is fully async
 * (readdir/stat), writes to SQLite in small batched transactions, and yields to
 * the event loop between batches — so Express keeps serving while it proceeds.
 * We deliberately do NOT lower the process priority here (on the main thread
 * that would nice request handling too).
 *
 * Freshness has three layers:
 *   1. write hooks — NextExplorer's own operations update the index instantly;
 *   2. on-view refresh — opening a folder re-checks the folders on screen
 *      (mtime-gated) so external changes surface within seconds where you look;
 *   3. adaptive reconciliation — a periodic mtime sweep that accelerates when it
 *      finds external changes and backs off when idle. If a changed directory
 *      exposes an unindexed child subtree, it queues one authoritative scan for
 *      that subtree rather than leaving an incomplete aggregate behind.
 */
const fsp = require('fs/promises');
const path = require('path');

const config = require('../config/index');
const logger = require('../utils/logger');
const indexer = require('./folderSizeIndexer');
const folderSizeIndex = require('./folderSizeIndex');
const transferState = require('./folderSizeTransferState');
const exclusions = require('./folderSizeExclusions');
const { getDb } = require('./db');

let db = null;
let scope = null;
let running = false;
let starting = false;
let stopped = false;

// Directories that need (re)aggregation, coalesced until the next flush.
const dirty = new Set();
let flushing = false;
let flushTimer = null;

// Adaptive reconciliation state.
let reconcileTimer = null;
let reconcileDelay = 0;
let reconciling = false;
let abortController = null;
let reconcileCursor = null;
const reconcileStats = {
  runs: 0,
  partialRuns: 0,
  completedPasses: 0,
  processed: 0,
  checked: 0,
  changed: 0,
  removed: 0,
  skipped: 0,
  lastRunAt: null,
  lastDurationMs: null,
};

// Targeted scans are serialized with each other. A completed filesystem
// operation can therefore await an exact subtree index without racing another
// operation's ancestor delta or the SQLite writes it produces.
let subtreeScanChain = Promise.resolve();
const pendingSubtreeScans = new Map();
let activeSubtreeScan = null;
const subtreeScanStats = {
  queued: 0,
  started: 0,
  completed: 0,
  failed: 0,
  folders: 0,
  files: 0,
  batches: 0,
  pauses: 0,
  totalMs: 0,
  slow: 0,
  timedOut: 0,
  circuitOpen: 0,
  cancelled: 0,
};
let readyPromise = null;

const isFolderSizeIoSafetyError = (err) =>
  err?.code === 'FOLDER_SIZE_IO_TIMEOUT' || err?.code === 'FOLDER_SIZE_IO_CIRCUIT_OPEN';

const pathsOverlap = (left, right) =>
  left === right ||
  left.startsWith(`${right}${path.sep}`) ||
  right.startsWith(`${left}${path.sep}`);

const log = (level, message, extra = {}) =>
  logger[level]({ component: 'folderSizeIndexer', ...extra }, message);

/**
 * Return the one-off baseline's transient heap to the OS. No-op unless the
 * process was started with --expose-gc; called only after the baseline/rebuild
 * (never in the steady-state loops) so it adds no ongoing pauses. Pair with
 * NODE_OPTIONS=--max-old-space-size=<n> to keep the resident set low.
 */
const reclaimMemory = () => {
  if (typeof global.gc === 'function') {
    try {
      global.gc();
    } catch {
      // ignore — best effort
    }
  }
};

const markDirty = (absPath) => {
  if (!absPath || !scope) return;
  if (!folderSizeIndex.isWithinRoot(scope.root, absPath)) return;
  if (exclusions.isExcluded(absPath, scope)) return;
  dirty.add(absPath);
};

/** Re-aggregate every dirty directory, applying all changes in one transaction. */
const flush = async () => {
  if (flushing || !db || !dirty.size) return;
  flushing = true;
  let retryDirs = [];
  try {
    const dirs = Array.from(dirty).filter(
      (absolutePath) =>
        !transferState.isRelatedToActiveTransfer(absolutePath) &&
        !exclusions.isExcluded(absolutePath, scope)
    );
    dirty.clear();
    if (!dirs.length) return;

    // Phase 1 (async, read-only): compute each directory's new aggregate.
    const ops = [];
    const incompleteSubtrees = new Set();
    for (const abs of dirs) {
      let agg;
      try {
        // eslint-disable-next-line no-await-in-loop
        agg = await indexer.aggregateDirectory(db, scope, abs, {
          mode: config.folderSize.mode,
          shouldExclude: (absDir) => exclusions.isExcluded(absDir, scope),
        });
      } catch (err) {
        retryDirs.push(abs);
        log('warn', 'Folder size aggregate deferred by I/O safety guard', {
          path: abs,
          code: err?.code,
          timeoutMs: err?.timeoutMs,
        });
        continue;
      }
      ops.push({ abs, agg });
      if (agg?.hasUnindexedSubdirectories) incompleteSubtrees.add(abs);
    }

    // Phase 2 (sync, one transaction): apply every change atomically.
    const apply = db.transaction(() => {
      for (const { abs, agg } of ops) {
        if (agg) indexer.applyAggregate(db, scope, abs, agg);
        else indexer.removeMissing(db, scope, abs);
      }
    });
    apply();
    for (const abs of incompleteSubtrees) {
      refreshSubtree(abs).catch(() => {});
    }
  } catch (err) {
    log('warn', 'Folder size flush failed', { err });
  } finally {
    for (const abs of retryDirs) dirty.add(abs);
    flushing = false;
  }
};

/**
 * On-view refresh. Given the directories currently in view, mark the ones whose
 * on-disk mtime is newer than what the index recorded so the next flush
 * re-aggregates them. One stat per folder (skipped when unchanged), fired
 * best-effort from the read route AFTER the response — the response itself stays
 * an O(1) index lookup, never a traversal. This is what surfaces external
 * changes promptly without a filesystem watcher.
 */
const touch = async (absDirs = []) => {
  if (!running || !db || !Array.isArray(absDirs) || !absDirs.length) return;
  for (const abs of absDirs) {
    if (!folderSizeIndex.isWithinRoot(scope.root, abs)) continue;
    if (exclusions.isExcluded(abs, scope)) continue;
    if (transferState.isRelatedToActiveTransfer(abs)) continue;
    let stat;
    try {
      // eslint-disable-next-line no-await-in-loop
      stat = await indexer.withIoTimeout('stat', abs, () => fsp.stat(abs));
    } catch (err) {
      if (isFolderSizeIoSafetyError(err)) {
        log('warn', 'Folder size on-view stat skipped by I/O safety guard', {
          path: abs,
          code: err.code,
          timeoutMs: err.timeoutMs,
        });
        continue;
      }
      markDirty(abs); // vanished — the flush will remove it and fix ancestors
      continue;
    }
    if (!stat.isDirectory()) continue;
    const entry = folderSizeIndex.getByAbsolutePath(db, abs);
    if (indexer.isStale(entry, stat.mtimeMs)) markDirty(abs);
  }
};

const runReconcile = async (reason, { full = false } = {}) => {
  if (reconciling || stopped || !db) return { changed: 0 };
  reconciling = true;
  const startedAt = Date.now();
  try {
    const incompleteSubtrees = new Set();
    const result = await indexer.reconcile(db, scope, {
      mode: config.folderSize.mode,
      signal: abortController?.signal,
      beforeRelativePath: full ? null : reconcileCursor,
      maxDirectories: full ? 0 : config.folderSize.reconcileMaxDirectories,
      shouldSkip: transferState.isRelatedToActiveTransfer,
      shouldExclude: (absDir) => exclusions.isExcluded(absDir, scope),
      onIncompleteSubtree: (absDir) => incompleteSubtrees.add(absDir),
    });
    for (const abs of incompleteSubtrees) {
      refreshSubtree(abs).catch(() => {});
    }
    if (!full) reconcileCursor = result.hasMore ? result.nextCursor : null;
    reconcileStats.runs += 1;
    reconcileStats.processed += result.processed || 0;
    reconcileStats.checked += result.checked || 0;
    reconcileStats.changed += result.changed || 0;
    reconcileStats.removed += result.removed || 0;
    reconcileStats.skipped += result.skipped || 0;
    reconcileStats.lastRunAt = new Date().toISOString();
    reconcileStats.lastDurationMs = Date.now() - startedAt;
    if (result.hasMore) reconcileStats.partialRuns += 1;
    else reconcileStats.completedPasses += 1;
    log('debug', 'Reconciliation slice complete', {
      reason,
      full,
      maxDirectories: full ? 0 : config.folderSize.reconcileMaxDirectories,
      cursor: reconcileCursor,
      ...result,
    });
    // A large sweep grows the heap; hand it back (no-op without --expose-gc).
    reclaimMemory();
    return result;
  } catch (err) {
    log('warn', 'Reconciliation failed', { err });
    return { changed: 0, hasMore: false };
  } finally {
    reconciling = false;
  }
};

/** Arm the next reconciliation timer, adaptively unless a fixed interval is set. */
const armReconcile = () => {
  if (stopped) return;
  reconcileTimer = setTimeout(async () => {
    const { changed, hasMore } = await runReconcile('scheduled');
    const { reconcileMs, reconcileMinMs, reconcileMaxMs } = config.folderSize;
    reconcileDelay =
      reconcileMs > 0
        ? reconcileMs
        : hasMore
          ? reconcileMinMs
          : indexer.nextReconcileDelay(reconcileDelay, changed, {
              minMs: reconcileMinMs,
              maxMs: reconcileMaxMs,
            });
    armReconcile();
  }, reconcileDelay);
  if (reconcileTimer.unref) reconcileTimer.unref();
};

const baselineIfNeeded = async () => {
  const existing = folderSizeIndex.countByVolume(db, scope.label);
  const storedVersion = folderSizeIndex.getIndexVersion(db, scope);
  const needsVersionUpgrade = existing > 0 && storedVersion < folderSizeIndex.CURRENT_INDEX_VERSION;
  const rebuild = config.folderSize.rebuild || needsVersionUpgrade;
  if (existing > 0 && !rebuild) {
    log('info', 'Baseline skipped (volume already indexed)', {
      folders: existing,
      indexVersion: storedVersion,
    });
    return;
  }
  if (rebuild && existing > 0) {
    folderSizeIndex.removeSubtree(db, scope, scope.root);
    log('info', 'Rebuild requested — cleared existing index', {
      folders: existing,
      reason: config.folderSize.rebuild ? 'manual' : 'index-version-upgrade',
      fromVersion: storedVersion,
      toVersion: folderSizeIndex.CURRENT_INDEX_VERSION,
    });
  }
  log('info', 'Starting baseline walk', { root: scope.root, mode: config.folderSize.mode });
  const started = Date.now();
  const result = await indexer.runBaseline(db, scope, {
    mode: config.folderSize.mode,
    shouldExclude: (absDir) => exclusions.isExcluded(absDir, scope),
  });
  folderSizeIndex.setIndexVersion(db, scope);
  log('info', 'Baseline walk complete', { ...result, ms: Date.now() - started });
};

const pruneExcludedIndexEntries = (relativePaths = exclusions.effectivePaths()) => {
  if (!db || !scope) return;
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(scope.root, relativePath);
    const removedSize = folderSizeIndex.removeSubtree(db, scope, absolutePath);
    if (absolutePath !== scope.root && removedSize) {
      folderSizeIndex.applyDelta(db, scope, path.dirname(absolutePath), -removedSize, {});
    }
  }
};

const init = async () => {
  db = await getDb();
  scope = indexer.getVolumeScope();
  exclusions.loadFromDatabase(db);
  pruneExcludedIndexEntries();

  // Baseline once (or on explicit rebuild). Async + cooperative yields, so it
  // never blocks request handling even on a large volume.
  await baselineIfNeeded();
  reclaimMemory();

  running = true;
  starting = false;
  abortController = new AbortController();

  flushTimer = setInterval(() => {
    flush().catch(() => {});
  }, config.folderSize.flushMs);
  if (flushTimer.unref) flushTimer.unref();

  reconcileDelay =
    config.folderSize.reconcileMs > 0
      ? config.folderSize.reconcileMs
      : config.folderSize.reconcileMinMs;
  armReconcile();

  log('info', 'Folder size indexer ready (in-process)', {
    root: scope.root,
    mode: config.folderSize.mode,
  });
};

const start = () => {
  if (!config.folderSize.enabled) {
    logger.debug('[folderSizeIndexer] Disabled (FOLDER_SIZE_MODE=off)');
    return;
  }
  if (running || starting) return readyPromise;
  starting = true;
  stopped = false;
  readyPromise = init().catch((err) => {
    starting = false;
    log('error', 'Folder size indexer failed to start', { err });
    throw err;
  });
  readyPromise.catch(() => {});
  return readyPromise;
};

const stop = async () => {
  if (flushTimer) clearInterval(flushTimer);
  if (reconcileTimer) clearTimeout(reconcileTimer);
  flushTimer = null;
  reconcileTimer = null;
  if (abortController) abortController.abort(); // cancel any in-flight paced reconcile
  activeSubtreeScan?.controller?.abort('indexer-stopped');
  running = false;
  // Final flush of anything still pending, then mark stopped so no late timer
  // callback re-arms.
  await flush();
  stopped = true;
};

/**
 * A filesystem mutation wins over a background scan. Cancel every queued or
 * active targeted scan whose subtree overlaps the changed path so stale scan
 * batches cannot recreate rows that a delete, move or rename just removed.
 */
const invalidateSubtree = (absolutePath, reason = 'filesystem-mutation') => {
  if (!absolutePath) return { active: false, queued: 0 };
  let queued = 0;
  for (const [scanPath, pending] of pendingSubtreeScans) {
    if (!pathsOverlap(scanPath, absolutePath)) continue;
    pending.invalidated = true;
    queued += 1;
  }

  const active = Boolean(activeSubtreeScan && pathsOverlap(activeSubtreeScan.path, absolutePath));
  if (active) activeSubtreeScan.controller.abort(reason);
  if (active || queued) {
    log('debug', 'Folder size subtree scan invalidated by filesystem mutation', {
      path: absolutePath,
      reason,
      active,
      queued,
    });
  }
  return { active, queued };
};

/**
 * Queue an authoritative scan of one newly-created directory tree. Calls for
 * the same path share the same work. During startup this waits for the baseline
 * instead of returning a stale size for a completed operation.
 */
const refreshSubtree = async (absDir, { allowActiveTransfer = false } = {}) => {
  if (!config.folderSize.enabled || stopped || (!running && !starting)) return null;
  if (scope && exclusions.isExcluded(absDir, scope)) return null;
  if (!allowActiveTransfer && transferState.isRelatedToActiveTransfer(absDir)) return null;
  const existing = pendingSubtreeScans.get(absDir);
  if (existing && !existing.invalidated) return existing.promise;
  if (existing?.invalidated) pendingSubtreeScans.delete(absDir);

  const pending = { invalidated: false, promise: null };

  const scan = async () => {
    if (pending.invalidated) return null;
    if (starting && readyPromise) await readyPromise;
    if (pending.invalidated) return null;
    if (!running || !db || !scope || stopped) return null;
    if (!allowActiveTransfer && transferState.isRelatedToActiveTransfer(absDir)) return null;

    const startedAt = Date.now();
    const controller = new AbortController();
    activeSubtreeScan = {
      path: absDir,
      startedAt,
      currentPath: absDir,
      phase: 'queued',
      controller,
    };
    subtreeScanStats.started += 1;
    try {
      const result = await indexer.indexSubtree(db, scope, absDir, {
        mode: config.folderSize.mode,
        batchSize: config.folderSize.subtreeBatch,
        yieldEvery: config.folderSize.subtreeBatch,
        pauseMs: config.folderSize.subtreePauseMs,
        ioTimeoutMs: config.folderSize.ioTimeoutMs,
        signal: controller.signal,
        shouldExclude: (absolutePath) => exclusions.isExcluded(absolutePath, scope),
        onProgress: (progress) => {
          if (activeSubtreeScan?.path !== absDir) return;
          activeSubtreeScan = {
            ...activeSubtreeScan,
            currentPath: progress.path,
            phase: progress.phase,
            folders: progress.folders,
            files: progress.files,
            batches: progress.batches,
            lastProgressAt: progress.at,
          };
        },
      });
      const ms = Date.now() - startedAt;
      subtreeScanStats.completed += 1;
      subtreeScanStats.folders += result?.folders || 0;
      subtreeScanStats.files += result?.files || 0;
      subtreeScanStats.batches += result?.batches || 0;
      subtreeScanStats.pauses += result?.pauses || 0;
      subtreeScanStats.totalMs += ms;
      if (result?.folders >= 300) reclaimMemory();

      const details = {
        path: absDir,
        ...result,
        ms,
        queueDepth: Math.max(0, pendingSubtreeScans.size - 1),
        batchSize: config.folderSize.subtreeBatch,
        pauseMs: config.folderSize.subtreePauseMs,
      };
      if (ms >= config.folderSize.subtreeSlowLogMs) {
        subtreeScanStats.slow += 1;
        log('info', 'Folder size subtree scan complete', details);
      } else {
        log('debug', 'Folder size subtree scan complete', details);
      }
      return result;
    } catch (err) {
      if (err?.code === 'FOLDER_SIZE_SCAN_ABORTED') {
        subtreeScanStats.cancelled += 1;
        log('debug', 'Folder size subtree scan cancelled by filesystem mutation', {
          path: absDir,
          ms: Date.now() - startedAt,
          currentPath: activeSubtreeScan?.currentPath || absDir,
        });
        return null;
      }
      subtreeScanStats.failed += 1;
      if (err?.code === 'FOLDER_SIZE_IO_TIMEOUT') subtreeScanStats.timedOut += 1;
      if (err?.code === 'FOLDER_SIZE_IO_CIRCUIT_OPEN') subtreeScanStats.circuitOpen += 1;
      log('warn', 'Folder size subtree scan failed', {
        path: absDir,
        ms: Date.now() - startedAt,
        currentPath: activeSubtreeScan?.currentPath || absDir,
        phase: activeSubtreeScan?.phase || null,
        err,
      });
      throw err;
    } finally {
      activeSubtreeScan = null;
    }
  };

  const queued = subtreeScanChain.then(scan, scan);
  subtreeScanChain = queued.catch(() => {});
  subtreeScanStats.queued += 1;
  pending.promise = queued;
  pendingSubtreeScans.set(absDir, pending);
  queued
    .finally(() => {
      if (pendingSubtreeScans.get(absDir) === pending) pendingSubtreeScans.delete(absDir);
    })
    .catch(() => {});
  return queued;
};

/**
 * Apply administrator-managed exclusions immediately. New exclusions are
 * removed from the SQLite index and cancel any overlapping targeted walk;
 * paths that become included are queued for one authoritative refresh.
 */
const setAdminExclusions = async (paths) => {
  const changed = exclusions.setAdminPaths(paths);
  if (!db || !scope || !config.folderSize.enabled) return { ...changed };

  for (const relativePath of changed.added) {
    const absolutePath = path.resolve(scope.root, relativePath);
    invalidateSubtree(absolutePath, 'folder-size-excluded');
    pruneExcludedIndexEntries([relativePath]);
    markDirty(path.dirname(absolutePath));
  }

  for (const relativePath of changed.removed) {
    const absolutePath = path.resolve(scope.root, relativePath);
    refreshSubtree(absolutePath).catch(() => {});
  }
  return { ...changed };
};

const getDiagnosticsSnapshot = () => ({
  running,
  starting,
  flushing,
  reconciling,
  dirtyDirectories: dirty.size,
  pendingSubtreeScans: pendingSubtreeScans.size,
  reconcileDelayMs: reconcileDelay || null,
  reconcile: {
    maxDirectories: config.folderSize.reconcileMaxDirectories,
    cursor: reconcileCursor,
    stats: { ...reconcileStats },
  },
  subtree: {
    active: activeSubtreeScan
      ? {
          path: activeSubtreeScan.path,
          currentPath: activeSubtreeScan.currentPath,
          phase: activeSubtreeScan.phase,
          folders: activeSubtreeScan.folders || 0,
          files: activeSubtreeScan.files || 0,
          batches: activeSubtreeScan.batches || 0,
          ageMs: Date.now() - activeSubtreeScan.startedAt,
          lastProgressAgeMs: activeSubtreeScan.lastProgressAt
            ? Date.now() - activeSubtreeScan.lastProgressAt
            : null,
        }
      : null,
    batchSize: config.folderSize.subtreeBatch,
    pauseMs: config.folderSize.subtreePauseMs,
    slowLogMs: config.folderSize.subtreeSlowLogMs,
    io: indexer.getIoDiagnostics(),
    stats: { ...subtreeScanStats },
  },
});

module.exports = {
  start,
  stop,
  touch,
  refreshSubtree,
  invalidateSubtree,
  setAdminExclusions,
  isRunning: () => running,
  getDiagnosticsSnapshot,
};
