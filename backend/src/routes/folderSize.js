const express = require('express');
const fs = require('fs/promises');
const { normalizeRelativePath, parsePathSpace, resolveVolumePath } = require('../utils/pathUtils');
const { resolvePathWithAccess } = require('../services/accessManager');
const { getDb } = require('../services/db');
const folderSizeIndex = require('../services/folderSizeIndex');
const { getVolumeScope } = require('../services/folderSizeIndexer');
const folderSizeManager = require('../services/folderSizeManager');
const folderSizeExclusions = require('../services/folderSizeExclusions');
const config = require('../config/index');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
} = require('../errors/AppError');

const router = express.Router();

const MAX_BATCH_PATHS = 500;
const MAX_MANUAL_REFRESHES = 24;
const manualRefreshes = new Map();

// Keep this router entirely dormant when folder sizes are disabled. The
// frontend normally never calls it in that mode, but this guard also prevents
// direct API consumers from resolving paths, opening SQLite, or stat'ing a
// directory before the manager can reject a refresh request.
router.use('/folder-size', (_req, res, next) => {
  if (!config.folderSize.enabled) {
    return res.status(404).json({ error: 'Folder size indexing is disabled.' });
  }
  return next();
});

/**
 * Resolve the absolute filesystem path for a logical path *without* enforcing
 * the navigation ACL — used so a folder's size can still be reported when the
 * user is not allowed to enter it (the non-negotiable requirement of the
 * feature). Only volume-space paths are resolvable this way; personal/share
 * spaces need user context and are left to the access-checked resolution.
 * Returns null when the path cannot be resolved safely.
 */
const fallbackAbsolutePath = async (context, inputRel) => {
  // Share visitors never get the fallback: they reach files through their
  // share only, so resolving a volume path for them would turn this endpoint
  // into a size oracle over the whole tree — including paths an admin hid.
  if (!context?.user?.id) return null;
  try {
    const { space, rel } = parsePathSpace(inputRel);
    if (space !== 'volume') return null;
    return await resolveVolumePath(rel);
  } catch {
    return null;
  }
};

/**
 * Look up a single logical path in the index. Never triggers a filesystem
 * traversal: it reads the pre-computed entry (or reports indexed:false).
 */
const lookupFolderSize = async (context, inputRelRaw) => {
  const inputRel = normalizeRelativePath(inputRelRaw);
  const { accessInfo, resolved } = await resolvePathWithAccess(context, inputRel);
  const canEnter = Boolean(accessInfo && accessInfo.canAccess && accessInfo.canRead);

  // Prefer the access-checked absolute path; fall back to a volume-root
  // resolution so size is available even when navigation is denied.
  const absolutePath = resolved?.absolutePath ?? (await fallbackAbsolutePath(context, inputRel));

  const db = await getDb();
  const scope = getVolumeScope();
  const withinRoot = Boolean(absolutePath && folderSizeIndex.isWithinRoot(scope.root, absolutePath));
  const excluded = withinRoot && folderSizeExclusions.isExcluded(absolutePath, scope);
  const entry = withinRoot ? folderSizeIndex.getByAbsolutePath(db, absolutePath) : null;

  return {
    result: {
      path: resolved?.relativePath ?? inputRel,
      canEnter,
      sizeBytes: entry ? entry.sizeBytes : null,
      entryCount: entry ? entry.entryCount : null,
      lastUpdated: folderSizeIndex.getLastUpdatedAt(entry),
      indexed: Boolean(entry),
      dirty: Boolean(entry?.dirty),
      excluded,
    },
    // Absolute path (volume-space, within root) for the on-view refresh, or null.
    absolutePath: withinRoot ? absolutePath : null,
  };
};

/**
 * Fire-and-forget on-view refresh: ask the indexer to re-check these folders'
 * mtime in the background so external changes surface within seconds. Never
 * blocks or fails the response.
 */
const scheduleOnViewRefresh = (absolutePaths) => {
  const dirs = absolutePaths.filter(Boolean);
  if (!dirs.length) return;
  Promise.resolve(folderSizeManager.touch(dirs)).catch(() => {});
};

const indexResult = (db, scope, absolutePath, logicalPath, canEnter) => {
  const entry = folderSizeIndex.getByAbsolutePath(db, absolutePath);
  return {
    path: logicalPath,
    canEnter,
    sizeBytes: entry ? entry.sizeBytes : null,
    entryCount: entry ? entry.entryCount : null,
    lastUpdated: folderSizeIndex.getLastUpdatedAt(entry),
    indexed: Boolean(entry),
    dirty: Boolean(entry?.dirty),
    excluded: folderSizeExclusions.isExcluded(absolutePath, scope),
  };
};

