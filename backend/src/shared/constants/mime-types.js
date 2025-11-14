/**
 * MIME Type Constants
 * Mapping of file extensions to MIME types
 */

const MIME_TYPES = {
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
  heic: 'image/heic',

  // Videos
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',

  // Documents
  pdf: 'application/pdf'
};

/**
 * Get MIME type for file extension
 * @param {string} extension - File extension (without dot)
 * @returns {string} - MIME type or 'application/octet-stream' if unknown
 */
function getMimeType(extension) {
  const ext = extension?.toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

module.exports = {
  MIME_TYPES,
  getMimeType
};
