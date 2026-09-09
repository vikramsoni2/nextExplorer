const { spawn } = require('child_process');

const logger = require('../utils/logger');

/**
 * The text of a PDF, for searching.
 *
 * A PDF's words live in compressed content streams, so a plain content search
 * finds nothing in one — the same problem Office documents have, for a
 * different reason. `pdftotext` does the reading; writing a parser for the
 * encodings, CID fonts and ligatures a real PDF uses would be a project of its
 * own and a worse one.
 *
 * Only PDFs that carry a text layer, which is most of them. A scan is a
 * picture of a page and stays unsearchable without OCR — a job measured in
 * seconds per page, which does not belong in a search request.
 */

const PDFTOTEXT_TIMEOUT_MS = 10 * 1000;
// A search reads the beginning of a document, not all of a thousand-page one.
const DEFAULT_MAX_PAGES = 50;

let available = null;

/** Whether pdftotext is installed, asked once. */
const hasPdfToText = async () => {
  if (available !== null) return available;

  available = await new Promise((resolve) => {
    const child = spawn('pdftotext', ['-v']);
    child.on('error', () => resolve(false));
    // pdftotext -v prints its version to stderr and exits 0 on some builds, 99
    // on others. Starting at all is the answer we need.
    child.on('exit', () => resolve(true));
  });

  if (!available) {
    logger.debug('pdftotext is not installed; PDF contents will not be searched');
  }
  return available;
};

/**
 * The document's text, one entry per line, or null where there is none to read
 * — no text layer, an unreadable file, or no pdftotext to read it with. Never
 * throws: a document that cannot be read is one that does not match.
 */
const extractPdfTextLines = async (absolutePath, { maxPages = DEFAULT_MAX_PAGES } = {}) => {
  if (!(await hasPdfToText())) return null;

  return new Promise((resolve) => {
    // `-q` silences the per-file warnings a slightly malformed PDF produces by
    // the dozen; `--` keeps a filename starting with a dash from being read as
    // an option. `-` sends the text to stdout instead of a file beside it.
    const child = spawn('pdftotext', ['-q', '-l', String(maxPages), '--', absolutePath, '-']);

    let text = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(value);
    };

    // A malformed document that makes pdftotext spin must not hold up a search.
    const timer = setTimeout(() => {
      logger.debug({ absolutePath }, 'Gave up reading a PDF for the content search');
      finish(null);
    }, PDFTOTEXT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      text += String(chunk);
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0 && !text) return finish(null);

      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      finish(lines.length > 0 ? lines : null);
    });
  });
};

module.exports = { extractPdfTextLines, hasPdfToText };
