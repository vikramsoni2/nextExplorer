import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import request from 'supertest';
import { createTestApp, setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * One account's personal folder, from another account.
 *
 * Personal folders default to `<volume>/_users`, which puts every account's
 * private files inside the tree everybody browses. The directory name was kept
 * out of listings, and that was the whole of it: asking for `_users/alice` by
 * name answered, and the volume's access rules had no reason to refuse — the
 * question of whose folder it was never came up.
 *
 * Measured before the fix, with an ordinary account holding no admin role: it
 * listed the other account's folder, read a file in it, and deleted that file,
 * answered 200 each time.
 *
 * The personal space itself was never the way in. It derives the directory from
 * who is asking rather than from what was asked for, so there is nothing to
 * aim. The volume was the way in, and the volume does not go there any more.
 */

let currentEnv;

const setup = async ({ userRootEnv = {} } = {}) => {
  const env = await setupTestEnv({
    tag: 'personal-isolation-',
    env: { USER_DIR_ENABLED: 'true', ...userRootEnv },
    modules: [
      'src/config/env',
      'src/config/index',
      'src/routes/browse',
      'src/routes/files/index',
      'src/middleware/errorHandler',
      'src/services/accessManager',
      'src/services/settingsService',
      'src/utils/pathUtils',
    ],
  });
  currentEnv = env;

  const browseRoutes = env.requireFresh('src/routes/browse');
  const fileRoutes = env.requireFresh('src/routes/files/index');
  const { errorHandler } = env.requireFresh('src/middleware/errorHandler');
  const { resolvePersonalPath } = env.requireFresh('src/utils/pathUtils');
  const { getDb } = env.requireFresh('src/services/db');

  const db = await getDb();
  const now = new Date().toISOString();
  for (const id of ['alice', 'bob']) {
    db.prepare(
      `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, `${id}@example.com`, 1, id, id, '["user"]', now, now);
  }

  const aliceRoot = await resolvePersonalPath('', { id: 'alice', username: 'alice' });
  await fs.mkdir(aliceRoot, { recursive: true });
  await fs.writeFile(path.join(aliceRoot, 'salary.txt'), 'alice private');

  const bob = { id: 'bob', username: 'bob', roles: ['user'] };
  const asBob = (router) =>
    createTestApp({ router, mountPath: '/api', user: bob, errorHandler });

  return {
    env,
    aliceRoot,
    aliceFolder: path.basename(aliceRoot),
    browseApp: asBob(browseRoutes),
    filesApp: asBob(fileRoutes),
  };
};

afterEach(async () => {
  if (currentEnv) {
    await currentEnv.cleanup();
    currentEnv = null;
  }
});

describe("another account's personal folder, through the volume", () => {
  it('cannot be listed', async () => {
    const { browseApp } = await setup();

    const response = await request(browseApp).get('/api/browse/_users');

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('cannot be opened by name', async () => {
    const { browseApp, aliceFolder } = await setup();

    const response = await request(browseApp).get(`/api/browse/_users/${aliceFolder}`);

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('does not leak a filename in the refusal', async () => {
    const { browseApp, aliceFolder } = await setup();

    const response = await request(browseApp).get(`/api/browse/_users/${aliceFolder}`);

    expect(JSON.stringify(response.body)).not.toContain('salary.txt');
  });

  /** The one that had a 200 and a deleted file behind it. */
  it('cannot have its files deleted', async () => {
    const { filesApp, aliceRoot, aliceFolder } = await setup();

    const response = await request(filesApp)
      .delete('/api/files')
      .send({ items: [{ path: `_users/${aliceFolder}`, name: 'salary.txt' }] });

    expect(response.status).toBeGreaterThanOrEqual(400);
    await expect(fs.access(path.join(aliceRoot, 'salary.txt'))).resolves.toBeUndefined();
  });

  it('is still absent from the volume listing', async () => {
    const { browseApp } = await setup();

    const response = await request(browseApp).get('/api/browse/');

    expect((response.body.items || []).map((item) => item.name)).not.toContain('_users');
  });
});

describe('an account reaching its own folder', () => {
  /** The refusal above must not have closed the door it exists to keep open. */
  it('still works through the personal space', async () => {
    const { browseApp } = await setup();

    const response = await request(browseApp).get('/api/browse/personal');

    expect(response.status).toBe(200);
  });

  it('sees its own files and not the other one\u2019s', async () => {
    const { browseApp } = await setup();
    const { resolvePersonalPath } = currentEnv.requireFresh('src/utils/pathUtils');
    const bobRoot = await resolvePersonalPath('', { id: 'bob', username: 'bob' });
    await fs.mkdir(bobRoot, { recursive: true });
    await fs.writeFile(path.join(bobRoot, 'mine.txt'), 'bob');

    const response = await request(browseApp).get('/api/browse/personal');
    const names = (response.body.items || []).map((item) => item.name);

    expect(names).toContain('mine.txt');
    expect(names).not.toContain('salary.txt');
  });
});

describe('a volume that does not hold the personal folders', () => {
  /**
   * With the user root somewhere else, the volume has nothing to refuse and the
   * check costs nothing. What matters is that ordinary browsing is untouched.
   */
  it('browses normally', async () => {
    const env = await setupTestEnv({
      tag: 'personal-isolation-elsewhere-',
      env: { USER_DIR_ENABLED: 'true' },
      modules: [
        'src/config/env',
        'src/config/index',
        'src/routes/browse',
        'src/middleware/errorHandler',
        'src/services/accessManager',
        'src/services/settingsService',
        'src/utils/pathUtils',
      ],
    });
    currentEnv = env;
    await fs.mkdir(path.join(env.volumeDir, 'Shared'), { recursive: true });
    await fs.writeFile(path.join(env.volumeDir, 'Shared', 'notes.txt'), 'everyone');

    const browseRoutes = env.requireFresh('src/routes/browse');
    const { errorHandler } = env.requireFresh('src/middleware/errorHandler');
    const db = await (env.requireFresh('src/services/db').getDb());
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('bob', 'bob@example.com', 1, 'bob', 'bob', '["user"]', now, now);

    const app = createTestApp({
      router: browseRoutes,
      mountPath: '/api',
      user: { id: 'bob', username: 'bob', roles: ['user'] },
      errorHandler,
    });

    const response = await request(app).get('/api/browse/Shared');

    expect(response.status).toBe(200);
    expect((response.body.items || []).map((item) => item.name)).toContain('notes.txt');
  });
});
