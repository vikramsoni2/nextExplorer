import { describe, it, expect } from 'vitest';
import { useMediaZoom } from './useMediaZoom';

/**
 * The rule that lets swiping and zooming share one finger.
 *
 * The gallery navigates by dragging, and the old viewer moved the picture
 * around instead — which is what people complained about. Both gestures are the
 * same movement, so what decides between them is whether the picture is zoomed.
 * Everything here is about that boundary being exact: a picture that stays
 * fractionally zoomed after a pinch would swallow every swipe, and one that can
 * be dragged off-screen has no way back.
 */

const frame = { width: 1000, height: 800 };

describe('useMediaZoom', () => {
  it('starts at natural size, where drags belong to the gallery', () => {
    const zoom = useMediaZoom();

    expect(zoom.scale.value).toBe(1);
    expect(zoom.isZoomed.value).toBe(false);
    expect(zoom.transform.value).toBe('none');
  });

  it('refuses to pan at natural size, so a swipe stays a swipe', () => {
    const zoom = useMediaZoom();

    zoom.panBy(120, 40, frame);

    expect(zoom.offset.x).toBe(0);
    expect(zoom.offset.y).toBe(0);
  });

  it('pans once zoomed', () => {
    const zoom = useMediaZoom();
    zoom.zoomTo(2, frame);

    zoom.panBy(100, 50, frame);

    expect(zoom.offset.x).toBe(100);
    expect(zoom.offset.y).toBe(50);
  });

  it('does not let the picture be dragged out of its frame', () => {
    // At 2x the picture overflows by half the frame on each side; further than
    // that is empty space, and a picture lost there cannot be brought back.
    const zoom = useMediaZoom();
    zoom.zoomTo(2, frame);

    zoom.panBy(5000, 5000, frame);

    expect(zoom.offset.x).toBe(500);
    expect(zoom.offset.y).toBe(400);
  });

  it('treats a pinch that lands just above 1 as not zoomed', () => {
    // Fingers never return a picture to exactly 1.0. Left alone, a scale of
    // 1.001 would keep every later swipe from navigating.
    const zoom = useMediaZoom();

    zoom.zoomTo(1.001, frame);

    expect(zoom.isZoomed.value).toBe(false);
    expect(zoom.transform.value).toBe('none');
  });

  it('recentres the picture when it comes back to natural size', () => {
    const zoom = useMediaZoom();
    zoom.zoomTo(3, frame);
    zoom.panBy(200, 100, frame);

    zoom.zoomTo(1, frame);

    expect(zoom.offset.x).toBe(0);
    expect(zoom.offset.y).toBe(0);
  });

  it('pulls the picture back into frame when zooming out', () => {
    // Panned to the edge at 4x, the same offset is off-screen at 1.5x.
    const zoom = useMediaZoom();
    zoom.zoomTo(4, frame);
    zoom.panBy(1500, 1200, frame);
    expect(zoom.offset.x).toBe(1500);

    zoom.zoomTo(1.5, frame);

    expect(zoom.offset.x).toBe(250);
    expect(zoom.offset.y).toBe(200);
  });

  it('stops at the maximum, however hard the pinch', () => {
    const zoom = useMediaZoom({ maxScale: 4 });

    zoom.zoomBy(100, frame);

    expect(zoom.scale.value).toBe(4);
  });

  it('never goes below natural size', () => {
    // Pinching out on an unzoomed picture must not shrink it into the frame.
    const zoom = useMediaZoom();

    zoom.zoomBy(0.2, frame);

    expect(zoom.scale.value).toBe(1);
    expect(zoom.isZoomed.value).toBe(false);
  });

  it('toggles all the way in and all the way back out', () => {
    const zoom = useMediaZoom({ doubleTapScale: 2.5 });

    zoom.toggle(frame);
    expect(zoom.scale.value).toBe(2.5);

    zoom.toggle(frame);
    expect(zoom.scale.value).toBe(1);
    expect(zoom.offset.x).toBe(0);
  });

  it('ignores a factor that is not a usable number', () => {
    const zoom = useMediaZoom();
    zoom.zoomTo(2, frame);

    zoom.zoomBy(Number.NaN, frame);
    zoom.zoomBy(0, frame);
    zoom.zoomBy(-1, frame);

    expect(zoom.scale.value).toBe(2);
  });

  it('survives being panned without a frame to measure against', () => {
    // The element may not be laid out yet when the first gesture arrives.
    const zoom = useMediaZoom();
    zoom.zoomTo(2, null);

    zoom.panBy(100, 100, null);

    expect(zoom.offset.x).toBe(0);
    expect(zoom.offset.y).toBe(0);
  });

  it('describes itself as a transform only while zoomed', () => {
    const zoom = useMediaZoom();
    zoom.zoomTo(2, frame);
    zoom.panBy(10, 20, frame);

    expect(zoom.transform.value).toBe('translate(10px, 20px) scale(2)');

    zoom.reset();
    expect(zoom.transform.value).toBe('none');
  });
});
