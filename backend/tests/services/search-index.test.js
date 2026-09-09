import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { setupTestEnv } from '../helpers/env-test-utils.js';
import { buildPdf } from '../helpers/pdf-fixture.js';

/**
 * The index keeps terms, not text, and is built by a walk that has to be
 * interruptible: one that cannot be stopped decides for itself when the server
 * is free, and it is always wrong about that.
 */

let envContext;
let db;
let store;
let indexer;

const volumePath = (...parts) => path.join(envContext.volumeDir, ...parts);

const build = async (env = {}) => {
  envContext = await setupTestEnv({ tag: 'search-index-', env });
  const dbService = envContext.requireFresh('src/services/db');
  db = await dbService.getDb();
  store = envContext.requireFresh('src/services/searchIndexStore');
  indexer = envContext.requireFresh('src/services/searchIndexer');
};

const indexAll = (options = {}) =>
  indexer.indexTree({ db, rootAbs: envContext.volumeDir, cpuPercent: 100, ...options });

afterEach(async () => {
  if (envContext) await envContext.cleanup();
  envContext = null;
});

describe('what the index knows', () => {
  beforeEach(async () => {
    await build();
    await fs.mkdir(volumePath('Docs'), { recursive: true });
    await fs.writeFile(
      volumePath('Docs', 'notes.md'),
      '# Notes\n\nle pangolin mange des fourmis\n'
    );
    await fs.writeFile(volumePath('Docs', 'other.txt'), 'rien de particulier ici\n');
  });

  it('finds a document by a word inside it', async () => {
    await indexAll();

    expect(store.search(db, 'pangolin')).toEqual(['Docs/notes.md']);
  });

  // The schema asks for it, and it is what makes a French index usable.
  it('ignores accents and case', async () => {
    await indexAll();

    expect(store.search(db, 'FOURMIS')).toEqual(['Docs/notes.md']);
    expect(store.search(db, 'pangolín')).toEqual(['Docs/notes.md']);
  });

  it('says nothing for a word nobody wrote', async () => {
    await indexAll();

    expect(store.search(db, 'tatou')).toEqual([]);
  });

  it('reads Office documents and PDFs too', async () => {
    await fs.writeFile(volumePath('Docs', 'report.pdf'), buildPdf('the pangolin report'));
    await indexAll();

    expect(store.search(db, 'report')).toContain('Docs/report.pdf');
  });

  // A term the user typed is a term, not an expression: someone searching for
  // `NOT` or a quote is looking for those characters.
  it('takes a query that would otherwise be FTS syntax', async () => {
    await fs.writeFile(volumePath('Docs', 'odd.txt'), 'the word NOT appears here\n');
    await indexAll();

    expect(store.search(db, 'NOT')).toContain('Docs/odd.txt');
    expect(() => store.search(db, '"')).not.toThrow();
  });
});

