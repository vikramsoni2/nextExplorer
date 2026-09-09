import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Reading what is inside a video, against a real one.
 *
 * The complaint this answers was reported from production: several MKVs play
 * with no sound, and the interface says nothing. The server logs named the
 * files, and the filenames named the cause — `DDP5.1`, `AC3.2.0` — soundtracks
 * no browser will decode. Nothing was broken; nothing said so either.
 *
 * A fixture is built here rather than mocked because the whole value of this
 * service is what a container actually reports: ffprobe's field names, the
 * two rival ISO codes for the same language, a disposition flag. A fake would
 * agree with whatever the code expected and prove none of it.
 */

let tracksService;
let fixtureDir;
let hasFfmpeg = false;

const ffmpegAvailable = async () => {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch (_) {
    return false;
  }
};

/**
 * A clip with a French AAC track, an English AC-3 track, and two subtitle
 * streams — the shape of a film downloaded with more than one language.
 *
 * The audio codecs are the point: AAC is decodable everywhere and AC-3 is
 * decodable nowhere but Safari, so one file exercises both answers.
 */
const buildFixture = async (dir) => {
  const frSrt = path.join(dir, 'source-fr.srt');
  const enSrt = path.join(dir, 'source-en.srt');
  await fs.writeFile(frSrt, '1\n00:00:00,500 --> 00:00:02,000\nBonjour le monde\n');
  await fs.writeFile(enSrt, '1\n00:00:00,500 --> 00:00:02,000\nHello world\n');

  const output = path.join(dir, 'film.mkv');
  await execFileAsync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=25:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
    '-i', frSrt,
    '-i', enSrt,
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-map', '4:s',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a:0', 'aac', '-c:a:1', 'ac3', '-c:s', 'srt',
    // `fre` rather than `fra`: both are ISO 639-2 for French, and a container
    // may carry either. A caption menu that shows them as two languages is the
    // bug this tag exists to catch.
    '-metadata:s:a:0', 'language=fre', '-metadata:s:a:0', 'title=VF',
    '-metadata:s:a:1', 'language=eng',
    '-metadata:s:s:0', 'language=fre',
    '-metadata:s:s:1', 'language=eng',
    output,
  ]);
  return output;
};

beforeAll(async () => {
  hasFfmpeg = await ffmpegAvailable();
  if (!hasFfmpeg) return;
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-tracks-'));
  await buildFixture(fixtureDir);
  tracksService = require('../../src/services/mediaTracks');
}, 60000);

afterEach(async () => {
  if (!fixtureDir) return;
  // Sidecars are created per test; the film stays.
  const entries = await fs.readdir(fixtureDir);
  await Promise.all(
    entries
      .filter((name) => name.startsWith('film.') && name !== 'film.mkv')
      .map((name) => fs.rm(path.join(fixtureDir, name), { force: true }))
  );
});

const filmPath = () => path.join(fixtureDir, 'film.mkv');
const read = () => tracksService.readMediaTracks(filmPath());

describe.skipIf(!(await ffmpegAvailable()))('the tracks inside a video', () => {
  it('finds both soundtracks', async () => {
    const tracks = await read();

    expect(tracks.audio).toHaveLength(2);
  });

  it('says the AAC one can be played', async () => {
    const tracks = await read();

    expect(tracks.audio.find((track) => track.codec === 'aac').playable).toBe(true);
  });

  /** The reported defect, in one assertion. */
  it('says the AC-3 one cannot', async () => {
    const tracks = await read();

    expect(tracks.audio.find((track) => track.codec === 'ac3').playable).toBe(false);
  });

  it('carries the title the file gave the track', async () => {
    const tracks = await read();

    expect(tracks.audio[0].title).toBe('VF');
  });

  it('reports the channel count', async () => {
    const tracks = await read();

    expect(tracks.audio[0].channels).toBe(1);
  });

  it('finds the video stream and calls H.264 playable', async () => {
    const tracks = await read();

    expect(tracks.video).toEqual([expect.objectContaining({ codec: 'h264', playable: true })]);
  });

  it('finds both embedded subtitle streams', async () => {
    const tracks = await read();

    expect(tracks.subtitles.filter((track) => track.source === 'embedded')).toHaveLength(2);
  });

  it('marks a text subtitle as convertible', async () => {
    const tracks = await read();

    expect(tracks.subtitles.every((track) => track.convertible)).toBe(true);
  });
});

describe.skipIf(!(await ffmpegAvailable()))('what the player is told about sound', () => {
  it('reports a playable soundtrack when one exists', async () => {
    const tracks = await read();

    expect(tracks.hasPlayableAudio).toBe(true);
  });

  /**
   * The whole reason this service exists: audio present, none of it decodable.
   * Without the distinction the interface cannot tell a silent film from one
   * the browser is refusing to play.
   */
  it('separates having audio from being able to play it', async () => {
    const acThree = path.join(fixtureDir, 'ac3-only.mkv');
    await execFileAsync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=25:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'ac3',
      acThree,
    ]);

    const tracks = await tracksService.readMediaTracks(acThree);

    expect(tracks.hasAudio).toBe(true);
    expect(tracks.hasPlayableAudio).toBe(false);
  });

  it('reports no audio at all for a video without any', async () => {
    const silent = path.join(fixtureDir, 'silent.mkv');
    await execFileAsync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=25:duration=2',
      '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
      silent,
    ]);

    const tracks = await tracksService.readMediaTracks(silent);

    expect(tracks.hasAudio).toBe(false);
  });
});

