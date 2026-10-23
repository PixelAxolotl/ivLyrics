import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const harnessUrl = new URL('./karaoke_static_render_cache.test.mjs', import.meta.url);
const fixture = readFileSync(harnessUrl, 'utf8');
const from = fixture.indexOf('const currentSource ='), to = fixture.indexOf("test('vocal presence");
assert.ok(from >= 0 && to > from);
const { createHarness, makeLine } = new Function('assert', 'execFileSync', 'readFileSync', 'vm',
  fixture.slice(from, to).replaceAll('import.meta.url', JSON.stringify(harnessUrl.href))
  + '\nreturn { createHarness, makeLine };')(assert, execFileSync, readFileSync, vm);
const nodes = (tree, className, result = []) => {
  if (Array.isArray(tree)) tree.forEach(node => nodes(node, className, result));
  else if (tree && typeof tree === 'object') {
    if (tree.props?.className?.split(' ').includes(className)) result.push(tree);
    nodes(tree.children, className, result);
  }
  return result;
};
const textOf = tree => Array.isArray(tree) ? tree.map(textOf).join('')
  : tree && typeof tree === 'object' ? textOf(tree.children) : String(tree ?? '');
const mapIn = (h, entries) => vm.runInContext(`new Map(${JSON.stringify(entries)})`, h.context);
const fillText = tree => nodes(tree, 'lyrics-karaoke-glyph-fill').map(textOf);

for (const [text, locale] of [
  ['مرحبا بالعالم', 'ar'], ['ภาษาไทย สวัสดี', 'th'], ['अच्छा गाना', 'hi'], ['a\u0301 voice', 'en'],
]) {
  test(`${locale}: readings keep the production renderer's contiguous shaping runs intact`, () => {
    const h = createHarness(undefined, { locale }), baseline = createHarness(undefined, { locale });
    const line = makeLine(text);
    const entries = Array.from(text, (_, index) => [index, { text: `r${index}`, dx: 0 }]);
    const rendered = h.render(line, 1200, { charReadings: mapIn(h, entries) });
    const plain = baseline.render(line, 1200);
    const readings = nodes(rendered, 'lyrics-karaoke-run-reading');
    assert.equal(nodes(rendered, 'lyrics-karaoke-char-reading').length, 0, 'joining/combining scripts must never be split into glyph DOM');
    assert.ok(nodes(plain, 'lyrics-karaoke-text-run-segment').length > 0);
    assert.equal(nodes(rendered, 'lyrics-karaoke-text-run-segment').length, nodes(plain, 'lyrics-karaoke-text-run-segment').length);
    assert.deepEqual(fillText(rendered), fillText(plain), 'each original shaped text node remains intact');
    assert.ok(readings.length > 0, 'pronunciation must not disappear in text-run mode');
    const words = text.split(' ');
    const secondWordCodePoint = Array.from(words[0]).length + 1;
    assert.ok(readings.some(node => textOf(node).startsWith(`r${secondWordCodePoint}`)), 'code-point indices align after multi-code-point graphemes');
  });
}

test('Japanese glyph readings coexist with ruby and refresh in a paused cached row', () => {
  const h = createHarness(undefined, { locale: 'ja' }), line = makeLine('漢字の歌');
  const furigana = mapIn(h, [[0, 'かん']]);
  const first = h.render(line, 1200, { furiganaMapOverride: furigana, charReadings: mapIn(h, [[0, { text: 'kan', dx: 16 }]]) });
  const second = h.render(line, 1200, { furiganaMapOverride: furigana, charReadings: mapIn(h, [[0, { text: 'new', dx: 0 }]]) });
  assert.equal(nodes(first, 'lyrics-karaoke-char-reading')[0].props.style.transform, 'translateX(calc(-50% + 16px))');
  assert.equal(textOf(nodes(first, 'lyrics-karaoke-char-reading')[0]), 'kan');
  assert.equal(textOf(nodes(second, 'lyrics-karaoke-char-reading')[0]), 'new');
  assert.equal(nodes(second, 'lyrics-karaoke-ruby').length, 1);
  assert.deepEqual(fillText(first), fillText(second));
});

test('shaped run cache refreshes readings at a fixed paused position', () => {
  const h = createHarness(undefined, { locale: 'ar' }), line = makeLine('مرحبا');
  const first = h.render(line, 1200, { charReadings: mapIn(h, [[0, 'first']]) });
  const second = h.render(line, 1200, { charReadings: mapIn(h, [[0, 'second']]) });
  assert.equal(textOf(nodes(first, 'lyrics-karaoke-run-reading')[0]), 'first');
  assert.equal(textOf(nodes(second, 'lyrics-karaoke-run-reading')[0]), 'second');
  assert.deepEqual(fillText(first), fillText(second));
});

