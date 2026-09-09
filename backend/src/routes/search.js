const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const readline = require('readline');

const { normalizeRelativePath } = require('../utils/pathUtils');
const { pathExists } = require('../utils/fsUtils');
const {
  excludedFiles,
  hiddenFiles,
  search: searchConfig,
  directories,
} = require('../config/index');
const { resolvePathWithAccess, getAccessInfo } = require('../services/accessManager');
const asyncHandler = require('../utils/asyncHandler');
const { ValidationError, NotFoundError, ForbiddenError } = require('../errors/AppError');
const { createPermissionResolver } = require('../services/accessControlService');
const {
  findDocumentTextMatch,
  findPlainTextMatch,
  isSearchableDocument,
  SEARCHABLE_EXTENSIONS: DOCUMENT_EXTENSIONS,
} = require('../services/documentText');
const searchIndexStore = require('../services/searchIndexStore');
const { collectResults, buildPage } = require('../services/searchCollector');
const { parseSearchTerm } = require('../services/searchTerm');
const { ripgrepIgnoreGlobs, isIgnoredDirectory } = require('../services/searchIgnore');
const { whenClientDisconnects } = require('../utils/clientDisconnect');
const searchIndexExclusions = require('../services/searchIndexExclusions');
const { getDb } = require('../services/db');
const logger = require('../utils/logger');
const { getSettings, getUserSettings } = require('../services/settingsService');

const router = express.Router();

// Constants
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build']);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
// Filenames lead — they are what someone looking for a file expects first —
// but they cannot take the whole page from what is inside the documents.

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * The size bound for the JavaScript scan, which runs when ripgrep does not.
 *
 * The ripgrep path bounds the same thing in `streamDocumentMatches`, from the
 * same setting. One engine runs per request, so this is the single enforcement
 * on this path rather than a second copy of that one.
 */
const CONTENT_FALLBACK_MAX_SIZE =
  searchConfig?.maxFileSizeBytes > 0 ? searchConfig.maxFileSizeBytes : 5 * 1024 * 1024;

// Cache ripgrep availability (Optimization #4)
let ripgrepAvailable = null;

// Utilities
const toLimit = (value, def = DEFAULT_LIMIT) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : def;
};

const isDirectory = async (p) => {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
};

// Cached ripgrep check (Optimization #4)
const hasRipgrep = async () => {
  if (ripgrepAvailable !== null) return ripgrepAvailable;

  ripgrepAvailable = await new Promise((resolve) => {
    const child = spawn('rg', ['--version']);
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });

  return ripgrepAvailable;
};

// Search implementations
/**
 * Arguments for a content search.
 *
 * Exported so the `--` separator can be tested without ripgrep on the machine:
 * the route falls back to a JavaScript scan when ripgrep is missing, so an
 * end-to-end test passes there while never exercising this at all.
 */
const buildContentSearchArgs = (term, globArgs = [], maxFileSize = null) => {
  const args = [
    '--json', // Use JSON output for faster parsing (Optimization #2)
    '-n',
    '-H',
    '--hidden',
    '--no-messages',
    '--smart-case',
    '-F',
    '-m',
    '1',
    ...globArgs,
    // Everything after `--` is positional. Without it a search term starting
    // with `-` is parsed as a ripgrep flag, and options such as `--pre=<cmd>`
    // run that command against every scanned file.
    '--',
    term,
    '.',
  ];

  // Spawn arguments are strings; passing the number through and letting the
  // conversion happen somewhere else is how a value stops being checkable.
  if (maxFileSize) args.unshift('--max-filesize', String(maxFileSize));
  return args;
};

/**
 * Everything ripgrep is given for a content search, composed in one place.
 *
 * Exported so the wiring can be tested where ripgrep is not installed — which
 * is where this went wrong: the raw `SEARCH_MAX_FILESIZE` was handed over
 * instead of the parsed byte count, ripgrep refused the flag, and nothing
 * anywhere ran the code that would have shown it.
 */
const contentSearchArgs = (term, includeHiddenFiles = false, relBasePath = '') =>
  buildContentSearchArgs(
    term,
    buildRipgrepArgs(includeHiddenFiles, relBasePath),
    searchConfig?.maxFileSizeBytes
  );

