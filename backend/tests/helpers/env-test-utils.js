/**
 * Test environment utilities for Vitest + Supertest testing.
 *
 * These utilities help with:
 * - Creating temporary directories for tests
 * - Managing environment variables
 * - Clearing module caches for fresh requires
 * - Setting up isolated test environments
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src') + path.sep;

/**
 * Override environment variables and return a restore function.
 * @param {Record<string, string | undefined>} values - Key-value pairs to set
 * @returns {() => void} Function to restore original values
 */
const overrideEnv = (values) => {
  const previous = {};
  Object.entries(values).forEach(([key, value]) => {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
  return () => {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  };
};

/**
 * Resolve a module path relative to the repository root.
 * @param {string} relative - Relative path from repo root
 * @returns {string} Absolute path
 */
const modulePath = (relative) => path.join(REPO_ROOT, relative);

/**
 * Clear a module from Node's require cache.
 * This allows re-requiring modules with fresh state.
 * @param {string} moduleSource - Relative path to the module
 */
const clearModuleCache = (moduleSource) => {
  try {
    const resolved = require.resolve(modulePath(moduleSource));
    delete require.cache[resolved];
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }
};

/**
 * Clear multiple modules from cache.
 * @param {string[]} modules - Array of module paths to clear
 */
const clearModulesCache = (modules) => {
  modules.forEach(clearModuleCache);
};

/**
 * Drop every module of the application from the require cache.
 *
 * Most of them read the configured directories once, at load time, and keep
 * what they computed. A test that only cleared the modules it names therefore
 * ran against the *first* test's temporary volume as soon as a helper it never
 * mentioned sat in between — pathUtils, fsUtils, authorizationService have all
 * played that role. The failures were the worst kind: green in isolation, red
 * in a suite, and pointing at the assertion rather than the cause.
 *
 * Clearing the whole tree removes the guessing. It costs a reload of whatever
 * the test actually requires afterwards, which is a few milliseconds, and it
 * cannot be forgotten.
 */
const clearApplicationModules = () => {
  for (const resolved of Object.keys(require.cache)) {
    if (resolved.startsWith(SRC_ROOT)) delete require.cache[resolved];
  }
};

/**
 * Create temporary directories for test isolation.
 * @param {string} tag - Prefix for the temp directory name
 * @returns {Promise<{tmpRoot: string, configDir: string, cacheDir: string, volumeDir: string}>}
 */
const createTempDirs = async (tag = 'backend-tests-') => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), tag));
  const configDir = path.join(tmpRoot, 'config');
  const cacheDir = path.join(tmpRoot, 'cache');
  const volumeDir = path.join(tmpRoot, 'volume');
  await Promise.all([
    fs.mkdir(configDir, { recursive: true }),
    fs.mkdir(cacheDir, { recursive: true }),
    fs.mkdir(volumeDir, { recursive: true }),
  ]);
  return { tmpRoot, configDir, cacheDir, volumeDir };
};

/**
 * Set up a complete test environment with temp dirs and env overrides.
 *
 * Every application module is dropped from the require cache, so nothing
 * carries the previous test's directories over. `modules` is therefore no
 * longer needed and is kept only for callers that still pass it.
 *
 * @param {Object} options - Setup options
 * @param {string} options.tag - Prefix for temp directory
 * @param {string[]} [options.modules] - Unused; all application modules are cleared
 * @param {Record<string, string>} options.env - Additional env vars to set
 * @returns {Promise<TestEnvContext>} Context object with cleanup and helper methods
 *
 * @example
 * const env = await setupTestEnv({ tag: 'my-test-', env: { MY_VAR: 'value' } });
 *
 * const myService = env.requireFresh('src/services/myService');
 * // ... run tests ...
 *
 * await env.cleanup();
 */
/**
 * Stop the background work a test may have started, without starting any.
 *
 * `require.cache` is consulted rather than `require` so that a module the test
 * never loaded stays unloaded — asking a service to stop is otherwise a way of
 * starting it.
 */
const loadedModule = (relativePath) => {
  const resolved = modulePath(relativePath);
  try {
    return require.cache[require.resolve(resolved)]?.exports || null;
  } catch {
    return null;
  }
};