// --- Sync creator preview uses the same pronunciation method as the editor ---
// Timing-derived AI units win over visual kana grouping; visual grouping
// stays the fallback. Loaded from the real SyncDataCreator.js source, the
// same way tests/preview_phonetic_line.test.mjs loads its helpers.
const syncCreatorSource = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8');
const syncCreatorContext = {};
vm.createContext(syncCreatorContext);
const loadSyncCreatorFn = (name) => {
  const start = syncCreatorSource.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = syncCreatorSource.indexOf('\n};', start) + 3;
  vm.runInContext(`${syncCreatorSource.slice(start, end)}\nglobalThis.__syncFn = ${name};`, syncCreatorContext);
  return syncCreatorContext.__syncFn;
};
const loadSyncCreatorLine = (name) => {
  const start = syncCreatorSource.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = syncCreatorSource.indexOf('\n', start);
  vm.runInContext(`${syncCreatorSource.slice(start, end)}\nglobalThis.__syncFn = ${name};`, syncCreatorContext);
  return syncCreatorContext.__syncFn;
};
for (const name of [
  'SYNC_CREATOR_JAPANESE_KANA_REGEX',
  'SYNC_CREATOR_KANJI_REGEX',
  'SYNC_CREATOR_JAPANESE_ATTACH_KANA_REGEX',
  'SYNC_CREATOR_HANGUL_JAMO_ONLY_REGEX',
]) loadSyncCreatorLine(name);
{
  const start = syncCreatorSource.indexOf('const SYNC_CREATOR_HANGUL_CODA_BY_JAMO');
  assert.notEqual(start, -1, 'missing SYNC_CREATOR_HANGUL_CODA_BY_JAMO');
  const end = syncCreatorSource.indexOf('\n]);', start) + 4;
  vm.runInContext(syncCreatorSource.slice(start, end), syncCreatorContext);
}
loadSyncCreatorFn('mergeSyncCreatorPronunciationText');
const normalizeSyncCreatorUnits = loadSyncCreatorFn('normalizeSyncCreatorPronunciationUnits');
const visualSyncCreatorUnits = loadSyncCreatorFn('buildSyncCreatorVisualPronunciationUnits');
loadSyncCreatorLine('SYNC_CREATOR_PREVIEW_FULLWIDTH_CHAR_REGEX');
const buildSyncCreatorPreviewCharReadings = loadSyncCreatorFn('buildSyncCreatorPreviewCharReadings');
const syncMapIn = (entries) => vm.runInContext(`new Map(${JSON.stringify(entries)})`, syncCreatorContext);
const syncJson = (value) => JSON.parse(JSON.stringify(value));

test('timing-derived units come from the line pron data like the editor', () => {
  const chars = Array.from('思いも');
  const lineData = { units: [{ start: 0, end: 1, pronunciation: 'おもい' }] };
  assert.deepEqual(syncJson(normalizeSyncCreatorUnits(lineData, chars)), [
    { start: 0, end: 1, pronunciation: 'おもい', text: '思い' },
  ]);
});

test('preview prefers timing-derived units over visual grouping', () => {
  // きょう would visually group (small ょ attaches to き), but the
  // timing-derived AI units split the chars: the editor renders the split,
  // so the preview must too.
  const chars = Array.from('きょう');
  const pronMap = syncMapIn([[0, 'きょ'], [1, 'う']]);
  const timing = [
    { start: 0, end: 0, pronunciation: 'A', text: 'き' },
    { start: 1, end: 1, pronunciation: 'B', text: 'ょ' },
  ];
  assert.deepEqual(syncJson(visualSyncCreatorUnits(chars, pronMap, timing)), timing);
});

test('preview falls back to visual grouping without timing-derived units', () => {
  const chars = Array.from('きょう');
  const pronMap = syncMapIn([[0, 'きょ'], [1, 'う']]);
  const grouped = [{ start: 0, end: 1, pronunciation: 'きょう', text: 'きょ' }];
  assert.deepEqual(syncJson(visualSyncCreatorUnits(chars, pronMap)), grouped);
  assert.deepEqual(syncJson(visualSyncCreatorUnits(chars, pronMap, [])), grouped);
});

test('invalid timing-derived units fall back to visual grouping', () => {
  const chars = Array.from('きょう');
  const pronMap = syncMapIn([[0, 'きょ'], [1, 'う']]);
  const invalid = [{ start: 0, end: 9, pronunciation: 'oob', text: 'きょう??' }];
  assert.deepEqual(syncJson(visualSyncCreatorUnits(chars, pronMap, invalid)), [
    { start: 0, end: 1, pronunciation: 'きょう', text: 'きょ' },
  ]);
});

test('part row with a join space keeps kimi on 君 and ni on に', () => {
  // part.syllables re-injects the join space, so the readings char list is
  // the expanded text: index 2 is ' ' (dropped by the whitespace skip),
  // kimi sits on 君 (3) and ni on に (4).
  const chars = Array.from('早く 君に');
  const pronMap = syncMapIn([[3, 'kimi'], [4, 'ni']]);
  const readings = buildSyncCreatorPreviewCharReadings(chars, pronMap, [], 32);
  assert.ok(readings && typeof readings.get === 'function');
  assert.equal(readings.get(3)?.text, 'kimi');
  assert.equal(readings.get(4)?.text, 'ni');
  assert.ok(!readings.has(2), 'join space must not carry a reading');
});

test('word-unit mid on a join space falls back to the unit start', () => {
  const chars = Array.from('早く 君に');
  const units = [{ start: 1, end: 3, pronunciation: 'kukimi', text: 'く 君' }];
  const readings = buildSyncCreatorPreviewCharReadings(chars, null, units, 32);
  assert.ok(!readings.has(2), 'mid on a space must not carry a reading');
  assert.equal(readings.get(1)?.text, 'kukimi');
});

test('word-unit text mismatch falls back to the unit start', () => {
  const chars = Array.from('早く 君に');
  const units = [{ start: 0, end: 2, pronunciation: 'x', text: 'WRONG' }];
  const readings = buildSyncCreatorPreviewCharReadings(chars, null, units, 32);
  assert.equal(readings.get(0)?.text, 'x');
  assert.ok(!readings.has(1));
});
