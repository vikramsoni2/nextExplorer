/**
 * How much of a page filenames may take, and when to stop looking.
 *
 * Names lead — someone looking for a file expects the file first — but they
 * cannot take the whole page: a term matching a hundred filenames used to
 * return a hundred names and not one line of content, which is the half a deep
 * search is opened for. So the two are counted apart and a share is reserved.
 *
 * The reserve is also the only reason to go on once a page could already be
 * filled, and that is where it went wrong. Waiting for a reserve that will
 * never fill made every ordinary search run to the time budget: a term with
 * five hundred filename matches and eight content matches spent five seconds
 * looking for content that had already run out. A reserve is worth waiting for
 * while there is somewhere left to find it; once the sources of content are
 * exhausted, waiting is just waiting.
 */

const NAME_SHARE = 0.75;

/**
 * Read from the merged stream until the page is satisfied.
 *
 * @param {AsyncIterable} results          the merged sources
 * @param {number} limit                   how many results a page holds
 * @param {() => boolean} contentExhausted  whether anything can still produce
 *   a content match; when nothing can, a full page of names is the whole
 *   answer and there is nothing left to wait for
 * @param {Array} names     filled as they are found, so a caller that gives up
 *   on the collector can still answer with what it had reached
 * @param {Array} contents  the same, for content matches
 */
const collectResults = async ({
  results,
  limit,
  contentExhausted = () => false,
  names = [],
  contents = [],
}) => {
  const nameCap = limit;
  const contentReserve = Math.max(1, limit - Math.floor(limit * NAME_SHARE));

  for await (const item of results) {
    (item.matchLine ? contents : names).push(item);

    if (names.length < nameCap) continue;
    if (contents.length >= contentReserve) break;
    if (contentExhausted()) break;
  }

  return { names, contents };
};

/**
 * One page, names first, with the reserve honoured and nothing wasted.
 *
 * A quota that went unused is not a reason to answer short: if there were only
 * three content matches, the rest of the page is names.
 */
const buildPage = ({ names, contents, limit }) => {
  const nameQuota = contents.length > 0 ? Math.max(1, Math.floor(limit * NAME_SHARE)) : limit;
  const page = [...names.slice(0, nameQuota), ...contents].slice(0, limit);

  if (page.length < limit) {
    page.push(...names.slice(nameQuota, nameQuota + (limit - page.length)));
  }

  return page;
};

module.exports = { collectResults, buildPage, NAME_SHARE };
