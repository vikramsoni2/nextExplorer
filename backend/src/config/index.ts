import path from 'path';
import type { CorsOptions } from 'cors';

const port = Number(process.env.PORT) || 3000;
const volumeDir = path.resolve(process.env.VOLUME_ROOT || '/mnt');
const volumeWithSep = volumeDir.endsWith(path.sep) ? volumeDir : `${volumeDir}${path.sep}`;
const cacheDir = path.resolve(process.env.CACHE_DIR || path.join(process.cwd(), 'cache'));
const thumbnailDir = path.join(cacheDir, 'thumbnails');
const passwordConfigFile = path.join(cacheDir, 'app-config.json');

const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tif', 'tiff', 'avif', 'heic'] as readonly string[];
const videoExtensions = ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi', 'wmv', 'flv', 'mpg', 'mpeg'] as readonly string[];
const documentExtensions = ['pdf'] as readonly string[];
const excludedFiles = ['thumbs.db', '.DS_Store'] as readonly string[];

const mimeTypes: Record<string, string> = {
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

const previewableExtensions = new Set<string>([
  ...imageExtensions,
  ...videoExtensions,
  ...documentExtensions,
]);

const corsOptions: CorsOptions = {
  origin: '*',
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
};

const directories = {
  volume: volumeDir,
  volumeWithSep,
  cache: cacheDir,
  thumbnails: thumbnailDir,
} as const;

const files = {
  passwordConfig: passwordConfigFile,
} as const;

const extensions = {
  images: imageExtensions,
  videos: videoExtensions,
  documents: documentExtensions,
  previewable: previewableExtensions,
} as const;

const thumbnails = {
  size: 200,
  quality: 70,
} as const;

export { corsOptions, directories, excludedFiles, extensions, files, mimeTypes, port, thumbnails };
export type ExtensionsConfig = typeof extensions;
export type DirectoriesConfig = typeof directories;
