const path = require('path');
const fs = require('fs/promises');

const {
  findOfficeTextMatch,
  isOfficeDocument,
  SUPPORTED_EXTENSIONS: OFFICE_EXTENSIONS,
} = require('./officeTextExtract');
const { extractPdfTextLines } = require('./pdfTextExtract');

/**
 * Searching inside the documents whose text a plain content search cannot see.
 *
 * Office files are zip archives, PDFs are compressed streams: ripgrep reads
 * both as binary and finds nothing in them, however the search is configured.
 * They are read differently — a zip in this process, a PDF through pdftotext —
 * and this is the one door the search goes through for either.
 */

const SEARCHABLE_EXTENSIONS = [...OFFICE_EXTENSIONS, 'pdf'];

const extensionOf = (filePath) => path.extname(filePath || '').slice(1).toLowerCase();

/** Whether this is a document whose text has to be extracted to be searched. */
const isSearchableDocument = (filePath) => SEARCHABLE_EXTENSIONS.includes(extensionOf(filePath));

/**
 * The first line of a document containing `needle`, or null.
 *
 * @returns {Promise<{ line: string, lineNumber: number }|null>}
 */
const findDocumentTextMatch = async (absolutePath, needle) => {
  const lowered = String(needle || '').toLowerCase();
  if (!lowered) return null;

  if (isOfficeDocument(absolutePath)) {
    return findOfficeTextMatch(absolutePath, lowered);
  }

  if (extensionOf(absolutePath) !== 'pdf') return null;

  const lines = await extractPdfTextLines(absolutePath);
  if (!lines) return null;

  const index = lines.findIndex((line) => line.toLowerCase().includes(lowered));
  return index === -1 ? null : { line: lines[index], lineNumber: index + 1 };
};

/**
 * How much of a plain file is worth reading to show one line of it.
 *
 * The same ceiling the index uses. A match further in than this is one the
 * result list was never going to show anyway.
 */
const MAX_PLAIN_TEXT_BYTES = 1024 * 1024;

/**
 * The first line of a plain file containing `needle`, or null.
 *
 * Written by hand rather than with `split`, and the difference is not style.
 * Splitting a file to take one line of it builds an array of every line it
 * has; counting newlines with `slice(0, index).match(/\n/g)` copies the whole
 * prefix and then builds an array of every newline in it. Three or four times
 * the file, allocated and discarded, per result shown — a hundred results deep
 * that is what a search costs the machine rather than the disk.
 */
const findPlainTextMatch = async (absolutePath, needle, maxBytes = MAX_PLAIN_TEXT_BYTES) => {
  const lowered = String(needle || '').toLowerCase();
  if (!lowered) return null;

  let handle = null;
  try {
    handle = await fs.open(absolutePath, 'r');
    // Sized to the file rather than to the ceiling: allocating a megabyte to
    // read a two-kilobyte note is the same waste in miniature.
    const { size } = await handle.stat();
    const wanted = Math.min(size, maxBytes);
    if (wanted <= 0) return null;

    const buffer = Buffer.allocUnsafe(wanted);
    const { bytesRead } = await handle.read(buffer, 0, wanted, 0);
    if (!bytesRead) return null;

    const content = buffer.subarray(0, bytesRead).toString('utf8');
    const index = content.toLowerCase().indexOf(lowered);
    if (index === -1) return null;

    let lineNumber = 1;
    let lineStart = 0;
    for (let at = 0; at < index; at += 1) {
      if (content.charCodeAt(at) === 10) {
        lineNumber += 1;
        lineStart = at + 1;
      }
    }

    let lineEnd = content.indexOf('\n', index);
    if (lineEnd === -1) lineEnd = content.length;
    const line = content.slice(lineStart, lineEnd).replace(/\r$/, '');

    return { line, lineNumber };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
};

module.exports = {
  findDocumentTextMatch,
  findPlainTextMatch,
  isSearchableDocument,
  SEARCHABLE_EXTENSIONS,
};