const buildRipgrepArgs = (includeHiddenFiles = false, relBasePath = '') => [
  // A folder excluded from search is excluded from all of it, and not only
  // from the index: walking the Docker overlay by name is what made every
  // filename search run out its budget.
  ...ripgrepIgnoreGlobs(relBasePath, excludedSearchPaths()),
  '-g',
  '!.git',
  '-g',
  '!node_modules',
  '-g',
  '!dist',
  '-g',
  '!build',
  ...(includeHiddenFiles ? [] : hiddenFiles.ripgrepGlobExcludes.flatMap((glob) => ['-g', glob])),
];

/**
 * Reading the list every time rather than once: an administrator changing it
 * in Settings expects the next search to obey, not the next restart.
 */
const excludedSearchPaths = () => {
  try {
    return searchIndexExclusions.effectivePaths();
  } catch {
    return [];
  }
};

const normalizePath = (p, relBasePath) => {
  const normalized = p.replace(/\\/g, '/');
  return relBasePath ? path.posix.join(relBasePath, normalized) : normalized;
};

const shouldIgnore = (name, includeHiddenFiles = false) =>
  IGNORED_DIRS.has(name) ||
  excludedFiles.includes(name) ||
  (!includeHiddenFiles && hiddenFiles.isHiddenName(name));

const extractDirMatches = (fullPath, matcher, includeHiddenFiles = false) => {
  const dirs = new Set();
  const dirPath = path.posix.dirname(fullPath);

  if (dirPath && dirPath !== '.') {
    const parts = dirPath.split('/');
    let acc = '';

    for (const part of parts) {
      if (!part || shouldIgnore(part, includeHiddenFiles)) continue;
      acc = acc ? `${acc}/${part}` : part;
      if (matcher.matchesName(part)) dirs.add(acc);
    }
  }

  return dirs;
};

const formatResult = (rel, kind, line, lineNumber) => {
  const parent = path.posix.dirname(rel);
  const item = {
    name: path.posix.basename(rel),
    path: parent === '.' ? '' : parent,
    kind,
  };

  if (line != null) {
    item.matchLine = line;
    if (Number.isFinite(lineNumber)) item.matchLineNumber = lineNumber;
  }

  return item;
};

// Helper to safely parse JSON lines (Optimization #2)
const parseJsonLine = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

// Optimized: Stream file list results (Optimization #1 & #3)
async function* streamFileListMatches(
  baseAbsPath,
  relBasePath,
  matcher,
  seenPaths,
  dirSet,
  shouldInclude,
  includeHiddenFiles = false
) {
  const globArgs = buildRipgrepArgs(includeHiddenFiles, relBasePath);
  const fileListProcess = spawn('rg', ['--files', '--hidden', '--no-messages', ...globArgs], {
    cwd: baseAbsPath,
  });

  const rl = readline.createInterface({
    input: fileListProcess.stdout,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!includeHiddenFiles && hiddenFiles.isHiddenPath(trimmed)) continue;

      const fullRel = normalizePath(trimmed, relBasePath);

      // Extract and yield directory matches immediately
      for (const dirPath of extractDirMatches(fullRel, matcher, includeHiddenFiles)) {
        if (!dirSet.has(dirPath) && !seenPaths.has(dirPath)) {
          dirSet.add(dirPath);
          seenPaths.add(dirPath);
          if (await shouldInclude(dirPath)) {
            yield formatResult(dirPath, 'dir');
          }
        }
      }

      // Check filename match and yield immediately
      if (matcher.matchesRelativePath(fullRel) && !seenPaths.has(fullRel)) {
        seenPaths.add(fullRel);
        if (await shouldInclude(fullRel)) {
          yield formatResult(fullRel, 'file');
        }
      }
    }
  } finally {
    rl.close();
    fileListProcess.kill('SIGTERM');
  }
}

