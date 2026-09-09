import { describe, it, expect } from 'vitest';

const { parseSearchTerm } = require('../../src/services/searchTerm');

/**
 * `*.ps1` typed into the search box returned six files that mention the
 * characters `*.ps1` somewhere in their text, after eleven seconds, and not
 * one PowerShell script. Both halves of that are this module's job: what the
 * pattern matches, and that a pattern is not something to look for inside
 * files.
 */
describe('reading what a search term asks for', () => {
  it('treats a term with no wildcard as text, matched anywhere in the name', () => {
    const term = parseSearchTerm('report');

    expect(term.isGlob).toBe(false);
    expect(term.matchesRelativePath('Docs/quarterly-report-final.pdf')).toBe(true);
    expect(term.matchesName('Reports')).toBe(true);
    expect(term.matchesName('invoices')).toBe(false);
  });

  it('matches an extension pattern against the whole name, not part of it', () => {
    const term = parseSearchTerm('*.ps1');

    expect(term.isGlob).toBe(true);
    expect(term.matchesRelativePath('Scripts/deploy.ps1')).toBe(true);
    // The defect this replaces: a substring test says yes to both of these.
    expect(term.matchesRelativePath('Scripts/deploy.ps1.bak')).toBe(false);
    expect(term.matchesRelativePath('Docs/how-to-write-a-ps1.md')).toBe(false);
  });

  it('ignores case, as every other part of the search does', () => {
    expect(parseSearchTerm('*.PS1').matchesRelativePath('Scripts/deploy.ps1')).toBe(true);
    expect(parseSearchTerm('*.ps1').matchesRelativePath('Scripts/DEPLOY.PS1')).toBe(true);
  });

  it('reads `?` as one character and `*` as any run of them', () => {
    const term = parseSearchTerm('conf?g.json');

    expect(term.matchesRelativePath('app/config.json')).toBe(true);
    expect(term.matchesRelativePath('app/confg.json')).toBe(false);
    expect(parseSearchTerm('*').matchesRelativePath('anything at all')).toBe(true);
  });

  /**
   * A term is typed by a person. `a+b` is three characters they expect to find
   * in a name; compiled as an expression it would mean one or more `a`s, and
   * `readme.md` would match `readme?md` for the wrong reason.
   */
  it('does not let a term become a regular expression', () => {
    expect(parseSearchTerm('a+b').matchesName('a+b-notes.txt')).toBe(true);
    expect(parseSearchTerm('a+b').matchesName('aaab.txt')).toBe(false);
    expect(parseSearchTerm('report.?').matchesName('reportxx')).toBe(false);
    expect(parseSearchTerm('report.?').matchesName('report.1')).toBe(true);
  });

  it('matches a pattern that spans folders against the path, and no single name', () => {
    const term = parseSearchTerm('Stacks/*/logs/*.log');

    expect(term.matchesRelativePath('Stacks/ytzero/logs/ytzero.log')).toBe(true);
    expect(term.matchesRelativePath('Other/ytzero/logs/ytzero.log')).toBe(false);
    // A folder is never the answer to a pattern describing files under it.
    expect(term.matchesName('logs')).toBe(false);
  });

  it('keeps a pattern without a separator away from the rest of the path', () => {
    // `*.log` must not match a file because a folder above it ends in .log.
    expect(parseSearchTerm('*.log').matchesRelativePath('archive.log/readme.txt')).toBe(false);
  });
});

describe('deciding whether to read inside files at all', () => {
  it('reads contents for text, and not for a pattern', () => {
    expect(parseSearchTerm('report').readsFileContents).toBe(true);
    expect(parseSearchTerm('*.ps1').readsFileContents).toBe(false);
  });
});
