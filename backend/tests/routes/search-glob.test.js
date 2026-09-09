import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * `*.ps1` typed into the search box found six files that happen to mention
 * `*.ps1` in their text, took eleven seconds about it, and returned not one of
 * the PowerShell scripts sitting in the volume. Both halves are tested here,
 * at the route, because the defect was never in matching a name — it was in
 * the search deciding that a pattern was something to look for inside files.
 */

let envContext;

const buildApp = () => {
  const searchRoutes = envContext.requireFresh('src/routes/search');
  const { errorHandler } = envContext.requireFresh('src/middleware/errorHandler');
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u1', email: 'u@example.com', roles: ['admin'] };
    next();
  });
  app.use('/api', searchRoutes);
  app.use(errorHandler);
  return app;
};

const seed = async () => {
  envContext = await setupTestEnv({
    tag: 'search-glob-',
    env: { SEARCH_DEEP: 'true', SEARCH_RIPGREP: 'true' },
  });
  const dbService = envContext.requireFresh('src/services/db');
  const db = await dbService.getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
     VALUES ('u1', 'u@example.com', 1, 'u', 'U', '["admin"]', ?, ?)`
  ).run(now, now);

  const dir = path.join(envContext.volumeDir, 'Scripts');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'deploy.ps1'), 'Write-Host "deploying"\n');
  await fs.writeFile(path.join(dir, 'cleanup.ps1'), 'Write-Host "cleaning"\n');
  // The trap: its name is not a match, but its text is. Under the old rule it
  // was a result and the scripts were not.
  await fs.writeFile(path.join(dir, 'README.md'), 'Run every *.ps1 in this folder.\n');
  await fs.writeFile(path.join(dir, 'deploy.ps1.bak'), 'old copy\n');
  return dir;
};

const search = async (term) => {
  const response = await request(buildApp()).get('/api/search').query({ q: term });
  expect(response.status).toBe(200);
  return response.body;
};

afterEach(async () => {
  if (envContext) await envContext.cleanup();
  envContext = null;
});

describe('searching for a filename pattern', () => {
  it('returns the files the pattern names', async () => {
    await seed();
    const names = (await search('*.ps1')).items.map((item) => item.name).sort();

    expect(names).toEqual(['cleanup.ps1', 'deploy.ps1']);
  });

  it('does not return a file merely because the pattern appears in its text', async () => {
    await seed();
    const names = (await search('*.ps1')).items.map((item) => item.name);

    expect(names).not.toContain('README.md');
  });

  it('anchors the pattern, so a name that only starts that way is not a match', async () => {
    await seed();
    const names = (await search('*.ps1')).items.map((item) => item.name);

    expect(names).not.toContain('deploy.ps1.bak');
  });

  /**
   * The half that made it slow. A pattern has nothing to look for inside a
   * file, so no content source is opened, and the answer cannot be truncated
   * by a budget it never spent.
   */
  it('answers whole, without spending the time budget', async () => {
    await seed();
    const body = await search('*.ps1');

    expect(body.truncated).toBe(false);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('still searches inside files when the term is not a pattern', async () => {
    await seed();
    const hit = (await search('deploying')).items.find((item) => item.name === 'deploy.ps1');

    expect(hit?.matchLine).toContain('deploying');
  });
});

/**
 * The exclusion list was written for the index, and only the index obeyed it.
 * Every search still walked the excluded folder by name, which on a Docker
 * overlay is most of a volume — so no search finished inside its budget, and
 * the same question came back truncated at a different point each time.
 */
describe('a folder the search is told to leave alone', () => {
  const seedWithExcluded = async () => {
    const dir = await seed();
    const excluded = path.join(envContext.volumeDir, 'Stacks', 'docker');
    await fs.mkdir(excluded, { recursive: true });
    await fs.writeFile(path.join(excluded, 'overlay.ps1'), 'Write-Host "inside docker"\n');
    return dir;
  };

  it('is not walked by a filename search', async () => {
    await seedWithExcluded();
    const searchIndexExclusions = envContext.requireFresh('src/services/searchIndexExclusions');
    searchIndexExclusions.setAdminPaths(['Stacks/docker']);

    const names = (await search('*.ps1')).items.map((item) => item.name);

    expect(names).not.toContain('overlay.ps1');
    expect(names).toContain('deploy.ps1');
  });

  it('is searched when it is the folder the search was pointed at', async () => {
    await seedWithExcluded();
    const searchIndexExclusions = envContext.requireFresh('src/services/searchIndexExclusions');
    searchIndexExclusions.setAdminPaths(['Stacks/docker']);

    const response = await request(buildApp())
      .get('/api/search')
      .query({ q: '*.ps1', path: 'Stacks/docker' });

    expect(response.status).toBe(200);
    expect(response.body.items.map((item) => item.name)).toContain('overlay.ps1');
  });
});
