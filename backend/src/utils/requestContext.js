const { AsyncLocalStorage } = require('node:async_hooks');

/**
 * Per-request scratch space, used for caches that must not outlive a request.
 *
 * Path containment resolves real paths, and a bulk copy resolves one per
 * selected item: on local storage that is ~18 µs each, but on network storage
 * it is a round-trip, so a few thousand selected files turn into seconds spent
 * asking the same questions.
 *
 * The lifetime is deliberately one request. A longer-lived cache would answer
 * from a filesystem that has since changed — and this cache feeds a security
 * check, so a stale answer there is not a stale answer anywhere.
 */
const storage = new AsyncLocalStorage();

const runInRequestContext = (fn) => storage.run(new Map(), fn);

/**
 * Memoize `compute(key)` for the rest of the current request. Outside a
 * request (scripts, background jobs) it simply computes every time.
 */
const cachedForRequest = (namespace, key, compute) => {
  const store = storage.getStore();
  if (!store) return compute();

  let namespaceCache = store.get(namespace);
  if (!namespaceCache) {
    namespaceCache = new Map();
    store.set(namespace, namespaceCache);
  }

  if (namespaceCache.has(key)) return namespaceCache.get(key);
  const value = compute();
  namespaceCache.set(key, value);
  return value;
};

/** Whether a per-request cache is available to memoize into. */
const hasRequestContext = () => storage.getStore() !== undefined;

const requestContextMiddleware = (_req, _res, next) => {
  runInRequestContext(() => next());
};

module.exports = {
  runInRequestContext,
  cachedForRequest,
  hasRequestContext,
  requestContextMiddleware,
};
