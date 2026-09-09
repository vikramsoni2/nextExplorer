const logger = require('../utils/logger');

/**
 * Where the words are kept, and nothing else.
 *
 * The index stores terms, not text. FTS5's contentless mode keeps only what it
 * needs to answer a query, which is a fraction of the size of the documents —
 * and the matched line, which results show, is read back from the file when a
 * result is actually returned. The path is right there, and only a page of
 * results is ever read, so storing every document a second time to save that
 * would be paying a lot for very little.
 *
 * `contentless_delete=1` is what makes it maintainable: without it, removing a
 * row requires handing FTS5 the original text back, which is exactly what is
 * not kept. It needs SQLite 3.43 or newer; the bundled one is well past that.
 */

const SEARCH_INDEX_DDL = `
  CREATE TABLE IF NOT EXISTS search_documents (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    dir TEXT NOT NULL DEFAULT '',
    mtime_ms INTEGER NOT NULL,
    size INTEGER NOT NULL,
    indexed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_search_documents_path ON search_documents(path);
  -- Asking what a folder holds has to be a lookup rather than a scan: it is
  -- what lets a pass forget a directory as soon as it leaves it, instead of
  -- carrying every path it has ever seen to the end.
  CREATE INDEX IF NOT EXISTS idx_search_documents_dir ON search_documents(dir);

  CREATE VIRTUAL TABLE IF NOT EXISTS search_terms
    USING fts5(text, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');
`;

/**
 * Prepared-statement cache, keyed by the db handle then the SQL text.
 *
 * Preparing a statement compiles it. A reconcile over a large volume runs these
 * queries several times per document and hundreds of times per second, and
 * compiling each one again every time burns CPU and churns native handles for
 * nothing. The folder-size index learned this on the same scale; this is the
 * same cache. The WeakMap lets it be collected with its connection.
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

/** What the index believes about a path, or null. */
const getIndexedDocument = (db, path) =>
  prep(db, 'SELECT id, mtime_ms AS mtimeMs, size FROM search_documents WHERE path = ?').get(
    path
  ) || null;

/** Whether the file on disk is the one already indexed. */
const isUpToDate = (indexed, { mtimeMs, size }) =>
  Boolean(indexed) && indexed.mtimeMs === Math.floor(mtimeMs) && indexed.size === size;

/**
 * Put a document's words in the index, replacing whatever was there.
 * Both tables move together or not at all.
 */
const parentOf = (documentPath) => {
  const at = documentPath.lastIndexOf('/');
  return at === -1 ? '' : documentPath.slice(0, at);
};

const upsertDocument = (db, { path, mtimeMs, size, text }) => {
  const now = new Date().toISOString();
  const existing = getIndexedDocument(db, path);

  if (existing) {
    prep(db, 'DELETE FROM search_terms WHERE rowid = ?').run(existing.id);
    prep(
      db,
      'UPDATE search_documents SET dir = ?, mtime_ms = ?, size = ?, indexed_at = ? WHERE id = ?'
    ).run(parentOf(path), Math.floor(mtimeMs), size, now, existing.id);
    prep(db, 'INSERT INTO search_terms(rowid, text) VALUES (?, ?)').run(existing.id, text);
    return existing.id;
  }

  const result = prep(
    db,
    'INSERT INTO search_documents (path, dir, mtime_ms, size, indexed_at) VALUES (?, ?, ?, ?, ?)'
  ).run(path, parentOf(path), Math.floor(mtimeMs), size, now);
  prep(db, 'INSERT INTO search_terms(rowid, text) VALUES (?, ?)').run(
    result.lastInsertRowid,
    text
  );
  return result.lastInsertRowid;
};

/** Forget a document. */
const removeDocument = (db, path) => {
  const existing = getIndexedDocument(db, path);
  if (!existing) return false;

  prep(db, 'DELETE FROM search_terms WHERE rowid = ?').run(existing.id);
  prep(db, 'DELETE FROM search_documents WHERE id = ?').run(existing.id);
  return true;
};

/** Forget a folder and everything under it. Answers how many went. */
const removeUnder = (db, prefix) => {
  const rows = prep(
    db,
    'SELECT id FROM search_documents WHERE path = ? OR path LIKE ? ESCAPE ?'
  ).all(prefix, `${prefix.replace(/[\\%_]/g, '\\$&')}/%`, '\\');

  for (const row of rows) {
    prep(db, 'DELETE FROM search_terms WHERE rowid = ?').run(row.id);
    prep(db, 'DELETE FROM search_documents WHERE id = ?').run(row.id);
  }
  return rows.length;
};

