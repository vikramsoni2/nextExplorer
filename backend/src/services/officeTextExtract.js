const AdmZip = require('adm-zip');

/**
 * The text inside an Office document, for searching.
 *
 * `.docx`, `.xlsx` and `.pptx` are zip archives of XML, so a plain content
 * search sees only compressed bytes and finds nothing — which is what someone
 * searching their documents notices first.
 *
 * The subtlety that decides whether this is useful: Word splits a word across
 * runs whenever formatting changes inside it, so **im**port**ant** is three
 * `<w:t>` nodes. Stripping tags and joining with a space turns that into
 * "im port ant", and searching for the word fails on exactly the documents
 * where it is emphasised. Runs are therefore joined with nothing between them,
 * and only a paragraph ends a line.
 */

/** Where the text lives in each format, and what ends a line. */
const FORMATS = {
  docx: {
    entries: [/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/],
    // A paragraph is a line. Runs inside it are one word's worth of pieces.
    lineBreak: /<\/w:p>/,
    node: /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g,
  },
  xlsx: {
    // Shared strings hold every text cell in the workbook; inline strings live
    // in the sheets themselves.
    entries: [/^xl\/sharedStrings\.xml$/, /^xl\/worksheets\/sheet\d+\.xml$/],
    lineBreak: /<\/(?:si|row)>/,
    node: /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g,
  },
  pptx: {
    entries: [/^ppt\/(?:slides|notesSlides)\/[a-zA-Z]+\d+\.xml$/],
    lineBreak: /<\/a:p>/,
    node: /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g,
  },
};

const SUPPORTED_EXTENSIONS = Object.keys(FORMATS);

/**
 * How much decompressed XML this will take from one document.
 *
 * A zip says how large each entry becomes before anything is decompressed, and
 * that number is the only warning there is: text compresses enormously, so a
 * five-megabyte spreadsheet — well inside any search size limit — can hold a
 * shared-strings table of several hundred megabytes. Inflating it happens on
 * the one thread the server has, and every other request waits behind it.
 *
 * Refusing a document that says it is larger than this costs nothing: the
 * declared size is read from the header, not from the data.
 */
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

/** Only the five XML predefines; the rest are literal in these documents. */
const decodeEntities = (value) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');

const formatFor = (filePath) => {
  const match = /\.([a-z0-9]+)$/i.exec(filePath || '');
  const extension = match ? match[1].toLowerCase() : '';
  return FORMATS[extension] || null;
};

/**
 * The document's text, one line per paragraph, or null where there is none to
 * read. Never throws: an unreadable document is one that does not match, not a
 * failed search.
 *
 * @param {string} absolutePath
 * @param {{ maxCharacters?: number }} [options]
 * @returns {string[]|null} lines
 */
const extractOfficeTextLines = (absolutePath, { maxCharacters = 2 * 1024 * 1024 } = {}) => {
  const format = formatFor(absolutePath);
  if (!format) return null;

  let entries;
  try {
    entries = new AdmZip(absolutePath).getEntries();
  } catch {
    // Not a readable archive — a corrupt file, or one named .docx that is not.
    return null;
  }

  const lines = [];
  let characters = 0;
  let inflated = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    if (!format.entries.some((pattern) => pattern.test(name))) continue;

    // What the archive says this becomes, before it becomes it.
    const declared = Number(entry.header?.size) || 0;
    if (declared > MAX_ENTRY_BYTES) continue;
    if (inflated + declared > MAX_DOCUMENT_BYTES) break;
    inflated += declared;

    let xml;
    try {
      xml = entry.getData().toString('utf8');
    } catch {
      continue;
    }

    for (const block of xml.split(format.lineBreak)) {
      let line = '';
      // Runs are concatenated with nothing between them: that is what keeps a
      // word split by formatting searchable as one word.
      for (const node of block.matchAll(format.node)) {
        line += decodeEntities(node[1]);
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      lines.push(trimmed);
      characters += trimmed.length;
      // A document that would take more than this to read is one nobody is
      // searching line by line.
      if (characters >= maxCharacters) return lines;
    }
  }

  return lines.length > 0 ? lines : null;
};

/**
 * The first line of a document that contains `needle`, or null. Case is
 * ignored, as everywhere else in search.
 *
 * @returns {{ line: string, lineNumber: number }|null}
 */
const findOfficeTextMatch = (absolutePath, needle, options) => {
  const lines = extractOfficeTextLines(absolutePath, options);
  if (!lines) return null;

  const lowered = String(needle || '').toLowerCase();
  if (!lowered) return null;

  const index = lines.findIndex((line) => line.toLowerCase().includes(lowered));
  return index === -1 ? null : { line: lines[index], lineNumber: index + 1 };
};

const isOfficeDocument = (filePath) => Boolean(formatFor(filePath));

module.exports = {
  extractOfficeTextLines,
  findOfficeTextMatch,
  isOfficeDocument,
  SUPPORTED_EXTENSIONS,
};