// Optimized: Stream content matches with JSON output (Optimization #1 & #2)
async function* streamContentMatches(
  baseAbsPath,
  relBasePath,
  term,
  seenPaths,
  shouldInclude,
  includeHiddenFiles = false
) {
  const contentArgs = contentSearchArgs(term, includeHiddenFiles, relBasePath);

  // The parsed byte count, never the raw setting. `SEARCH_MAX_FILESIZE=5MB` —
  // the form our own README suggests — went to ripgrep verbatim, and ripgrep
  // only accepts `K`, `M` or `G`. It answered `invalid format for size '5MB'`,
  // exited, and searched nothing: content search returned no results at all
  // while filename search, a separate invocation without this flag, went on
  // working. With --no-messages set and stderr unread, it did it in silence.

  const contentProcess = spawn('rg', contentArgs, { cwd: baseAbsPath });

  // Whatever ripgrep has to say about how it was called. `--no-messages`
  // silences per-file errors, not usage ones, and nothing was reading this: a
  // refused flag looked exactly like a search that found nothing.
  let stderr = '';
  contentProcess.stderr?.on('data', (chunk) => {
    if (stderr.length < 2000) stderr += String(chunk);
  });
  contentProcess.on('close', (code) => {
    // 1 is ripgrep's "no matches", which is an answer rather than a failure.
    if (code !== null && code > 1) {
      logger.warn({ code, stderr: stderr.trim() }, 'Content search failed to run');
    }
  });

  const rl = readline.createInterface({
    input: contentProcess.stdout,
    crlfDelay: Infinity,
  });

  // The consumer stops as soon as it has enough results. Without this the
  // process would keep scanning the whole tree in the background.
  try {
    for await (const line of rl) {
      const data = parseJsonLine(line);
      if (!data || data.type !== 'match') continue;

      const filePath = data.data?.path?.text;
      if (!filePath) continue;
      // `rg` reports content-search paths as `./file`, unlike `rg --files`.
      // That prefix is not a hidden-file marker; checking it first made every
      // content match look hidden and in particular hid literal terms such as
      // `--pre=...` even though the arguments were safely protected by `--`.
      const normalizedFilePath = filePath.replace(/^(?:\.\/|\.\\)+/, '');
      if (!includeHiddenFiles && hiddenFiles.isHiddenPath(normalizedFilePath)) continue;

      const lineNum = data.data?.line_number;
      const lineText = data.data?.lines?.text;

      const rel = normalizePath(normalizedFilePath, relBasePath);
      if (seenPaths.has(rel)) continue;

      seenPaths.add(rel);
      if (await shouldInclude(rel)) {
        yield formatResult(rel, 'file', lineText, lineNum);
      }
    }
  } finally {
    rl.close();
    contentProcess.kill('SIGTERM');
  }
}

/**
 * Yield from several generators as their results arrive.
 *
 * The two passes used to be drained one after the other despite the comment
 * that said they ran in parallel, and the route stops at its result limit. So
 * a term that matched a hundred filenames spent the whole budget before the
 * content search had produced anything — and content matches, the ones people
 * come to a deep search for, never appeared at all. The content search did not
 * even start until the entire file listing had been walked.
 */
/**
 * Wrap a generator so that its exhaustion is observable.
 *
 * The merged stream hides which source produced what and, more to the point,
 * which one has finished — and "no content can arrive any more" is exactly the
 * fact the collector needs to stop waiting for a reserve that will never fill.
 */
const announceWhenDone = (generator, onDone) =>
  (async function* watched() {
    try {
      yield* generator;
    } finally {
      onDone();
    }
  })();

const resultIdentity = (item) =>
  item?.path ? `${item.path}/${item.name}` : String(item?.name ?? '');

async function* mergeResults(...generators) {
  const next = new Map();
  // The last word on whether a file has already been listed.
  //
  // Each pass carries a shared `seenPaths` and consults it, which stops it
  // doing work another pass has done — but it cannot stop a duplicate, because
  // the check and the claim are not adjacent. The document pass tests the path,
  // then stats the file, extracts its text and asks permission, and only then
  // records it: three awaits wide. The file-list pass claims a path on the line
  // after it tests one, so it fits inside that window, and a `.docx` whose name
  // and contents both match the term came back twice.
  //
  // It showed up as one CI run in some number, because losing the race needs a
  // machine slow enough to finish the walk while a document is being unzipped.
  // Moving the claim earlier in that pass would trade the duplicate for a
  // worse bug: a document that turns out not to match would have reserved a
  // path the name pass then skips, and the file would vanish from the results.
  //
  // Here there is no window. Everything converges on this loop, so a path that
  // has been emitted is known to have been emitted, whatever order the passes
  // finished in.
  const emitted = new Set();

  for (const generator of generators) {
    next.set(
      generator,
      generator.next().then((result) => ({ generator, result }))
    );
  }

  try {
    while (next.size > 0) {
      // eslint-disable-next-line no-await-in-loop
      const { generator, result } = await Promise.race(next.values());
      if (result.done) {
        next.delete(generator);
        continue;
      }

      next.set(
        generator,
        generator.next().then((value) => ({ generator, result: value }))
      );

      const identity = resultIdentity(result.value);
      if (emitted.has(identity)) continue;
      emitted.add(identity);

      yield result.value;
    }
  } finally {
    // The consumer stops as soon as it has enough. Each generator closes its
    // own ripgrep process in its `finally`; this is what gets them there.
    for (const generator of next.keys()) {
      generator.return?.();
    }
  }
}

