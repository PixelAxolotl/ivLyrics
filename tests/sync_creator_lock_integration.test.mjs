import assert from 'node:assert/strict';
import test from 'node:test';
import { createLockedEditor } from './sync_creator_lock_harness.mjs';

for (const [name, start, end, editable] of [
	['prefix', 0, 1, [2, 3, 4, 5]],
	['middle', 2, 3, [0, 1, 4, 5]],
	['suffix', 4, 5, [0, 1, 2, 3]],
]) {
	test(`${name} lock: real ArrowRight listener records every editable character and completes`, () => {
		const h = createLockedEditor();
		assert.equal(h.arm(start, end), true);
		const before = h.times();
		for (const [tap, index] of editable.entries()) {
			h.press('ArrowRight', 20 + tap);
			if (tap < editable.length - 1) assert.equal(h.context.keyboardCharIndexRef.current, index);
		}
		assert.equal(h.advances, 1);
		assert.deepEqual(h.times().slice(start, end + 1), before.slice(start, end + 1));
		assert.ok(h.times().every((time, index, all) => time >= 0 && (index === 0 || time >= all[index - 1])));
		h.dispose();
	});
}

test('ArrowLeft crosses a middle lock without deleting it and can undo the editable prefix', () => {
	const h = createLockedEditor();
	h.arm(2, 3);
	h.press('ArrowRight', 9); h.press('ArrowRight', 10); h.press('ArrowRight', 14);
	assert.equal(h.context.keyboardCharIndexRef.current, 4);
	h.press('ArrowLeft');
	assert.equal(h.context.keyboardCharIndexRef.current, 1);
	assert.deepEqual(h.input().slice(2, 4), [12, 13]);
	assert.equal(h.input()[4], null);
	h.press('ArrowLeft'); h.press('ArrowLeft');
	assert.equal(h.context.isKeyboardSyncingRef.current, false);
	assert.deepEqual(h.input(), [null, null, 12, 13, null, null]);
	assert.deepEqual(h.times(), [10, 11, 12, 13, 14, 15]);
});

test('Enter completion and the complete production normalizer retain an exact middle lock', () => {
	const h = createLockedEditor();
	h.arm(2, 3);
	h.press('ArrowRight', 99);
	h.press('Enter', 100);
	assert.equal(h.advances, 1);
	assert.deepEqual(h.times().slice(2, 4), [12, 13]);
	assert.ok(h.times()[0] < 12 && h.times()[1] < 12);
	assert.ok(h.times()[4] > 13);
});

test('a zero-time locked boundary survives commit without negative prefix marks', () => {
	const h = createLockedEditor({ saved: [0, 0, 0, 0, 1, 2] });
	h.arm(2, 3); h.press('ArrowRight', 20); h.press('Enter', 21);
	assert.deepEqual(h.times().slice(0, 4), [0, 0, 0, 0]);
	assert.ok(h.times().every(time => time >= 0));
});

test('word forward/back and syllable shortcuts use the same protected cursor', () => {
	const h = createLockedEditor({ text: 'AB CD EF', saved: [1, 2, 3, 4, 5, 6, 7, 8] });
	h.arm(3, 4);
	h.press('.', 0.5);
	assert.equal(h.context.keyboardCharIndexRef.current, 2);
	h.press(',', 0.6);
	assert.equal(h.context.isKeyboardSyncingRef.current, false);
	h.press(';', 0.7); h.press(';', 0.8); h.press(';', 0.9); h.press(';', 6);
	assert.equal(h.context.keyboardCharIndexRef.current, 5);
	assert.deepEqual(h.input().slice(3, 5), [4, 5]);
	h.press('Enter', 7);
	assert.deepEqual(h.times().slice(3, 5), [4, 5]);
});

test('held slash completes a suffix lock and stops its keyboard repeat loop', () => {
	const h = createLockedEditor();
	h.arm(3, 5); h.press('/', 9);
	assert.equal(h.advances, 1);
	assert.deepEqual(h.times().slice(3), [13, 14, 15]);
	assert.equal(h.intervals.size, 0);
	h.release('/');
});

