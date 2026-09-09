import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import AdmZip from 'adm-zip';
import { randomBytes } from 'node:crypto';

import { setupTestEnv } from '../helpers/env-test-utils.js';
import { useFakeRipgrep } from '../helpers/fake-ripgrep.js';
import { buildPdf } from '../helpers/pdf-fixture.js';

/**
 * Searching inside Office documents and PDFs.
 *
 * ripgrep reads a .docx as binary — it is a zip — and a PDF as binary too,
 * because its words live in compressed content streams. So both are searched by
 * a separate pass that extracts the text first, and that pass is bounded three
 * ways because it costs an unzip or a `pdftotext` per document: only certain
 * extensions, only files under the configured size, and only so many documents
 * per search.
 *
 * All three bounds were uncovered, along with the deduplication that stops a
 * document already found by name being listed twice. Those bounds are what
 * stands between a search and a folder of ten thousand spreadsheets.
 *
 * The size bound is enforced twice because the search has two content engines,
 * and a request only ever runs one of them: ripgrep's path bounds it in
 * `streamDocumentMatches`, the JavaScript fallback in `generateFallbackResults`.
 * Neither is a duplicate of the other, and a machine without ripgrep installed
 * exercises only the second — which is why deleting the first looked harmless
 * for as long as nobody ran it. The bound tests below therefore name the engine
 * they run on and run on both, on every machine.
 *
 * The extension check in `streamDocumentMatches` is a genuine optimisation
 * rather than a rule: `findDocumentTextMatch` tests the extension again and
 * returns null, so deleting it changes nothing but the number of files opened.
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
    tag: 'search-documents-',
    env: { SEARCH_DEEP: 'true', SEARCH_RIPGREP: 'true', ...env },
  });
  const dbService = envContext.requireFresh('src/services/db');
  const db = await dbService.getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
     VALUES ('u1', 'u@example.com', 1, 'u', 'U', '["admin"]', ?, ?)`
  ).run(now, now);
  const dir = path.join(envContext.volumeDir, 'Docs');
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

/** A real .docx: a zip whose word/document.xml carries the text. */
const writeDocx = async (absolutePath, text) => {
  const zip = new AdmZip();
  zip.addFile(
    'word/document.xml',
    Buffer.from(
      `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    )
  );
  await fs.writeFile(absolutePath, zip.toBuffer());
};

const search = async (q, query = {}) => {
  const response = await request(buildApp()).get('/api/search').query({ q, ...query });
  expect(response.status).toBe(200);
  return response.body.items || [];
};

afterEach(async () => {
  if (envContext) await envContext.cleanup();
  envContext = null;
});

describe('inside an Office document', () => {
  it('finds a word ripgrep cannot see, because the file is a zip', async () => {
    const dir = await seed();
    await writeDocx(path.join(dir, 'report.docx'), 'the word pangolin appears here');

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'report.docx')).toBe(true);
  });

  it('does not offer a document that does not contain the word', async () => {
    const dir = await seed();
    await writeDocx(path.join(dir, 'report.docx'), 'nothing of interest');

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'report.docx')).toBe(false);
  });

  /**
   * A file found by its name has already been counted. Extracting its text as
   * well would list it twice, once per pass.
   */
  it('lists a document found by name only once', async () => {
    const dir = await seed();
    await writeDocx(path.join(dir, 'pangolin.docx'), 'the word pangolin appears here');

    const items = await search('pangolin');

    expect(items.filter((item) => item.name === 'pangolin.docx')).toHaveLength(1);
  });

  it('searches documents in subfolders too', async () => {
    const dir = await seed();
    await fs.mkdir(path.join(dir, '2026/q1'), { recursive: true });
    await writeDocx(path.join(dir, '2026/q1/deep.docx'), 'the word pangolin appears here');

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'deep.docx')).toBe(true);
  });

  it('matches without regard to case', async () => {
    const dir = await seed();
    await writeDocx(path.join(dir, 'report.docx'), 'The word PANGOLIN appears here');

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'report.docx')).toBe(true);
  });

  /** An extension not on the list is never opened, whatever is inside it. */
  it('does not open a file type it was not asked to read', async () => {
    const dir = await seed();
    await writeDocx(path.join(dir, 'archive.zip'), 'the word pangolin appears here');

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'archive.zip')).toBe(false);
  });
});

describe('inside a PDF', () => {
  it('finds a word held in a compressed content stream', async () => {
    const dir = await seed();
    await fs.writeFile(path.join(dir, 'paper.pdf'), buildPdf('the word pangolin appears here'));

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'paper.pdf')).toBe(true);
  });

  it('does not offer a PDF that does not contain the word', async () => {
    const dir = await seed();
    await fs.writeFile(path.join(dir, 'paper.pdf'), buildPdf('nothing of interest'));

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'paper.pdf')).toBe(false);
  });
});

describe('the bounds on how much it will read', () => {
  it('respects the result limit the caller asked for', async () => {
    const dir = await seed();
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await writeDocx(path.join(dir, `doc${i}.docx`), 'the word pangolin appears here');
    }

    const items = await search('pangolin', { limit: 2 });

    expect(items.length).toBeLessThanOrEqual(2);
  });
});

describe('hidden documents', () => {
  it('are left out unless they were asked for', async () => {
    const dir = await seed({ HIDDEN_FILE_PATTERNS: '.' });
    await writeDocx(path.join(dir, '.secret.docx'), 'the word pangolin appears here');

    const items = await search('pangolin');

    expect(items.some((item) => item.name === '.secret.docx')).toBe(false);
  });

  it('are searched in a folder that is not hidden', async () => {
    const dir = await seed({ HIDDEN_FILE_PATTERNS: '.' });
    await writeDocx(path.join(dir, 'visible.docx'), 'the word pangolin appears here');

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'visible.docx')).toBe(true);
  });
});

describe('when a document cannot be read', () => {
  /** A truncated or corrupt file is a file, not a reason to fail the search. */
  it('carries on with the rest', async () => {
    const dir = await seed();
    await fs.writeFile(path.join(dir, 'corrupt.docx'), Buffer.from('not a zip at all'));
    await writeDocx(path.join(dir, 'good.docx'), 'the word pangolin appears here');

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'good.docx')).toBe(true);
  });

  it('carries on when the PDF is not a PDF', async () => {
    const dir = await seed();
    await fs.writeFile(path.join(dir, 'corrupt.pdf'), Buffer.from('%PDF-1.4 truncated'));
    await fs.writeFile(path.join(dir, 'good.pdf'), buildPdf('the word pangolin appears here'));

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'good.pdf')).toBe(true);
  });
});

/**
 * The size bound, on each of the two engines that enforce it.
 *
 * Which engine a request uses is decided by whether `rg` can be spawned, so
 * without saying so a suite covers whichever half the machine happens to
 * provide. Both are named here: the fallback by switching ripgrep off, the
 * ripgrep path by putting a stand-in on PATH that reports no matches, leaving
 * the document pass to decide the result.
 */
describe.each([
  ['the fallback scan', { SEARCH_RIPGREP: 'false' }, false],
  ['the ripgrep path', { SEARCH_RIPGREP: 'true' }, true],
])('the size bound, on %s', (_engine, engineEnv, standInRipgrep) => {
  let restoreRipgrep = null;

  beforeEach(() => {
    restoreRipgrep = standInRipgrep ? useFakeRipgrep() : null;
  });

  afterEach(() => {
    restoreRipgrep?.();
    restoreRipgrep = null;
  });

  /** A folder of large spreadsheets would otherwise be unzipped for every keystroke. */
  it('skips a document larger than the configured size', async () => {
    const dir = await seed({ SEARCH_MAX_FILESIZE: '1K', ...engineEnv });
    const zip = new AdmZip();
    zip.addFile(
      'word/document.xml',
      Buffer.from(
        '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>' +
          'the word pangolin appears here</w:t></w:r></w:p></w:body></w:document>'
      )
    );
    // Random bytes, because repeated padding compresses away and the file
    // would come out under the limit this test is about.
    zip.addFile('word/media/blob.bin', randomBytes(64 * 1024));
    const file = path.join(dir, 'huge.docx');
    await fs.writeFile(file, zip.toBuffer());
    expect((await fs.stat(file)).size).toBeGreaterThan(1024);

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'huge.docx')).toBe(false);
  });

  it('still reads one under the limit', async () => {
    const dir = await seed({ SEARCH_MAX_FILESIZE: '1M', ...engineEnv });
    await writeDocx(path.join(dir, 'small.docx'), 'the word pangolin appears here');

    const items = await search('pangolin');

    expect(items.some((item) => item.name === 'small.docx')).toBe(true);
  });
});
