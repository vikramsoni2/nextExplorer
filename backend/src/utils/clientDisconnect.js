/**
 * When the person who asked has stopped waiting.
 *
 * Typing a search sends one request per pause, and the panel abandons every
 * one but the last. The server did not know that: each abandoned search went
 * on walking the volume with its own ripgrep processes for the full budget, so
 * typing `*.xlsx` one character at a time left five searches running at once —
 * three subprocesses and seven hundred megabytes for four answers nobody would
 * ever read.
 *
 * `close` also fires on a response that finished normally, so the promise only
 * settles when the connection went away with the answer still unwritten.
 */
const whenClientDisconnects = (res) =>
  new Promise((resolve) => {
    if (res.writableEnded) return;
    res.once('close', () => {
      if (!res.writableEnded) resolve();
    });
  });

module.exports = { whenClientDisconnects };