/**
 * Matches the index already knows about.
 *
 * It stores terms and not text, so the line to show is read back from the file
 * — which costs one read per result rather than one per document, and only for
 * the handful actually returned. That is the whole bargain of a contentless
 * index, and it is a good one.
 *
 * It covers the volume root. A search based anywhere else — a personal folder,
 * an assigned volume — falls back to reading as it goes, because the index
 * does not hold those.
 */
async function* streamIndexMatches(relBasePath, term, seenPaths, shouldInclude, limit) {
  let paths;
  try {
    const db = await getDb();
    // Over-fetch: permissions are applied after the query, since the index
    // does not know who may read what.
    paths = searchIndexStore.search(db, term, Math.max(limit * 3, 50));
  } catch (error) {
    logger.debug({ err: error }, 'Search index query failed; falling back to reading as we go');
    return;
  }

  const needle = term.toLowerCase();
  const prefix = relBasePath ? `${relBasePath}/` : '';

  for (const rel of paths) {
    if (prefix && !rel.startsWith(prefix) && rel !== relBasePath) continue;
    if (seenPaths.has(rel)) continue;

    const absolutePath = path.join(directories.volume, rel);
    let line = '';
    let lineNumber = null;

    if (isSearchableDocument(absolutePath)) {
      // eslint-disable-next-line no-await-in-loop
      const match = await findDocumentTextMatch(absolutePath, needle);
      if (match) {
        line = match.line;
        lineNumber = match.lineNumber;
      }
    } else {
      // eslint-disable-next-line no-await-in-loop
      const match = await findPlainTextMatch(absolutePath, needle);
      if (match) {
        line = match.line;
        lineNumber = match.lineNumber;
      }
    }

    // The file changed since it was indexed and no longer says this. The next
    // pass will notice; this one simply does not offer it.
    if (!lineNumber) continue;

    seenPaths.add(rel);
    // eslint-disable-next-line no-await-in-loop
    if (await shouldInclude(rel)) {
      yield formatResult(rel, 'file', line, lineNumber);
    }
  }
}

/**
 * Matches inside documents whose text has to be extracted first.
 *
 * Office files are zip archives and PDFs are compressed streams, so ripgrep
 * reads both as binary and finds nothing in them however the search is
 * configured. Reading them costs an unzip or a `pdftotext` per document, so
 * this is bounded three ways: only these extensions, only files under the
 * configured size, and only so many documents per search.
 *
 * The extension check is an optimisation and not a rule: `findDocumentTextMatch`
 * tests it again and returns null, so deleting it here changes only the number
 * of files opened. The other two decide what is searched.
 */
const OFFICE_DOCUMENT_LIMIT = 500;

async function* streamDocumentMatches(
  baseAbsPath,
  relBasePath,
  term,
  seenPaths,
  shouldInclude,
  includeHiddenFiles = false
) {
  const needle = term.toLowerCase();
  const maxBytes = searchConfig?.maxFileSizeBytes > 0 ? searchConfig.maxFileSizeBytes : null;
  let examined = 0;

  let entries;
  try {
    entries = await fs.readdir(baseAbsPath, { withFileTypes: true, recursive: true });
  } catch (err) {
    logger.debug({ err }, 'Could not list documents for the content search');
    return;
  }

  for (const entry of entries) {
    if (examined >= OFFICE_DOCUMENT_LIMIT) return;
    if (!entry.isFile()) continue;

    const extension = path.extname(entry.name).slice(1).toLowerCase();
    if (!DOCUMENT_EXTENSIONS.includes(extension)) continue;

    const parent = path.relative(baseAbsPath, entry.parentPath || entry.path || baseAbsPath);
    const relFromBase = parent
      ? path.posix.join(parent.split(path.sep).join('/'), entry.name)
      : entry.name;
    if (!includeHiddenFiles && hiddenFiles.isHiddenPath(relFromBase)) continue;

    const rel = normalizePath(relFromBase, relBasePath);
    if (seenPaths.has(rel)) continue;

    const absolutePath = path.join(baseAbsPath, relFromBase);
    // The same bound `generateFallbackResults` applies through
    // CONTENT_FALLBACK_MAX_SIZE. Not a duplicate: a request runs one content
    // engine or the other, never both, so each path enforces it once. Deleting
    // either looks harmless on a machine that does not take that path — which
    // is why the bound tests name their engine and run on both.
    if (maxBytes) {
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.stat(absolutePath).catch(() => null);
      if (!stats || stats.size > maxBytes) continue;
    }

    examined += 1;
    // eslint-disable-next-line no-await-in-loop
    const match = await findDocumentTextMatch(absolutePath, needle);
    if (!match) continue;

    seenPaths.add(rel);
    // eslint-disable-next-line no-await-in-loop
    if (await shouldInclude(rel)) {
      yield formatResult(rel, 'file', match.line, match.lineNumber);
    }
  }
}

