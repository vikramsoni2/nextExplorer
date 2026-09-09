import { describe, it, expect } from 'vitest';

const { ripgrepIgnoreGlobs, isIgnoredDirectory } = require('../../src/services/searchIgnore');

/**
 * `SEARCH_INDEX_EXCLUDE=Stacks/docker` kept the index out of the Docker
 * overlay and nothing else: every filename search still walked it, and none
 * could finish inside five seconds. The same search answered 58 matches once
 * and 57 the next time — one question, two answers, because the walk was cut
 * at a different point each time.
 */
describe('keeping the search out of excluded folders', () => {
  it('excludes the folder and everything under it, anchored to the root', () => {
    expect(ripgrepIgnoreGlobs('', ['Stacks/docker'])).toEqual([
      '-g',
      '!/Stacks/docker',
      '-g',
      '!/Stacks/docker/**',
    ]);
  });

  it('rewrites the path when the search starts further down', () => {
    expect(ripgrepIgnoreGlobs('Stacks', ['Stacks/docker'])).toEqual([
      '-g',
      '!/docker',
      '-g',
      '!/docker/**',
    ]);
  });

  it('says nothing about an exclusion in another part of the volume', () => {
    expect(ripgrepIgnoreGlobs('Media', ['Stacks/docker'])).toEqual([]);
  });

  /**
   * Standing inside an excluded folder and searching is asking to look there.
   * The list keeps the crawl out of a corner; it does not make the corner
   * unreadable to someone who navigated into it.
   */
  it('does not exclude the folder the search was pointed at', () => {
    expect(ripgrepIgnoreGlobs('Stacks/docker', ['Stacks/docker'])).toEqual([]);
  });

  it('anchors, so a folder of the same name elsewhere is still searched', () => {
    const globs = ripgrepIgnoreGlobs('', ['Stacks/docker']);

    expect(globs).not.toContain('!docker');
  });

  it('recognises the folder itself while walking', () => {
    expect(isIgnoredDirectory('Stacks/docker', ['Stacks/docker'])).toBe(true);
    expect(isIgnoredDirectory('Stacks/dockerfiles', ['Stacks/docker'])).toBe(false);
    expect(isIgnoredDirectory('Stacks', ['Stacks/docker'])).toBe(false);
  });
});
