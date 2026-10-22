import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const fixtureUrl = new URL('./sync_creator_segment_offset.test.mjs', import.meta.url);
const fixture = readFileSync(fixtureUrl, 'utf8');
const fixtureStart = fixture.indexOf('const source =');
const fixtureEnd = fixture.indexOf("test('manual split offset");
assert.ok(fixtureStart >= 0 && fixtureEnd > fixtureStart);
const { createEditor } = new Function('assert', 'readFileSync', 'createRequire', 'pathToFileURL', 'vm',
	fixture.slice(fixtureStart, fixtureEnd).replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href))
	+ '\nreturn { createEditor };')(assert, readFileSync, createRequire, pathToFileURL, vm);
const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8');
const section = (start, end) => {
	const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
	assert.ok(from >= 0 && to > from, start);
	return source.slice(from, to);
};

// Run the shipping event listeners, lock callbacks and complete commit pipeline.
// Only React state/effect hosting, playback time and document events are replaced.
export function createLockedEditor({ text = 'ABCDEF', saved = [10, 11, 12, 13, 14, 15] } = {}) {
	const editor = createEditor({ rows: ['PRE', text, 'TAIL'] });
	const { context } = editor;
	editor.line().chars = [...saved];
	editor.render();
	let progress = 0, advances = 0;
	const events = new Map(), intervals = new Map(), toasts = [], setters = [];
	const extra = [
		section('\tconst SYNC_CREATOR_DRAG_INITIAL_BURST_STEPS =', '\tconst countRangeChars ='),
		section('\tconst setRecordingLockIndexValue =', '\t// 트랙 정보'),
		section('\tconst getCurrentSyncTargetSavedChars =', '\tconst currentLineText ='),
		section('\tconst [offsetSelectionRange, setOffsetSelectionRange]', '\tconst applyRecordingLockRange ='),
		section('\tconst applyRecordingLockRange =', '\n\tuseEffect(() => () => {'),
		section('\tconst handleDragStart =', '\t// Keep timestamps ordered'),
		section('\tconst handleDragEnd =', '\t// 키보드 싱크 상태 ref'),
		section('\tconst handleContainerMouseDown =', '\n\tuseEffect(() => {\n\t\tif (!isDragging)'),
	].join('\n');
	const effect = section('\t// 키보드 이벤트 리스너 등록', '\tconst handleContainerMouseDown =');
	const rightEffect = section('\tuseEffect(() => {\n\t\tconst handleRightMove =', '\t// 현재 줄 싱크 삭제');
	const resetSelectionEffect = section('\t// Clear offset selection whenever', '\tuseEffect(() => {\n\t\tif (!syncLinesByStart');
	Object.assign(context, {
		mode: 'record', currentLineText: text, syncGranularity: 'character', localStorage: { getItem: () => null },
		isDragging: false, dragStartTime: null, dragStartCharIndex: -1,
		currentLineEffectiveSyllableSegments: Array.from(text, (_, index) => ({ start: index, end: index })),
		currentGranularityRanges: [], WORD_GAP_MS: 80, interpolationEnabledRef: { current: true },
		Spicetify: { Player: { getProgress: () => progress * 1000, getDuration: () => 180000 } },
		Toast: { success: value => toasts.push(value), error: value => toasts.push(value) },
		advanceAfterCompletedTarget: () => { advances++; },
		markScoreTimingInput() {},
		cacheCharHitBoxes() {}, getGranularityEndIndex: index => index,
		getGranularityRangeForIndex: index => ({ start: index, end: index }),
		getCharIndexFromPoint: x => Math.max(0, Math.min(Math.round(x), context.currentLineChars.length - 1)),
		useState: initial => [initial, value => { context.offsetSelectionRange = value; }],
		useRef: initial => ({ current: initial }),
		setRecordingProgressIndex: index => { context.recordingCharIndexRef.current = index; },
		setInterval: fn => { const id = intervals.size + 1; intervals.set(id, fn); return id; },
		clearInterval: id => intervals.delete(id),
		useEffect: fn => { context.disposeKeyboard?.(); context.disposeKeyboard = fn(); },
	});
	context.document.addEventListener = (name, fn) => events.set(name, fn);
	context.document.removeEventListener = (name, fn) => { if (events.get(name) === fn) events.delete(name); };
	for (const [, name] of (extra + effect).matchAll(/\b(\w+Ref)\.current/g)) context[name] ??= { current: null };
	Object.assign(context, {
		recordingLockIndexRef: { current: -1 }, recordingLockRangeRef: { current: null },
		recordingCharIndexRef: { current: -1 }, isKeyboardSyncingRef: { current: false },
		keyboardCharIndexRef: { current: -1 }, charTimesRef: { current: [] },
		charHitBoxesRef: { current: [] }, charScrollMetricsRef: { current: [] },
		prevLineIndexRef: { current: context.currentLineIndex },
		prevKeyboardTargetRef: { current: context.activeParallelTargetId },
	});
	for (const [, name] of extra.matchAll(/\b(set[A-Z]\w*)\b/g)) {
		if (context[name]) continue;
		const property = name[3].toLowerCase() + name.slice(4);
		context[name] = value => { setters.push(name); context[property] = typeof value === 'function' ? value(context[property]) : value; };
	}
	vm.runInContext(`Object.assign(globalThis, (() => { ${extra}
		return { getActiveRecordingLockRange, getActiveRecordingLockIndex, getCurrentSyncTargetSavedChars,
			buildLockedCharTimes, getLockClampedRecordingTime, clearRecordingLock, applyRecordingLockRange,
			handleDragStart, handleDragMove, handleDragEnd, handleContainerMouseDown,
			applyOffsetSelectionRange, handleCharacterContextMenu, offsetSelectionRangeRef, offsetSelectionTargetRef, clearOffsetSelection, clearLyricTextSelection,
			getNormalizedHotkeyFromEvent, getSyncCreatorShortcutBindings, readSyncCreatorBooleanSetting, isSyncCreatorDragHotkeyEvent,
			isLeadingChar, isTrailingChar, isWordBoundary, getSequentialSyncTime, getPreviousRecordedSyncTime, getLastRecordedSyncIndex,
			estimateSegmentDuration, estimateWordInterpolationDuration, applyInterpolatedRangeToCharTimes,
			smoothStepInterpolation, SYNC_CREATOR_AUTO_BOUNDARY_CHARS_KEY,
			SYNC_CREATOR_DRAG_INITIAL_BURST_STEPS, SYNC_CREATOR_DRAG_INTERVAL_MS, EDGE_INTERPOLATION_GAP_SEC };
	})());`, context);
	const refreshKeyboard = () => vm.runInContext(effect, context);
	refreshKeyboard();
	context.useEffect = fn => { context.disposeRight?.(); context.disposeRight = fn(); };
	vm.runInContext(rightEffect, context);
	const event = (key, changes = {}) => ({ key, code: key, target: {}, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...changes });
	return {
		...editor, context, toasts, setters, intervals,
		get advances() { return advances; },
		arm: (start, end = start) => context.applyRecordingLockRange(start, end),
		press: (key, at = progress, changes) => { progress = at; events.get('keydown')(event(key, changes)); },
		release: key => events.get('keyup')(event(key)),
		select: (start, end) => context.applyOffsetSelectionRange(start, end),
		contextMenu: index => context.handleCharacterContextMenu(index, event('ContextMenu')),
		rightDrag: (start, end) => {
			context.handleContainerMouseDown(event('mousedown', { button: 2, clientX: start, clientY: 0 }));
			events.get('mousemove')(event('mousemove', { buttons: 2, clientX: end, clientY: 0 }));
			events.get('mouseup')(event('mouseup', { type: 'mouseup', button: 2, clientX: end, clientY: 0 }));
			context.handleCharacterContextMenu(end, event('ContextMenu'));
		},
		resetSelection: changes => {
			Object.assign(context, changes);
			const hostEffect = context.useEffect; context.useEffect = fn => fn();
			vm.runInContext(resetSelectionEffect, context); context.useEffect = hostEffect;
		},
		drag: (start, moves, at = 9) => {
			progress = at; context.handleDragStart(start, event('mousedown'));
			for (const [index, time] of moves) { progress = time; context.handleDragMove(index, event('mousemove')); }
			context.handleDragEnd(event('mouseup'));
		},
		refreshKeyboard: () => {
			const hostEffect = context.useEffect;
			context.useEffect = fn => { context.disposeKeyboard?.(); context.disposeKeyboard = fn(); };
			refreshKeyboard(); context.useEffect = hostEffect;
		},
		dispose: () => { context.disposeKeyboard?.(); context.disposeRight?.(); },
		input: () => JSON.parse(JSON.stringify(context.charTimesRef.current)),
		times: () => JSON.parse(JSON.stringify(editor.line().chars)),
	};
}