// Optimized ripgrep with parallel execution (Optimization #1, #2, #3)
async function* generateRipgrepResults(
  baseAbsPath,
  relBasePath,
  term,
  shouldInclude,
  deep = true,
  includeHiddenFiles = false,
  { useIndex = false, limit = 100, onContentSources, onContentSourceDone } = {}
) {
  const matcher = parseSearchTerm(term);
  const seenPaths = new Set();
  const dirSet = new Set();

  if (!deep) {
    // If no deep search, only run file list matches
    yield* streamFileListMatches(
      baseAbsPath,
      relBasePath,
      matcher,
      seenPaths,
      dirSet,
      shouldInclude,
      includeHiddenFiles
    );
    return;
  }

  const fileListGen = streamFileListMatches(
    baseAbsPath,
    relBasePath,
    matcher,
    seenPaths,
    dirSet,
    shouldInclude,
    includeHiddenFiles
  );
  // With an index in place the live content scan is not run at all: doing both
  // would be exactly the cost an index exists to remove.
  const contentGen = useIndex
    ? streamIndexMatches(relBasePath, term, seenPaths, shouldInclude, limit)
    : streamContentMatches(
        baseAbsPath,
        relBasePath,
        term,
        seenPaths,
        shouldInclude,
        includeHiddenFiles
      );

  const documentGen = streamDocumentMatches(
    baseAbsPath,
    relBasePath,
    term,
    seenPaths,
    shouldInclude,
    includeHiddenFiles
  );

  // The document pass reads Office files and PDFs one by one; the index has
  // already read them.
  //
  // The content sources announce their own exhaustion, because the collector
  // has to know when a reserve it is holding the page open for can no longer
  // be filled. Without it, every search that finds few content matches waits
  // out the whole time budget for content that had already run out.
  // A wildcard term describes filenames and nothing else: no file contains
  // the characters `*.ps1`, so reading the tree for them costs the whole
  // budget to return files that merely mention the pattern in their text.
  const contentSources = !matcher.readsFileContents
    ? []
    : useIndex
      ? [contentGen]
      : [contentGen, documentGen];
  if (!matcher.readsFileContents) {
    await contentGen.return?.();
    await documentGen.return?.();
  }
  onContentSources?.(contentSources.length);
  const watched = contentSources.map((source) =>
    announceWhenDone(source, () => onContentSourceDone?.())
  );

  yield* mergeResults(fileListGen, ...watched);
}

