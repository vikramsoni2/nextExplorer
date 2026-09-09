/**
 * Data-access layer for the `folder_size_index` table.
 *
 * This module is intentionally free of any application configuration: every
 * function takes an explicit better-sqlite3 `db` handle and, where relevant, a
 * `scope` object describing the volume being indexed:
 *
 *   scope = { root: '<absolute volume root>', label: '<volume identifier>' }
 *
 * Keeping it pure makes it trivial to unit test against a temporary database
 * and an arbitrary directory tree, and lets it be shared unchanged between the
 * Express request threads (write hooks + read route) and the indexer worker
 * thread — each simply passes its own connection.
 *
 * Sizes are recursive by convention (a folder's `size_bytes` is the total of
 * everything beneath it). Relative paths are always stored POSIX-style so that
 * prefix range scans behave identically across platforms.
 */
const crypto = require('crypto');
const path = require('path');

// Bump this whenever the indexer gains a capability that older, already
// populated indexes cannot retroactively provide. The manager performs one
// cooperative baseline rebuild for each affected volume on upgrade.
const CURRENT_INDEX_VERSION = 2;

const toPosix = (p) => (p.includes('\\') ? p.split('\\').join('/') : p);

/**
 * Prepared-statement cache, keyed by the db handle then the SQL text. Preparing
 * a statement compiles it; doing that on every call churns a lot of native
 * handles and JS garbage during a large reconcile (hundreds of thousands of
 * folders). Caching means each distinct query is compiled once and reused. The
 * WeakMap lets the cache be collected with its connection.
 */
const stmtCache = new WeakMap();
const prep = (db, sql) => {
  let bySql = stmtCache.get(db);
  if (!bySql) {
    bySql = new Map();
    stmtCache.set(db, bySql);
  }
  let stmt = bySql.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    bySql.set(sql, stmt);
  }
  return stmt;
};

/** Stable primary key for a folder: the sha1 of its absolute path. */
const pathHash = (absolutePath) => crypto.createHash('sha1').update(absolutePath).digest('hex');

const relativeOf = (root, absolutePath) => {
  if (absolutePath === root) return '';
  return toPosix(path.relative(root, absolutePath));
};

const isWithinRoot = (root, absolutePath) => {
  if (absolutePath === root) return true;
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  return absolutePath.startsWith(withSep);
};

/**
 * Build the chain of absolute paths from `dirAbsolutePath` up to and including
 * the volume `root`. Returns [] when the path is not inside the volume.
 */
const ancestorChain = (root, dirAbsolutePath) => {
  if (!isWithinRoot(root, dirAbsolutePath)) return [];
  const chain = [];
  let current = dirAbsolutePath;
  // The 4096 bound is a defensive guard against unexpected path cycles; a real
  // directory depth never approaches it.
  for (let i = 0; i < 4096; i += 1) {
    chain.push(current);
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break; // filesystem root reached without matching volume root
    current = parent;
  }
  return chain;
};

const mapRow = (row) => {
  if (!row) return null;
  return {
    parentHash: row.parent_hash,
    volume: row.volume,
    relativePath: row.relative_path,
    sizeBytes: row.size_bytes,
    entryCount: row.entry_count,
    lastDeltaAt: row.last_delta_at,
    lastFullScanAt: row.last_full_scan_at,
    dirty: row.dirty,
  };
};

const getByAbsolutePath = (db, absolutePath) => {
  const row = prep(db, 'SELECT * FROM folder_size_index WHERE path_hash = ?').get(
    pathHash(absolutePath)
  );
  return mapRow(row);
};

/**
 * Return the most recent index write timestamp for an entry. A pending
 * transfer keeps its delta timestamp when its authoritative scan completes,
 * so using `lastDeltaAt || lastFullScanAt` would permanently hide that later
 * scan from clients waiting for a refresh.
 */
const getLastUpdatedAt = (entry) => {
  if (!entry) return null;
  const candidates = [entry.lastDeltaAt, entry.lastFullScanAt]
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return candidates[0] || null;
};

/**
 * One page of folders for the reconciliation pass, ordered by relative_path
 * DESC (children before their parents) and limited to `limit` rows. Only the
 * three columns reconcile needs are selected. Pass `beforeRelativePath = null`
 * for the first page, then the last (smallest) `relativePath` of the previous
 * page as the cursor for the next. Paging keeps reconcile's peak memory O(page)
 * instead of O(all folders) on very large volumes, and the DESC order lets a
 * vanished folder's size be subtracted from an ancestor before that ancestor is
 * re-aggregated.
 */