test('Backspace cancels the draft and clears the lock without changing saved timings', () => {
	const h = createLockedEditor();
	h.arm(2, 3); h.press('ArrowRight', 9); h.press('Backspace');
	assert.equal(h.context.getActiveRecordingLockRange(), null);
	assert.equal(h.context.isKeyboardSyncingRef.current, false);
	assert.deepEqual(h.times(), [10, 11, 12, 13, 14, 15]);
});

test('a target change removes the range before the next vocal can receive keyboard input', () => {
	const h = createLockedEditor();
	h.arm(2, 3); h.press('ArrowRight', 9);
	h.context.activeParallelTargetId = 'other'; h.refreshKeyboard();
	assert.equal(h.context.getActiveRecordingLockRange(), null);
	assert.equal(h.context.isKeyboardSyncingRef.current, false);
	assert.deepEqual(h.times(), [10, 11, 12, 13, 14, 15]);
});

test('mouse drag across a middle lock uses the same complete commit pipeline', () => {
	const h = createLockedEditor();
	h.arm(2, 3); h.drag(0, [[1, 10], [4, 14], [5, 15]]);
	assert.equal(h.advances, 1);
	assert.deepEqual(h.times(), [9, 10, 12, 13, 14, 15]);
});

test('word interpolation remains enabled around a protected suffix', () => {
	const h = createLockedEditor({ text: 'AB CD EF', saved: [1, 2, 3, 4, 5, 6, 7, 8] });
	h.arm(6, 7); h.press('.', 1); h.press('.', 3);
	assert.equal(h.advances, 1);
	assert.ok(h.times()[1] - h.times()[0] > 0.1, 'word timings retain interpolation rather than collapsing to sequential millisecond marks');
	assert.deepEqual(h.times().slice(6), [7, 8]);
});

test('plain context menu selects one character; another click inside clears selection', () => {
	const h = createLockedEditor(); h.context.mode = 'idle';
	h.contextMenu(2);
	assert.deepEqual(JSON.parse(JSON.stringify(h.context.offsetSelectionRangeRef.current)), { start: 2, end: 2 });
	h.api.adjustCurrentLineOffset(100);
	assert.deepEqual(h.times(), [10, 11, 12.1, 13, 14, 15]);
	h.contextMenu(2);
	assert.equal(h.context.offsetSelectionRangeRef.current, null);
});

test('a plain right-click arms the word under the cursor; a second right-click disarms it', () => {
	const h = createLockedEditor({ text: 'AB CD EF', saved: [1, 2, 3, 4, 5, 6, 7, 8] });
	h.context.mode = 'idle';
	h.context.getGranularityEndIndex = index => (index >= 6 ? 7 : index >= 3 ? 4 : 1);
	h.contextMenu(3);
	assert.deepEqual(JSON.parse(JSON.stringify(h.context.offsetSelectionRangeRef.current)), { start: 3, end: 4 });
	h.api.adjustCurrentLineOffset(100);
	assert.deepEqual(h.times(), [1, 2, 3, 4.1, 5.1, 6, 7, 8]);
	h.contextMenu(3);
	assert.equal(h.context.offsetSelectionRangeRef.current, null);
});

test('queued repeated selection offsets compute from the latest functional state', () => {
	const h = createLockedEditor(); h.context.mode = 'idle'; h.select(1, 2);
	const queued = [], apply = h.context.setSyncData;
	h.context.setSyncData = updater => queued.push(updater);
	h.api.adjustCurrentLineOffset(100); h.api.adjustCurrentLineOffset(100);
	for (const updater of queued) apply(updater);
	assert.deepEqual(h.times(), [10, 11.2, 12.2, 13, 14, 15]);
});

