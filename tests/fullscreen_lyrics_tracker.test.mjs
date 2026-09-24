import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Pages.js', import.meta.url), 'utf8');
const slice = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
};
const createHarness = () => {
  const slots = [], events = [];
  let cursor = 0, position = 0;
  const useMemo = (fn, deps) => {
    const index = cursor++, old = slots[index];
    if (!old || deps.length !== old.deps.length || deps.some((v, i) => !Object.is(v, old.deps[i]))) {
      slots[index] = { value: fn(), deps };
    }
    return slots[index].value;
  };
  const CONFIG = { visual: { 'synced-compact': true, 'pseudo-karaoke-render-advance': 150 } };
  const context = vm.createContext({
    CONFIG, useMemo, useEffect: useMemo,
    react: { memo: f => f, createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'fragment' },
    window: { dispatchEvent: e => events.push(JSON.parse(JSON.stringify(e.detail))) },
    CustomEvent: class { constructor(type, data) { Object.assign(this, { type, ...data }); } },
    emptyLine: { text: '', startTime: 0 },
    PSEUDO_KARAOKE_SOURCES: new Set(['pseudo']),
    useLyricsPlaybackPosition: () => position,
    getCurrentTrackDurationMs: () => 20000,
    getEmbeddedAuxiliaryDisplayValues: line => line,
    getInterludeInfo: () => ({ isInterlude: false }),
    buildLyricDisplayState: () => ({}),
    SyncedLyricsPage: 'compact-page', SyncedExpandedLyricsPage: 'expanded-page',
    UnsyncedLyricsPage: 'unsynced-page', LyricsUnavailableView: 'unavailable',
    MarketplacePage: 'marketplace', CreditFooter: 'footer',
  });
  vm.runInContext([
    slice('const getPseudoKaraokeRenderAdvance', 'const shouldIncludeSyncedLineInCompactView'),
    slice('const getActiveTimedLineIndex', 'const getPrecenteredTimedLineIndex'),
    slice('const prepareSyncedLineStartIndex', 'const buildSyncedPlaybackBoundaries'),
    slice('const usePreparedSyncedLyrics', 'const useSyncedLyricsEngine'),
    slice('const LyricsPageRenderer', 'window.LyricsPageRenderer'),
    'globalThis.api = { SyncedLyricsPlaybackTracker, LyricsPageRenderer };',
  ].join('\n'), context);
  return {
    CONFIG, events,
    tracker: context.api.SyncedLyricsPlaybackTracker,
    tick(lyrics, time, options = {}) {
      cursor = 0; position = time;
      assert.equal(context.api.SyncedLyricsPlaybackTracker({ lyrics, ...options }), null);
      return events.at(-1);
    },
    render(props) { cursor = 0; return context.api.LyricsPageRenderer(props); },
  };
};

// Match the former page's reverse source scan, including padding before the
// first lyric. Sorting timestamps must never reorder simultaneous/overlap rows.
const legacyIndex = (lyrics, time) => Math.max(0, lyrics.findLastIndex(line => time >= (line.startTime || 0)));

test('fullscreen tracker preserves source indices across boundaries, gaps, overlaps and seeks', () => {
  const lyrics = [
    { text: 'first', startTime: 1000, endTime: 12000 },
    { text: 'later', startTime: 5000, endTime: 6000 },
    { text: 'overlap', startTime: 3000, endTime: 4000 },
    { text: 'same time', startTime: 5000 },
    { text: 'after gap', startTime: 14000 },
  ];
  for (const compact of [true, false]) for (const isKara of [true, false]) {
    const h = createHarness(); h.CONFIG.visual['synced-compact'] = compact;
    for (const time of [-100, 0, 999, 1000, 2999, 3000, 4999, 5000, 13000, 14000, 20000, 2000, 0]) {
      assert.deepEqual(h.tick(lyrics, time, { isKara }), { index: legacyIndex(lyrics, time), total: lyrics.length });
    }
  }
});

test('tracker retains pseudo karaoke advance and only publishes boundary or lyric-count changes', () => {
  const h = createHarness(), lyrics = [{ startTime: 1000 }, { startTime: 2000 }];
  const options = { isKara: true, karaokeSource: 'pseudo' };
  h.tick(lyrics, 1800, options);
  for (const time of [1810, 1820, 1849]) h.tick(lyrics, time, options);
  assert.deepEqual(h.events, [{ index: 0, total: 2 }]);
  assert.deepEqual(h.tick(lyrics, 1850, options), { index: 1, total: 2 });
  assert.deepEqual(h.tick(lyrics, 1900, { ...options, karaokeSource: 'real' }), { index: 0, total: 2 });
  assert.deepEqual(h.tick([...lyrics, { startTime: 3000 }], 1900), { index: 0, total: 3 });
  assert.deepEqual(h.tick([], 1900), { index: 0, total: 0 });
});

test('focused presentations mount only the tracker and restore the normal renderer on exit', () => {
  for (const mode of [0, 1, 3]) {
    const h = createHarness(), lyrics = [{ text: 'line', startTime: 0 }];
    const props = { mode, currentLyrics: lyrics, karaoke: lyrics, synced: lyrics, reRenderLyricsPage: 2 };
    assert.equal(h.render({ ...props, playbackOnly: true }).type, h.tracker);
    const normal = h.render({ ...props, playbackOnly: false });
    assert.equal(normal.children[0].type, 'compact-page');
    assert.equal(normal.children[1].type, 'footer');
    h.CONFIG.visual['synced-compact'] = false;
    const expanded = h.render({ ...props, mode: 1, playbackOnly: true });
    assert.equal(expanded.type, h.tracker);
    assert.equal(h.render({ ...props, mode: 1 }).children[0].type, 'expanded-page');
  }
});

test('hidden unsynced/unavailable pages do not mount rows while marketplace stays accessible', () => {
  const h = createHarness();
  assert.equal(h.render({ playbackOnly: true, mode: 2, unsynced: [{}] }), null);
  assert.equal(h.render({ playbackOnly: true, mode: -1 }), null);
  assert.equal(h.render({ playbackOnly: true, showMarketplace: true }).children[0].type, 'marketplace');
});