const listScanTargetsPage = (db, volume, beforeRelativePath, limit) => {
  const rows =
    beforeRelativePath === null || beforeRelativePath === undefined
      ? prep(
          db,
          `SELECT relative_path, last_full_scan_at, dirty FROM folder_size_index
             WHERE volume = ? ORDER BY relative_path DESC LIMIT ?`
        ).all(volume, limit)
      : prep(
          db,
          `SELECT relative_path, last_full_scan_at, dirty FROM folder_size_index
             WHERE volume = ? AND relative_path < ? ORDER BY relative_path DESC LIMIT ?`
        ).all(volume, beforeRelativePath, limit);
  return rows.map((row) => ({
    relativePath: row.relative_path,
    lastFullScanAt: row.last_full_scan_at,
    dirty: row.dirty,
  }));
};

const countByVolume = (db, volume) =>
  prep(db, 'SELECT COUNT(*) AS n FROM folder_size_index WHERE volume = ?').get(volume).n;

const indexVersionKey = (scope) =>
  `folder_size_index_version:${scope.label}:${pathHash(scope.root)}`;

const getIndexVersion = (db, scope) => {
  const value = prep(db, 'SELECT value FROM meta WHERE key = ?')
    .pluck()
    .get(indexVersionKey(scope));
  const version = Number(value);
  return Number.isInteger(version) && version >= 0 ? version : 0;
};

const setIndexVersion = (db, scope, version = CURRENT_INDEX_VERSION) => {
  prep(db, 'INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(
    indexVersionKey(scope),
    String(version)
  );
};

/**
 * Apply an incremental byte delta to a folder and propagate it up every
 * ancestor to the volume root, in a single transaction. Rows that do not yet
 * exist are created and flagged `dirty` so the reconciler can later replace the
 * approximate value with a true aggregate. `entryDelta` only affects the target
 * folder's direct entry count, never its ancestors'.
 *
 * @returns {number} number of levels touched (0 when outside the volume)
 */
const applyDelta = (db, scope, dirAbsolutePath, byteDelta, { entryDelta = 0 } = {}) => {
  const { root, label } = scope;
  const chain = ancestorChain(root, dirAbsolutePath);
  if (!chain.length) return 0;

  const now = new Date().toISOString();
  const upsert = prep(
    db,
    `
    INSERT INTO folder_size_index
      (path_hash, parent_hash, volume, relative_path, size_bytes, entry_count, last_delta_at, dirty)
    VALUES (@pathHash, @parentHash, @volume, @relativePath, @initialSize, @initialCount, @now, 1)
    ON CONFLICT(path_hash) DO UPDATE SET
      size_bytes = MAX(0, size_bytes + @byteDelta),
      entry_count = MAX(0, entry_count + @entryDelta),
      last_delta_at = @now
  `
  );

  const run = db.transaction(() => {
    for (let i = 0; i < chain.length; i += 1) {
      const abs = chain[i];
      const isTarget = i === 0;
      const parentAbs = abs === root ? null : path.dirname(abs);
      const levelEntryDelta = isTarget ? entryDelta : 0;
      upsert.run({
        pathHash: pathHash(abs),
        parentHash: parentAbs ? pathHash(parentAbs) : null,
        volume: label,
        relativePath: relativeOf(root, abs),
        initialSize: Math.max(0, byteDelta),
        initialCount: Math.max(0, levelEntryDelta),
        byteDelta,
        entryDelta: levelEntryDelta,
        now,
      });
    }
  });
  run();
  return chain.length;
};

/**
 * Upsert an authoritative (non-dirty) entry — used by the baseline walk and the
 * reconciler when the true recursive size of a folder is known.
 */
const upsertScanEntry = (db, scope, { absolutePath, sizeBytes, entryCount, lastFullScanAt }) => {
  const { root, label } = scope;
  const parentAbs = absolutePath === root ? null : path.dirname(absolutePath);
  prep(
    db,
    `
    INSERT INTO folder_size_index
      (path_hash, parent_hash, volume, relative_path, size_bytes, entry_count, last_full_scan_at, dirty)
    VALUES (@pathHash, @parentHash, @volume, @relativePath, @sizeBytes, @entryCount, @lastFullScanAt, 0)
    ON CONFLICT(path_hash) DO UPDATE SET
      parent_hash = @parentHash,
      volume = @volume,
      relative_path = @relativePath,
      size_bytes = @sizeBytes,
      entry_count = @entryCount,
      last_full_scan_at = @lastFullScanAt,
      dirty = 0
  `
  ).run({
    pathHash: pathHash(absolutePath),
    parentHash: parentAbs ? pathHash(parentAbs) : null,
    volume: label,
    relativePath: relativeOf(root, absolutePath),
    sizeBytes,
    entryCount,
    lastFullScanAt,
  });
};

/** Bulk variant of {@link upsertScanEntry}, wrapped in one transaction. */
const bulkUpsertScanEntries = (db, scope, entries = []) => {
  if (!entries.length) return;
  const run = db.transaction(() => {
    for (const entry of entries) upsertScanEntry(db, scope, entry);
  });
  run();
};

