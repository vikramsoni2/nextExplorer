import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const { extractPdfTextLines, hasPdfToText } = require('../../src/services/pdfTextExtract');
const { buildPdf } = require('../helpers/pdf-fixture');

/**
 * A PDF keeps its words in compressed content streams, so a plain content
 * search reads it as binary and finds nothing. Only documents with a text
 * layer — a scan is a picture of a page and needs OCR, which is seconds per
 * page and does not belong in a search request.
 */

let dir;

const writePdf = async (name, text) => {
  const file = path.join(dir, name);
  await fs.writeFile(file, buildPdf(text));
  return file;
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-text-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('reading a PDF', () => {
  it('is possible at all here', async () => {
    // If this fails the rest prove nothing: the tool is what does the reading.
    expect(await hasPdfToText()).toBe(true);
  });

  it('gives back the words on the page', async () => {
    const file = await writePdf('report.pdf', 'the pangolin is here');

    expect(await extractPdfTextLines(file)).toContain('the pangolin is here');
  });

  it('says nothing rather than failing on a file that is not a PDF', async () => {
    const file = path.join(dir, 'broken.pdf');
    await fs.writeFile(file, 'this is not a PDF at all');

    expect(await extractPdfTextLines(file)).toBeNull();
  });

  it('says nothing for a file that is not there', async () => {
    expect(await extractPdfTextLines(path.join(dir, 'missing.pdf'))).toBeNull();
  });
});
