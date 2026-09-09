import { ref, computed, watch } from 'vue';

/**
 * What a media file contains, and what this browser will do with it.
 *
 * The player hands files to a `<video>` element and never transcodes — that is
 * a media server's job. The consequence is invisible from the outside: a film
 * whose only soundtrack is AC-3 plays perfectly, in silence, and nothing says
 * why. This asks the server what is in the file so the interface can say it.
 *
 * @param {import('vue').Ref} media the media item currently on screen
 * @param {object} api the preview plugin API
 * @param {import('vue').Ref<boolean>} enabled whether this item is a video at all
 */
export function useMediaTracks(media, api, enabled) {
  const tracks = ref(null);

  // Responses can arrive after the person has moved to the next video. Each
  // request carries the key it was made for, and a stale one is dropped rather
  // than shown against the wrong file.
  let pending = null;

  const load = async (current) => {
    tracks.value = null;
    if (!current || !enabled.value || typeof api.getMediaTracks !== 'function') return;

    const token = current.key;
    pending = token;
    let result = null;
    try {
      result = await api.getMediaTracks(current.item);
    } catch (_) {
      result = null;
    }
    if (pending !== token) return;
    tracks.value = result?.available ? result : null;
  };

  watch(media, (current) => load(current), { immediate: true });

  /**
   * The subtitle tracks a `<track>` element can actually show.
   *
   * Image-based subtitles — a Blu-ray's PGS, a DVD's VobSub — are pictures of
   * words and would need OCR, so they are dropped here rather than offered as
   * captions that never appear.
   */
  const subtitleTracks = computed(() => {
    const list = tracks.value?.subtitles || [];
    return list
      .filter((track) => track.convertible)
      .map((track) => ({
        ...track,
        url: api.getSubtitleUrl?.(media.value?.item, {
          stream: track.source === 'embedded' ? track.index : undefined,
          file: track.source === 'sidecar' ? track.fileName : undefined,
        }),
      }))
      .filter((track) => track.url);
  });

  const audioTracks = computed(() => tracks.value?.audio || []);

  /**
   * The picture itself is one this browser will not decode.
   *
   * HEVC is the case that matters: a browser plays it only from an MP4, only
   * with hardware support, and never in ten-bit — so an `x265.10bit.HEVC.mkv`
   * shows nothing at all. That is a different sentence from a silent film and
   * it takes precedence over it, because there is no point explaining the
   * sound of something that is not playing.
   */
  const hasUnplayableVideo = computed(() => {
    const streams = tracks.value?.video || [];
    return streams.length > 0 && !streams.some((stream) => stream.playable);
  });

  const unplayableVideoCodecs = computed(() => [
    ...new Set((tracks.value?.video || []).map((stream) => stream.codec)),
  ]);

  /** Soundtracks exist, and this browser can decode none of them. */
  const hasUnplayableAudio = computed(
    () => Boolean(tracks.value) && tracks.value.hasAudio && !tracks.value.hasPlayableAudio
  );

  /** The codecs to name in that message, each once. */
  const unplayableCodecs = computed(() => [
    ...new Set(audioTracks.value.filter((track) => !track.playable).map((track) => track.codec)),
  ]);

  return {
    tracks,
    subtitleTracks,
    audioTracks,
    hasUnplayableAudio,
    unplayableCodecs,
    hasUnplayableVideo,
    unplayableVideoCodecs,
  };
}

/**
 * A language's name in the reader's own language.
 *
 * The file says `fr`; a caption menu should say "français" to a French reader
 * and "French" to an English one. `Intl.DisplayNames` does exactly this, and
 * anything it cannot name falls back to the tag itself, which is still more
 * use than nothing.
 */
export function languageName(tag, locale) {
  if (!tag) return '';
  try {
    return new Intl.DisplayNames([locale || 'en'], { type: 'language' }).of(tag) || tag;
  } catch (_) {
    return tag;
  }
}
