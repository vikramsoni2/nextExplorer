import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { setupTestEnv, createTestApp } from '../helpers/env-test-utils.js';

const ROUTE_MODULES = [
  'src/routes/folderSize',
  'src/services/accessManager',
  'src/services/folderSizeIndex',
  'src/services/folderSizeIndexer',
  'src/services/folderSizeManager',
  'src/utils/pathUtils',
];

/**
 * Build the folder-size route test context: temp volume, a populated index and
 * a mounted router. `userVolumes` toggles USER_VOLUMES so a non-admin user with
 * no assigned volume is denied navigation (exercising the "size even when you
 * cannot enter" requirement).
 */
const buildContext = async ({ user, userVolumes = false, folderSizeMode = 'full' } = {}) => {
  const env = await setupTestEnv({
    tag: 'folder-size-route-',
    modules: ROUTE_MODULES,
    env: {
      FOLDER_SIZE_MODE: folderSizeMode,
      USER_VOLUMES: userVolumes ? 'true' : 'false',
    },
  });

  const { getDb } = env.requireFresh('src/services/db');
  const folderSizeIndex = env.requireFresh('src/services/folderSizeIndex');
  const indexer = env.requireFresh('src/services/folderSizeIndexer');
  const manager = env.requireFresh('src/services/folderSizeManager');
  const routes = env.requireFresh('src/routes/folderSize');

  const db = await getDb();
  const scope = { root: env.volumeDir, label: 'volume' };

  const app = createTestApp({ router: routes, mountPath: '/api', user });
  return { env, db, folderSizeIndex, indexer, manager, scope, app };
};

