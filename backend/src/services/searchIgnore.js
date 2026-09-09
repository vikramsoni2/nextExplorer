/**
 * The folders search does not walk into.
 *
 * The exclusion list was written for the index, and only the index obeyed it.
 * Every search still enumerated the whole volume by name — including the
 * Docker overlay the list exists to keep out — so no filename search could
 * finish inside its budget: `*.xlsx` came back truncated at fifty-eight
 * matches, then at fifty-seven, the same question answered differently twice
 * because the walk was cut at a different point each time.
 *
 * A folder excluded from search is excluded from all of it. The one exception
 * is standing inside it: navigating into an excluded folder and searching
 * there is asking to look, and the exclusion keeps the crawl out of a corner
 * rather than making the corner unreadable.
 */

/**
 * ripgrep globs for the folders to skip, relative to where the search starts.
 *
 * @param {string} relBasePath  the search base, relative to the volume root
 * @param {string[]} excludedPaths  excluded folders, relative to the same root
 */
const ripgrepIgnoreGlobs = (relBasePath = '', excludedPaths = []) => {
  const base = relBasePath ? `${relBasePath}/` : '';

  return excludedPaths.flatMap((excluded) => {
    if (!excluded) return [];
    // An exclusion elsewhere in the volume cannot match anything under this
    // base, and one naming the base itself is where the search was pointed.
    if (base && !excluded.startsWith(base)) return [];
    const inner = base ? excluded.slice(base.length) : excluded;
    if (!inner) return [];
    // Anchored, so `Stacks/docker` does not also take out `Other/docker`.
    return ['-g', `!/${inner}`, '-g', `!/${inner}/**`];
  });
};

/** Whether a folder found while walking is one of the folders to skip. */
const isIgnoredDirectory = (relPath, excludedPaths = []) =>
  excludedPaths.some((excluded) => excluded && relPath === excluded);

module.exports = { ripgrepIgnoreGlobs, isIgnoredDirectory };