/**
 * Follow a rename. The words do not change, so only the path does — which is
 * the whole reason a move is cheap and a rewrite is not.
 */
const movePath = (db, fromPath, toPath) => {
  const like = `${fromPath.replace(/[\\%_]/g, '\\$&')}/%`;
  const moved = prep(
    db,
    `UPDATE search_documents
       SET path = ? || substr(path, ?),
           dir = rtrim(? || substr(path, ?), replace(? || substr(path, ?), rtrim(? || substr(path, ?), replace(? || substr(path, ?), '/', '')), ''))
       WHERE path LIKE ? ESCAPE '\\'`
  ).run(
    toPath,
    fromPath.length + 1,
    toPath,
    fromPath.length + 1,
    toPath,
    fromPath.length + 1,
    toPath,
    fromPath.length + 1,
    toPath,
    fromPath.length + 1,
    like
  );

  const movedSelf = prep(
    db,
    'UPDATE search_documents SET path = ?, dir = ? WHERE path = ?'
  ).run(toPath, parentOf(toPath), fromPath);

  return moved.changes + movedSelf.changes;
};

/**
 * Paths whose words match, best first.
 *
 * The query is what FTS5 understands, so a bare word is a prefix-free term
 * match. Callers pass a term the user typed, so it is quoted: someone
 * searching `NOT` or `a-b` is looking for those characters, not writing an
 * expression.
 */
const search = (db, term, limit = 100) => {
  const quoted = `"${String(term).replace(/"/g, '""')}"`;
  try {
    return prep(
      db,
      `SELECT d.path AS path
         FROM search_terms t
         JOIN search_documents d ON d.id = t.rowid
         WHERE search_terms MATCH ?
         ORDER BY rank
         LIMIT ?`
    )
      .all(quoted, limit)
      .map((row) => row.path);
  } catch (error) {
    logger.debug({ err: error, term }, 'Full-text query failed');
    return [];
  }
};

/**
 * What a folder holds, by name, and nothing about what is under it.
 *
 * This is the query that replaced carrying every path seen so far in memory:
 * fifty megabytes for two hundred thousand files, held from the first
 * directory to the last, on a container whose whole working set is sixty.
 */
const listDirectoryPaths = (db, dir) =>
  prep(db, 'SELECT path FROM search_documents WHERE dir = ?')
    .pluck()
    .all(dir);

/** Every folder the index has something in. Streamed, never materialised. */
const iterateIndexedDirectories = (db) =>
  prep(db, 'SELECT DISTINCT dir FROM search_documents ORDER BY dir').pluck().iterate();

/**
 * Whether the index has ever been finished.
 *
 * It matters because the index does not supplement the live content search, it
 * replaces it. Half an index therefore answers half a search and says nothing
 * about the half it did not look at — a term that was found yesterday is simply
 * absent today, which is worse than a slow answer and much harder to explain.
 * Until a pass has run to the end, searches read the tree as they always did.
 *
 * Kept in the database rather than in memory because a restart does not
 * invalidate the index: what was read is still read, and the mtime check is
 * what decides whether it is still true.
 */
const READY_KEY = 'search_index_complete_at';

const markPassComplete = (db, at = new Date().toISOString()) => {
  prep(db, 'INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(READY_KEY, at);
};

const isReady = (db) => {
  try {
    return Boolean(prep(db, 'SELECT value FROM meta WHERE key = ?').pluck().get(READY_KEY));
  } catch {
    return false;
  }
};

/**
 * Throw the whole index away.
 *
 * Safe at any time: every row in it was read from a file that is still there,
 * so the only cost of being wrong about needing this is one pass.
 */
const clear = (db) => {
  db.exec('DELETE FROM search_terms');
  db.exec('DELETE FROM search_documents');
  prep(db, 'DELETE FROM meta WHERE key = ?').run(READY_KEY);
};

/** How much is in there, for the diagnostics page and for tests. */
const stats = (db) => {
  const row = prep(db, 'SELECT COUNT(*) AS documents FROM search_documents').get();
  return { documents: row?.documents ?? 0 };
};

module.exports = {
  SEARCH_INDEX_DDL,
  getIndexedDocument,
  isUpToDate,
  upsertDocument,
  removeDocument,
  removeUnder,
  movePath,
  search,
  stats,
  clear,
  listDirectoryPaths,
  iterateIndexedDirectories,
  markPassComplete,
  isReady,
};
