import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import AdmZip from 'adm-zip';

const { extractOfficeTextLines } = require('../../src/services/officeTextExtract');

/**
 * Office documents are zip archives of XML, so a plain content search sees
 * compressed bytes and finds nothing. What decides whether reading them is
 * useful is how the pieces of a paragraph are put back together.
 */

let dir;

const docx = (documentXml) => {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
  zip.addFile('word/document.xml', Buffer.from(documentXml));
  const file = path.join(dir, `doc-${Math.abs(documentXml.length)}.docx`);
  zip.writeZip(file);
  return file;
};

const paragraph = (...runs) =>
  `<w:p>${runs.map((run) => `<w:r><w:t>${run}</w:t></w:r>`).join('')}</w:p>`;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'office-text-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('reading a Word document', () => {
  it('gives back its paragraphs', async () => {
    const file = docx(
      `<w:document><w:body>${paragraph('Hello there')}${paragraph('Second line')}</w:body></w:document>`
    );

    expect(extractOfficeTextLines(file)).toEqual(['Hello there', 'Second line']);
  });

  // The reason this exists. Word splits a word across runs whenever formatting
  // changes inside it, so an emphasised syllable makes three nodes. Joining
  // them with a space would hide the word from the search that goes looking
  // for it.
  it('puts a word split by formatting back together', async () => {
    const file = docx(
      `<w:document><w:body>${paragraph('im', 'port', 'ant')}</w:body></w:document>`
    );

    expect(extractOfficeTextLines(file)).toEqual(['important']);
  });

  it('reads the entities as the characters they stand for', async () => {
    const file = docx(
      `<w:document><w:body>${paragraph('Tom &amp; Jerry &lt;3 &quot;quoted&quot;')}</w:body></w:document>`
    );

    expect(extractOfficeTextLines(file)).toEqual(['Tom & Jerry <3 "quoted"']);
  });

  it('says nothing rather than failing on a file that is not a document', async () => {
    const file = path.join(dir, 'broken.docx');
    await fs.writeFile(file, 'this is not a zip at all');

    expect(extractOfficeTextLines(file)).toBeNull();
  });

  it('leaves formats it does not read alone', async () => {
    const file = path.join(dir, 'notes.md');
    await fs.writeFile(file, '# hello');

    expect(extractOfficeTextLines(file)).toBeNull();
  });

  // A document big enough to be a problem is not one anyone reads line by
  // line, and the search must not be held up by it.
  it('stops reading a document past the size it was given', async () => {
    const long = Array.from({ length: 500 }, (_, index) => paragraph(`line ${index} `.repeat(20)));
    const file = docx(`<w:document><w:body>${long.join('')}</w:body></w:document>`);

    const lines = extractOfficeTextLines(file, { maxCharacters: 1000 });

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('').length).toBeLessThan(2000);
  });
});

describe('reading a spreadsheet and a deck', () => {
  it('reads the strings out of a workbook', async () => {
    const zip = new AdmZip();
    zip.addFile(
      'xl/sharedStrings.xml',
      Buffer.from('<sst><si><t>Revenue</t></si><si><t>Q4 pangolin</t></si></sst>')
    );
    const file = path.join(dir, 'book.xlsx');
    zip.writeZip(file);

    expect(extractOfficeTextLines(file)).toEqual(['Revenue', 'Q4 pangolin']);
  });

  it('reads the text off the slides', async () => {
    const zip = new AdmZip();
    zip.addFile(
      'ppt/slides/slide1.xml',
      Buffer.from('<p:sld><a:p><a:r><a:t>Title here</a:t></a:r></a:p></p:sld>')
    );
    const file = path.join(dir, 'deck.pptx');
    zip.writeZip(file);

    expect(extractOfficeTextLines(file)).toEqual(['Title here']);
  });
});

/**
 * A zip states how large each entry becomes before anything is decompressed,
 * and for text that number can be enormous next to the file it came in. The
 * inflation happens on the one thread the server has, so a document nobody
 * would think twice about — well inside any search size limit — can stop
 * everything else for as long as it takes.
 */
describe('what it refuses to inflate', () => {
  const bodyOf = (paragraphs) =>
    `<w:document><w:body>${paragraph('pangolin').repeat(paragraphs)}</w:body></w:document>`;

  // Either side of the ceiling, so the ceiling is what separates them and not
  // some other property of a large archive. Both files are tiny on disk.
  it('reads a document that inflates to a reasonable size', async () => {
    const file = docx(bodyOf(150000));

    expect((await fs.stat(file)).size).toBeLessThan(1024 * 1024);
    expect(extractOfficeTextLines(file)?.length).toBe(150000);
  });

  it('leaves an entry that says it inflates to far more', async () => {
    const file = docx(bodyOf(400000));

    expect((await fs.stat(file)).size).toBeLessThan(1024 * 1024);
    expect(extractOfficeTextLines(file)).toBeNull();
  });
});
