import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import MediaPreview from './MediaPreview.vue';

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
      },
    },
  },
});

const media = [
  { name: 'first.jpg', kind: 'jpg', path: 'Test' },
  { name: 'clip.mp4', kind: 'mp4', path: 'Test' },
  { name: 'last.png', kind: 'png', path: 'Test' },
];

let pause;

beforeEach(() => {
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const createWrapper = (item = media[0]) => {
  const api = {
    close: vi.fn(),
    download: vi.fn(),
    getPreviewUrl: (target) => `/api/preview/${target.name}`,
    getSiblings: () => media,
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

  return { api, wrapper };
};

const swipe = async (wrapper, startX, startY, endX, endY) => {
  const preview = wrapper.get('[data-test="media-preview"]');
  await preview.trigger('touchstart', {
    changedTouches: [
      {
        clientX: startX,
        clientY: startY,
        identifier: 1,
      },
    ],
  });
  await preview.trigger('touchend', {
    changedTouches: [
      {
        clientX: endX,
        clientY: endY,
        identifier: 1,
      },
    ],
  });
};

const stage = (wrapper) => wrapper.get('[data-test="media-preview"]');

const touch = (x, y, identifier = 1) => ({ clientX: x, clientY: y, identifier });

/** Pinch with two fingers, from one separation to another. */
const pinch = async (wrapper, from, to) => {
  const element = stage(wrapper);
  await element.trigger('touchstart', {
    touches: [touch(500 - from / 2, 400, 1), touch(500 + from / 2, 400, 2)],
    changedTouches: [touch(500 - from / 2, 400, 1)],
  });
  await element.trigger('touchmove', {
    touches: [touch(500 - to / 2, 400, 1), touch(500 + to / 2, 400, 2)],
  });
  await element.trigger('touchend', {
    touches: [],
    changedTouches: [touch(500 - to / 2, 400, 1)],
  });
};

/** Two taps in the same place, close together. */
const doubleTap = async (wrapper, x = 400, y = 300) => {
  const element = stage(wrapper);
  for (let index = 0; index < 2; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await element.trigger('touchstart', {
      touches: [touch(x, y)],
      changedTouches: [touch(x, y)],
    });
    // eslint-disable-next-line no-await-in-loop
    await element.trigger('touchend', { touches: [], changedTouches: [touch(x, y)] });
  }
};

const imageTransform = (wrapper) => wrapper.get('img').attributes('style') || '';

describe('MediaPreview', () => {
  it('navigates between images and videos with horizontal swipes', async () => {
    const { wrapper } = createWrapper();

    expect(wrapper.get('img').attributes('src')).toBe('/api/preview/first.jpg');

    await swipe(wrapper, 260, 120, 120, 120);
    expect(wrapper.get('video').exists()).toBe(true);
    expect(wrapper.get('source').attributes('src')).toBe('/api/preview/clip.mp4');

    await swipe(wrapper, 120, 120, 280, 120);
    expect(wrapper.get('img').attributes('src')).toBe('/api/preview/first.jpg');
  });

  it('does not navigate for vertical or short touch gestures', async () => {
    const { wrapper } = createWrapper();

    await swipe(wrapper, 200, 100, 220, 240);
    expect(wrapper.get('img').attributes('src')).toBe('/api/preview/first.jpg');

    await swipe(wrapper, 200, 100, 170, 100);
    expect(wrapper.get('img').attributes('src')).toBe('/api/preview/first.jpg');
  });

  it('downloads the media currently shown after swiping', async () => {
    const { api, wrapper } = createWrapper();

    await swipe(wrapper, 260, 120, 120, 120);
    await wrapper.get('button[aria-label="Download media"]').trigger('click');

    expect(api.download).toHaveBeenCalledWith(media[1]);
  });

  it('pauses video playback when switching media or closing the preview', async () => {
    const { wrapper: switchingWrapper } = createWrapper(media[1]);

    await swipe(switchingWrapper, 260, 120, 120, 120);
    expect(pause).toHaveBeenCalledTimes(1);

    switchingWrapper.unmount();

    const { wrapper: closingWrapper } = createWrapper(media[1]);
    closingWrapper.unmount();

    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('keeps native video arrow-key controls available', () => {
    const { wrapper } = createWrapper(media[1]);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowRight',
    });

    wrapper.get('video').element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.get('source').attributes('src')).toBe('/api/preview/clip.mp4');
  });
});

/**
 * Zooming, and the rule that lets it coexist with swiping.
 *
 * The viewer this replaces moved the picture around when you dragged it, which
 * is exactly what #354 asked to remove — but dropping the drag entirely would
 * have cost zooming, which people expect on a phone. Both live here, separated
 * by the only thing that can separate them: whether the picture is zoomed.
 */
describe('MediaPreview zoom', () => {
  it('zooms a picture when pinched', async () => {
    const { wrapper } = createWrapper();

    await pinch(wrapper, 100, 300);

    expect(imageTransform(wrapper)).toContain('scale(3)');
  });

  it('stops navigating once the picture is zoomed', async () => {
    // The heart of it: the same gesture cannot both move the picture and turn
    // the page. Zoomed in, it moves the picture.
    const { wrapper } = createWrapper();
    await pinch(wrapper, 100, 300);

    await swipe(wrapper, 260, 120, 120, 120);

    expect(wrapper.get('img').attributes('src')).toBe('/api/preview/first.jpg');
  });

  it('navigates again once the picture is back to natural size', async () => {
    const { wrapper } = createWrapper();
    await pinch(wrapper, 100, 300);
    await pinch(wrapper, 300, 100);

    await swipe(wrapper, 260, 120, 120, 120);

    expect(wrapper.get('video').exists()).toBe(true);
  });

  it('zooms in and back out on a double tap', async () => {
    const { wrapper } = createWrapper();

    await doubleTap(wrapper);
    expect(imageTransform(wrapper)).toContain('scale(2.5)');

    await doubleTap(wrapper);
    expect(imageTransform(wrapper)).not.toContain('scale(');
  });

  it('starts the next picture at natural size', async () => {
    // Reached with the arrow while still zoomed — the only way to leave a
    // zoomed picture, since swiping is busy panning it. Carrying that zoom over
    // would land somewhere arbitrary in an unrelated image, and leave swiping
    // dead there with no visible reason.
    const { wrapper } = createWrapper();
    await pinch(wrapper, 100, 300);
    expect(imageTransform(wrapper)).toContain('scale(3)');

    await wrapper.get('button[aria-label="Next media"]').trigger('click');
    await wrapper.get('button[aria-label="Next media"]').trigger('click');

    expect(imageTransform(wrapper)).not.toContain('scale(');
  });

  it('leaves videos alone, which have their own controls', async () => {
    const { wrapper } = createWrapper(media[1]);

    await pinch(wrapper, 100, 300);

    expect(wrapper.get('video').attributes('style') || '').not.toContain('scale(');
  });

  it('zooms with ctrl and the wheel, and scrolls without it', async () => {
    const { wrapper } = createWrapper();

    const wheel = (ctrlKey) =>
      stage(wrapper).element.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -200, ctrlKey, bubbles: true, cancelable: true })
      );

    wheel(true);
    await wrapper.vm.$nextTick();
    expect(imageTransform(wrapper)).toContain('scale(');

    const zoomed = imageTransform(wrapper);
    wheel(false);
    await wrapper.vm.$nextTick();
    expect(imageTransform(wrapper)).toBe(zoomed);
  });
});
