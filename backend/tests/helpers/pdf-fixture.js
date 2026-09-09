const zlib = require('node:zlib');

/**
 * A one-page PDF whose text is compressed, as a real one's is.
 *
 * The compression is the point: an uncompressed content stream leaves the
 * words as plain bytes in the file, where an ordinary text search finds them
 * without anything having read the PDF at all — so a fixture built that way
 * proves nothing about extracting the text.
 */
const buildPdf = (text) => {
  const raw = `BT /F1 12 Tf 20 150 Td (${String(text).replace(/([()\\])/g, '\\$1')}) Tj ET`;
  const stream = zlib.deflateSync(Buffer.from(raw, 'latin1'));

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    { dict: `<< /Length ${stream.length} /Filter /FlateDecode >>`, data: stream },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let length = parts[0].length;
  const offsets = [];

  objects.forEach((body, index) => {
    offsets.push(length);
    const chunk =
      typeof body === 'string'
        ? Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1')
        : Buffer.concat([
            Buffer.from(`${index + 1} 0 obj\n${body.dict}\nstream\n`, 'latin1'),
            body.data,
            Buffer.from('\nendstream\nendobj\n', 'latin1'),
          ]);
    parts.push(chunk);
    length += chunk.length;
  });

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(parts);
};

module.exports = { buildPdf };
