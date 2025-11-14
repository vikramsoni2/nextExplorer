/**
 * OnlyOffice Configuration
 * OnlyOffice integration settings
 */

const env = require('./env.config');
const authConfig = require('./auth.config');

module.exports = {
  serverUrl: env.ONLYOFFICE_URL?.replace(/\/$/, '') || null,
  secret: env.ONLYOFFICE_SECRET || env.SESSION_SECRET || authConfig.session.secret,
  lang: env.ONLYOFFICE_LANG,
  forceSave: env.ONLYOFFICE_FORCE_SAVE,
  extensions: env.ONLYOFFICE_FILE_EXTENSIONS
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
  enabled: !!env.ONLYOFFICE_URL
};
