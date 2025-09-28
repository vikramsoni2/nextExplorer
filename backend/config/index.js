const path = require('path');

const port = Number(process.env.PORT) || 3000;
const volumeDir = path.resolve(process.env.VOLUME_ROOT || '/mnt');
const volumeWithSep = volumeDir.endsWith(path.sep) ? volumeDir : `${volumeDir}${path.sep}`;
const cacheDir = path.resolve(process.env.CACHE_DIR || '/cache');
const thumbnailDir = path.join(cacheDir, 'thumbnails');
const tusUploadDir = path.join(cacheDir, 'tus-uploads');
const passwordConfigFile = path.join(cacheDir, 'app-config.json');

const UPLOAD_METHODS = {
  TUS: 'tus',
  MULTER: 'multer',
};

const uploadMethodEnv = (process.env.UPLOAD_METHOD || UPLOAD_METHODS.TUS).toLowerCase();
const uploadMethod = Object.values(UPLOAD_METHODS).includes(uploadMethodEnv)
  ? uploadMethodEnv
  : UPLOAD_METHODS.TUS;

const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tif', 'tiff', 'avif', 'heic'];
const videoExtensions = ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi', 'wmv', 'flv', 'mpg', 'mpeg'];
const documentExtensions = ['pdf'];
const excludedFiles = ['thumbs.db', '.DS_Store'];

const mimeTypes = {
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

const previewableExtensions = new Set([...imageExtensions, ...videoExtensions, ...documentExtensions]);

const corsOptions = {
  origin: '*',
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
};

module.exports = {
  port,
  directories: {
    volume: volumeDir,
    volumeWithSep,
    cache: cacheDir,
    thumbnails: thumbnailDir,
    tusUploads: tusUploadDir,
  },
  files: {
    passwordConfig: passwordConfigFile,
  },
  uploads: {
    method: uploadMethod,
    methods: UPLOAD_METHODS,
  },
  extensions: {
    images: imageExtensions,
    videos: videoExtensions,
    documents: documentExtensions,
    previewable: previewableExtensions,
  },
  excludedFiles,
  mimeTypes,
  corsOptions,
};
