const path = require('path');
const fs = require('fs/promises');

const { search: searchConfig, directories, extensions } = require('../config/index');
const { extractPdfTextLines } = require('./pdfTextExtract');
const { extractOfficeTextLines, isOfficeDocument } = require('./officeTextExtract');
const store = require('./searchIndexStore');
const { containerMemoryLimitBytes } = require('../utils/containerMemory');

/**
 * Building the index without being noticed.
 *
 * The rule this borrows from the folder-size index: work in small batches
 * inside one transaction each, hand the event loop back between them, and
 * check an abort signal at every step. A walk that cannot be interrupted is a
 * walk that decides for itself when the server is free, and it is always
 * wrong about that.
 *
 * What it did not borrow, and had to learn: pacing on a count of items paces
 * nothing here. The folder-size walk costs a `stat` per item, so pausing every
 * two hundred of them is a real pause. Indexing costs a file read, an
 * extraction and a tokenisation per item, so pausing every twenty-five of them
 * was fifty milliseconds of rest for seconds of work — a core held at half
 * load for as long as the pass ran. The pause is taken on elapsed time now, so
 * the share of a core is what is chosen and it holds whatever the files are.
 *
 * Reading a file is the expensive part, so nothing is read twice: a document
 * whose size and modification time match what was indexed is skipped without
 * being opened.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', '.cache']);

/**
 * How much of one document is worth indexing, and how much may be held at once.
 *
 * A batch used to be counted in documents, which says nothing about memory: a
 * file of a few megabytes becomes a JavaScript string twice that size, and
 * twenty-five of them held together while FTS5 tokenises each is hundreds of
 * megabytes for a background task nobody asked to be noticed. Both are bounded
 * in bytes now.
 *
 * A megabyte of text is some two hundred thousand words. A search that cannot
 * be answered by those is not one a bigger index would have answered either.
 */
const MAX_TEXT_PER_DOCUMENT = 1024 * 1024;
const MAX_TEXT_PER_BATCH = 4 * 1024 * 1024;

/**
 * Files that are never going to yield a search term.
 *
 * Reading one to find that out costs the same as reading a document: the sniff
 * below only rules a file out after it has been opened and read. A volume is
 * mostly photos, video and archives, so deciding from the name first is what
 * keeps a pass proportional to the documents rather than to the disk.
 */
const NON_TEXT_EXTENSIONS = new Set([
  ...extensions.images,
  ...extensions.rawImages,
  ...extensions.videos,
  ...extensions.audios,
  'zip', 'rar', '7z', 'gz', 'bz2', 'xz', 'zst', 'tar', 'tgz', 'iso', 'dmg', 'jar',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'class', 'pyc', 'wasm',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'db', 'sqlite', 'sqlite3', 'mdb', 'pack', 'idx',
]);

const extensionOf = (absolutePath) => path.extname(absolutePath).slice(1).toLowerCase();

/** Whether the name alone is enough to leave a file unopened. */
const isProbablyNotText = (absolutePath) => NON_TEXT_EXTENSIONS.has(extensionOf(absolutePath));

/** Enough of a file to tell prose from a binary. */
const SNIFF_BYTES = 4096;

