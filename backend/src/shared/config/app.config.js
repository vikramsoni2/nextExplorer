/**
 * Application Configuration
 * General application settings
 */

const path = require('path');
const env = require('./env.config');

// Resolve directory paths
const volumeDir = path.resolve(env.VOLUME_ROOT);
const configDir = path.resolve(env.CONFIG_DIR);
const cacheDir = path.resolve(env.CACHE_DIR);

const directories = {
  volume: volumeDir,
  volumeWithSep: volumeDir.endsWith(path.sep) ? volumeDir : `${volumeDir}${path.sep}`,
  config: configDir,
  cache: cacheDir,
  data: configDir, // data and config are the same directory
  thumbnails: path.join(cacheDir, 'thumbnails'),
  extensions: path.join(configDir, 'extensions')
};

// Parse public URL
let publicUrl = null;
let publicOrigin = null;
if (env.PUBLIC_URL) {
  try {
    const url = new URL(env.PUBLIC_URL);
    publicUrl = url.href.replace(/\/$/, '');
    publicOrigin = url.origin;
  } catch (err) {
    console.warn(`[Config] Invalid PUBLIC_URL: ${env.PUBLIC_URL}`);
  }
}

module.exports = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  directories,

  files: {
    configFile: path.join(configDir, 'app-config.json')
  },

  public: {
    url: publicUrl,
    origin: publicOrigin
  },

  thumbnails: {
    size: 200,
    quality: 70
  },

  features: {
    volumeUsage: env.SHOW_VOLUME_USAGE
  },

  trustProxy: env.TRUST_PROXY
};
