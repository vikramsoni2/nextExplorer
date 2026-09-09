const fs = require('fs');

/**
 * How much memory this process is allowed, when something is enforcing it.
 *
 * A background task that must not be the reason a container dies needs to know
 * what "too much" is, and the only authority on that is the cgroup the
 * container runs in. Without one — a bare process, a host with no limit — there
 * is no answer, and callers fall back to a budget of their own.
 *
 * Read once: a limit does not change under a running container, and reading it
 * on every check would put two file reads in a loop that exists to be cheap.
 */
const readNumber = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (raw === 'max') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

let cached;

const containerMemoryLimitBytes = () => {
  if (cached !== undefined) return cached;

  const limit =
    readNumber('/sys/fs/cgroup/memory.max') ??
    readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes');

  // A "limit" larger than any machine is how an unlimited cgroup reports
  // itself on v1, and it is not a limit anyone set.
  cached = limit != null && limit < 1024 * 1024 * 1024 * 1024 ? limit : null;
  return cached;
};

/** Only for tests, which need to ask more than once. */
const resetContainerMemoryLimit = () => {
  cached = undefined;
};

module.exports = { containerMemoryLimitBytes, resetContainerMemoryLimit };