describe.skipIf(!(await ffmpegAvailable()))('language tags', () => {
  /**
   * A container writes ISO 639-2 and a `<track srclang>` wants BCP 47. `fre`
   * is not a tag a browser understands, and a caption menu built from it
   * labels nothing.
   */
  it('turns the container ISO 639-2 code into the two-letter one', async () => {
    const tracks = await read();

    expect(tracks.audio.map((track) => track.language)).toEqual(['fr', 'en']);
  });

  it('gives a sidecar and an embedded track the same tag for the same language', async () => {
    await fs.copyFile(path.join(fixtureDir, 'source-fr.srt'), path.join(fixtureDir, 'film.fr.srt'));

    const tracks = await read();
    const sidecar = tracks.subtitles.find((track) => track.source === 'sidecar');
    const embedded = tracks.subtitles.find((track) => track.language === 'fr' && track.index !== null);

    expect(sidecar.language).toBe(embedded.language);
  });

  it('leaves an untagged track without a language rather than inventing one', async () => {
    const untagged = path.join(fixtureDir, 'untagged.mkv');
    await execFileAsync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=25:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
      untagged,
    ]);

    const tracks = await tracksService.readMediaTracks(untagged);

    expect(tracks.audio[0].language).toBeNull();
  });
});

describe.skipIf(!(await ffmpegAvailable()))('subtitle files next to the video', () => {
  it('finds one named after the film', async () => {
    await fs.copyFile(path.join(fixtureDir, 'source-fr.srt'), path.join(fixtureDir, 'film.srt'));

    const found = await tracksService.findSidecarSubtitles(filmPath());

    expect(found.map((track) => track.fileName)).toEqual(['film.srt']);
  });

  it('reads the language out of the name', async () => {
    await fs.copyFile(path.join(fixtureDir, 'source-fr.srt'), path.join(fixtureDir, 'film.fr.srt'));

    const [found] = await tracksService.findSidecarSubtitles(filmPath());

    expect(found.language).toBe('fr');
  });

  it('reads a forced marker out of the name too', async () => {
    await fs.copyFile(
      path.join(fixtureDir, 'source-en.srt'),
      path.join(fixtureDir, 'film.en.forced.srt')
    );

    const [found] = await tracksService.findSidecarSubtitles(filmPath());

    expect(found).toMatchObject({ language: 'en', forced: true });
  });

  it('ignores a subtitle belonging to a different film', async () => {
    await fs.copyFile(
      path.join(fixtureDir, 'source-fr.srt'),
      path.join(fixtureDir, 'other-film.fr.srt')
    );

    const found = await tracksService.findSidecarSubtitles(filmPath());

    expect(found).toEqual([]);
  });

  it('ignores a file that is not a subtitle', async () => {
    await fs.writeFile(path.join(fixtureDir, 'film.nfo'), 'release notes');

    const found = await tracksService.findSidecarSubtitles(filmPath());

    expect(found).toEqual([]);
  });

  it('returns nothing rather than failing when the folder cannot be read', async () => {
    const found = await tracksService.findSidecarSubtitles('/nonexistent/place/film.mkv');

    expect(found).toEqual([]);
  });
});

describe.skipIf(!(await ffmpegAvailable()))('converting a subtitle to WebVTT', () => {
  const vttFrom = (options) => tracksService.extractWebVtt(filmPath(), options);

  it('produces a WebVTT document', async () => {
    const vtt = await vttFrom({ streamIndex: 3 });

    expect(vtt.startsWith('WEBVTT')).toBe(true);
  });

  it('carries the text of the track it was asked for', async () => {
    const vtt = await vttFrom({ streamIndex: 3 });

    expect(vtt).toContain('Bonjour le monde');
  });

  it('takes the other track when asked for the other track', async () => {
    const vtt = await vttFrom({ streamIndex: 4 });

    expect(vtt).toContain('Hello world');
    expect(vtt).not.toContain('Bonjour');
  });

  /** Accents survive the round trip, which a byte-level pipe would not promise. */
  it('keeps non-ASCII text intact', async () => {
    const accented = path.join(fixtureDir, 'film.es.srt');
    await fs.writeFile(accented, '1\n00:00:00,500 --> 00:00:02,000\nEl niño está aquí\n');

    const vtt = await tracksService.extractWebVtt(accented);

    expect(vtt).toContain('El niño está aquí');
  });

  it('converts a whole sidecar file when given no stream', async () => {
    const sidecar = path.join(fixtureDir, 'film.en.srt');
    await fs.copyFile(path.join(fixtureDir, 'source-en.srt'), sidecar);

    const vtt = await tracksService.extractWebVtt(sidecar);

    expect(vtt).toContain('Hello world');
  });

  it('fails rather than returning an empty file when the stream is not there', async () => {
    await expect(vttFrom({ streamIndex: 99 })).rejects.toThrow();
  });
});