test('selection offsets reject untimed targets and leave other timing marks unchanged', () => {
	const h = createLockedEditor(); h.context.mode = 'idle'; h.select(1, 2);
	h.context.syncData.lines.find(line => line.start === h.context.currentLineStart).chars[1] = null;
	const before = h.times(); h.api.adjustCurrentLineOffset(100);
	assert.deepEqual(h.times(), before);
	assert.ok(h.toasts.includes('syncCreator.selectionOffsetRequiresTiming'));
});

test('locking an untimed middle span never converts missing marks into zero', () => {
	const h = createLockedEditor({ saved: [10, 11, null, 13, 14, 15] });
	assert.equal(h.arm(2, 3), false);
	assert.equal(h.context.getActiveRecordingLockRange(), null);
	assert.ok(h.toasts.includes('settings.syncLockRequiresTiming'));
});

test('a committed zero-boundary lock retains its exact marks through export and reload', async () => {
	const h = createLockedEditor({ saved: [0, 0, 0, 0, 1, 2] });
	h.arm(2, 3); h.press('ArrowRight', 20); h.press('Enter', 21);
	const result = await h.export();
	const saved = result.lines.find(line => line.start === h.context.currentLineStart);
	assert.deepEqual(saved.chars.slice(0, 4), [0, 0, 0, 0]);
	await h.import(result);
	assert.deepEqual(h.times().slice(0, 4), [0, 0, 0, 0]);
});

test('dragging back inside a prefix lock cancels all editable input without committing', () => {
	const h = createLockedEditor();
	h.arm(0, 1); h.drag(2, [[4, 14], [1, 15]], 12);
	assert.equal(h.advances, 0);
	assert.deepEqual(h.times(), [10, 11, 12, 13, 14, 15]);
	assert.deepEqual(h.input(), [10, 11, null, null, null, null]);
});

for (const mode of ['record', 'idle', 'preview']) {
	for (const [start, end] of [[2, 3], [3, 2]]) {
		test(`${mode}: actual right-drag listeners select ${start} to ${end} and suppress the trailing context menu`, () => {
			const h = createLockedEditor(); h.context.mode = mode;
			h.rightDrag(start, end);
			const range = mode === 'record' ? h.context.getActiveRecordingLockRange() : h.context.offsetSelectionRangeRef.current;
			assert.deepEqual(JSON.parse(JSON.stringify(range)), { start: 2, end: 3 });
		});
	}
}

test('navigation or mode changes clear selection and cancel an in-flight right drag', () => {
	const h = createLockedEditor(); h.context.mode = 'preview';
	h.rightDrag(1, 2);
	assert.ok(h.context.offsetSelectionRangeRef.current);
	h.context.isRightOffsetDraggingRef.current = true;
	h.context.rightOffsetDragStartRef.current = 1;
	h.resetSelection({ currentLineIndex: 2, mode: 'idle' });
	assert.equal(h.context.offsetSelectionRangeRef.current, null);
	assert.equal(h.context.isRightOffsetDraggingRef.current, false);
	assert.equal(h.context.rightOffsetDragStartRef.current, -1);
});

test('mouse completion advances after the last editable character before a suffix lock', () => {
	const h = createLockedEditor();
	h.arm(4, 5); h.drag(0, [[1, 10], [2, 11], [3, 12]]);
	assert.equal(h.advances, 1);
	assert.deepEqual(h.times().slice(4), [14, 15]);
});

test('a locked selected vocal commits without moving its sibling or protected marks', () => {
	const h = createLockedEditor();
	h.split(3); h.render('b'); h.refreshKeyboard();
	const siblingBefore = JSON.parse(JSON.stringify(h.context.currentParallelData.parts[0].chars));
	const selectedBefore = JSON.parse(JSON.stringify(h.context.activeParallelPart.chars));
	assert.equal(h.arm(1, 2), true); h.press('ArrowRight', 20);
	const parts = h.line().parallel.parts;
	assert.deepEqual(JSON.parse(JSON.stringify(parts[0].chars)), siblingBefore);
	assert.deepEqual(JSON.parse(JSON.stringify(parts[1].chars.slice(1))), selectedBefore.slice(1));
	assert.equal(h.advances, 1);
});