/**
 * Duplicate existing index rows for a directory copy without reading the
 * filesystem again. The source and target must belong to the same indexed
 * volume. Rows are read and written in small pages, so even a large directory
 * tree does not require materialising all of its SQLite rows in JavaScript
 * memory. A page is fully read before its write transaction starts because
 * SQLite does not allow a cursor query and a write on one connection at once.
 */
const cloneSubtree = (db, scope, sourceAbsolutePath, targetAbsolutePath) => {
  const { root, label } = scope;
  if (
    !isWithinRoot(root, sourceAbsolutePath) ||
    !isWithinRoot(root, targetAbsolutePath) ||
    sourceAbsolutePath === targetAbsolutePath
  ) {
    return 0;
  }

  const sourceRelativePath = relativeOf(root, sourceAbsolutePath);
  const pageSize = 256;
  const selectRows =
    sourceRelativePath === ''
      ? prep(
          db,
          `SELECT * FROM folder_size_index
             WHERE volume = ? AND (? IS NULL OR relative_path > ?)
             ORDER BY relative_path ASC LIMIT ?`
        )
      : prep(
          db,
          `SELECT * FROM folder_size_index
             WHERE volume = ?
               AND (relative_path = ? OR (relative_path >= ? AND relative_path < ?))
               AND (? IS NULL OR relative_path > ?)
             ORDER BY relative_path ASC LIMIT ?`
        );
  const upsert = prep(
    db,
    `
    INSERT INTO folder_size_index
      (path_hash, parent_hash, volume, relative_path, size_bytes, entry_count, last_delta_at, last_full_scan_at, dirty)
    VALUES (@pathHash, @parentHash, @volume, @relativePath, @sizeBytes, @entryCount, @lastDeltaAt, @lastFullScanAt, @dirty)
    ON CONFLICT(path_hash) DO UPDATE SET
      parent_hash = @parentHash,
      volume = @volume,
      relative_path = @relativePath,
      size_bytes = @sizeBytes,
      entry_count = @entryCount,
      last_delta_at = @lastDeltaAt,
      last_full_scan_at = @lastFullScanAt,
      dirty = @dirty
  `
  );

  let copied = 0;
  const writePage = db.transaction((rows) => {
    for (const row of rows) {
      const sourceRowAbsolutePath = row.relative_path ? path.join(root, row.relative_path) : root;
      const suffix =
        sourceRowAbsolutePath === sourceAbsolutePath
          ? ''
          : sourceRowAbsolutePath.slice(sourceAbsolutePath.length);
      const targetRowAbsolutePath = `${targetAbsolutePath}${suffix}`;
      const parentAbsolutePath =
        targetRowAbsolutePath === root ? null : path.dirname(targetRowAbsolutePath);

      upsert.run({
        pathHash: pathHash(targetRowAbsolutePath),
        parentHash: parentAbsolutePath ? pathHash(parentAbsolutePath) : null,
        volume: label,
        relativePath: relativeOf(root, targetRowAbsolutePath),
        sizeBytes: row.size_bytes,
        entryCount: row.entry_count,
        lastDeltaAt: row.last_delta_at,
        lastFullScanAt: row.last_full_scan_at,
        dirty: row.dirty,
      });
      copied += 1;
    }
  });

  let afterRelativePath = null;
  for (;;) {
    const rows =
      sourceRelativePath === ''
        ? selectRows.all(label, afterRelativePath, afterRelativePath, pageSize)
        : selectRows.all(
            label,
            sourceRelativePath,
            `${sourceRelativePath}/`,
            `${sourceRelativePath}0`,
            afterRelativePath,
            afterRelativePath,
            pageSize
          );
    if (!rows.length) break;
    writePage(rows);
    if (rows.length < pageSize) break;
    afterRelativePath = rows[rows.length - 1].relative_path;
  }
  return copied;
};

/**
 * Record a directory whose recursive byte count is known from an operation,
 * while leaving it marked dirty until its descendant rows are needed. This
 * keeps a completed directory copy off the filesystem hot path: the list view
 * can show its exact root size immediately, and a detailed scan happens only
 * when someone actually opens that tree.
 */
