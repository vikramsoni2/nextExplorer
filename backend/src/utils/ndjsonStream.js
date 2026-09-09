/**
 * NDJSON progress streams, in one place.
 *
 * Delete, transfer and archive all stream the same way: a 200 committed before
 * the work starts, then one JSON object per line. They had three copies of the
 * same header block and the same "don't write to a closed socket" guard, and
 * the copies had already drifted — only delete flushed its headers, so the
 * other two left the client waiting on an empty response until the first event
 * happened to arrive.
 *
 * The status is committed here on purpose: once headers are out, a failure can
 * only be reported as an error *event*, never as an HTTP status. Callers must
 * therefore do their authorization and validation before calling this.
 */
const startNdjsonStream = (res, { onClose } = {}) => {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  // Without this, nginx holds progress lines until the response ends.
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof onClose === 'function') res.once('close', onClose);
  res.flushHeaders?.();

  return (event) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`${JSON.stringify(event)}\n`);
  };
};

/**
 * Percent events, throttled so a fast operation does not spend its time
 * writing progress lines nobody can read that quickly.
 */
const throttlePercent = (writeEvent, intervalMs = 150) => {
  let lastAt = 0;
  let lastPercent = -1;

  return (percent) => {
    const now = Date.now();
    if (percent === lastPercent) return;
    if (percent < 100 && now - lastAt < intervalMs) return;
    lastAt = now;
    lastPercent = percent;
    writeEvent({ type: 'progress', percent });
  };
};

/**
 * Let progress events through at a steady rate, keeping the last one.
 *
 * A bulk operation reports once per item: three thousand files means three
 * thousand socket writes, three thousand lines to parse and as many reactive
 * updates in the browser — for a bar that can only show a hundred distinct
 * positions. The final event is never dropped, so the bar always lands on
 * completion rather than stopping just short of it.
 */
const throttleProgress = (writeEvent, intervalMs = 100) => {
  let lastAt = 0;
  let pending = null;

  const send = (event) => {
    pending = null;
    lastAt = Date.now();
    writeEvent(event);
  };

  const throttled = (event) => {
    const now = Date.now();
    if (now - lastAt >= intervalMs) send(event);
    else pending = event;
  };

  // Called once the work is done, so the last position is not lost.
  throttled.flush = () => {
    if (pending) send(pending);
  };

  return throttled;
};

module.exports = { startNdjsonStream, throttlePercent, throttleProgress };
