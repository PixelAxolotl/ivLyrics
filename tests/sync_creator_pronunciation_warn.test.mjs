import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8');
const context = {};
vm.createContext(context);

const load = (name) => {
  const start = source.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf('\n};', start) + 3;
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.__fn = ${name};`, context);
  return context.__fn;
};
const loadLine = (name) => {
  const start = source.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf('\n', start);
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.__fn = ${name};`, context);
  return context.__fn;
};

for (const name of [
  'SYNC_CREATOR_JAPANESE_KANA_REGEX',
  'SYNC_CREATOR_KANJI_REGEX',
  'SYNC_CREATOR_JAPANESE_ATTACH_KANA_REGEX',
  'SYNC_CREATOR_HANGUL_JAMO_ONLY_REGEX',
  'SYNC_CREATOR_PREVIEW_FULLWIDTH_CHAR_REGEX',
]) loadLine(name);
{
  const start = source.indexOf('const SYNC_CREATOR_HANGUL_CODA_BY_JAMO');
  assert.notEqual(start, -1, 'missing SYNC_CREATOR_HANGUL_CODA_BY_JAMO');
  const end = source.indexOf('\n]);', start) + 4;
  vm.runInContext(source.slice(start, end), context);
}
load('mergeSyncCreatorPronunciationText');
const normalizeUnits = load('normalizeSyncCreatorPronunciationUnits');
const visualUnits = load('buildSyncCreatorVisualPronunciationUnits');
const buildReadings = load('buildSyncCreatorPreviewCharReadings');
loadLine('previewCharReadingsCache');
const cachedReadings = load('getCachedPreviewCharReadings');

const mapIn = (entries) => vm.runInContext(`new Map(${JSON.stringify(entries)})`, context);
const plain = (map) => (map ? JSON.parse(JSON.stringify([...map.entries()])) : null);

// Builds the previewed line's own pron map + units exactly like the live
// preview branch does for a non-edited line: merged-aware lookup of
// characterPronunciations by line index, timing-derived units first,
// visual grouping as the fallback.
const buildOwnLineReadings = (previewChars, lineData, glyphPx = 32) => {
  const pronMapEntries = [];
  if (Array.isArray(lineData?.chars)) {
    lineData.chars.forEach((item, fallbackIndex) => {
      const sourceIndex = Number.isInteger(Number(item?.i)) ? Number(item.i) : fallbackIndex;
      const pronunciation = typeof item?.pronunciation === 'string' ? item.pronunciation.trim() : '';
      if (pronunciation && Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < previewChars.length) {
        pronMapEntries.push([sourceIndex, pronunciation]);
      }
    });
  }
  const pronMap = mapIn(pronMapEntries);
  const timingUnits = normalizeUnits(lineData, previewChars);
  if (pronMap.size === 0 && timingUnits.length === 0) return null;
  const units = timingUnits.length > 0 ? timingUnits : visualUnits(previewChars, pronMap);
  return cachedReadings(previewChars, pronMap.size > 0 ? pronMap : null, units, glyphPx);
};

test('preview of a non-edited line shows that line’s own readings', () => {
  // Playing line 1 while editing line 0: line 1's word unit must render at
  // the group centre with the editor's half-glyph shift, not disappear.
  const previewChars = Array.from('思いも');
  const lineData = {
    index: 1,
    chars: [
      { i: 0, char: '思', pronunciation: 'おも' },
      { i: 1, char: 'い', pronunciation: 'い' },
      { i: 2, char: 'も', pronunciation: 'も' },
    ],
    units: [{ start: 0, end: 1, pronunciation: 'おもい' }],
  };
  assert.deepEqual(plain(buildOwnLineReadings(previewChars, lineData)), [
    [0, { text: 'おもい', dx: 16 }],
    [2, { text: 'も', dx: 0 }],
  ]);
});

test('preview without pron data for the previewed line stays furigana-only', () => {
  const previewChars = Array.from('思いも');
  assert.equal(buildOwnLineReadings(previewChars, { index: 1, chars: [], units: [] }), null);
  assert.equal(buildReadings(previewChars, mapIn([]), [], 32), null);
});

test('live preview resolves readings from the previewed line, not only the edited line', () => {
  assert.ok(
    source.includes("displaySourceLine.text === currentLineChars.join('')"),
    'preview still detects the edited line for the identical fast path'
  );
  assert.ok(source.includes('previewPronMap'), 'preview builds a pron map for the previewed line');
  assert.ok(
    source.includes('getMergedLineIndexesForStart(previewLineIndex)'),
    'preview resolves merged lyrics for the previewed line'
  );
  assert.ok(
    source.includes('getCachedPreviewCharReadings(previewChars'),
    'preview renders readings built from the previewed line'
  );
  assert.ok(
    source.includes('if (previewPronMap.size > 0 || previewTimingUnits.length > 0) {'),
    'furigana-only stays the fallback when the previewed line has no pron data'
  );
});
