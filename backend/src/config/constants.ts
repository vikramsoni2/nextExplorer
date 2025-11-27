export const IMAGE_EXTENSIONS: string[] = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'tif',
  'tiff',
  'avif',
  'heic',
];

export const VIDEO_EXTENSIONS: string[] = [
  'mp4',
  'mov',
  'mkv',
  'webm',
  'm4v',
  'avi',
  'wmv',
  'flv',
  'mpg',
  'mpeg',
];

export const DOCUMENT_EXTENSIONS: string[] = ['pdf'];

export const EXCLUDED_FILES: string[] = ['thumbs.db', '.DS_Store'];

export const MIME_TYPES: Record<string, string> = {
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
  pdf: 'application/pdf',
};

export const PREVIEWABLE_EXTENSIONS: Set<string> = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
]);

module.exports = {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  EXCLUDED_FILES,
  MIME_TYPES,
  PREVIEWABLE_EXTENSIONS,
};
