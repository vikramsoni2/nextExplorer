const os = require('os');

/**
 * Map over items with a bounded number of them in flight.
 *
 * `Promise.all(items.map(...))` starts everything at once, which is fine for a
 * list the code chose and quite different for one the request brought with it:
 * a client that asks about ten thousand paths gets ten thousand simultaneous
 * authorization checks and stats, and the machine has no say in it. The list is
 * the client's, so the concurrency has to be ours.
 *
 * The same shape as the pool the transfer service has always used, written once
 * so a new route does not have to remember to write it again.
 */
const DEFAULT_CONCURRENCY = Math.max(
  1,
  typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
);

const mapWithConcurrency = async (items, mapper, concurrency = DEFAULT_CONCURRENCY) => {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let next = 0;

  const workerCount = Math.min(Math.max(1, concurrency), list.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= list.length) return;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await mapper(list[index], index);
    }
  });

  await Promise.all(workers);
  return results;
};

module.exports = { mapWithConcurrency, DEFAULT_CONCURRENCY };
