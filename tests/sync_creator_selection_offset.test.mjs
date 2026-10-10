import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8');
const slice = (startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(start >= 0 && end > start, `missing source section: ${startMarker}`);
	return source.slice(start, end);
};

const context = vm.createContext({});
vm.runInContext(
	slice('const normalizeSyncCreatorLockRange =', 'const getSyncCreatorLockedPlaybackProgressIndex =') +
	'\nglobalThis.__selectionHelpers = { shiftSyncCreatorSelectionTimes };',
	context
);
const { shiftSyncCreatorSelectionTimes } = context.__selectionHelpers;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('shifts only the selected characters', () => {
	const result = plain(shiftSyncCreatorSelectionTimes([10, 11, 12, 13, 14], 1, 3, 0.5, 0.01));
	assert.deepEqual(result, { ok: true, times: [10, 11.5, 12.5, 13.5, 14] });
});

test('negative delta is bounded by the selected minimum and floored at zero', () => {
	const result = plain(shiftSyncCreatorSelectionTimes([0.2, 1, 2, 3, 4], 0, 4, -1, 0.01));
	assert.deepEqual(result, { ok: true, times: [0, 0.8, 1.8, 2.8, 3.8] });
});

test('front collision clamps against the next unselected neighbor', () => {
	const result = plain(shiftSyncCreatorSelectionTimes([10, 11, 12, 20, 21], 0, 2, 9, 0.01));
	assert.deepEqual(result, { ok: true, times: [19, 19.98, 19.99, 20, 21] });
});

test('back collision clamps against the previous unselected neighbor', () => {
	const result = plain(shiftSyncCreatorSelectionTimes([10, 20, 21, 22, 30], 1, 3, -15, 0.01));
	assert.deepEqual(result, { ok: true, times: [10, 10.01, 10.02, 10.03, 30] });
});

test('null neighbors are skipped when finding clamp anchors', () => {
	const result = plain(shiftSyncCreatorSelectionTimes([10, null, 12], 0, 0, 1, 0.01));
	assert.deepEqual(result, { ok: true, times: [11, null, 12] });
});

test('untimed characters inside the selection reject the offset', () => {
	const result = plain(shiftSyncCreatorSelectionTimes([10, null, 12], 0, 2, 1, 0.01));
	assert.deepEqual(result.ok, false);
});

test('invalid ranges reject the offset', () => {
	assert.deepEqual(plain(shiftSyncCreatorSelectionTimes([10, 11], 2, 1, 1, 0.01)).ok, false);
	assert.deepEqual(plain(shiftSyncCreatorSelectionTimes([10, 11], 0, 5, 1, 0.01)).ok, false);
	assert.deepEqual(plain(shiftSyncCreatorSelectionTimes([10, 11], 0, 1, Number.NaN, 0.01)).ok, false);
});
