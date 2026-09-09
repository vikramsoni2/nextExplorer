import { describe, it, expect } from 'vitest';

const { collectResults, buildPage } = require('../../src/services/searchCollector');

/**
 * A reserve is worth waiting for while there is somewhere left to find it.
 * Once the sources of content are exhausted, waiting is just waiting — and it
 * was five seconds of it on every ordinary search: a term with five hundred
 * filename matches and eight content matches ran to the time budget looking
 * for content that had already run out.
 */
const name = (n) => ({ name: `file-${n}.txt`, path: 'Docs' });
const content = (n) => ({ name: `doc-${n}.md`, path: 'Docs', matchLine: 'pangolin here' });

const stream = async function* (items, { onExhausted } = {}) {
  for (const item of items) yield item;
  onExhausted?.();
};

describe('collecting a page of results', () => {
  it('stops once names have filled the page and no content can arrive', async () => {
    let exhausted = false;
    const many = Array.from({ length: 500 }, (unused, i) => name(i));

    const { names, contents } = await collectResults({
      results: stream(many, { onExhausted: () => {} }),
      limit: 100,
      // Nothing else is going to produce a content match.
      contentExhausted: () => (exhausted = true),
    });

    expect(names).toHaveLength(100);
    expect(contents).toHaveLength(0);
    expect(exhausted).toBe(true);
  });

  // While content can still arrive, the page stays open for it: names alone
  // used to return a hundred results and not one line of what was inside them.
  it('keeps looking while content can still arrive', async () => {
    const items = [
      ...Array.from({ length: 300 }, (unused, i) => name(i)),
      ...Array.from({ length: 25 }, (unused, i) => content(i)),
    ];

    const { names, contents } = await collectResults({
      results: stream(items),
      limit: 100,
      contentExhausted: () => false,
    });

    expect(names.length).toBeGreaterThan(100);
    expect(contents).toHaveLength(25);
  });

  // Both conditions, in that order: the page of names has to be full before
  // the reserve is even looked at, so content arriving quickly overshoots it
  // rather than cutting the names short.
  it('stops once the page is full and the reserve is met, and not before', async () => {
    const items = [];
    for (let i = 0; i < 300; i += 1) {
      items.push(name(i));
      if (i % 3 === 0) items.push(content(i));
    }

    let consumed = 0;
    const counted = (async function* () {
      for (const item of items) {
        consumed += 1;
        yield item;
      }
    })();

    const { names, contents } = await collectResults({
      results: counted,
      limit: 100,
      contentExhausted: () => false,
    });

    expect(names).toHaveLength(100);
    // A quarter of a hundred-result page is reserved for content, and content
    // arriving faster than names simply exceeds it.
    expect(contents.length).toBeGreaterThanOrEqual(25);
    // And it stopped rather than reading the rest.
    expect(consumed).toBeLessThan(items.length);
  });
});

describe('building the page', () => {
  it('gives content its share and lets names lead', () => {
    const page = buildPage({
      names: Array.from({ length: 100 }, (unused, i) => name(i)),
      contents: Array.from({ length: 25 }, (unused, i) => content(i)),
      limit: 100,
    });

    expect(page).toHaveLength(100);
    expect(page.filter((item) => item.matchLine)).toHaveLength(25);
    expect(page[0].matchLine).toBeUndefined();
  });

  // A quota that went unused is not a reason to answer short.
  it('fills the page with names when there was little content', () => {
    const page = buildPage({
      names: Array.from({ length: 200 }, (unused, i) => name(i)),
      contents: [content(0)],
      limit: 100,
    });

    expect(page).toHaveLength(100);
    expect(page.filter((item) => item.matchLine)).toHaveLength(1);
  });

  it('answers with only names when nothing matched inside a file', () => {
    const page = buildPage({
      names: Array.from({ length: 40 }, (unused, i) => name(i)),
      contents: [],
      limit: 100,
    });

    expect(page).toHaveLength(40);
  });
});

/**
 * The budget stopped the search and then the answer waited anyway. Cleaning up
 * means resuming every source at whatever it was in the middle of, and on a
 * busy tree that took six seconds — so a search bounded at five answered in
 * eleven. The bound had not been raised; the wait had moved past it.
 *
 * The way out is that what has been found is already the caller's, so it can
 * answer at the budget and clean up afterwards.
 */
describe('answering before the search has finished', () => {
  it('leaves what it has found in the caller’s hands as it goes', async () => {
    const names = [];
    const contents = [];
    let released;
    const held = new Promise((resolve) => {
      released = resolve;
    });
    let reachedTheHold;
    const reached = new Promise((resolve) => {
      reachedTheHold = resolve;
    });

    const slow = async function* () {
      yield name(1);
      yield content(1);
      yield name(2);
      // A source that will not come back on its own: the budget is the only
      // thing that ends this search. Reaching it is the deterministic moment
      // to look — every item before it has been handed to the collector.
      reachedTheHold();
      await held;
    };

    const collect = collectResults({ results: slow(), limit: 100, names, contents });
    await reached;

    // No await on the collector: this is the moment the route answers in.
    expect(names.map((item) => item.name)).toEqual(['file-1.txt', 'file-2.txt']);
    expect(contents.map((item) => item.name)).toEqual(['doc-1.md']);

    released();
    await collect;
  });
});
