import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import AdmZip from 'adm-zip';
import { setupTestEnv, clearModuleCache } from '../helpers/env-test-utils.js';

let envContext;

beforeAll(async () => {
  envContext = await setupTestEnv({
    tag: 'archive-extract-test-',
    modules: [
      'src/services/db',
      'src/services/users',
      'src/services/archiveService',
      'src/utils/pathUtils',
      'src/middleware/errorHandler',
      'src/routes/zip',
    ],
  });
});

afterAll(async () => {
  await envContext.cleanup();
});

const buildApp = ({ user } = {}) => {
  if (!envContext) throw new Error('Test environment not initialized');

  clearModuleCache('src/config/env');
  clearModuleCache('src/config/index');

  const zipRoutes = envContext.requireFresh('src/routes/zip');
  const { errorHandler } = envContext.requireFresh('src/middleware/errorHandler');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use('/api', zipRoutes);
  app.use(errorHandler);
  return app;
};

const adminUser = { id: 'admin', roles: ['admin'] };

// The extract endpoint streams NDJSON events (start/progress/done/error).
const parseNdjson = (text) =>
  String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

describe('Archive extraction', () => {
  it('extracts a zip archive into a sibling folder, streaming its status', async () => {
    const workDir = path.join(envContext.volumeDir, 'archives');
    await fs.mkdir(workDir, { recursive: true });

    const zip = new AdmZip();
    zip.addFile('hello.txt', Buffer.from('hello archive'));
    zip.addFile('nested/deep.txt', Buffer.from('nested content'));
    zip.writeZip(path.join(workDir, 'sample.zip'));

    const app = buildApp({ user: adminUser });
    const response = await request(app)
      .post('/api/files/zip/extract')
      .send({ path: 'archives/sample.zip' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');

    const events = parseNdjson(response.text);
    expect(events[0]).toMatchObject({ type: 'start', name: 'sample' });
    const done = events.at(-1);
    expect(done.type).toBe('done');
    expect(done.item?.name).toBe('sample');
    expect(done.item?.kind).toBe('directory');

    const extractedRoot = path.join(workDir, 'sample');
    expect(await fs.readFile(path.join(extractedRoot, 'hello.txt'), 'utf8')).toBe('hello archive');
    expect(await fs.readFile(path.join(extractedRoot, 'nested', 'deep.txt'), 'utf8')).toBe(
      'nested content'
    );
  });

  it('extracts root entries directly into the current folder on request', async () => {
    const workDir = path.join(envContext.volumeDir, 'archives-current');
    await fs.mkdir(workDir, { recursive: true });

    const zip = new AdmZip();
    zip.addFile('hello.txt', Buffer.from('hello archive'));
    zip.addFile('nested/deep.txt', Buffer.from('nested content'));
    zip.writeZip(path.join(workDir, 'sample.zip'));

    const app = buildApp({ user: adminUser });
    const response = await request(app)
      .post('/api/files/zip/extract')
      .send({ path: 'archives-current/sample.zip', destination: 'current' });

    expect(response.status).toBe(200);
    const done = parseNdjson(response.text).at(-1);
    expect(done).toMatchObject({ type: 'done', success: true });
    expect(done.item).toBeNull();
    expect(done.items.map((item) => item.name).sort()).toEqual(['hello.txt', 'nested']);
    expect(await fs.readFile(path.join(workDir, 'hello.txt'), 'utf8')).toBe('hello archive');
    expect(await fs.readFile(path.join(workDir, 'nested', 'deep.txt'), 'utf8')).toBe(
      'nested content'
    );
    expect(await fs.readdir(workDir)).not.toContain('sample');
  });

  it('renames conflicting root entries when extracting into the current folder', async () => {
    const workDir = path.join(envContext.volumeDir, 'archives-collision');
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(path.join(workDir, 'report.txt'), 'existing file');

    const zip = new AdmZip();
    zip.addFile('report.txt', Buffer.from('archive file'));
    zip.writeZip(path.join(workDir, 'sample.zip'));

    const app = buildApp({ user: adminUser });
    const response = await request(app)
      .post('/api/files/zip/extract')
      .send({ path: 'archives-collision/sample.zip', destination: 'current' });

    expect(response.status).toBe(200);
    const done = parseNdjson(response.text).at(-1);
    expect(done.item?.name).toBe('report (1).txt');
    expect(await fs.readFile(path.join(workDir, 'report.txt'), 'utf8')).toBe('existing file');
    expect(await fs.readFile(path.join(workDir, 'report (1).txt'), 'utf8')).toBe('archive file');
  });

  it('rejects formats the local build does not support', async () => {
    const workDir = path.join(envContext.volumeDir, 'archives-bad');
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(path.join(workDir, 'document.docx'), 'not really an archive');

    const app = buildApp({ user: adminUser });
    const response = await request(app)
      .post('/api/files/zip/extract')
      .send({ path: 'archives-bad/document.docx' });

    expect(response.status).toBe(400);
    expect(response.body?.error?.message || response.text).toMatch(/unsupported archive format/i);
  });

  it('compresses a selection into a zip, streaming its status', async () => {
    const workDir = path.join(envContext.volumeDir, 'to-compress');
    await fs.mkdir(path.join(workDir, 'sub'), { recursive: true });
    await fs.writeFile(path.join(workDir, 'a.txt'), 'alpha');
    await fs.writeFile(path.join(workDir, 'sub', 'b.txt'), 'beta');

    const app = buildApp({ user: adminUser });
    const response = await request(app)
      .post('/api/files/zip/compress')
      .send({
        items: [
          { name: 'a.txt', path: 'to-compress' },
          { name: 'sub', path: 'to-compress', kind: 'directory' },
        ],
        destination: 'to-compress',
        name: 'bundle',
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');

    const events = parseNdjson(response.text);
    expect(events[0]).toMatchObject({ type: 'start', name: 'bundle.zip' });
    const done = events.at(-1);
    expect(done.type).toBe('done');
    expect(done.item?.name).toBe('bundle.zip');

    const entries = new AdmZip(path.join(workDir, 'bundle.zip'))
      .getEntries()
      .map((entry) => entry.entryName.replace(/\\/g, '/'));
    expect(entries).toContain('a.txt');
    expect(entries).toContain('sub/b.txt');
  });

  it('reports the supported formats from the 7-Zip probe', async () => {
    const archiveService = envContext.requireFresh('src/services/archiveService');
    const extensions = await archiveService.getSupportedArchiveExtensions();

    expect(Array.isArray(extensions)).toBe(true);
    // zip is always available: either through 7-Zip or the bundled fallback.
    expect(extensions).toContain('zip');
  });

  describe('ARCHIVE_EXTENSIONS configuration', () => {
    const loadConfigWithEnv = (value) => {
      const previous = process.env.ARCHIVE_EXTENSIONS;
      if (value === undefined) delete process.env.ARCHIVE_EXTENSIONS;
      else process.env.ARCHIVE_EXTENSIONS = value;
      clearModuleCache('src/config/env');
      clearModuleCache('src/config/index');
      const config = envContext.requireFresh('src/config/index');
      if (previous === undefined) delete process.env.ARCHIVE_EXTENSIONS;
      else process.env.ARCHIVE_EXTENSIONS = previous;
      return config;
    };

    it('uses the default whitelist when unset', () => {
      const { archives } = loadConfigWithEnv(undefined);
      expect(archives.extensions).toContain('iso');
      expect(archives.extensions).toContain('rar');
      expect(archives.extensions).toContain('zip');
    });

    it('replaces the whitelist with a plain list', () => {
      const { archives } = loadConfigWithEnv('zip, .ISO');
      expect(archives.extensions).toEqual(['zip', 'iso']);
    });

    it('extends the defaults with a leading +', () => {
      const { archives } = loadConfigWithEnv('+udf,squashfs');
      expect(archives.extensions).toContain('udf');
      expect(archives.extensions).toContain('squashfs');
      expect(archives.extensions).toContain('rar');
      expect(archives.extensions).toContain('zip');
    });
  });
});
