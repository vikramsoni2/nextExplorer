import { computed, reactive, ref } from 'vue';

/**
 * Zooming into a picture, and moving around inside it once you have.
 *
 * The gallery this belongs to navigates by swiping, which is what people asked
 * for — the old viewer dragged the image around instead, and that was the
 * complaint. Both gestures are a finger moving across a picture, so they cannot
 * both be live at once. The rule here is the one Photos and Google Photos use,
 * and it is the whole point of this file: at natural size a drag belongs to the
 * gallery, and only once the picture is zoomed does it move the picture.
 *
 * Panning is bounded, because a picture dragged off-screen with no way back is
 * worse than one that will not move.
 */

const MAX_SCALE = 4;
const MIN_SCALE = 1;
const DOUBLE_TAP_SCALE = 2.5;

// Below this, floating-point drift from a pinch would leave a picture
// "zoomed" at 1.0001 and quietly swallow every swipe.
const ZOOMED_EPSILON = 0.01;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function useMediaZoom({ maxScale = MAX_SCALE, doubleTapScale = DOUBLE_TAP_SCALE } = {}) {
  const scale = ref(MIN_SCALE);
  const offset = reactive({ x: 0, y: 0 });

  const isZoomed = computed(() => scale.value > MIN_SCALE + ZOOMED_EPSILON);

  const reset = () => {
    scale.value = MIN_SCALE;
    offset.x = 0;
    offset.y = 0;
  };

  /**
   * Keep the picture overlapping its frame.
   *
   * At scale s, the picture overflows its frame by (s-1)/2 of the frame on each
   * side; allowing more than that would drag it into empty space.
   */
  const clampOffset = (bounds) => {
    const width = Number(bounds?.width) || 0;
    const height = Number(bounds?.height) || 0;
    const limitX = (width * (scale.value - 1)) / 2;
    const limitY = (height * (scale.value - 1)) / 2;

    offset.x = clamp(offset.x, -limitX, limitX);
    offset.y = clamp(offset.y, -limitY, limitY);
  };

  const zoomTo = (next, bounds) => {
    scale.value = clamp(Number(next) || MIN_SCALE, MIN_SCALE, maxScale);
    if (!isZoomed.value) {
      // Back to natural size: centred again, and swipes belong to the gallery.
      offset.x = 0;
      offset.y = 0;
      return;
    }
    clampOffset(bounds);
  };

  /** Zoom by a factor — what a pinch and a wheel both produce. */
  const zoomBy = (factor, bounds) => {
    const multiplier = Number(factor);
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    zoomTo(scale.value * multiplier, bounds);
  };

  /** Double tap: all the way in, or all the way back out. */
  const toggle = (bounds) => {
    if (isZoomed.value) {
      reset();
      return;
    }
    zoomTo(doubleTapScale, bounds);
  };

  /** Move within the picture. Does nothing at natural size, by design. */
  const panBy = (deltaX, deltaY, bounds) => {
    if (!isZoomed.value) return;
    offset.x += Number(deltaX) || 0;
    offset.y += Number(deltaY) || 0;
    clampOffset(bounds);
  };

  const transform = computed(() =>
    isZoomed.value ? `translate(${offset.x}px, ${offset.y}px) scale(${scale.value})` : 'none'
  );

  return {
    scale,
    offset,
    isZoomed,
    reset,
    zoomTo,
    zoomBy,
    toggle,
    panBy,
    transform,
    maxScale,
  };
}