const upsertPendingDirectoryEntry = (db, scope, { absolutePath, sizeBytes, entryCount = 0 }) => {
  const { root, label } = scope;
  const parentAbs = absolutePath === root ? null : path.dirname(absolutePath);
  prep(
    db,
    `
    INSERT INTO folder_size_index
      (path_hash, parent_hash, volume, relative_path, size_bytes, entry_count, last_delta_at, dirty)
    VALUES (@pathHash, @parentHash, @volume, @relativePath, @sizeBytes, @entryCount, @now, 1)
    ON CONFLICT(path_hash) DO UPDATE SET
      parent_hash = @parentHash,
      volume = @volume,
      relative_path = @relativePath,
      size_bytes = @sizeBytes,
      entry_count = @entryCount,
      last_delta_at = @now,
      dirty = 1
  `
  ).run({
    pathHash: pathHash(absolutePath),
    parentHash: parentAbs ? pathHash(parentAbs) : null,
    volume: label,
    relativePath: relativeOf(root, absolutePath),
    sizeBytes: Math.max(0, Number(sizeBytes) || 0),
    entryCount: Math.max(0, Number(entryCount) || 0),
    now: new Date().toISOString(),
  });
};

/**
 * Update scan metadata (entry count, last scan timestamp, dirty flag) without
 * touching `size_bytes` — the reconciler adjusts size separately via
 * {@link applyDelta} so the change also propagates to ancestors.
 */
const setScanMeta = (db, absolutePath, { entryCount, lastFullScanAt, dirty = 0 }) => {
  prep(
    db,
    `
    UPDATE folder_size_index
    SET entry_count = @entryCount, last_full_scan_at = @lastFullScanAt, dirty = @dirty
    WHERE path_hash = @pathHash
  `
  ).run({
    pathHash: pathHash(absolutePath),
    entryCount,
    lastFullScanAt,
    dirty: dirty ? 1 : 0,
  });
};

/**
 * Remove a folder and its entire subtree from the index in one transaction.
 * Uses a binary prefix range ([rel + '/', rel + '0')) rather than LIKE so that
 * folder names containing `%` or `_` cannot over-match.
 *
 * @returns {number} the recorded recursive size of the removed folder, so
 *   callers can propagate a negative delta to the ancestors that remain.
 */
const removeSubtree = (db, scope, dirAbsolutePath) => {
  const { root, label } = scope;
  const existing = getByAbsolutePath(db, dirAbsolutePath);
  const size = existing ? existing.sizeBytes : 0;
  const rel = relativeOf(root, dirAbsolutePath);

  const run = db.transaction(() => {
    if (rel === '') {
      prep(db, 'DELETE FROM folder_size_index WHERE volume = ?').run(label);
    } else {
      prep(
        db,
        `DELETE FROM folder_size_index
         WHERE volume = ?
           AND (relative_path = ? OR (relative_path >= ? AND relative_path < ?))`
      ).run(label, rel, `${rel}/`, `${rel}0`);
    }
  });
  run();
  return size;
};

/**
 * Re-key a folder and its whole subtree after a move/rename, in one
 * transaction. Sizes are preserved (a rename does not change bytes); only the
 * path_hash / parent_hash / relative_path of each row are rewritten. The target
 * key space is assumed free (callers move to a fresh, conflict-resolved name).
 *
 * @returns {number} number of rows re-keyed
 */
const reparentSubtree = (db, scope, oldAbsolutePath, newAbsolutePath) => {
  const { root, label } = scope;
  const oldRel = relativeOf(root, oldAbsolutePath);
  const rows =
    oldRel === ''
      ? prep(db, 'SELECT * FROM folder_size_index WHERE volume = ?').all(label)
      : prep(
          db,
          `SELECT * FROM folder_size_index
             WHERE volume = ?
               AND (relative_path = ? OR (relative_path >= ? AND relative_path < ?))`
        ).all(label, oldRel, `${oldRel}/`, `${oldRel}0`);

  const update = prep(
    db,
    `UPDATE folder_size_index
     SET path_hash = @newHash, parent_hash = @newParentHash, relative_path = @newRel
     WHERE path_hash = @oldHash`
  );

  const run = db.transaction(() => {
    for (const row of rows) {
      const rowAbs = row.relative_path ? path.join(root, row.relative_path) : root;
      const suffix = rowAbs === oldAbsolutePath ? '' : rowAbs.slice(oldAbsolutePath.length);
      const newRowAbs = newAbsolutePath + suffix;
      const newParentAbs = newRowAbs === root ? null : path.dirname(newRowAbs);
      update.run({
        newHash: pathHash(newRowAbs),
        newParentHash: newParentAbs ? pathHash(newParentAbs) : null,
        newRel: relativeOf(root, newRowAbs),
        oldHash: row.path_hash,
      });
    }
  });
  run();
  return rows.length;
};

module.exports = {
  CURRENT_INDEX_VERSION,
  isWithinRoot,
  getByAbsolutePath,
  getLastUpdatedAt,
  listScanTargetsPage,
  countByVolume,
  getIndexVersion,
  setIndexVersion,
  applyDelta,
  upsertScanEntry,
  bulkUpsertScanEntries,
  cloneSubtree,
  upsertPendingDirectoryEntry,
  setScanMeta,
  removeSubtree,
  reparentSubtree,
};
