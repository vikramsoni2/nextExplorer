import { describe, expect, it } from 'vitest';

const { mergeResults } = require('../../src/routes/search.js');

/**
 * The same file, found by two passes at once.
 *
 * A search runs several passes concurrently — names, contents, and the one that
 * unzips Office documents — and they share a set of paths already found so that
 * none repeats another's work. That set cannot prevent a duplicate, because in
 * the document pass the test and the claim are three awaits apart: it checks a
 * path, then stats the file, extracts its text and asks permission, and only
 * then records it. The name pass claims a path on the line after testing one,
 * so it fits inside that window.
 *
 * A `.docx` whose name and contents both match therefore came back twice. It
 * needed a machine slow enough to finish the directory walk while a document
 * was being unzipped, which is why it appeared in CI and not on a developer's
 * machine — a timing test would be no test at all, so these drive the merge
 * directly and arrange the interleaving by hand.
 */

const item = (name, path = '', kind = 'file') => ({ name, path, kind });

/** A generator that yields on demand, so a test can decide who goes first. */
const paced = async function* (values, pauseMs = 0) {
  for (const value of values) {
    if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    yield value;
  }
};

const collect = async (generator) => {
  const out = [];
  for await (const value of generator) out.push(value);
  return out;
};

describe('merging the passes of a search', () => {
  it('passes through what one pass found', async () => {
    const results = await collect(mergeResults(paced([item('a.txt'), item('b.txt')])));

    expect(results.map((r) => r.name)).toEqual(['a.txt', 'b.txt']);
  });

  it('lists a file once when two passes both find it', async () => {
    const byName = paced([item('pangolin.docx')]);
    const byContent = paced([item('pangolin.docx')]);

    const results = await collect(mergeResults(byName, byContent));

    expect(results.filter((r) => r.name === 'pangolin.docx')).toHaveLength(1);
  });

  /**
   * The order the passes finish in is exactly what varies between machines, so
   * neither order may produce a duplicate.
   */
  it('lists it once when the slower pass finds it first', async () => {
    const byName = paced([item('pangolin.docx')], 30);
    const byContent = paced([item('pangolin.docx')]);

    const results = await collect(mergeResults(byName, byContent));

    expect(results).toHaveLength(1);
  });

  it('lists it once when the faster pass finds it first', async () => {
    const byName = paced([item('pangolin.docx')]);
    const byContent = paced([item('pangolin.docx')], 30);

    const results = await collect(mergeResults(byName, byContent));

    expect(results).toHaveLength(1);
  });

  /** The first one through is the one kept, with whatever it carried. */
  it('keeps the first result rather than the last', async () => {
    const byName = paced([item('pangolin.docx')]);
    const byContent = paced([{ ...item('pangolin.docx'), matchLine: 'the word appears here' }], 30);

    const [result] = await collect(mergeResults(byName, byContent));

    expect(result.matchLine).toBeUndefined();
  });

  /**
   * Two files of the same name in different folders are two files. Collapsing
   * them would be a worse bug than the one being fixed.
   */
  it('keeps two same-named files from different folders', async () => {
    const first = paced([item('report.docx', '2025')]);
    const second = paced([item('report.docx', '2026')]);

    const results = await collect(mergeResults(first, second));

    expect(results).toHaveLength(2);
  });

  it('tells a file at the root from one of the same name in a folder', async () => {
    const first = paced([item('report.docx')]);
    const second = paced([item('report.docx', 'archive')]);

    const results = await collect(mergeResults(first, second));

    expect(results).toHaveLength(2);
  });

  it('still ends when every pass is exhausted', async () => {
    const results = await collect(mergeResults(paced([]), paced([])));

    expect(results).toEqual([]);
  });

  /**
   * A consumer that stops early closes the passes behind it — that is what
   * ends the ripgrep processes they own.
   */
  it('closes the passes it is still holding when the consumer stops', async () => {
    let closed = false;
    const endless = (async function* () {
      try {
        for (let i = 0; ; i += 1) yield item(`file-${i}.txt`);
      } finally {
        closed = true;
      }
    })();

    const merged = mergeResults(endless, paced([]));
    await merged.next();
    await merged.return?.();
    // The close propagates on the next turn of the loop.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(closed).toBe(true);
  });
});