describe('Folder size route', () => {
  let ctx;

  afterEach(async () => {
    if (ctx) {
      await ctx.manager.stop();
      await ctx.env.cleanup();
      ctx = null;
    }
  });

  it('returns sizeBytes even when the user cannot enter the folder', async () => {
    ctx = await buildContext({
      user: { id: 'restricted-user', roles: [] },
      userVolumes: true,
    });
    const { env, db, indexer, scope } = ctx;

    await fs.mkdir(path.join(env.volumeDir, 'TestVol', 'inner'), { recursive: true });
    await fs.writeFile(path.join(env.volumeDir, 'TestVol', 'inner', 'file'), Buffer.alloc(4096));
    await indexer.runBaseline(db, scope, { mode: 'full' });

    const response = await request(ctx.app).get('/api/folder-size/TestVol');

    expect(response.status).toBe(200);
    // USER_VOLUMES is on and this user has no assigned volume -> navigation denied
    expect(response.body.canEnter).toBe(false);
    // ...but the size is still reported (the non-negotiable requirement).
    expect(response.body.indexed).toBe(true);
    expect(response.body.sizeBytes).toBe(4096);
    expect(response.body.entryCount).toBe(1);
  });

  it('returns indexed:false without error when the path is not indexed', async () => {
    ctx = await buildContext({ user: { id: 'admin-user', roles: ['admin'] } });
    await fs.mkdir(path.join(ctx.env.volumeDir, 'Unindexed'), { recursive: true });
    // Deliberately no baseline run: the index is empty.

    const response = await request(ctx.app).get('/api/folder-size/Unindexed');

    expect(response.status).toBe(200);
    expect(response.body.indexed).toBe(false);
    expect(response.body.sizeBytes).toBeNull();
    expect(response.body.entryCount).toBeNull();
  });

  it('returns a result per path from the batch endpoint', async () => {
    ctx = await buildContext({ user: { id: 'admin-user', roles: ['admin'] } });
    const { env, db, indexer, scope } = ctx;

    await fs.mkdir(path.join(env.volumeDir, 'A', 'B'), { recursive: true });
    await fs.writeFile(path.join(env.volumeDir, 'A', 'B', 'f1'), Buffer.alloc(100));
    await fs.writeFile(path.join(env.volumeDir, 'A', 'f2'), Buffer.alloc(50));
    await indexer.runBaseline(db, scope, { mode: 'full' });

    const response = await request(ctx.app)
      .post('/api/folder-size/batch')
      .send({ paths: ['A', 'A/B', 'DoesNotExist'] });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.results)).toBe(true);
    expect(response.body.results).toHaveLength(3);

    const byPath = Object.fromEntries(response.body.results.map((r) => [r.path, r]));
    expect(byPath['A'].sizeBytes).toBe(150);
    expect(byPath['A'].indexed).toBe(true);
    expect(byPath['A/B'].sizeBytes).toBe(100);
    expect(byPath['DoesNotExist'].indexed).toBe(false);
    expect(byPath['DoesNotExist'].sizeBytes).toBeNull();
  });

  it('reports the authoritative scan timestamp after a pending transfer completes', async () => {
    ctx = await buildContext({ user: { id: 'admin-user', roles: ['admin'] } });
    const { env, db, folderSizeIndex, scope } = ctx;
    const target = path.join(env.volumeDir, 'Transferred');
    await fs.mkdir(target, { recursive: true });

    folderSizeIndex.upsertPendingDirectoryEntry(db, scope, {
      absolutePath: target,
      sizeBytes: 0,
      entryCount: 0,
    });
    folderSizeIndex.upsertScanEntry(db, scope, {
      absolutePath: target,
      sizeBytes: 123,
      entryCount: 1,
      lastFullScanAt: '2099-01-01T00:00:00.000Z',
    });

    const response = await request(ctx.app).get('/api/folder-size/Transferred');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ sizeBytes: 123, dirty: false });
    expect(response.body.lastUpdated).toBe('2099-01-01T00:00:00.000Z');
  });

  it('never triggers a synchronous scan (unindexed folder with real content stays null)', async () => {
    ctx = await buildContext({ user: { id: 'admin-user', roles: ['admin'] } });

    // A folder that physically contains data but was never indexed must report
    // null/false, proving the route does not fall back to a live traversal.
    await fs.mkdir(path.join(ctx.env.volumeDir, 'Heavy'), { recursive: true });
    await fs.writeFile(path.join(ctx.env.volumeDir, 'Heavy', 'big'), Buffer.alloc(123456));

    const response = await request(ctx.app).get('/api/folder-size/Heavy');

    expect(response.status).toBe(200);
    expect(response.body.indexed).toBe(false);
    expect(response.body.sizeBytes).toBeNull();
  });

  it('repairs a selected external directory tree through the explicit refresh endpoint', async () => {
    ctx = await buildContext({ user: { id: 'admin-user', roles: ['admin'] } });
    const { env, manager } = ctx;
    await manager.start();

    const external = path.join(env.volumeDir, 'External', 'nested');
    await fs.mkdir(external, { recursive: true });
    await fs.writeFile(path.join(external, 'payload.bin'), Buffer.alloc(321));

    const response = await request(ctx.app).post('/api/folder-size/refresh/External');

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      path: 'External',
      refreshPending: true,
    });
  });

  it('does not resolve paths or expose the index endpoints when disabled', async () => {
    ctx = await buildContext({
      user: { id: 'admin-user', roles: ['admin'] },
      folderSizeMode: 'off',
    });

    const [single, batch, refresh] = await Promise.all([
      request(ctx.app).get('/api/folder-size/anything'),
      request(ctx.app)
        .post('/api/folder-size/batch')
        .send({ paths: ['anything'] }),
      request(ctx.app).post('/api/folder-size/refresh/anything'),
    ]);

    expect(single.status).toBe(404);
    expect(batch.status).toBe(404);
    expect(refresh.status).toBe(404);
    expect(ctx.manager.getDiagnosticsSnapshot()).toMatchObject({
      running: false,
      starting: false,
      dirtyDirectories: 0,
      pendingSubtreeScans: 0,
    });
  });
});
