import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * What the archive endpoints refuse. The extraction and compression suites
 * cover the paths that work; every branch that says no was untested, and they
 * are the ones that decide where an archive may be written and what may be read
 * into it.
 *
 * As in the upload suite, the `!allowed || !resolved` pairs cannot be told
 * apart by any test: the authorization service returns no resolved path when it
 * refuses, so the second half never fires alone.
 */

let currentEnv;

afterEach(async () => {
  if (currentEnv) {
    await currentEnv.cleanup();
    currentEnv = null;
  }
});

const seed = async (env = {}) => {
  currentEnv = await setupTestEnv({
    tag: 'zip-refusals-',
    env,
    modules: ['src/config/env', 'src/config/index', 'src/routes/zip'],
  });
  const dbService = currentEnv.requireFresh('src/services/db');
  const db = await dbService.getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
     VALUES ('user-1','r@example.com',1,'r','R','["user"]', ?, ?)`
  ).run(now, now);
  await fs.mkdir(path.join(currentEnv.volumeDir, 'Work'), { recursive: true });
  await fs.writeFile(path.join(currentEnv.volumeDir, 'Work', 'one.txt'), 'one\n');
  return db;
};

const buildApp = (user) => {
  const routes = currentEnv.requireFresh('src/routes/zip');
  const { errorHandler } = currentEnv.requireFresh('src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use('/api', routes);
  app.use(errorHandler);
  return app;
};

const ADMIN = { id: 'admin-1', roles: ['admin'] };
const RESTRICTED = { id: 'user-1', roles: [] };

const compress = (app, body) => request(app).post('/api/files/zip/compress').send(body);
const reason = (response) => response.body?.error?.message || response.text;

describe('what may go into an archive', () => {
  it('refuses a request with no items', async () => {
    await seed();

    const response = await compress(buildApp(ADMIN), { items: [], destination: 'Work' });

    expect(response.status).toBe(400);
    expect(reason(response)).toMatch(/at least one item/i);
  });

  it('refuses an item with no name', async () => {
    await seed();

    const response = await compress(buildApp(ADMIN), {
      items: [{ path: 'Work' }],
      destination: 'Work',
    });

    expect(response.status).toBe(400);
    expect(reason(response)).toMatch(/must include a name/i);
  });

  it('refuses a source the caller cannot reach', async () => {
    await seed({ USER_VOLUMES: 'true' });

    const response = await compress(buildApp(RESTRICTED), {
      items: [{ name: 'one.txt', path: 'Work' }],
      destination: 'Work',
    });

    expect(response.status).toBe(403);
  });
});

describe('where an archive may be written', () => {
  it('refuses an empty destination', async () => {
    await seed();

    const response = await compress(buildApp(ADMIN), {
      items: [{ name: 'one.txt', path: 'Work' }],
      destination: '   ',
    });

    expect(response.status).toBe(400);
  });

  it('refuses a destination that is a file', async () => {
    await seed();

    const response = await compress(buildApp(ADMIN), {
      items: [{ name: 'one.txt', path: 'Work' }],
      destination: 'Work/one.txt',
    });

    expect(response.status).toBe(400);
    expect(reason(response)).toMatch(/must be a directory/i);
  });

  it('refuses a destination the caller may not write to', async () => {
    await seed({ USER_VOLUMES: 'true' });

    const response = await compress(buildApp(RESTRICTED), {
      items: [{ name: 'one.txt', path: 'Work' }],
      destination: 'Work',
    });

    expect(response.status).toBe(403);
  });
});

describe('what may be extracted', () => {
  it('refuses a path that is not there', async () => {
    await seed();

    const response = await request(buildApp(ADMIN))
      .post('/api/files/zip/extract')
      .send({ path: 'Work/absent.zip' });

    expect([400, 404]).toContain(response.status);
  });

  it('refuses an archive the caller cannot read', async () => {
    await seed({ USER_VOLUMES: 'true' });
    await fs.writeFile(path.join(currentEnv.volumeDir, 'Work', 'a.zip'), 'PK');

    const response = await request(buildApp(RESTRICTED))
      .post('/api/files/zip/extract')
      .send({ path: 'Work/a.zip' });

    expect(response.status).toBe(403);
  });
});
