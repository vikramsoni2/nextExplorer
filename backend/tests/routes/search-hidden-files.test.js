import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import request from 'supertest';
import { createTestApp, setupTestEnv } from '../helpers/env-test-utils.js';

const createSearchContext = async () => {
  const envContext = await setupTestEnv({
    tag: 'search-hidden-files-test-',
    env: {
      HIDDEN_FILE_PATTERNS: '.,@',
      SEARCH_RIPGREP: 'false',
    },
    modules: [
      'src/config/env',
      'src/config/index',
      'src/routes/search',
      'src/middleware/errorHandler',
      'src/services/accessManager',
      'src/services/settingsService',
      'src/utils/pathUtils',
    ],
  });

  const searchRoutes = envContext.requireFresh('src/routes/search');
  const { errorHandler } = envContext.requireFresh('src/middleware/errorHandler');
  const { getDb } = envContext.requireFresh('src/services/db');
  const db = await getDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run('admin', 'admin@example.com', 1, 'admin', 'Admin', '["admin"]', now, now);

  const app = createTestApp({
    router: searchRoutes,
    mountPath: '/api',
    user: { id: 'admin', roles: ['admin'] },
    errorHandler,
  });

  return { envContext, app };
};

describe('Search hidden file patterns', () => {
  let currentEnv;

  afterEach(async () => {
    if (currentEnv) {
      await currentEnv.cleanup();
      currentEnv = null;
    }
  });

  it('does not return matches from configured hidden path segments', async () => {
    const { envContext, app } = await createSearchContext();
    currentEnv = envContext;

    await fs.writeFile(path.join(envContext.volumeDir, 'visible-match.txt'), 'needle');
    await fs.writeFile(path.join(envContext.volumeDir, '.dot-match.txt'), 'needle');
    await fs.mkdir(path.join(envContext.volumeDir, '@eaDir'), { recursive: true });
    await fs.writeFile(path.join(envContext.volumeDir, '@eaDir', 'synology-match.txt'), 'needle');

    const response = await request(app).get('/api/search').query({ q: 'match' });

    expect(response.status).toBe(200);
    expect(response.body.items.map((item) => item.name)).toEqual(['visible-match.txt']);
  });

  it('returns hidden pattern matches when the user preference is enabled', async () => {
    const { envContext, app } = await createSearchContext();
    currentEnv = envContext;

    const settingsService = envContext.requireFresh('src/services/settingsService');
    await settingsService.setUserSetting('admin', 'showHiddenFiles', true);

    await fs.writeFile(path.join(envContext.volumeDir, 'visible-match.txt'), 'needle');
    await fs.writeFile(path.join(envContext.volumeDir, '.dot-match.txt'), 'needle');
    await fs.mkdir(path.join(envContext.volumeDir, '@eaDir'), { recursive: true });
    await fs.writeFile(path.join(envContext.volumeDir, '@eaDir', 'synology-match.txt'), 'needle');

    const response = await request(app).get('/api/search').query({ q: 'match' });

    expect(response.status).toBe(200);
    expect(response.body.items.map((item) => item.name).sort()).toEqual([
      '.dot-match.txt',
      'synology-match.txt',
      'visible-match.txt',
    ]);
  });
});
