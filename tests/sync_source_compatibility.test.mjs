import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { KaraokeWordTiming, SyncDataSourceCompatibility } = require('../LyricsService.js');
const readSource = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const section = (source, startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `missing production section: ${startMarker}`);
    return source.slice(start, end);
};
const editor = vm.createContext({ window: {}, Spicetify: {}, console });
vm.runInContext(`${section(readSource('SyncDataCreator.js'), 'const SYNC_CREATOR_', 'const SyncDataCreator =')}
    globalThis.normalize = normalizeLoadedSyncCreatorBodyForLyrics;
    globalThis.fingerprint = getSyncCreatorLyricsFingerprintFromText;`, editor);
const renderer = vm.createContext({ window: {}, Spicetify: {}, console, KaraokeWordTiming, SyncDataSourceCompatibility });
vm.runInContext(`${section(readSource('LyricsService.js'), 'const SyncDataService = (() => {', 'window.SyncDataService = SyncDataService;')}
    globalThis.apply = SyncDataService.applySyncDataToLyrics;`, renderer);
const addon = vm.createContext({});
vm.runInContext(`${section(readSource('Addon_Lyrics_Lrclib.js'), 'function getSyncDataLineCharCounts(', 'function hasExactLineCharCountMatch(')}
    globalThis.counts = getSyncDataLineCharCounts;`, addon);
const plain = value => JSON.parse(JSON.stringify(value));
const sourceRows = ['ABCDEFG', 'HIJKLMNOP', 'QRSTUVWXYZ'];
const makeSync = (rows = sourceRows) => {
    let start = 0;
    return { version: 2, lines: rows.map((text, row) => {
        const length = Array.from(text.normalize('NFC')).length;
        const line = { start, end: start + length - 1, chars: Array.from({ length }, (_, index) => row * 10 + index / 10 + 1) };
        start += length;
        return line;
    }) };
};
const apply = (rows, body, options) => renderer.apply(rows.map(text => ({ text })), { provider: 'lrclib', syncData: body }, options);
const withSource = (body, rows = sourceRows) => ({ ...body, source: {
    provider: 'lrclib', lrclibId: '123', lineCharCounts: rows.map(text => Array.from(text).length),
    lyricsFingerprint: editor.fingerprint(rows.join('\n'))
} });

test('changed row boundaries are rejected before legacy ranges can join or truncate lyrics', () => {
    const body = makeSync();
    const redistributed = ['ABCDEFGHIJ', 'KLMNOPQR', 'STUVWXYZ']; // Same characters and total length, different rows.
    assert.equal(editor.normalize(body, redistributed.join('\n')), null);
    assert.equal(apply(redistributed, body), null);
    assert.equal(apply(['AB', 'CD'], body), null, 'shorter source also rejects out-of-bounds ranges');
});

test('matching legacy source keeps its exact character timings without mutating the submission', () => {
    const body = makeSync();
    const before = JSON.stringify(body);
    assert.equal(editor.normalize(body, sourceRows.join('\n')), body);
    const rendered = plain(apply(sourceRows, body));
    assert.deepEqual(rendered.map(line => line.text), sourceRows);
    assert.deepEqual(rendered.map(line => line.syllables.map(syllable => syllable.startTime)),
        body.lines.map(line => line.chars.map(time => Math.round(time * 1000))));
    assert.equal(JSON.stringify(body), before);
});

test('partial legacy submissions can retain complete matching rows at nonzero offsets', () => {
    const body = makeSync();
    body.lines = [body.lines[1]];
    assert.equal(editor.normalize(body, sourceRows.join('\n')), body);
    const rendered = plain(apply(sourceRows, body));
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].text, sourceRows[1]);
});

test('invalid indexes and ranges cutting through source rows are rejected', () => {
    for (const range of [{ start: 1, end: 6 }, { start: 0, end: 7 }, { start: -1, end: 6 },
        { start: 0, end: 6.5 }, { start: '0', end: 6 }, { start: 100, end: 106 }]) {
        const body = { version: 2, lines: [{ ...range, chars: [1] }] };
        assert.equal(editor.normalize(body, sourceRows.join('\n')), null);
        assert.equal(apply(sourceRows, body), null);
    }
});

test('legacy boundaries use normalized Unicode code points and parenthetical source normalization', () => {
    const rows = ['😀é', '한글'];
    const body = makeSync(rows);
    assert.equal(editor.normalize(body, '😀e\u0301\n한글'), body);
    assert.deepEqual(plain(apply(['(😀e\u0301)', '한글'], body)).map(line => line.text), rows);
});

test('source-backed merged ranges retain the existing verified source behavior', () => {
    const body = makeSync();
    body.lines = [{ start: 0, end: 15, chars: [...body.lines[0].chars, ...body.lines[1].chars] }, body.lines[2]];
    const backed = withSource(body);
    assert.equal(editor.normalize(backed, sourceRows.join('\n')), backed);
    assert.deepEqual(plain(apply(sourceRows, backed)).map(line => line.text), [sourceRows[0] + sourceRows[1], sourceRows[2]]);
    assert.equal(editor.normalize(backed, ['abcdefg', ...sourceRows.slice(1)].join('\n')), null, 'fingerprint check stays active');
});

test('playback rejects legacy LRCLIB mismatches when the provider is supplied through result options', () => {
    const result = renderer.apply([{ text: 'AB' }], { syncData: makeSync() }, { result: { provider: 'lrclib' } });
    assert.equal(result, null);
});

test('LRCLIB candidate matching prefers canonical source rows over merged display ranges', () => {
    const body = withSource(makeSync());
    body.lines = [{ start: 0, end: 25, timing: { start: 1 } }];
    assert.deepEqual(plain(addon.counts({ syncData: body })), [7, 9, 10]);
});

test('LRCLIB matching can infer full legacy rows from compact ranges without character arrays', () => {
    const body = makeSync();
    body.lines = body.lines.map(({ start, end }) => ({ start, end, timing: { start: 1 } }));
    assert.deepEqual(plain(addon.counts({ syncData: body })), [7, 9, 10]);
});

test('partial legacy ranges do not masquerade as complete source row counts', () => {
    const body = makeSync();
    body.lines = [body.lines[1], body.lines[2]];
    assert.equal(addon.counts({ syncData: body }), null);
    assert.equal(addon.counts({ syncData: { lines: [{ start: 0, end: -1 }] } }), null);
});
