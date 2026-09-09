import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { flushPromises } from '@vue/test-utils';
import MediaPreview from './MediaPreview.vue';

/**
 * Saying what a video holds, and offering the subtitles it holds.
 *
 * The player does not transcode, so a soundtrack the browser cannot decode
 * simply produces nothing — reported from production as several films playing
 * in silence with nothing on screen to explain it. These cover the two halves
 * of the answer: the sentence that explains the silence, and the caption tracks
 * that the browser's own controls then offer.
 */

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      mediaPreview: {
        download: 'Download media',
        close: 'Close preview',
        previous: 'Previous media',
        next: 'Next media',
        noPlayableAudio: 'Soundtrack is {codecs}, which your browser cannot decode.',
        noPlayableVideo: 'This video is {codecs}; play it in a media player.',
        audioTrack: 'Audio track',
        audioTrackNumbered: 'Track {number}',
        subtitleForced: 'forced',
        subtitleExternal: 'external file',
      },
    },
  },
});

const media = [
  { name: 'clip.mp4', kind: 'mp4', path: 'Test' },
  { name: 'other.mkv', kind: 'mkv', path: 'Test' },
  { name: 'photo.jpg', kind: 'jpg', path: 'Test' },
];

const tracksWith = (overrides = {}) => ({
  available: true,
  video: [{ index: 0, codec: 'h264', label: 'Track 1', playable: true }],
  audio: [],
  subtitles: [],
  hasAudio: false,
  hasPlayableAudio: false,
  ...overrides,
});

const AC3 = { index: 1, codec: 'ac3', language: 'fr', title: null, label: 'fr', playable: false };
const AAC = { index: 2, codec: 'aac', language: 'en', title: null, label: 'en', playable: true };

const subtitle = (overrides = {}) => ({
  index: 3,
  codec: 'subrip',
  language: 'fr',
  title: null,
  label: 'fr',
  isDefault: false,
  forced: false,
  source: 'embedded',
  convertible: true,
  ...overrides,
});

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const mountWith = async (tracks, item = media[0]) => {
  const getMediaTracks = vi.fn().mockResolvedValue(tracks);
  const api = {
    close: vi.fn(),
    download: vi.fn(),
    getPreviewUrl: (target) => `/api/preview/${target.name}`,
    getSiblings: () => media,
    getMediaTracks,
    getSubtitleUrl: (target, track) =>
      `/api/media/subtitle?path=${target.name}&${track.file ? `file=${track.file}` : `stream=${track.stream}`}`,
  };

  const wrapper = mount(MediaPreview, {
    props: {
      item,
      extension: item.kind,
      filePath: `${item.path}/${item.name}`,
      previewUrl: api.getPreviewUrl(item),
      api,
    },
    global: { plugins: [i18n] },
  });

  await flushPromises();
  return { wrapper, api, getMediaTracks };
};

describe('explaining a silent video', () => {
  it('says so when the only soundtrack is one the browser cannot decode', async () => {
    const { wrapper } = await mountWith(
      tracksWith({ audio: [AC3], hasAudio: true, hasPlayableAudio: false })
    );

    expect(wrapper.text()).toContain('cannot decode');
  });

  it('names the codec, so the message says something actionable', async () => {
    const { wrapper } = await mountWith(
      tracksWith({ audio: [AC3], hasAudio: true, hasPlayableAudio: false })
    );

    expect(wrapper.text()).toContain('AC3');
  });

  it('stays quiet when a soundtrack can be played', async () => {
    const { wrapper } = await mountWith(
      tracksWith({ audio: [AC3, AAC], hasAudio: true, hasPlayableAudio: true })
    );

    expect(wrapper.text()).not.toContain('cannot decode');
  });

  /** A video with no soundtrack is not broken, and saying so would be noise. */
  it('stays quiet about a video with no soundtrack at all', async () => {
    const { wrapper } = await mountWith(tracksWith({ hasAudio: false }));

    expect(wrapper.text()).not.toContain('cannot decode');
  });

  it('says nothing when the server could not read the file', async () => {
    const { wrapper } = await mountWith(null);

    expect(wrapper.text()).not.toContain('cannot decode');
  });

  /**
   * It answers a question asked in the first seconds and has no business
   * sitting over a film for two hours.
   */
  it('gets out of the way after a while', async () => {
    vi.useFakeTimers();
    const { wrapper } = await mountWith(
      tracksWith({ audio: [AC3], hasAudio: true, hasPlayableAudio: false })
    );
    expect(wrapper.text()).toContain('cannot decode');

    vi.advanceTimersByTime(11000);
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain('cannot decode');
  });

  /** Nothing to explain about a picture, so nothing is asked. */
  it('does not ask about an image', async () => {
    const { getMediaTracks } = await mountWith(tracksWith(), media[2]);

    expect(getMediaTracks).not.toHaveBeenCalled();
  });
});

