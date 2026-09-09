import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import AdmZip from 'adm-zip';
import { setupTestEnv } from '../helpers/env-test-utils.js';
import { buildPdf } from '../helpers/pdf-fixture.js';

/**
 * Searching inside documents is the half of search nothing tested, and it was
 * broken twice over: a size setting written the way our own README suggests
 * made ripgrep refuse the flag and search nothing at all, and what survived
 * that was rendered only after every filename match had been counted against
 * the result limit.
 */

let envContext;

const buildApp = () => {
  const searchRoutes = envContext.requireFresh('src/routes/search');
  const { errorHandler } = envContext.requireFresh('src/middleware/errorHandler');
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u1', email: 'u@example.com', roles: ['admin'] };
    next();
  });
  app.use('/api', searchRoutes);
  app.use(errorHandler);
  return app;
};

const seed = async (env = {}) => {
  envContext = await setupTestEnv({
    tag: 'search-content-',
    env: { SEARCH_DEEP: 'true', SEARCH_RIPGREP: 'true', ...env },
  });
  const dbService = envContext.requireFresh('src/services/db');
  const db = await dbService.getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
     VALUES ('u1', 'u@example.com', 1, 'u', 'U', '["admin"]', ?, ?)`
  ).run(now, now);
  return path.join(envContext.volumeDir, 'Docs');
};

const search = async (term) => {
  const response = await request(buildApp()).get('/api/search').query({ q: term });
  expect(response.status).toBe(200);
  return response.body.items || [];
};

afterEach(async () => {
  if (envContext) await envContext.cleanup();
  envContext = null;
});

describe('searching inside documents', () => {
  beforeEach(async () => {
    const dir = await seed();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'notes.md'), '# Notes\n\nthe word pangolin is here\n');
  });

  it('finds the word and says which line it is on', async () => {
    const items = await search('pangolin');

    const hit = items.find((item) => item.name === 'notes.md');
    expect(hit).toBeTruthy();
    expect(hit.matchLine).toContain('pangolin');
    expect(hit.matchLineNumber).toBe(3);
  });
});

// `SEARCH_MAX_FILESIZE=5MB` is the form the README suggests. ripgrep takes
// `K`, `M` or `G` and nothing else: given `5MB` it refused the flag, exited,
// and searched nothing — while filename search, a separate invocation without
// that flag, went on working. Exactly the report in issue #3.
describe('a size limit written the way people write it', () => {
  for (const written of ['5MB', '5M', '5 mb', '5242880']) {
    it(`still searches contents with SEARCH_MAX_FILESIZE=${written}`, async () => {
      const dir = await seed({ SEARCH_MAX_FILESIZE: written });
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'notes.md'), 'the word pangolin is here\n');

      const items = await search('pangolin');

      expect(items.some((item) => item.name === 'notes.md' && item.matchLine)).toBe(true);
    });
  }

  it('still skips a file that is over the limit', async () => {
    const dir = await seed({ SEARCH_MAX_FILESIZE: '1K' });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'big.txt'), `${'x'.repeat(4096)}\npangolin\n`);
    await fs.writeFile(path.join(dir, 'small.txt'), 'pangolin\n');

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'small.txt')).toBe(true);
    expect(items.some((item) => item.name === 'big.txt')).toBe(false);
  });
});

// The result limit is shared, and the passes used to be drained one after the
// other: a term matching many filenames spent the whole budget before content
// search had produced anything.
describe('when the same term matches many filenames', () => {
  it('still returns what is inside the documents', async () => {
    const dir = await seed();
    await fs.mkdir(dir, { recursive: true });
    for (let index = 0; index < 120; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(dir, `pangolin-${index}.txt`), 'nothing to see\n');
    }
    await fs.writeFile(path.join(dir, 'zzz-notes.md'), 'the word pangolin is in here\n');

    const items = await search('pangolin');

    expect(items.some((item) => item.matchLine)).toBe(true);
    // And the page is still full: reserving a share for content does not mean
    // answering short when there is little of it.
    expect(items.length).toBe(100);
    expect(items.filter((item) => !item.matchLine).length).toBeGreaterThan(90);
  });
});

/**
 * A `.docx` is a zip of XML: ripgrep sees compressed bytes and finds nothing,
 * whatever the settings say. This is the half of "search my documents" that
 * could not work at all.
 */
describe('searching inside Office documents', () => {
  const writeDocx = (file, paragraphs) => {
    const zip = new AdmZip();
    const body = paragraphs
      .map((runs) => `<w:p>${runs.map((run) => `<w:r><w:t>${run}</w:t></w:r>`).join('')}</w:p>`)
      .join('');
    zip.addFile(
      'word/document.xml',
      Buffer.from(`<w:document><w:body>${body}</w:body></w:document>`)
    );
    zip.writeZip(file);
  };

  it('finds a word in a Word document', async () => {
    const dir = await seed();
    await fs.mkdir(dir, { recursive: true });
    writeDocx(path.join(dir, 'report.docx'), [
      ['Quarterly report'],
      ['The pangolin numbers are up'],
    ]);

    const items = await search('pangolin');

    const hit = items.find((item) => item.name === 'report.docx');
    expect(hit).toBeTruthy();
    expect(hit.matchLine).toContain('pangolin');
  });

  // Word splits a word across runs wherever formatting changes inside it.
  it('finds a word an author emphasised in the middle', async () => {
    const dir = await seed();
    await fs.mkdir(dir, { recursive: true });
    writeDocx(path.join(dir, 'styled.docx'), [['pan', 'gol', 'in season']]);

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'styled.docx')).toBe(true);
  });

  it('reads a spreadsheet too', async () => {
    const dir = await seed();
    await fs.mkdir(dir, { recursive: true });
    const zip = new AdmZip();
    zip.addFile('xl/sharedStrings.xml', Buffer.from('<sst><si><t>pangolin count</t></si></sst>'));
    zip.writeZip(path.join(dir, 'numbers.xlsx'));

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'numbers.xlsx')).toBe(true);
  });

  it('leaves a document that says nothing of the sort alone', async () => {
    const dir = await seed();
    await fs.mkdir(dir, { recursive: true });
    writeDocx(path.join(dir, 'other.docx'), [['Nothing relevant in here']]);

    expect(await search('pangolin')).toEqual([]);
  });

  // The size that counts is the archive on disk. Padding has to be
  // incompressible or a repetitive document sails under any limit.
  it('skips a document over the configured size', async () => {
    const dir = await seed({ SEARCH_MAX_FILESIZE: '4K' });
    await fs.mkdir(dir, { recursive: true });
    const noise = Array.from({ length: 8000 }, (_, index) =>
      ((index * 2654435761) % 4294967296).toString(36)
    ).join(' ');
    writeDocx(path.join(dir, 'big.docx'), [[`${noise} pangolin`]]);
    writeDocx(path.join(dir, 'small.docx'), [['pangolin here']]);

    const stats = await fs.stat(path.join(dir, 'big.docx'));
    expect(stats.size).toBeGreaterThan(4 * 1024);

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'small.docx')).toBe(true);
    expect(items.some((item) => item.name === 'big.docx')).toBe(false);
  });
});

/**
 * What ripgrep is actually handed. These run whether or not ripgrep is
 * installed, which matters: the machine this was written on has no `rg` at
 * all, so every end-to-end case above exercises the JavaScript fallback and
 * would have gone on passing while the ripgrep path stayed broken.
 */
describe('the arguments a content search is given', () => {
  const argsWith = async (env) => {
    envContext = await setupTestEnv({ tag: 'search-args-', env });
    const searchRoutes = envContext.requireFresh('src/routes/search');
    return searchRoutes.contentSearchArgs('pangolin');
  };

  const sizeIn = (args) => {
    const index = args.indexOf('--max-filesize');
    return index === -1 ? null : args[index + 1];
  };

  // ripgrep takes a number with an optional K, M or G. `5MB` — the form our
  // own README suggested — makes it refuse the flag and search nothing.
  for (const written of ['5MB', '5M', '5 mb', '5242880']) {
    it(`turns SEARCH_MAX_FILESIZE=${written} into a byte count`, async () => {
      const args = await argsWith({ SEARCH_MAX_FILESIZE: written });

      expect(sizeIn(args)).toBe('5242880');
    });
  }

  it('never hands over the raw setting', async () => {
    const args = await argsWith({ SEARCH_MAX_FILESIZE: '5MB' });

    expect(args).not.toContain('5MB');
  });

  // The separator that keeps a term starting with `-` from being read as a
  // flag — `--pre=<cmd>` would run that command against every scanned file.
  it('puts the term after the separator', async () => {
    const args = await argsWith({});

    expect(args.indexOf('pangolin')).toBeGreaterThan(args.indexOf('--'));
  });
});

/**
 * A PDF keeps its words in compressed streams, so a content search reads it as
 * binary. Only ones carrying a text layer, which is most of them — a scan is a
 * picture and needs OCR.
 */
describe('searching inside PDFs', () => {
  it('finds a word on the page', async () => {
    const dir = await seed();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'report.pdf'), buildPdf('the pangolin is here'));

    const items = await search('pangolin');

    const hit = items.find((item) => item.name === 'report.pdf');
    expect(hit).toBeTruthy();
    expect(hit.matchLine).toContain('pangolin');
  });

  it('leaves a PDF that says nothing of the sort alone', async () => {
    const dir = await seed();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'other.pdf'), buildPdf('nothing relevant in here'));

    expect(await search('pangolin')).toEqual([]);
  });
});

/**
 * With the index on, a search answers from what was read earlier instead of
 * reading the tree again. The point of the whole thing is that the second
 * search costs nothing the first one did not already pay.
 */
describe('searching through the index', () => {
  // A pass, and the mark that says it reached the end — which is what the
  // manager records, and what lets search stop reading the tree for itself.
  const buildIndex = async ({ complete = true } = {}) => {
    const dbService = envContext.requireFresh('src/services/db');
    const db = await dbService.getDb();
    const { indexTree } = envContext.requireFresh('src/services/searchIndexer');
    const store = envContext.requireFresh('src/services/searchIndexStore');
    const result = await indexTree({ db, rootAbs: envContext.volumeDir, cpuPercent: 100 });
    if (complete) store.markPassComplete(db);
    return result;
  };

  it('finds a word inside a document', async () => {
    const dir = await seed({ SEARCH_INDEX: 'true' });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'notes.md'), '# Notes\n\nthe word pangolin is here\n');
    await buildIndex();

    const items = await search('pangolin');

    const hit = items.find((item) => item.name === 'notes.md');
    expect(hit).toBeTruthy();
    expect(hit.matchLine).toContain('pangolin');
    expect(hit.matchLineNumber).toBe(3);
  });

  it('finds one inside a Word document', async () => {
    const dir = await seed({ SEARCH_INDEX: 'true' });
    await fs.mkdir(dir, { recursive: true });
    const zip = new AdmZip();
    zip.addFile(
      'word/document.xml',
      Buffer.from(
        '<w:document><w:body><w:p><w:r><w:t>a pangolin appears</w:t></w:r></w:p></w:body></w:document>'
      )
    );
    zip.writeZip(path.join(dir, 'report.docx'));
    await buildIndex();

    expect((await search('pangolin')).some((item) => item.name === 'report.docx')).toBe(true);
  });

  // The index says a file matches; the file is what says where. A document
  // edited since the last pass must not be offered on the strength of words it
  // no longer contains.
  it('does not offer a file that no longer says it', async () => {
    const dir = await seed({ SEARCH_INDEX: 'true' });
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'notes.md');
    await fs.writeFile(file, 'the word pangolin is here\n');
    await buildIndex();

    await fs.writeFile(file, 'it says something else entirely now\n');

    expect((await search('pangolin')).map((item) => item.name)).not.toContain('notes.md');
  });

  // What proves the answer came from the index rather than from reading the
  // tree again: a file the index has never seen is not found by its contents,
  // because with the index on nothing reads contents live. It is also the
  // honest description of the trade — results are as fresh as the last pass.
  it('answers from the index, and only from it', async () => {
    const dir = await seed({ SEARCH_INDEX: 'true' });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'indexed.md'), 'the word pangolin is here\n');
    await buildIndex();
    await fs.writeFile(path.join(dir, 'later.md'), 'a pangolin arrived after the pass\n');

    // Stated before the real assertion, because the failure otherwise reads as
    // 'the index returned too much' when the cause is 'the index was not used':
    // an index that is not ready sends the search back to reading the tree,
    // which finds the later file for an entirely different reason.
    const dbService = envContext.requireFresh('src/services/db');
    const store = envContext.requireFresh('src/services/searchIndexStore');
    expect(store.isReady(await dbService.getDb())).toBe(true);

    const names = (await search('pangolin')).map((item) => item.name);

    expect(names).toContain('indexed.md');
    expect(names).not.toContain('later.md');
  });

  /**
   * The index replaces the live content scan rather than adding to it, so an
   * index that has not finished answers with whatever part of the volume it
   * happens to have read — and a term that was found yesterday is simply gone,
   * with nothing in the answer to say why.
   */
  it('reads the tree itself until a pass has finished', async () => {
    const dir = await seed({ SEARCH_INDEX: 'true' });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'indexed.md'), 'the word pangolin is here\n');
    await buildIndex({ complete: false });
    await fs.writeFile(path.join(dir, 'later.md'), 'a pangolin arrived after the pass\n');

    const names = (await search('pangolin')).map((item) => item.name);

    expect(names).toContain('indexed.md');
    expect(names).toContain('later.md');
  });

  it('still matches on names, which the index is not for', async () => {
    const dir = await seed({ SEARCH_INDEX: 'true' });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'pangolin-notes.md'), 'nothing relevant\n');
    await buildIndex();

    expect((await search('pangolin')).some((item) => item.name === 'pangolin-notes.md')).toBe(true);
  });
});

/**
 * A search that keeps looking to be sure there is nothing more is a search
 * nobody waits for. What it has when the budget runs out is the answer.
 */
describe('how long a search may take', () => {
  it('says so when the budget ended it', async () => {
    const dir = await seed({ SEARCH_TIMEOUT_MS: '1' });
    await fs.mkdir(dir, { recursive: true });
    for (let index = 0; index < 60; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(dir, `doc-${index}.pdf`), buildPdf('nothing of interest'));
    }

    const response = await request(buildApp()).get('/api/search').query({ q: 'pangolin' });

    expect(response.status).toBe(200);
    expect(response.body.truncated).toBe(true);
  });

  it('does not say so when it saw everything', async () => {
    const dir = await seed({ SEARCH_TIMEOUT_MS: '5000' });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'notes.md'), 'the word pangolin is here\n');

    const response = await request(buildApp()).get('/api/search').query({ q: 'pangolin' });

    expect(response.body.truncated).toBe(false);
    expect(response.body.items.length).toBeGreaterThan(0);
  });

  // The budget is a ceiling, not a delay: a search with an answer returns as
  // soon as it has one.
  it('does not wait for the budget when it is done', async () => {
    const dir = await seed({ SEARCH_TIMEOUT_MS: '5000' });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'notes.md'), 'the word pangolin is here\n');

    const started = Date.now();
    const items = await search('pangolin');
    const elapsed = Date.now() - started;

    expect(items.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(3000);
  });
});
