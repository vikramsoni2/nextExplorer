import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import request from 'supertest';

import { setupTestEnv } from '../helpers/env-test-utils.js';

const execFileAsync = promisify(execFile);

/**
 * Telling the player what is in a video, and handing it a subtitle.
 *
 * Both endpoints read a file the caller named, so the first thing worth
 * proving is that they read only files the caller is allowed to read, and only
 * subtitles this endpoint itself would have offered. A filename joined onto a
 * directory is how a subtitle parameter becomes a way to read anything on the
 * disk; it is checked against the enumeration instead.
 */

let ctx;

const hasFfmpeg = async () => {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch (_) {
    return false;
  }
};

const buildFilm = async (dir) => {
  const srt = path.join(dir, 'subs.srt');
  await fs.writeFile(srt, '1\n00:00:00,500 --> 00:00:02,000\nBonjour le monde\n');
  await execFileAsync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=25:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-i', srt,
    '-map', '0:v', '-map', '1:a', '-map', '2:s',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'ac3', '-c:s', 'srt',
    '-metadata:s:a:0', 'language=fre',
    path.join(dir, 'film.mkv'),
  ]);
  await fs.rm(srt);
};

const setup = async () => {
  ctx = await setupTestEnv({
    tag: 'media-route-',
    modules: [
      'src/config/env',
      'src/config/index',
      'src/services/ffmpegRunner',
      'src/services/mediaTracks',
      'src/routes/files/media',
      'src/middleware/errorHandler',
    ],
  });

  await buildFilm(ctx.volumeDir);
  await fs.writeFile(path.join(ctx.volumeDir, 'notes.txt'), 'not a film');

  const routes = ctx.requireFresh('src/routes/files/media');
  const { errorHandler } = ctx.requireFresh('src/middleware/errorHandler');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'owner', roles: ['admin'] };
    next();
  });
  app.use('/api', routes);
  app.use(errorHandler);
  return app;
};

afterEach(async () => {
  if (ctx) {
    await ctx.cleanup();
    ctx = null;
  }
});

const tracksOf = (app, file = 'film.mkv') =>
  request(app).get('/api/media/tracks').query({ path: file });

describe.skipIf(!(await hasFfmpeg()))('asking what is in a video', () => {
  it('answers', async () => {
    const response = await tracksOf(await setup());

    expect(response.status).toBe(200);
  });

  it('names the soundtrack it found', async () => {
    const response = await tracksOf(await setup());

    expect(response.body.audio).toEqual([expect.objectContaining({ codec: 'ac3', language: 'fr' })]);
  });

  /** The reported symptom: sound present, browser silent. */
  it('says the browser will not be able to play it', async () => {
    const response = await tracksOf(await setup());

    expect(response.body).toMatchObject({ hasAudio: true, hasPlayableAudio: false });
  });

  it('lists the subtitle track inside the file', async () => {
    const response = await tracksOf(await setup());

    expect(response.body.subtitles).toHaveLength(1);
  });

  it('refuses a path that is not a media file', async () => {
    const response = await tracksOf(await setup(), 'notes.txt');

    expect(response.status).toBe(415);
  });

  it('refuses a request with no path at all', async () => {
    const response = await request(await setup()).get('/api/media/tracks');

    expect(response.status).toBe(400);
  });

  /** The volume root is a boundary, not a starting point. */
  it('refuses a path that climbs out of the volume', async () => {
    const response = await tracksOf(await setup(), '../../../etc/passwd');

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe.skipIf(!(await hasFfmpeg()))('asking for a subtitle', () => {
  const subtitle = (app, query) => request(app).get('/api/media/subtitle').query(query);

  it('serves the embedded track as WebVTT', async () => {
    const app = await setup();
    const { body } = await tracksOf(app);
    const embedded = body.subtitles.find((track) => track.source === 'embedded');

    const response = await subtitle(app, { path: 'film.mkv', stream: embedded.index });

    expect(response.status).toBe(200);
    expect(response.text).toContain('WEBVTT');
  });

  it('carries the subtitle text', async () => {
    const app = await setup();
    const { body } = await tracksOf(app);
    const embedded = body.subtitles.find((track) => track.source === 'embedded');

    const response = await subtitle(app, { path: 'film.mkv', stream: embedded.index });

    expect(response.text).toContain('Bonjour le monde');
  });

  /** A video element ignores anything not declared as text/vtt. */
  it('declares itself as WebVTT', async () => {
    const app = await setup();
    const { body } = await tracksOf(app);
    const embedded = body.subtitles.find((track) => track.source === 'embedded');

    const response = await subtitle(app, { path: 'film.mkv', stream: embedded.index });

    expect(response.headers['content-type']).toContain('text/vtt');
  });

  it('serves a sidecar file beside the video', async () => {
    const app = await setup();
    await fs.writeFile(
      path.join(ctx.volumeDir, 'film.fr.srt'),
      '1\n00:00:01,000 --> 00:00:02,000\nDepuis un fichier\n'
    );

    const response = await subtitle(app, { path: 'film.mkv', file: 'film.fr.srt' });

    expect(response.text).toContain('Depuis un fichier');
  });

  it('refuses a stream that is not a subtitle track', async () => {
    const app = await setup();

    const response = await subtitle(app, { path: 'film.mkv', stream: 0 });

    expect(response.status).toBe(404);
  });

  it('refuses a request that names no track', async () => {
    const response = await subtitle(await setup(), { path: 'film.mkv' });

    expect(response.status).toBe(400);
  });

  /**
   * The parameter is a name from our own enumeration, not a path. A file that
   * exists, is readable, and is a real subtitle is still refused when it is not
   * this film's — otherwise the parameter is a way to read any file whose name
   * ends in `.srt`.
   */
  it('refuses a subtitle file belonging to another video', async () => {
    const app = await setup();
    await fs.writeFile(path.join(ctx.volumeDir, 'other.fr.srt'), '1\n00:00:01,000 --> 00:00:02,000\nx\n');

    const response = await subtitle(app, { path: 'film.mkv', file: 'other.fr.srt' });

    expect(response.status).toBe(404);
  });

  it('refuses a filename that tries to climb out of the folder', async () => {
    const app = await setup();

    const response = await subtitle(app, { path: 'film.mkv', file: '../../../etc/passwd' });

    expect(response.status).toBe(404);
  });

  it('refuses a stream index that is not a number', async () => {
    const response = await subtitle(await setup(), { path: 'film.mkv', stream: 'first' });

    expect(response.status).toBe(400);
  });
});