describe('explaining a video that will not play at all', () => {
  const HEVC = { index: 0, codec: 'hevc', label: 'Track 1', playable: false };

  /**
   * The case the production log showed: an `x265.10bit.HEVC.mkv`, which a
   * browser plays only from an MP4, only with hardware support, and never in
   * ten bits — so it shows nothing whatever.
   */
  it('says the picture is one the browser cannot decode', async () => {
    const { wrapper } = await mountWith(tracksWith({ video: [HEVC] }));

    expect(wrapper.text()).toContain('play it in a media player');
  });

  it('names the video codec', async () => {
    const { wrapper } = await mountWith(tracksWith({ video: [HEVC] }));

    expect(wrapper.text()).toContain('HEVC');
  });

  /** Nothing is playing, so a remark about the soundtrack is beside the point. */
  it('says that instead of talking about the sound', async () => {
    const { wrapper } = await mountWith(
      tracksWith({ video: [HEVC], audio: [AC3], hasAudio: true, hasPlayableAudio: false })
    );

    expect(wrapper.text()).not.toContain('Soundtrack is');
  });

  it('stays quiet about a video the browser can decode', async () => {
    const { wrapper } = await mountWith(tracksWith());

    expect(wrapper.text()).not.toContain('play it in a media player');
  });
});

describe('offering subtitles', () => {
  const trackElements = (wrapper) => wrapper.findAll('track');

  it('declares a track element for a subtitle in the file', async () => {
    const { wrapper } = await mountWith(tracksWith({ subtitles: [subtitle()] }));

    expect(trackElements(wrapper)).toHaveLength(1);
  });

  it('points it at the endpoint that converts that stream', async () => {
    const { wrapper } = await mountWith(tracksWith({ subtitles: [subtitle({ index: 3 })] }));

    expect(trackElements(wrapper)[0].attributes('src')).toContain('stream=3');
  });

  it('points a sidecar at the endpoint by filename', async () => {
    const { wrapper } = await mountWith(
      tracksWith({
        subtitles: [subtitle({ index: null, source: 'sidecar', fileName: 'clip.fr.srt' })],
      })
    );

    expect(trackElements(wrapper)[0].attributes('src')).toContain('file=clip.fr.srt');
  });

  it('declares the language, so the browser can label the menu', async () => {
    const { wrapper } = await mountWith(tracksWith({ subtitles: [subtitle({ language: 'fr' })] }));

    expect(trackElements(wrapper)[0].attributes('srclang')).toBe('fr');
  });

  /** A code is not a name; a caption menu should read as words. */
  it('names the language rather than showing its tag', async () => {
    const { wrapper } = await mountWith(tracksWith({ subtitles: [subtitle({ language: 'fr' })] }));

    expect(trackElements(wrapper)[0].attributes('label')).toContain('French');
  });

  /**
   * A file beside the video and a track inside it can carry the same language,
   * and a menu offering "French" twice makes the choice a guess.
   */
  it('says which of two same-language tracks came from a separate file', async () => {
    const { wrapper } = await mountWith(
      tracksWith({
        subtitles: [
          subtitle({ index: null, source: 'sidecar', fileName: 'clip.fr.srt' }),
          subtitle({ index: 3 }),
        ],
      })
    );

    const labels = trackElements(wrapper).map((track) => track.attributes('label'));
    expect(labels.filter((label) => label.includes('external file'))).toHaveLength(1);
  });

  it('marks a forced track as forced', async () => {
    const { wrapper } = await mountWith(tracksWith({ subtitles: [subtitle({ forced: true })] }));

    expect(trackElements(wrapper)[0].attributes('label')).toContain('forced');
  });

  /**
   * A Blu-ray subtitle is a picture of words. Offering it as a caption track
   * would produce a menu entry that shows nothing when chosen.
   */
  it('leaves out an image-based subtitle it cannot convert', async () => {
    const { wrapper } = await mountWith(
      tracksWith({
        subtitles: [subtitle({ codec: 'hdmv_pgs_subtitle', convertible: false })],
      })
    );

    expect(trackElements(wrapper)).toHaveLength(0);
  });

  it('declares no tracks when the file has none', async () => {
    const { wrapper } = await mountWith(tracksWith());

    expect(trackElements(wrapper)).toHaveLength(0);
  });
});