describe('keeping up with the files', () => {
  beforeEach(async () => {
    await build();
    await fs.mkdir(volumePath('Docs'), { recursive: true });
    await fs.writeFile(volumePath('Docs', 'notes.md'), 'le pangolin est là\n');
  });

  // The second run is what has to be cheap, or an index is a tax.
  it('does not open a file it has already read', async () => {
    const first = await indexAll();
    expect(first.indexed).toBe(1);

    const second = await indexAll();
    expect(second.indexed).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('notices a file that changed', async () => {
    await indexAll();
    await fs.writeFile(volumePath('Docs', 'notes.md'), 'le tatou a pris sa place\n');

    const again = await indexAll();

    expect(again.indexed).toBe(1);
    expect(store.search(db, 'pangolin')).toEqual([]);
    expect(store.search(db, 'tatou')).toEqual(['Docs/notes.md']);
  });

  it('forgets a file that is gone', async () => {
    await indexAll();
    await fs.rm(volumePath('Docs', 'notes.md'));

    const again = await indexAll();

    expect(again.removed).toBe(1);
    expect(store.search(db, 'pangolin')).toEqual([]);
  });

  it('follows a rename without reading anything again', async () => {
    await indexAll();

    store.movePath(db, 'Docs', 'Archive');

    expect(store.search(db, 'pangolin')).toEqual(['Archive/notes.md']);
  });
});

describe('being interruptible', () => {
  beforeEach(async () => {
    await build();
    await fs.mkdir(volumePath('Docs'), { recursive: true });
    for (let index = 0; index < 60; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(volumePath('Docs', `file-${index}.txt`), `document ${index} pangolin\n`);
    }
  });

  it('stops when asked and says so', async () => {
    const controller = new AbortController();
    const running = indexAll({ signal: controller.signal, batchSize: 5, cpuPercent: 1, workSliceMs: 1 });
    // Long enough to have started, far short of sixty files.
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();

    const result = await running;

    expect(result.interrupted).toBe(true);
    expect(result.indexed).toBeLessThan(60);
  });

  // What it did get through is kept: the next run has that much less to do.
  it('keeps the work it had already done', async () => {
    const controller = new AbortController();
    const running = indexAll({ signal: controller.signal, batchSize: 5, cpuPercent: 1, workSliceMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    const first = await running;

    expect(store.stats(db).documents).toBe(first.indexed);

    const second = await indexAll();
    expect(second.skipped).toBe(first.indexed);
    expect(store.stats(db).documents).toBe(60);
  });

  // An interrupted walk has not seen the whole tree, so it cannot know what is
  // missing from it — deleting on that basis would empty the index.
  it('does not decide what is missing when it was cut short', async () => {
    await indexAll();
    expect(store.stats(db).documents).toBe(60);

    const controller = new AbortController();
    controller.abort();
    const result = await indexAll({ signal: controller.signal });

    expect(result.interrupted).toBe(true);
    expect(result.removed).toBe(0);
    expect(store.stats(db).documents).toBe(60);
  });
});

describe('what it leaves out', () => {
  beforeEach(async () => {
    await build({ SEARCH_MAX_FILESIZE: '2K' });
    await fs.mkdir(volumePath('Docs'), { recursive: true });
  });

  it('leaves a file bigger than the limit alone', async () => {
    await fs.writeFile(volumePath('Docs', 'big.txt'), `${'x'.repeat(4096)}\npangolin\n`);
    await fs.writeFile(volumePath('Docs', 'small.txt'), 'pangolin\n');

    await indexAll();

    expect(store.search(db, 'pangolin')).toEqual(['Docs/small.txt']);
  });

  // A null byte is the giveaway, and it has to be the one that decides: the
  // rest of this file is perfectly ordinary text, which is what a real binary
  // with embedded strings looks like. The extension is one nothing rules out,
  // so the sniff is the only thing that can be doing the work here.
  it('leaves binaries alone', async () => {
    await fs.writeFile(
      volumePath('Docs', 'blob.dat'),
      Buffer.from(
        'pangolin\u0000pangolin\u0000pangolin and a great deal of ordinary text',
        'binary'
      )
    );
    await fs.writeFile(volumePath('Docs', 'text.txt'), 'pangolin\n');

    await indexAll();

    expect(store.search(db, 'pangolin')).toEqual(['Docs/text.txt']);
    expect(store.stats(db).documents).toBe(1);
  });
});

/**
 * A background task must not be the reason a container runs out of memory. A
 * batch counted in documents says nothing about how much is being held: a file
 * of a few megabytes becomes a string twice that size, and a handful of them
 * together is hundreds of megabytes while FTS5 tokenises each in turn.
 */
describe('how much it holds at once', () => {
  beforeEach(async () => {
    await build({ SEARCH_MAX_FILESIZE: '20M' });
    await fs.mkdir(volumePath('Docs'), { recursive: true });
  });

  it('writes in smaller batches when the documents are large', async () => {
    // Six documents of two megabytes each: counted in documents that is one
    // batch, counted in bytes it cannot be.
    for (let index = 0; index < 6; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(
        volumePath('Docs', `big-${index}.txt`),
        `pangolin ${'lorem ipsum dolor sit amet '.repeat(80000)}`
      );
    }

    const result = await indexAll({ batchSize: 25 });

    expect(result.indexed).toBe(6);
    expect(result.batches).toBeGreaterThan(1);
    expect(store.search(db, 'pangolin').length).toBe(6);
  });

  // Terms are what is kept, and a megabyte of them is two hundred thousand
  // words. Beyond that an index is carrying weight it cannot be asked about.
  it('keeps only as much of one document as is worth searching', async () => {
    const padding = 'lorem ipsum dolor sit amet '.repeat(60000);
    await fs.writeFile(volumePath('Docs', 'huge.txt'), `pangolin ${padding} tatou`);

    await indexAll();

    expect(store.search(db, 'pangolin')).toEqual(['Docs/huge.txt']);
    // Past the cap, so never taken in.
    expect(store.search(db, 'tatou')).toEqual([]);
  });
});

/**
 * What a pass costs the machine it runs on.
 *
 * Every defect below was found running against a real volume of some three
 * hundred thousand files, where a background task settled at half a core and
 * two gigabytes of resident memory. None of them are visible on a small tree,
 * which is why each one is pinned by an observable rather than by a timing.
 */
describe('what a pass costs', () => {
  beforeEach(async () => {
    await build({ SEARCH_MAX_FILESIZE: '20M' });
    await fs.mkdir(volumePath('Docs'), { recursive: true });
  });

  // Deciding from the name is the difference between a pass proportional to
  // the documents and one proportional to the disk. The content here is plain
  // text, so the sniff would have taken it: only the extension can refuse it.
  it('does not open what its name says is not text', async () => {
    await fs.writeFile(volumePath('Docs', 'holiday.mp4'), 'pangolin in plain text\n');
    await fs.writeFile(volumePath('Docs', 'archive.zip'), 'pangolin in plain text\n');
    await fs.writeFile(volumePath('Docs', 'notes.txt'), 'pangolin in plain text\n');

    await indexAll();

    expect(store.search(db, 'pangolin')).toEqual(['Docs/notes.txt']);
  });

  // Reading a file to find out it is a binary costs the same as reading a
  // document. At a few hundred files a second that was gigabytes of buffers
  // allocated and thrown away, which is what the memory graph was made of.
  it('reads a few kilobytes of a binary, not all of it', async () => {
    const megabyte = Buffer.alloc(4 * 1024 * 1024, 0x41);
    megabyte[10] = 0;
    await fs.writeFile(volumePath('Docs', 'opaque.dat'), megabyte);

    let bytesRead = 0;
    const realOpen = fs.open;
    fs.open = async (...args) => {
      const handle = await realOpen(...args);
      const realRead = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await realRead(...readArgs);
        bytesRead += result.bytesRead;
        return result;
      };
      return handle;
    };

    try {
      await indexAll();
    } finally {
      fs.open = realOpen;
    }

    expect(store.stats(db).documents).toBe(0);
    // Both halves matter: reading none of it through this path would pass the
    // ceiling below while reading all four megabytes some other way.
    expect(bytesRead).toBeGreaterThan(0);
    expect(bytesRead).toBeLessThanOrEqual(4096);
  });

  // The pause used to be taken when a batch was written, so a batch large
  // enough never to be written was a walk that never stood aside. Time is what
  // it costs the machine, so time is what it has to be paid in.
  it('stands aside on elapsed time, not on how many files went by', async () => {
    for (let index = 0; index < 40; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(volumePath('Docs', `note-${index}.txt`), `pangolin ${index}\n`);
    }

    // A batch this size is never reached, so nothing is written until the end.
    const paced = await indexAll({ batchSize: 10000, cpuPercent: 50, workSliceMs: 1 });
    expect(paced.batches).toBe(1);
    expect(paced.pauses).toBeGreaterThan(0);

    const flatOut = await indexAll({ batchSize: 10000, cpuPercent: 100 });
    expect(flatOut.pauses).toBe(0);
  });

  // The volume is the user's, and what is worth searching in it is theirs to
  // say. A build tree or a machine backup is hundreds of thousands of files
  // nobody searches by content, and reading them is the whole overhead.
  it('leaves out what it was told to leave out', async () => {
    await fs.mkdir(volumePath('Docs', 'machine-backup'), { recursive: true });
    await fs.writeFile(volumePath('Docs', 'machine-backup', 'output.txt'), 'pangolin\n');
    await fs.writeFile(volumePath('Docs', 'kept.txt'), 'pangolin\n');

    const result = await indexAll({ exclude: ['Docs/machine-backup'] });

    expect(store.search(db, 'pangolin')).toEqual(['Docs/kept.txt']);
    expect(result.indexed).toBe(1);
  });

  it('reads the same tree when it was told nothing', async () => {
    await fs.mkdir(volumePath('Docs', 'machine-backup'), { recursive: true });
    await fs.writeFile(volumePath('Docs', 'machine-backup', 'output.txt'), 'pangolin\n');
    await fs.writeFile(volumePath('Docs', 'kept.txt'), 'pangolin\n');

    const result = await indexAll({ exclude: [] });

    expect(result.indexed).toBe(2);
  });

  // Compiling a statement holds kilobytes of native memory that V8 cannot see,
  // so nothing pushes back and nothing is collected. Three per document over a
  // large volume is where the two gigabytes came from.
  it('compiles its queries once, not once per document', async () => {
    for (let index = 0; index < 40; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(volumePath('Docs', `note-${index}.txt`), `pangolin ${index}\n`);
    }

    let compiled = 0;
    const realPrepare = db.prepare.bind(db);
    db.prepare = (...args) => {
      compiled += 1;
      return realPrepare(...args);
    };

    try {
      await indexAll();
    } finally {
      db.prepare = realPrepare;
    }

    expect(store.stats(db).documents).toBe(40);
    // A handful of distinct queries. Per document it would be over a hundred.
    expect(compiled).toBeLessThan(12);
  });

  // A single reading is not enough: the figure is the whole process, so a
  // thumbnail sweep or a folder-size pass running alongside would otherwise
  // end the indexing that happens to be running at the same moment.
  it('does not stop on one reading that another task caused', async () => {
    for (let index = 0; index < 40; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(volumePath('Docs', `note-${index}.txt`), `pangolin ${index}\n`);
    }

    // One spike well over the budget, then back to normal.
    let reading = 0;
    const result = await indexAll({
      batchSize: 1,
      workSliceMs: 0,
      memoryBudgetBytes: 1000,
      readMemory: () => {
        reading += 1;
        return reading === 4 ? 100000 : 500;
      },
    });

    expect(result.stoppedForMemory).toBe(false);
    expect(result.indexed).toBe(40);
  });

  // The last line of defence. Every bound above is a belief about what a file
  // costs; this one holds when a belief turns out to be wrong.
  it('stops rather than let the process grow without end', async () => {
    for (let index = 0; index < 40; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(volumePath('Docs', `note-${index}.txt`), `pangolin ${index}\n`);
    }

    let reading = 0;
    const result = await indexAll({
      batchSize: 1,
      workSliceMs: 0,
      memoryBudgetBytes: 1000,
      // Growing by a kilobyte each time it is asked, so the budget is passed
      // partway through rather than at the first file or not at all.
      readMemory: () => {
        reading += 1;
        return reading * 500;
      },
    });

    expect(result.stoppedForMemory).toBe(true);
    expect(result.interrupted).toBe(true);
    expect(result.indexed).toBeGreaterThan(0);
    expect(result.indexed).toBeLessThan(40);
    // What it wrote before stopping is kept, so the next pass carries on.
    expect(store.stats(db).documents).toBe(result.indexed);
  });
});

/**
 * The application announces what it writes, and nobody waits for the answer.
 * Copying a folder of ten thousand files therefore used to start ten thousand
 * file reads at once, on top of whatever pass was already running — which is
 * how a background task came to hold more of a machine than the application it
 * was serving.
 */
describe('how much runs at once', () => {
  let manager;

  beforeEach(async () => {
    await build({ SEARCH_INDEX: 'true' });
    manager = envContext.requireFresh('src/services/searchIndexManager');
    await fs.mkdir(volumePath('Docs'), { recursive: true });
  });

  afterEach(() => {
    manager?.stop();
  });

  it('reads one announced file at a time, however many are announced', async () => {
    for (let index = 0; index < 30; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(volumePath('Docs', `note-${index}.txt`), `pangolin ${index}\n`);
    }

    let openNow = 0;
    let openAtMost = 0;
    const realOpen = fs.open;
    fs.open = async (...args) => {
      openNow += 1;
      openAtMost = Math.max(openAtMost, openNow);
      try {
        const handle = await realOpen(...args);
        const realClose = handle.close.bind(handle);
        handle.close = async () => {
          openNow -= 1;
          return realClose();
        };
        return handle;
      } catch (error) {
        openNow -= 1;
        throw error;
      }
    };

    try {
      // Announced the way the application announces them: all at once, awaited
      // by nobody.
      await Promise.all(
        Array.from({ length: 30 }, (unused, index) =>
          manager.onFileChanged(volumePath('Docs', `note-${index}.txt`))
        )
      );
    } finally {
      fs.open = realOpen;
    }

    expect(openAtMost).toBe(1);
    expect((await manager.status()).documents).toBe(30);
  });

  // A backlog with no bottom is a memory leak wearing a queue's clothes.
  it('drops what it cannot keep up with rather than remember all of it', async () => {
    const announcements = [];
    for (let index = 0; index < 1200; index += 1) {
      announcements.push(manager.onFileChanged(volumePath('Docs', `ghost-${index}.txt`)));
    }
    await Promise.all(announcements);

    const status = await manager.status();
    expect(status.pending).toBe(0);
    expect(status.dropped).toBeGreaterThan(0);
  });
});

/**
 * A pass used to carry every path it had seen to the end, so it could work out
 * what had gone. Fifty megabytes for two hundred thousand files, held from the
 * first folder to the last, on a container whose whole working set is sixty.
 * It asks the index what a folder held instead, and forgets the folder as soon
 * as it leaves it.
 */
describe('forgetting what is gone', () => {
  beforeEach(async () => {
    await build();
    await fs.mkdir(volumePath('Docs', 'Notes'), { recursive: true });
    await fs.writeFile(volumePath('Docs', 'Notes', 'one.txt'), 'pangolin one\n');
    await fs.writeFile(volumePath('Docs', 'Notes', 'two.txt'), 'pangolin two\n');
    await fs.writeFile(volumePath('Docs', 'kept.txt'), 'pangolin kept\n');
    await indexAll();
  });

  it('forgets a file that was removed from a folder', async () => {
    await fs.rm(volumePath('Docs', 'Notes', 'one.txt'));

    const result = await indexAll();

    expect(result.removed).toBe(1);
    expect(store.search(db, 'pangolin').sort()).toEqual(['Docs/Notes/two.txt', 'Docs/kept.txt']);
  });

  // Nothing walks a folder that is not there, so nothing asks what it held.
  it('forgets a folder that was removed outright', async () => {
    await fs.rm(volumePath('Docs', 'Notes'), { recursive: true });

    const result = await indexAll();

    expect(result.removed).toBe(2);
    expect(store.search(db, 'pangolin')).toEqual(['Docs/kept.txt']);
  });

  // A folder that was listed in full is a folder whose absences are known,
  // whatever happens to the pass afterwards.
  it('keeps the deletions it was sure of when it is cut short', async () => {
    await fs.rm(volumePath('Docs', 'Notes', 'one.txt'));
    for (let index = 0; index < 60; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(volumePath('Docs', `filler-${index}.txt`), `pangolin ${index}\n`);
    }

    const controller = new AbortController();
    const running = indexAll({ signal: controller.signal, cpuPercent: 1, workSliceMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    const result = await running;

    expect(result.interrupted).toBe(true);
    expect(store.search(db, 'pangolin')).not.toContain('Docs/Notes/one.txt');
  });
});

/**
 * A pass that re-reads tens of thousands of files nobody touched is either
 * looking at a volume that really does change that much, or asking a question
 * its storage cannot answer the same way twice. From a count the two are
 * identical, so the disagreement itself has to be reported.
 */
describe('saying why a file was read again', () => {
  beforeEach(async () => {
    await build();
    await fs.mkdir(volumePath('Docs'), { recursive: true });
    await fs.writeFile(volumePath('Docs', 'note.txt'), 'pangolin\n');
    await indexAll();
  });

  // Half an hour is too long to wait to learn which folder is responsible.
  it('carries the count and the folder leading it in every progress line', async () => {
    await fs.mkdir(volumePath('Docs', 'Churn'), { recursive: true });
    const settled = new Date(1_700_000_000_000);
    for (let index = 0; index < 8; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(volumePath('Docs', 'Churn', `c-${index}.txt`), `pangolin ${index}\n`);
      // eslint-disable-next-line no-await-in-loop
      await fs.utimes(volumePath('Docs', 'Churn', `c-${index}.txt`), settled, settled);
    }
    await indexAll();

    const moved = new Date(1_700_000_060_000);
    for (let index = 0; index < 8; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.utimes(volumePath('Docs', 'Churn', `c-${index}.txt`), moved, moved);
    }

    const lines = [];
    await indexAll({ batchSize: 1, progressMs: 0, onProgress: (line) => lines.push(line) });

    expect(lines.length).toBeGreaterThan(0);
    const last = lines[lines.length - 1];
    expect(last.reindexed).toBeGreaterThan(0);
    expect(last.rereadTopFolder).toBe('Docs/Churn');
    expect(last.rereadTopCount).toBeGreaterThan(0);
  });

  it('reports nothing when nothing was read again', async () => {
    const result = await indexAll();

    expect(result.reindexedKnown).toBe(0);
    expect(result.rereadSamples).toEqual([]);
  });

  it('names the file and the field that disagreed', async () => {
    // Same size, different date: the case that a count cannot tell apart from
    // real activity.
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(volumePath('Docs', 'note.txt'), future, future);

    const result = await indexAll();

    expect(result.reindexedKnown).toBe(1);
    expect(result.rereadSamples).toHaveLength(1);

    const [sample] = result.rereadSamples;
    expect(sample.path).toBe('Docs/note.txt');
    expect(sample.differs).toBe('mtime');
    expect(sample.storedSize).toBe(sample.diskSize);
    expect(sample.mtimeDeltaMs).toBeGreaterThan(0);
  });

  // The three shapes have to separate the three explanations, or the pass is
  // just a total again.
  it('separates a constant offset from one noisy folder', async () => {
    await fs.mkdir(volumePath('Docs', 'Bruyant'), { recursive: true });
    // Given the same starting date, so that a shared shift really is one
    // delta. Left to their creation times they differ by a millisecond here
    // and there, and six files produce six deltas — which is the noise this
    // report exists to tell apart from a signal.
    const before = new Date(1_700_000_000_000);
    for (let index = 0; index < 6; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(volumePath('Docs', 'Bruyant', `n-${index}.txt`), `pangolin ${index}\n`);
      // eslint-disable-next-line no-await-in-loop
      await fs.utimes(volumePath('Docs', 'Bruyant', `n-${index}.txt`), before, before);
    }
    await indexAll();

    // Every file in one folder, all moved by exactly the same amount: the
    // signature of storage that rounds, and of nothing else.
    const shifted = new Date(1_700_000_120_000);
    for (let index = 0; index < 6; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.utimes(volumePath('Docs', 'Bruyant', `n-${index}.txt`), shifted, shifted);
    }

    const result = await indexAll();

    expect(result.reindexedKnown).toBe(6);
    expect(result.rereadByField.mtime).toBe(6);
    expect(result.rereadByField.size).toBe(0);
    // One folder accounts for all of it.
    expect(result.topRereadDirs[0]).toEqual({ value: 'Docs/Bruyant', count: 6 });
    // And one delta accounts for all of it.
    expect(result.topMtimeDeltas).toEqual([{ value: 120_000, count: 6 }]);
  });

  it('says so when it is the size that moved', async () => {
    await fs.writeFile(volumePath('Docs', 'note.txt'), 'pangolin and more\n');

    const result = await indexAll();

    const [sample] = result.rereadSamples;
    expect(['size', 'both']).toContain(sample.differs);
    expect(sample.diskSize).toBeGreaterThan(sample.storedSize);
  });
});

/**
 * An index holding nine thousand documents where the volume has six hundred
 * thousand is either a working exclusion or a silent hole, and nothing in the
 * log told the two apart — the question had to be asked and answered by hand.
 */
describe('saying what it does not read', () => {
  beforeEach(async () => {
    await build({ SEARCH_INDEX_EXCLUDE: 'Stacks/docker' });
    await fs.mkdir(volumePath('Docs'), { recursive: true });
  });

  it('reports the environment list and the administrator list apart', async () => {
    const exclusions = envContext.requireFresh('src/services/searchIndexExclusions');
    exclusions.setAdminPaths(['Sauvegardes/2024']);

    expect(exclusions.snapshot()).toEqual({
      environmentExcludedPaths: ['Stacks/docker'],
      excludedPaths: ['Sauvegardes/2024'],
    });
    // And the pass is given both, so what it skipped is what was asked.
    expect(exclusions.effectivePaths()).toEqual(['Sauvegardes/2024', 'Stacks/docker']);
  });

  it('leaves out what the environment named, without being told twice', async () => {
    await fs.mkdir(volumePath('Stacks', 'docker'), { recursive: true });
    await fs.writeFile(volumePath('Stacks', 'docker', 'layer.txt'), 'pangolin\n');
    await fs.writeFile(volumePath('Docs', 'kept.txt'), 'pangolin\n');

    const exclusions = envContext.requireFresh('src/services/searchIndexExclusions');
    const result = await indexAll({ exclude: exclusions.effectivePaths() });

    expect(result.indexed).toBe(1);
    expect(store.search(db, 'pangolin')).toEqual(['Docs/kept.txt']);
  });
});
