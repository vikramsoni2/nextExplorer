import { describe, it, expect } from 'vitest';
import path from 'node:path';

const { createPathExclusions } = require('../../src/services/pathExclusions');

/**
 * Written once because it was written twice: the folder-size index and the
 * search index each carried their own copy, eighty-two per cent identical and
 * differing only in which setting they read. Two copies of a rule about what
 * may be excluded is two places for it to drift.
 */
const build = (environment = []) =>
  createPathExclusions({
    settingsCategory: 'system',
    settingsKey: 'test',
    readEnvironmentPaths: () => environment,
  });

describe('two lists of folders to leave alone', () => {
  it('keeps the environment separate from the administrator', () => {
    const exclusions = build(['Stacks/docker']);
    exclusions.setAdminPaths(['Backups/2024']);

    expect(exclusions.snapshot()).toEqual({
      excludedPaths: ['Backups/2024'],
      environmentExcludedPaths: ['Stacks/docker'],
    });
    expect(exclusions.effectivePaths()).toEqual(['Backups/2024', 'Stacks/docker']);
  });

  // An operator who wrote a path into their compose file did not mean it to be
  // removable by anyone who can reach Settings.
  it('does not let an administrator take back what the environment set', () => {
    const exclusions = build(['Stacks/docker']);

    exclusions.setAdminPaths(['Stacks/docker', 'Backups/2024']);

    expect(exclusions.snapshot().excludedPaths).toEqual(['Backups/2024']);
    expect(exclusions.effectivePaths()).toContain('Stacks/docker');
  });

  it('says what changed, which is what tells a caller to act', () => {
    const exclusions = build();
    exclusions.setAdminPaths(['Photos/RAW']);

    const changed = exclusions.setAdminPaths(['Backups/2024']);

    expect(changed.added).toEqual(['Backups/2024']);
    expect(changed.removed).toEqual(['Photos/RAW']);
  });

  it('matches a folder and everything under it, and nothing beside it', () => {
    const exclusions = build(['Stacks/docker']);
    const scope = { root: path.resolve('/volume') };

    expect(exclusions.isExcluded(path.resolve('/volume/Stacks/docker'), scope)).toBe(true);
    expect(exclusions.isExcluded(path.resolve('/volume/Stacks/docker/overlay2'), scope)).toBe(true);
    // A sibling whose name merely starts the same way is not inside it.
    expect(exclusions.isExcluded(path.resolve('/volume/Stacks/docker-compose'), scope)).toBe(false);
    expect(exclusions.isExcluded(path.resolve('/volume/Stacks'), scope)).toBe(false);
  });

  // Each index has its own list; one must not be able to overwrite the other's.
  it('gives each caller its own state', () => {
    const first = build(['A']);
    const second = build(['B']);

    first.setAdminPaths(['first-only']);

    expect(second.snapshot().excludedPaths).toEqual([]);
    expect(second.effectivePaths()).toEqual(['B']);
  });
});
