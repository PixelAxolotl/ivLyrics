import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync('SyncDataCreator.js', 'utf8');
const context = {};
vm.createContext(context);

const load = (name) => {
  const start = source.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf('\n};', start) + 4;
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.__fn = ${name};`, context);
  return context.__fn;
};

const buildReadings = load('buildSyncCreatorPreviewCharReadings');
vm.runInContext(
  source.slice(
    source.indexOf('const SYNC_CREATOR_PREVIEW_FULLWIDTH_CHAR_REGEX'),
    source.indexOf('\n', source.indexOf('const SYNC_CREATOR_PREVIEW_FULLWIDTH_CHAR_REGEX')) + 1
  ),
  context
);

const mapIn = (entries) => vm.runInContext(`new Map(${JSON.stringify(entries)})`, context);
const plain = (map) => (map ? JSON.parse(JSON.stringify([...map.entries()])) : null);

test('per-char readings keyed by glyph index, no shift', () => {
  const chars = Array.from('愛してどうして');
  const pronMap = mapIn([[0, 'あい'], [1, 'し'], [2, 'て'], [3, 'ど'], [4, 'う'], [5, 'し'], [6, 'て']]);
  assert.deepEqual(plain(buildReadings(chars, pronMap, [], 32)), [
    [0, { text: 'あい', dx: 0 }], [1, { text: 'し', dx: 0 }], [2, { text: 'て', dx: 0 }],
    [3, { text: 'ど', dx: 0 }], [4, { text: 'う', dx: 0 }], [5, { text: 'し', dx: 0 }], [6, { text: 'て', dx: 0 }],
  ]);
});

test('even-width unit shifts right by half a glyph, covered members stay blank', () => {
  const chars = Array.from('思いも');
  const pronMap = mapIn([[0, 'おも'], [1, 'い'], [2, 'も']]);
  const units = [{ start: 0, end: 1, pronunciation: 'おもい' }];
  assert.deepEqual(plain(buildReadings(chars, pronMap, units, 32)), [
    [0, { text: 'おもい', dx: 16 }], [2, { text: 'も', dx: 0 }],
  ]);
});

test('odd-width unit needs no shift', () => {
  const chars = Array.from('違った');
  const units = [{ start: 0, end: 2, pronunciation: 'chigat' }];
  assert.deepEqual(plain(buildReadings(chars, mapIn([]), units, 32)), [[1, { text: 'chigat', dx: 0 }]]);
});

test('returns null without readings', () => {
  assert.equal(buildReadings(['a'], mapIn([]), [], 32), null);
  assert.equal(buildReadings([], mapIn([]), [], 32), null);
});
