const path = require('path');
const fs = require('fs/promises');

const ffmpegRunner = require('./ffmpegRunner');

/**
 * What is inside a video, and which of it a browser can actually use.
 *
 * NextExplorer plays media by handing the file to a `<video>` element, which is
 * a deliberate limit: transcoding belongs to a media server, not to a file
 * explorer. But that limit is invisible from the outside. A Matroska file with
 * an AC-3 soundtrack plays perfectly with no sound at all, and nothing on
 * screen says why — the person is left to conclude the file is broken, or that
 * we are.
 *
 * So this reads what the container holds and says which parts a browser will
 * refuse, which turns silence into a sentence.
 */

/**
 * Audio codecs a browser will decode.
 *
 * The absentees are the point: AC-3, E-AC-3, DTS and TrueHD are what a film in
 * a Matroska container almost always carries, and neither Chrome nor Firefox
 * will decode any of them — a licensing decision, not a technical one. Safari
 * on macOS does decode AC-3, which is why this is reported rather than asserted
 * as a flat failure.
 */
const BROWSER_AUDIO_CODECS = new Set([
  'aac',
  'mp3',
  'opus',
  'vorbis',
  'flac',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_u8',
  'pcm_f32le',
]);

/** Video codecs a browser will decode, give or take the profile. */
const BROWSER_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora']);

/**
 * Subtitle codecs that are text and can therefore become WebVTT.
 *
 * The others — `hdmv_pgs_subtitle` from a Blu-ray, `dvd_subtitle` from a DVD —
 * are pictures of words. Converting them needs OCR, which is a different
 * project, so they are listed and marked rather than silently dropped: a person
 * looking for the subtitles they know are in the file deserves to be told why
 * they are not on offer.
 */
const TEXT_SUBTITLE_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);

/** Sidecar subtitle files sitting next to the video. */
const SIDECAR_EXTENSIONS = ['srt', 'vtt', 'ass', 'ssa'];

const streamsOfType = (data, type) =>
  (data?.streams || []).filter((stream) => stream?.codec_type === type);

const cleanTag = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.toLowerCase() !== 'und' ? text : '';
};

/**
 * A language tag a browser will accept.
 *
 * Media containers write ISO 639-2 — `fre`, `ger`, `dut` — while `<track
 * srclang>` wants BCP 47, where those are `fr`, `de`, `nl`. Worse, 639-2 has
 * two codes for several languages (`fre` and `fra` are both French) depending
 * on whether the file was tagged from the bibliographic or the terminological
 * list, so a caption menu would show the same language twice.
 *
 * `Intl.getCanonicalLocales` already knows all of this, from ICU's own tables —
 * a hand-written map would be a worse copy of it. Anything it refuses is
 * returned as-is, since an unrecognised tag is still better than none.
 */
const normaliseLanguage = (value) => {
  const text = cleanTag(value);
  if (!text) return null;
  try {
    const [canonical] = Intl.getCanonicalLocales(text.replace(/_/g, '-'));
    return canonical && canonical !== 'und' ? canonical : null;
  } catch (_) {
    return text;
  }
};

/**
 * A label for a track, from whatever the file was willing to say.
 *
 * Files are inconsistent about this: some name the track, some only tag a
 * language, plenty do neither. Falling back to the position at least tells two
 * tracks apart.
 */
const describeTrack = (stream, position) => {
  const title = cleanTag(stream?.tags?.title);
  const language = normaliseLanguage(stream?.tags?.language);
  if (title && language) return `${title} (${language})`;
  return title || language || `Track ${position + 1}`;
};

const describeAudio = (stream, position) => ({
  index: stream.index,
  codec: stream.codec_name || 'unknown',
  language: normaliseLanguage(stream?.tags?.language),
  title: cleanTag(stream?.tags?.title) || null,
  channels: Number(stream.channels) || null,
  label: describeTrack(stream, position),
  isDefault: stream?.disposition?.default === 1,
  // Whether a browser will make a sound out of it.
  playable: BROWSER_AUDIO_CODECS.has(String(stream.codec_name || '').toLowerCase()),
});

const describeSubtitle = (stream, position) => {
  const codec = String(stream.codec_name || '').toLowerCase();
  return {
    index: stream.index,
    codec: codec || 'unknown',
    language: normaliseLanguage(stream?.tags?.language),
    title: cleanTag(stream?.tags?.title) || null,
    label: describeTrack(stream, position),
    isDefault: stream?.disposition?.default === 1,
    forced: stream?.disposition?.forced === 1,
    source: 'embedded',
    // Image-based subtitles cannot be turned into text without OCR.
    convertible: TEXT_SUBTITLE_CODECS.has(codec),
  };
};

/**
 * Subtitle files sitting beside the video, as people actually name them:
 * `film.srt`, `film.fr.srt`, `film.en.forced.srt`.
 *
 * Read from the directory listing rather than by guessing filenames, so a
 * language tag nobody anticipated still shows up.
 */