/**
 * Queue one user-requested, authoritative scan of a folder tree. The manager
 * deduplicates same-path scans; this route additionally caps distinct pending
 * requests so an authenticated client cannot fill the serialized scan queue.
 *
 * The scan itself deliberately continues after the HTTP response. A deep tree
 * can be paced for minutes, and keeping a browser/proxy request open for that
 * duration leaves the UI in an unhelpful perpetual loading state.
 */
const queueRefreshDirectory = (absolutePath) => {
  const pending = manualRefreshes.get(absolutePath);
  if (pending) return;
  if (manualRefreshes.size >= MAX_MANUAL_REFRESHES) {
    throw new RateLimitError('Too many folder size refreshes are already pending.');
  }
  if (!folderSizeManager.isRunning()) {
    throw new ValidationError('Folder size indexing is not ready.');
  }

  const refresh = folderSizeManager.refreshSubtree(absolutePath);
  manualRefreshes.set(absolutePath, refresh);
  refresh
    .then((result) => {
      if (!result) {
        logger.warn({ path: absolutePath }, 'Manual folder size refresh did not start');
      }
    })
    .catch((err) => {
      logger.warn({ err, path: absolutePath }, 'Manual folder size refresh failed');
    })
    .finally(() => manualRefreshes.delete(absolutePath));
};

// POST /api/folder-size/refresh/<logical path>
// An explicit repair action for a folder changed outside NextExplorer. Unlike
// normal size reads, this is deliberately authoritative and scans only the
// requested subtree, updating every indexed descendant and its ancestors.
router.post(
  '/folder-size/refresh/{*splat}',
  asyncHandler(async (req, res) => {
    const raw = (req.params.splat || []).join('/');
    const relativePath = normalizeRelativePath(raw);
    if (!relativePath) {
      throw new ValidationError('A folder path is required.');
    }

    const context = { user: req.user, guestSession: req.guestSession };
    const { accessInfo, resolved } = await resolvePathWithAccess(context, relativePath);
    if (!accessInfo?.canAccess || !accessInfo?.canRead) {
      throw new ForbiddenError(accessInfo?.denialReason || 'Path is not accessible.');
    }

    const scope = getVolumeScope();
    const absolutePath = resolved?.absolutePath;
    if (!absolutePath || !folderSizeIndex.isWithinRoot(scope.root, absolutePath)) {
      throw new ValidationError('Folder size refresh is only available for volume folders.');
    }
    if (folderSizeExclusions.isExcluded(absolutePath, scope)) {
      throw new ValidationError('Folder size indexing is excluded for this directory.');
    }

    let stats;
    try {
      // Do not follow a directory symlink here: the indexed volume is a hard
      // boundary, and a manual refresh must never turn it into a traversal of
      // an arbitrary target outside that boundary.
      stats = await fs.lstat(absolutePath);
    } catch {
      throw new NotFoundError('Folder not found.');
    }
    if (!stats.isDirectory()) {
      throw new ValidationError('Folder size refresh requires a directory.');
    }

    queueRefreshDirectory(absolutePath);
    const db = await getDb();
    res.status(202).json({
      ...indexResult(db, scope, absolutePath, resolved.relativePath, true),
      refreshPending: true,
    });
  })
);

// GET /api/folder-size/<logical path>
// Returns the pre-computed recursive size for a single folder. `sizeBytes` is
// returned regardless of `canEnter`; `indexed:false` (not a 500) when the path
// is not yet in the index.
router.get(
  '/folder-size/{*splat}',
  asyncHandler(async (req, res) => {
    const raw = (req.params.splat || []).join('/');
    const context = { user: req.user, guestSession: req.guestSession };
    const { result, absolutePath } = await lookupFolderSize(context, raw);
    res.json(result);
    scheduleOnViewRefresh([absolutePath]);
  })
);

// POST /api/folder-size/batch  { paths: ["a", "a/b", ...] }
// One index lookup per requested path so a list view can be populated without
// N separate round trips.
router.post(
  '/folder-size/batch',
  asyncHandler(async (req, res) => {
    const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    const limited = paths.slice(0, MAX_BATCH_PATHS);
    const context = { user: req.user, guestSession: req.guestSession };

    const results = [];
    const touchPaths = [];
    for (const p of limited) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { result, absolutePath } = await lookupFolderSize(
          context,
          typeof p === 'string' ? p : ''
        );
        results.push(result);
        if (absolutePath) touchPaths.push(absolutePath);
      } catch (err) {
        logger.debug({ err, path: p }, 'folder-size batch lookup failed for path');
        results.push({
          path: typeof p === 'string' ? p : '',
          canEnter: false,
          sizeBytes: null,
          entryCount: null,
          lastUpdated: null,
          indexed: false,
          dirty: false,
          excluded: false,
        });
      }
    }

    res.json({ results, truncated: paths.length > limited.length });
    scheduleOnViewRefresh(touchPaths);
  })
);

module.exports = router;
