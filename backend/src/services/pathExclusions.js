const path = require('path');

const { normalizeRelativePath } = require('../utils/pathUtils');

/**
 * Two lists of folders a background pass should leave alone.
 *
 * One comes from the environment and the interface cannot touch it: an
 * operator who wrote a path into their compose file did not mean it to be
 * removable by anyone who can reach Settings. The other belongs to whoever
 * administers the instance, is kept in the database, and is edited from a
 * settings page.
 *
 * Written once because it was written twice. The folder-size index and the
 * search index each had their own copy — eighty-two per cent identical, and
 * differing only in which setting they read and which environment variable
 * feeds them. Two copies of a rule about what may be excluded is two places
 * for it to drift, and a difference nobody chose.
 *
 * Each caller gets its own state: the factory closes over `adminPaths` rather
 * than sharing a module-level one, so the two indexes cannot overwrite each
 * other's list.
 */

const unique = (paths) => [...new Set(paths)].sort((left, right) => left.localeCompare(right));

const sanitizePaths = (value) => {
  const values = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n,]/)
        .map((item) => item.trim());

  return unique(
    values
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => normalizeRelativePath(item))
      .filter(Boolean)
  );
};

/**
 * @param {object} options
 * @param {string} options.settingsCategory   where the admin list is stored
 * @param {string} options.settingsKey        and under which key
 * @param {() => unknown} options.readEnvironmentPaths  the environment's list,
 *   read on every call rather than captured, so a test that rebuilds the
 *   configuration is seen without rebuilding this too
 */
const createPathExclusions = ({ settingsCategory, settingsKey, readEnvironmentPaths }) => {
  let adminPaths = [];

  const environmentPaths = () => sanitizePaths(readEnvironmentPaths());
  const effectivePaths = () => unique([...environmentPaths(), ...adminPaths]);

  const loadFromDatabase = (db) => {
    const row = db
      .prepare('SELECT value FROM system_settings WHERE category = ? AND key = ?')
      .get(settingsCategory, settingsKey);
    if (!row) {
      adminPaths = [];
      return adminPaths;
    }
    try {
      adminPaths = sanitizePaths(JSON.parse(row.value)?.excludedPaths || []);
    } catch {
      adminPaths = [];
    }
    return adminPaths;
  };

  const setAdminPaths = (paths) => {
    const previous = effectivePaths();
    const environment = environmentPaths();
    adminPaths = sanitizePaths(paths).filter((value) => !environment.includes(value));
    const next = effectivePaths();
    return {
      excludedPaths: adminPaths,
      environmentExcludedPaths: environmentPaths(),
      added: next.filter((value) => !previous.includes(value)),
      removed: previous.filter((value) => !next.includes(value)),
    };
  };

  /** Whether an absolute path sits at or under one of the excluded folders. */
  const isExcluded = (absolutePath, scope) => {
    if (!absolutePath || !scope?.root) return false;
    const candidate = path.resolve(absolutePath);
    return effectivePaths().some((relativePath) => {
      const excluded = path.resolve(scope.root, relativePath);
      return candidate === excluded || candidate.startsWith(`${excluded}${path.sep}`);
    });
  };

  const snapshot = () => ({
    excludedPaths: adminPaths,
    environmentExcludedPaths: environmentPaths(),
  });

  return {
    SETTINGS_CATEGORY: settingsCategory,
    SETTINGS_KEY: settingsKey,
    sanitizePaths,
    loadFromDatabase,
    setAdminPaths,
    effectivePaths,
    isExcluded,
    snapshot,
  };
};

module.exports = { createPathExclusions, sanitizePaths };