const findSidecarSubtitles = async (absolutePath) => {
  const directory = path.dirname(absolutePath);
  const base = path.basename(absolutePath, path.extname(absolutePath)).toLowerCase();

  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (_) {
    return [];
  }

  const ownName = path.basename(absolutePath);
  const found = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Never offer the file as a subtitle for itself.
    if (entry.name === ownName) continue;
    const extension = path.extname(entry.name).slice(1).toLowerCase();
    if (!SIDECAR_EXTENSIONS.includes(extension)) continue;

    const stem = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
    if (stem !== base && !stem.startsWith(`${base}.`)) continue;

    // Whatever sits between the video's name and the extension is how people
    // write the language: `film.fr.srt`, `film.en.forced.srt`.
    const suffix = stem.slice(base.length).replace(/^\./, '');
    const parts = suffix.split('.').filter(Boolean);
    const forced = parts.some((part) => part === 'forced');
    const language = normaliseLanguage(parts.find((part) => part !== 'forced'));

    found.push({
      index: null,
      codec: extension,
      language,
      title: null,
      label: language ? `${language}${forced ? ' (forced)' : ''}` : entry.name,
      isDefault: false,
      forced,
      source: 'sidecar',
      fileName: entry.name,
      convertible: true,
    });
  }

  return found.sort((a, b) => a.label.localeCompare(b.label));
};

/**
 * Everything worth saying about a media file, or null if ffprobe cannot read it.
 *
 * @returns {Promise<{video: object[], audio: object[], subtitles: object[],
 *   hasPlayableAudio: boolean, hasAudio: boolean}|null>}
 */
const readMediaTracks = async (absolutePath) => {
  const data = await ffmpegRunner.probe(absolutePath);
  if (!data) return null;

  const audio = streamsOfType(data, 'audio').map(describeAudio);
  const video = streamsOfType(data, 'video').map((stream, position) => ({
    index: stream.index,
    codec: stream.codec_name || 'unknown',
    label: describeTrack(stream, position),
    playable: BROWSER_VIDEO_CODECS.has(String(stream.codec_name || '').toLowerCase()),
  }));

  const embedded = streamsOfType(data, 'subtitle').map(describeSubtitle);
  const sidecar = await findSidecarSubtitles(absolutePath);

  return {
    video,
    audio,
    subtitles: [...sidecar, ...embedded],
    hasAudio: audio.length > 0,
    // The distinction the player needs: no soundtrack at all is a silent film,
    // a soundtrack no browser can decode is a different sentence entirely.
    hasPlayableAudio: audio.some((track) => track.playable),
  };
};

/**
 * How long a subtitle extraction may take, and how much it may produce.
 *
 * A subtitle track is a few hundred kilobytes of text at most; anything past
 * this is a malformed file or a stream that is not really subtitles, and either
 * way it should not be allowed to hold a connection open or fill memory.
 */
const SUBTITLE_TIMEOUT_MS = 20000;
const SUBTITLE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * One subtitle track, rewritten as WebVTT.
 *
 * WebVTT is the only subtitle format a `<video>` element accepts, so everything
 * — SubRip, SubStation Alpha, the MP4 text track — has to become it. ffmpeg
 * does the conversion in a single pass with no re-encoding of anything else:
 * `-map` picks the one stream, and the rest of the file is never decoded.
 *
 * The result is buffered rather than piped, because it is small and because a
 * conversion that fails halfway is better reported as an error than as a
 * truncated subtitle file the player silently accepts.
 *
 * @param {string} absolutePath file to read the track from — the video for an
 *   embedded track, the sidecar itself for a sidecar
 * @param {{streamIndex?: number|null}} [options] ffprobe stream index to map,
 *   or nothing at all when the whole input is the subtitle
 * @returns {Promise<string>} the WebVTT document
 */
const extractWebVtt = (absolutePath, { streamIndex = null } = {}) =>
  new Promise((resolve, reject) => {
    const args = ['-loglevel', 'error', '-i', absolutePath];
    if (streamIndex !== null && streamIndex !== undefined) {
      args.push('-map', `0:${streamIndex}`);
    }
    args.push('-f', 'webvtt', 'pipe:1');

    let command;
    try {
      command = ffmpegRunner.run(args);
    } catch (error) {
      reject(error);
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;
    let timer = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) {
        try {
          command.kill('SIGKILL');
        } catch (_) {
          // Already gone.
        }
        reject(error);
        return;
      }
      resolve(value);
    };

    timer = setTimeout(
      () => finish(new Error('Subtitle extraction timed out.')),
      SUBTITLE_TIMEOUT_MS
    );

    let stderr = '';
    command.stderr.on('data', (chunk) => {
      // Kept only to explain a failure; a success says nothing here.
      if (stderr.length < 4096) stderr += String(chunk);
    });

    command.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > SUBTITLE_MAX_BYTES) {
        finish(new Error('Subtitle track is implausibly large.'));
        return;
      }
      chunks.push(chunk);
    });

    command.on('error', (error) => finish(error));
    command.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(`FFmpeg exited with ${code}: ${stderr.trim()}`));
        return;
      }
      finish(null, Buffer.concat(chunks).toString('utf8'));
    });
  });

module.exports = {
  readMediaTracks,
  normaliseLanguage,
  findSidecarSubtitles,
  extractWebVtt,
  SUBTITLE_MAX_BYTES,
  BROWSER_AUDIO_CODECS,
  BROWSER_VIDEO_CODECS,
  TEXT_SUBTITLE_CODECS,
  SIDECAR_EXTENSIONS,
};