const quiesceLoadedServices = async () => {
  const searchIndex = loadedModule('src/services/searchIndexManager');
  try {
    searchIndex?.stop?.();
  } catch {
    /* a manager that never started has nothing to stop */
  }

  // Thumbnails are the other thing that outlives the request that asked for
  // it: three queues and three timers, which go on writing into a cache
  // directory that is about to be deleted — and a write landing during the
  // removal fails it outright with ENOTEMPTY.
  const thumbnails = loadedModule('src/services/thumbnailService');
  try {
    await thumbnails?.stopThumbnailWork?.();
  } catch {
    /* nothing queued is nothing to drain */
  }

  const db = loadedModule('src/services/db');
  try {
    db?.closeDb?.();
  } catch {
    /* an unopened database has no handle to close */
  }

  // One turn for anything that was mid-flight to settle before the directory
  // it is writing into disappears.
  await new Promise((resolve) => setImmediate(resolve));
};

const setupTestEnv = async ({ tag, modules = [], env = {} } = {}) => {
  const dirs = await createTempDirs(tag);
  const envOverrides = {
    CONFIG_DIR: dirs.configDir,
    CACHE_DIR: dirs.cacheDir,
    VOLUME_ROOT: dirs.volumeDir,
    SESSION_SECRET: 'test-secret',
    ...env,
  };
  const restoreEnv = overrideEnv(envOverrides);

  // `modules` is accepted for compatibility; clearing everything covers it.
  void modules;
  clearApplicationModules();

  return {
    ...dirs,
    envOverrides,
    /**
     * Clean up the test environment.
     * Call this in afterAll/afterEach to restore state.
     */
    cleanup: async () => {
      // Close what the test started before the ground is removed from under
      // it. Dropping the module registry does not stop a timer or a queued
      // pass that a loaded module already scheduled: it keeps running against
      // a directory that is about to be deleted and an environment that is
      // about to be restored, and it lands on whichever test comes next. That
      // is the whole of the intermittent failure this suite had — five
      // different tests in five different files over two days, each passing on
      // its own.
      //
      // Only modules already in the registry are touched: requiring one here
      // to shut it down would start it.
      await quiesceLoadedServices();
      restoreEnv();
      clearApplicationModules();
      // Retries because quiescing cannot be perfect: a thumbnail write can be
      // between its temp file and its rename at the instant the queues report
      // idle, and the directory then refuses to go with ENOTEMPTY. That is a
      // race the cleanup can absorb — a test failing on the tidying up after it
      // has already passed teaches nobody anything.
      await fs.rm(dirs.tmpRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
    },
    /**
     * Require a module with a fresh cache.
     * @param {string} moduleSource - Relative path to the module
     * @returns {any} The freshly required module
     */
    requireFresh: (moduleSource) => {
      clearModuleCache(moduleSource);
      return require(modulePath(moduleSource));
    },
  };
};

/**
 * Create a minimal Express app for testing a specific router.
 * This is a convenience helper for route tests.
 *
 * @param {Object} options - Configuration options
 * @param {express.Router} options.router - The router to mount
 * @param {string} options.mountPath - Path to mount the router at
 * @param {Object} options.user - Mock user object to inject into requests
 * @param {Function} options.errorHandler - Error handler middleware
 * @returns {express.Application} Configured Express app for testing
 *
 * @example
 * const app = createTestApp({
 *   router: myRouter,
 *   mountPath: '/api/items',
 *   user: { id: '1', roles: ['admin'] },
 *   errorHandler: errorMiddleware.errorHandler
 * });
 *
 * const response = await request(app).get('/api/items').expect(200);
 */
const createTestApp = ({ router, mountPath, user, errorHandler } = {}) => {
  const express = require('express');
  const app = express();
  app.use(express.json());

  // Inject mock user if provided
  if (user) {
    app.use((req, _res, next) => {
      req.user = user;
      next();
    });
  }

  // Mount the router
  if (router && mountPath) {
    app.use(mountPath, router);
  }

  // Add error handler if provided
  if (errorHandler) {
    app.use(errorHandler);
  }

  return app;
};

module.exports = {
  overrideEnv,
  clearModuleCache,
  clearModulesCache,
  clearApplicationModules,
  createTempDirs,
  setupTestEnv,
  createTestApp,
  modulePath,
};