// Optimized fallback with streaming (Optimization #1)
async function* generateFallbackResults(
  baseAbsPath,
  relBasePath,
  term,
  shouldInclude,
  deep = true,
  includeHiddenFiles = false,
  { useIndex = false, limit = 100 } = {}
) {
  const seenPaths = new Set();
  const matcher = parseSearchTerm(term);
  const needle = matcher.needle;
  const readsFileContents = deep && matcher.readsFileContents;

  // Yield results immediately as we find them
  const walk = async function* (dirAbs, dirRel) {
    let dirents;
    try {
      dirents = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return; // Skip directories we can't read
    }

    for (const d of dirents) {
      if (shouldIgnore(d.name, includeHiddenFiles)) continue;

      const abs = path.join(dirAbs, d.name);
      const rel = dirRel ? path.posix.join(dirRel, d.name) : d.name;

      if (d.isDirectory()) {
        // The same folders ripgrep is told to skip, skipped here too — the
        // fallback answering a different question is how this went unnoticed.
        if (isIgnoredDirectory(rel, excludedSearchPaths())) continue;
        if (matcher.matchesName(d.name) && !seenPaths.has(rel)) {
          seenPaths.add(rel);
          if (await shouldInclude(rel)) {
            yield formatResult(rel, 'dir');
          }
        }
        yield* walk(abs, rel);
      } else if (d.isFile()) {
        if (matcher.matchesRelativePath(rel) && !seenPaths.has(rel)) {
          seenPaths.add(rel);
          if (await shouldInclude(rel)) {
            yield formatResult(rel, 'file');
          }
        } else if (readsFileContents && !seenPaths.has(rel)) {
          try {
            const st = await fs.stat(abs);
            if (st.size <= CONTENT_FALLBACK_MAX_SIZE && isSearchableDocument(abs)) {
              // A .docx or a .pdf read as text is compressed bytes. Their words
              // have to be extracted before there is anything to search.
              const match = await findDocumentTextMatch(abs, needle);
              if (match) {
                seenPaths.add(rel);
                if (await shouldInclude(rel)) {
                  yield formatResult(rel, 'file', match.line, match.lineNumber);
                }
              }
            } else if (st.size <= CONTENT_FALLBACK_MAX_SIZE) {
              const match = await findPlainTextMatch(abs, needle, CONTENT_FALLBACK_MAX_SIZE);
              if (match) {
                seenPaths.add(rel);
                if (await shouldInclude(rel)) {
                  yield formatResult(rel, 'file', match.line, match.lineNumber);
                }
              }
            }
          } catch {
            // Ignore read/encoding errors
          }
        }
      }
    }
  };

  // With an index in place the walk stops reading files: it looks at names,
  // and the index answers for what is inside them.
  if (useIndex && !matcher.isGlob) {
    yield* mergeResults(
      walk(baseAbsPath, relBasePath),
      streamIndexMatches(relBasePath, term, seenPaths, shouldInclude, limit)
    );
    return;
  }

  yield* walk(baseAbsPath, relBasePath);
}

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) {
      throw new ValidationError('Search term (q) is required.');
    }

    const relBaseInput = normalizeRelativePath(req.query.path || '');

    const context = { user: req.user, guestSession: req.guestSession };
    let accessInfo;
    let resolvedBase;
    try {
      ({ accessInfo, resolved: resolvedBase } = await resolvePathWithAccess(context, relBaseInput));
    } catch (error) {
      throw new NotFoundError('Base path not found.');
    }

    if (!accessInfo || !accessInfo.canAccess || !accessInfo.canRead) {
      throw new ForbiddenError(accessInfo?.denialReason || 'Search base is not accessible.');
    }

    const baseAbs = resolvedBase.absolutePath;
    const relBase = resolvedBase.relativePath;

    if (!(await pathExists(baseAbs))) {
      throw new NotFoundError('Base path not found.');
    }
    if (!(await isDirectory(baseAbs))) {
      throw new ValidationError('Search base path must be a directory.');
    }

    const limit = toLimit(req.query.limit);
    const ripgrepAllowed = searchConfig?.ripgrep !== false;
    const useRipgrep = ripgrepAllowed && (await hasRipgrep());
    const deepEnabled = searchConfig?.deep !== false;

    const settings = await getSettings();
    const userSettings = req.user?.id ? await getUserSettings(req.user.id) : {};
    const includeHiddenFiles = userSettings?.showHiddenFiles === true;
    const permissionRules = Array.isArray(settings?.access?.rules) ? settings.access.rules : [];
    const permissionResolver = permissionRules.length
      ? createPermissionResolver(permissionRules)
      : null;
    const shareCache = new Map();
    const userVolumeCache = new Map();

    const includeCache = new Map();
    const shouldInclude = async (rel) => {
      const name = path.posix.basename(rel);
      if (excludedFiles.includes(name)) return false;
      if (!includeHiddenFiles && hiddenFiles.isHiddenName(name)) return false;

      if (includeCache.has(rel)) return includeCache.get(rel);

      const info = await getAccessInfo(context, rel, {
        ...(permissionResolver ? { permissionResolver } : null),
        shareCache,
        userVolumeCache,
      });
      const ok = Boolean(info?.canAccess && info?.canRead);
      includeCache.set(rel, ok);
      return ok;
    };

    // The index holds the volume root. A search based anywhere else — a
    // personal folder, an assigned volume — reads as it goes, because the
    // index does not hold those.
    //
    // And it is only used once a pass has finished. The index replaces the live
    // content scan rather than adding to it, so an index still being built
    // answers with the part of the volume it happens to have read — a term
    // found yesterday goes missing today, with nothing in the answer to say
    // why. Reading the tree meanwhile is slower and right.
    const indexReady = await (async () => {
      if (!(deepEnabled && searchConfig?.index?.enabled === true)) return false;
      try {
        return searchIndexStore.isReady(await getDb());
      } catch {
        return false;
      }
    })();

    const useIndex = indexReady && baseAbs.startsWith(directories.volume);

    // Nothing can produce a content match once every content source has
    // finished, and that is the moment a reserve stops being worth waiting for.
    let contentSourcesLeft = Number.POSITIVE_INFINITY;

    const generator = useRipgrep
      ? generateRipgrepResults(
          baseAbs,
          relBase,
          q,
          shouldInclude,
          deepEnabled,
          includeHiddenFiles,
          {
            useIndex,
            limit,
            onContentSources: (count) => {
              contentSourcesLeft = count;
            },
            onContentSourceDone: () => {
              contentSourcesLeft -= 1;
            },
          }
        )
      : generateFallbackResults(
          baseAbs,
          relBase,
          q,
          // With an index the walk does not read files; the index answers for
          // their contents.
          shouldInclude,
          deepEnabled && !useIndex,
          includeHiddenFiles,
          { useIndex, limit }
        );

    // Counted apart and only put together at the end: sharing one running
    // total let filenames spend it all, and a term matching a hundred of them
    // returned a hundred names and not one line of content — the half people
    // open a deep search for.
    const items = [];
    const contentItems = [];

    // Filled as they are found rather than handed back at the end: when the
    // budget wins the race, what has been collected so far is the answer, and
    // waiting for the collector to hand it over is the one thing there is no
    // time left for.
    const collect = collectResults({
      results: generator,
      limit,
      contentExhausted: () => contentSourcesLeft === 0,
      names: items,
      contents: contentItems,
    });

    let truncated = false;
    let abandoned = false;
    {
      // Guaranteeing content a share means looking for it until the reserve is
      // full or the tree runs out — and on a large one that is a long time to
      // hold someone waiting. The budget ends it: whatever has been found by
      // then is the answer, which is a better one than a spinner.
      //
      // Which of the two won has to be read from the race itself. Ending the
      // generator below makes the loop exit normally, so anything the
      // collector sets on its way out would say it finished either way.
      const outcome = await Promise.race([
        collect.then(() => 'complete'),
        delay(searchConfig?.timeoutMs ?? 5000).then(() => 'timeout'),
        // Typing sends one search per pause and the panel keeps only the last.
        // Without this the abandoned ones each ran their full budget, with
        // their own subprocesses, for answers nobody would read.
        whenClientDisconnects(res).then(() => 'abandoned'),
      ]);
      abandoned = outcome === 'abandoned';
      truncated = outcome === 'timeout';
    }

    // Breaking out of a for-await leaves the generator suspended, and with it
    // the ripgrep processes it spawned — which keep scanning the whole tree.
    // Returning runs their cleanup so they are killed.
    //
    // It is not awaited before answering, and that is the point: cleanup means
    // resuming every source at whatever it was in the middle of, which on a
    // busy tree took six seconds. A budget of five that answers in eleven is
    // not a budget — the wait it was written to cap simply moved.
    const cleanup = Promise.resolve(generator.return?.())
      .catch(() => {})
      .then(() => collect)
      .catch(() => {});

    if (abandoned) {
      await cleanup;
      return;
    }

    const combined = buildPage({ names: items, contents: contentItems, limit });

    // Said out loud rather than left to look like a complete answer: a search
    // the budget ended has not seen everything, and whoever is reading the
    // results deserves to know which of the two they are looking at.
    if (truncated) {
      logger.info(
        { term: q, names: items.length, contents: contentItems.length },
        'Search stopped at its time budget'
      );
    }

    res.json({ items: combined, truncated });
    await cleanup;
  })
);

module.exports = router;
module.exports.buildContentSearchArgs = buildContentSearchArgs;
module.exports.contentSearchArgs = contentSearchArgs;
// Exported for the test that drives it directly: the duplicate it prevents
// depends on which pass wins a race, which a test cannot arrange from outside.
module.exports.mergeResults = mergeResults;