const looksBinary = (buffer) => {
  const length = Math.min(buffer.length, SNIFF_BYTES);
  if (!length) return false;

  let suspicious = 0;
  for (let index = 0; index < length; index += 1) {
    const byte = buffer[index];
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / length > 0.3;
};

/**
 * The head of a plain file, as text — never more of it than will be kept.
 *
 * Read in two steps on purpose. The first is a few kilobytes, enough to tell
 * prose from a binary; a file that fails that test is closed having cost one
 * small read. Reading the whole file first and deciding afterwards is what
 * turned a pass over a volume into gigabytes of buffers and strings allocated
 * and thrown away, at whatever rate the disk could sustain.
 */
const readPlainTextHead = async (absolutePath, size, scratch = null) => {
  let handle = null;
  try {
    handle = await fs.open(absolutePath, 'r');

    const sniffLength = Math.min(size, SNIFF_BYTES);
    const sniff = scratch ? scratch.subarray(0, sniffLength) : Buffer.allocUnsafe(sniffLength);
    const { bytesRead } = await handle.read(sniff, 0, sniffLength, 0);
    if (!bytesRead) return null;
    if (looksBinary(sniff.subarray(0, bytesRead))) return null;

    if (size <= bytesRead) return sniff.subarray(0, bytesRead).toString('utf8');

    const wanted = Math.min(size, MAX_TEXT_PER_DOCUMENT);
    const buffer = scratch ? scratch.subarray(0, wanted) : Buffer.allocUnsafe(wanted);
    const full = await handle.read(buffer, 0, wanted, 0);
    return buffer.subarray(0, full.bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
};

/**
 * The words in a file, or null where there are none to take — a binary, an
 * unreadable file, a document with no text layer.
 */
const readIndexableText = async (absolutePath, size, scratch = null) => {
  if (isOfficeDocument(absolutePath)) {
    const lines = extractOfficeTextLines(absolutePath);
    return lines ? lines.join('\n') : null;
  }

  if (extensionOf(absolutePath) === 'pdf') {
    const lines = await extractPdfTextLines(absolutePath);
    return lines ? lines.join('\n') : null;
  }

  if (isProbablyNotText(absolutePath)) return null;

  return readPlainTextHead(absolutePath, size, scratch);
};

/** As much of a document as is worth keeping terms for. */
const capText = (text) =>
  text.length > MAX_TEXT_PER_DOCUMENT ? text.slice(0, MAX_TEXT_PER_DOCUMENT) : text;

const createAbortedError = () => {
  const error = new Error('Indexing was interrupted.');
  error.code = 'SEARCH_INDEX_ABORTED';
  return error;
};

/**
 * Walk a tree and bring the index up to date with it.
 *
 * Returns what it did, and what it did not: an interrupted run reports its
 * progress rather than throwing it away, so the next one is shorter.
 */
const indexTree = async ({
  db,
  rootAbs = directories.volume,
  rootRel = '',
  signal,
  batchSize = 25,
  cpuPercent = 25,
  workSliceMs = 50,
  memoryBudgetBytes = 256 * 1024 * 1024,
  exclude = searchConfig?.index?.exclude ?? [],
  readMemory = () => process.memoryUsage().rss,
  maxFileSizeBytes = searchConfig?.maxFileSizeBytes ?? 5 * 1024 * 1024,
  removeMissing = true,
  onProgress,
  progressMs = 30 * 1000,
} = {}) => {
  // Directories visited, not files seen. The difference is the whole point: a
  // volume has a few tens of thousands of folders and a few hundred thousand
  // files, and only one of those numbers can be carried to the end of a pass
  // on a container whose working set is sixty megabytes.
  const seenDirs = new Set(['']);
  const pending = [];
  let pendingBytes = 0;
  let indexed = 0;
  let skipped = 0;
  let batches = 0;
  let interrupted = false;

  const throwIfAborted = () => {
    if (signal?.aborted) throw createAbortedError();
  };

  /**
   * One buffer for the whole pass, rather than one per file.
   *
   * A megabyte allocated and freed per document is not a leak — the memory is
   * released — but the allocator keeps the ground it took, and a pass over a
   * volume with large documents in it leaves the process holding a hundred
   * megabytes it will not give back. What the user sees is a container that
   * never returns to what it used before indexing, and no amount of collecting
   * brings it down, because there is nothing left to collect.
   *
   * Safe because index work is serialised: one worker drains the per-file
   * queue, and a pass holds it for its duration. Nothing else reads into this.
   */
  const scratch = Buffer.allocUnsafe(MAX_TEXT_PER_DOCUMENT);

  /**
   * Files re-read although the index already knew them.
   *
   * A count alone cannot tell a volume that really is that active from a skip
   * check its storage answers differently each time, so three shapes of the
   * same fact are kept: which field moved, by how much, and where. A constant
   * offset in the dates, one noisy folder, or genuine activity spread over the
   * whole tree each look completely different in those three, and identical in
   * a total.
   *
   * All three are bounded. This is a diagnostic on a volume with six hundred
   * thousand documents in it; it does not get to be the thing that runs the
   * machine out of memory.
   */
  const MAX_REREAD_SAMPLES = 10;
  const MAX_TRACKED_KEYS = 500;
  const rereadSamples = [];
  const rereadByField = { mtime: 0, size: 0, both: 0 };
  const deltaCounts = new Map();
  const dirCounts = new Map();
  let reindexedKnown = 0;

  const countCapped = (map, key) => {
    const seenKey = map.get(key);
    if (seenKey !== undefined) map.set(key, seenKey + 1);
    else if (map.size < MAX_TRACKED_KEYS) map.set(key, 1);
  };

  const topOf = (map, limit = 5) =>
    [...map.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));

  let removed = 0;
  const forgetPaths = db.transaction((paths) => {
    for (const gonePath of paths) store.removeDocument(db, gonePath);
  });

  const excluded = exclude.filter(Boolean);
  const isExcluded = (relativePath) =>
    excluded.some((entry) => relativePath === entry || relativePath.startsWith(`${entry}/`));

  // Work for a slice, then stand aside for as long as the chosen share says.
  // At 25% that is 50 ms of work and 150 ms of rest, whether those 50 ms went
  // into one large PDF or forty small text files.
  const share = Math.min(100, Math.max(1, cpuPercent));
  const restMs = Math.round((workSliceMs * (100 - share)) / share);
  let sliceStartedAt = Date.now();
  let pauses = 0;

  // A ceiling on the pass, checked once a slice.
  //
  // Two of them, because two different things are being protected against.
  // What actually kills a container is the process passing the limit its
  // cgroup enforces, so where there is one that is the ceiling — three
  // quarters of it, leaving room for the request that arrives while the pass
  // is between checks. Where there is none, the fallback is what the pass
  // itself has added, which is all that can be known without a limit to
  // compare against.
  //
  // The delta is a blunt instrument and worth being honest about: it is the
  // whole process's growth since the pass began, so a thumbnail sweep or a
  // folder-size reconcile running alongside is counted against the index. A
  // single reading is therefore not enough to stop on — it takes two in a row,
  // so a spike belonging to something else does not end the pass.
  //
  // Stopping is safe either way: what was written stays written, and the next
  // pass skips it and carries on from there.
  const memoryAtStart = readMemory();
  const containerLimit = containerMemoryLimitBytes();
  const containerCeiling = containerLimit ? containerLimit * 0.75 : null;
  let consecutiveOverBudget = 0;
  const cpuAtStart = process.cpuUsage();
  const startedAt = Date.now();
  let stoppedForMemory = false;

  const overMemoryBudget = () => {
    const rss = readMemory();

    if (containerCeiling) return rss > containerCeiling;

    if (!(memoryBudgetBytes > 0)) return false;
    if (rss - memoryAtStart > memoryBudgetBytes) {
      consecutiveOverBudget += 1;
      return consecutiveOverBudget >= 2;
    }
    consecutiveOverBudget = 0;
    return false;
  };

  const growthMb = () => Math.round((readMemory() - memoryAtStart) / (1024 * 1024));

  /**
   * What the pass has cost so far, as opposed to what the container is using.
   *
   * `rssMb` is the whole process — sessions, thumbnails, the folder-size index
   * — and says nothing on its own about who is holding it. `addedMb` is this
   * pass's own share, and `cpuPercent` is measured against the wall clock, so
   * a quarter of a core reads as 25 whatever else the machine is doing.
   */
  const cost = () => {
    const cpu = process.cpuUsage(cpuAtStart);
    const cpuMs = Math.round((cpu.user + cpu.system) / 1000);
    const elapsedMs = Math.max(1, Date.now() - startedAt);
    return {
      addedMb: growthMb(),
      rssMb: Math.round(readMemory() / (1024 * 1024)),
      cpuMs,
      cpuPercent: Math.round((cpuMs / elapsedMs) * 100),
      pauses,
    };
  };

  const payForTimeUsed = async () => {
    if (Date.now() - sliceStartedAt < workSliceMs) return;

    if (overMemoryBudget()) {
      stoppedForMemory = true;
      throw createAbortedError();
    }
    if (restMs > 0) {
      pauses += 1;
      await sleep(restMs);
    }
    sliceStartedAt = Date.now();
  };

  // A first pass over a large library takes minutes, and silence for minutes
  // is indistinguishable from nothing happening. Progress is reported on a
  // timer rather than per batch, so the log says how it is going without
  // becoming the noisiest thing in it.
  let lastReport = Date.now();

  // Built once. `db.transaction()` compiles its own statements every time it is
  // called, and it is called once per batch — the same compile-in-a-loop that
  // made the queries below expensive.
  const writeBatch = db.transaction((batch) => {
    for (const document of batch) store.upsertDocument(db, document);
  });

  const flush = () => {
    if (pending.length === 0) return;

    const batch = pending.splice(0, pending.length);
    pendingBytes = 0;
    writeBatch(batch);
    indexed += batch.length;
    batches += 1;

    if (typeof onProgress === 'function' && Date.now() - lastReport >= progressMs) {
      lastReport = Date.now();
      // What this pass has added to the process, which is the only number that
      // says whether the index is the thing using the memory. Without it the
      // question can only be answered by argument.
      // The re-read report used to arrive only at the end, which on a volume
      // this size means waiting half an hour to find out which folder is
      // responsible. The count and the folder leading it travel with every
      // progress line instead.
      const [worstFolder] = topOf(dirCounts, 1);
      onProgress({
        indexed,
        skipped,
        batches,
        reindexed: reindexedKnown,
        ...(worstFolder ? { rereadTopFolder: worstFolder.value, rereadTopCount: worstFolder.count } : {}),
        ...cost(),
      });
    }
  };

  const walk = async (dirAbs, dirRel) => {
    throwIfAborted();
    seenDirs.add(dirRel);

    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return; // A directory we cannot read is not a reason to stop.
    }

    // What this directory holds, forgotten as soon as it is left.
    const seenHere = new Set();

    for (const entry of entries) {
      throwIfAborted();

      if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue;

      const absolutePath = path.join(dirAbs, entry.name);
      const relativePath = dirRel ? `${dirRel}/${entry.name}` : entry.name;

      if (isExcluded(relativePath)) continue;

      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;

      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.stat(absolutePath).catch(() => null);
      if (!stats) continue;
      if (maxFileSizeBytes && stats.size > maxFileSizeBytes) continue;

      seenHere.add(relativePath);

      // Already indexed, unchanged: not opened at all. This is what makes the
      // second run cost almost nothing.
      const known = store.getIndexedDocument(db, relativePath);
      if (store.isUpToDate(known, stats)) {
        skipped += 1;
        // eslint-disable-next-line no-await-in-loop
        await payForTimeUsed();
        continue;
      }

      // A pass that re-reads tens of thousands of files nobody touched is
      // either looking at a volume that really does change that much, or
      // asking a question its storage cannot answer the same way twice. The
      // two look identical from a count, so the first few disagreements are
      // reported in full: what was stored, what the disk says now, and which
      // of the two fields differs.
      if (known) {
        const diskMtimeMs = Math.floor(stats.mtimeMs);
        const mtimeMoved = known.mtimeMs !== diskMtimeMs;
        const sizeMoved = known.size !== stats.size;
        const differs = mtimeMoved ? (sizeMoved ? 'both' : 'mtime') : 'size';

        reindexedKnown += 1;
        rereadByField[differs] += 1;
        if (mtimeMoved) countCapped(deltaCounts, diskMtimeMs - known.mtimeMs);
        countCapped(dirCounts, dirRel || '/');

        if (rereadSamples.length < MAX_REREAD_SAMPLES) {
          rereadSamples.push({
            path: relativePath,
            storedMtimeMs: known.mtimeMs,
            diskMtimeMs,
            mtimeDeltaMs: diskMtimeMs - known.mtimeMs,
            storedSize: known.size,
            diskSize: stats.size,
            differs,
          });
        }
      }

      // eslint-disable-next-line no-await-in-loop
      const text = await readIndexableText(absolutePath, stats.size, scratch);
      if (text === null || !text.trim()) continue;

      const indexable = capText(text);
      pending.push({
        path: relativePath,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        text: indexable,
      });
      pendingBytes += indexable.length;

      // Whichever ceiling is reached first. The byte one is what keeps a
      // handful of large documents from being held together.
      if (pending.length >= batchSize || pendingBytes >= MAX_TEXT_PER_BATCH) flush();

      // eslint-disable-next-line no-await-in-loop
      await payForTimeUsed();
    }

    // Everything the index holds for this folder that is no longer in it. The
    // listing above is complete, so this is safe even if the pass is stopped
    // before it reaches the next folder — an interrupted run keeps the
    // deletions it was sure of, rather than throwing them away.
    if (removeMissing) {
      const goneHere = store.listDirectoryPaths(db, dirRel).filter((known) => !seenHere.has(known));
      if (goneHere.length > 0) {
        forgetPaths(goneHere);
        removed += goneHere.length;
      }
    }
  };

  try {
    await walk(rootAbs, rootRel);
    flush();
  } catch (error) {
    flush();
    if (error?.code !== 'SEARCH_INDEX_ABORTED') throw error;
    interrupted = true;
  }

  // A folder deleted outright is never walked, so nothing above ever asks what
  // it held. Only a run that reached the end can tell that apart from a folder
  // it simply had not got to yet.
  if (removeMissing && !interrupted) {
    const goneDirs = [];
    for (const dir of store.iterateIndexedDirectories(db)) {
      if (!seenDirs.has(dir)) goneDirs.push(dir);
    }
    for (const dir of goneDirs) {
      const paths = store.listDirectoryPaths(db, dir);
      if (paths.length > 0) {
        forgetPaths(paths);
        removed += paths.length;
      }
    }
  }

  return {
    indexed,
    skipped,
    removed,
    batches,
    pauses,
    interrupted,
    stoppedForMemory,
    reindexedKnown,
    rereadByField,
    topMtimeDeltas: topOf(deltaCounts),
    topRereadDirs: topOf(dirCounts),
    rereadSamples,
    ...cost(),
  };
};

/** Bring one file up to date, or forget it if it is gone. */
const indexFile = async (db, relativePath, absolutePath) => {
  const stats = await fs.stat(absolutePath).catch(() => null);
  if (!stats || !stats.isFile()) {
    store.removeDocument(db, relativePath);
    return { removed: true };
  }

  const maxBytes = searchConfig?.maxFileSizeBytes ?? 0;
  if (maxBytes && stats.size > maxBytes) {
    store.removeDocument(db, relativePath);
    return { skipped: true };
  }

  if (store.isUpToDate(store.getIndexedDocument(db, relativePath), stats)) {
    return { unchanged: true };
  }

  const text = await readIndexableText(absolutePath, stats.size);
  if (text === null || !text.trim()) {
    store.removeDocument(db, relativePath);
    return { skipped: true };
  }

  store.upsertDocument(db, {
    path: relativePath,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    text: capText(text),
  });
  return { indexed: true };
};

module.exports = { indexTree, indexFile, readIndexableText };

// Exported for tests: telling prose from a binary is the one judgement here.
module.exports.looksBinary = looksBinary;
