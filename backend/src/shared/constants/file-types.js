/**
 * File Type Constants
 * Supported file extensions by category
 */

const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico',
  'tif', 'tiff', 'avif', 'heic'
];

const VIDEO_EXTENSIONS = [
  'mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi', 'wmv', 'flv',
  'mpg', 'mpeg'
];

const DOCUMENT_EXTENSIONS = ['pdf'];

const EXCLUDED_FILES = ['thumbs.db', '.DS_Store'];

const PREVIEWABLE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS
]);

module.exports = {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  EXCLUDED_FILES,
  PREVIEWABLE_EXTENSIONS
};
