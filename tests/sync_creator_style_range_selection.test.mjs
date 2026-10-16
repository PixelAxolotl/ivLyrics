import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Partial effects (style ranges) are driven by the main lyric line's
// right-click selection in preview/idle. The old dedicated left-drag
// selection (styleRangeSelection + char grid) is gone.
const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const section = (startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	assert.ok(start >= 0, `missing source section: ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(end > start, `missing source section end: ${endMarker}`);
	return source.slice(start, end);
};

test('style ranges apply to the right-click offset selection', () => {
	const apply = section('const updateCurrentLineStyleRanges =', 'const applySongVocalSpeaker =');
	assert.ok(apply.includes('offsetSelectionRange'), 'must read the right-click selection');
	assert.ok(!apply.includes('styleRangeSelection'), 'must not read the removed grid selection');
});

test('left-drag style selection method is removed', () => {
	for (const token of [
		'beginStyleRangeSelection',
		'extendStyleRangeSelection',
		'styleRangeDragRef',
		'renderStyleRangeCharGrid',
		'renderStyleRangeEditor',
		'isStyleRangeEditorExpanded',
		'selectRangeEffect',
	]) {
		assert.ok(!source.includes(token), `removed method still present: ${token}`);
	}
	assert.ok(!source.includes('styleRangeSelection'), 'removed selection state still present');
});

test('selection style display resolves shared range settings', () => {
	const start = source.indexOf('const resolveSyncCreatorSelectionStyle =');
	assert.ok(start >= 0, 'missing resolveSyncCreatorSelectionStyle');
	const end = source.indexOf('\n};', start);
	const resolve = vm.runInNewContext(
		`${source.slice(start, end + 3)}\nresolveSyncCreatorSelectionStyle;`,
		{}
	);
	const plain = (value) => JSON.parse(JSON.stringify(value));
	const ranges = [
		{ start: 10, end: 12, kind: 'echo', speaker: 'FEMALE 1', 'speaker-color': '#ff0000' },
		{ start: 20, end: 21, kind: 'glow', speaker: 'MALE 1' },
	];
	assert.deepEqual(
		plain(resolve({ start: 10, end: 12 }, ranges)),
		{ kind: 'echo', speaker: 'FEMALE 1', color: '#ff0000', fallback: '', hasOverride: true }
	);
	assert.deepEqual(
		plain(resolve({ start: 10, end: 20 }, ranges)),
		{ kind: '', speaker: '', color: '', fallback: '', hasOverride: true },
		'partially covered selections show no shared setting'
	);
	assert.deepEqual(
		plain(resolve({ start: 14, end: 15 }, ranges)),
		{ kind: '', speaker: '', color: '', fallback: '', hasOverride: false }
	);
	assert.deepEqual(
		plain(resolve(null, ranges)),
		{ kind: '', speaker: '', color: '', fallback: '', hasOverride: false }
	);
});

test('line-level controls route to the selected range', () => {	const effectStart = source.indexOf('const updateCurrentTextEffect =');
	assert.ok(effectStart >= 0, 'missing updateCurrentTextEffect');
	const effectEnd = source.indexOf('const renderLineInspector =', effectStart);
	const effectBody = source.slice(effectStart, effectEnd);
	assert.ok(effectBody.includes('updateCurrentLineStyleRanges'), 'effect picker must write ranges on selection');
	const targetStart = source.indexOf('const selectionStyleTarget =');
	assert.ok(targetStart >= 0 && targetStart < effectStart, 'missing shared selection target');
	const targetBody = source.slice(targetStart, effectStart);
	for (const token of ['offsetSelectionRange', "mode !== 'record'", 'activeParallelPart', 'resolveSyncCreatorSelectionStyle']) {
		assert.ok(targetBody.includes(token), `selection target must account for ${token}`);
	}
	const inspector = section('const renderLineInspector =', 'const renderGranularitySelector =');
	assert.ok(inspector.includes('updateCurrentLineStyleRanges'), 'speaker inspector must write ranges on selection');
	assert.ok(inspector.includes('rangeStyleClear'), 'inspector needs a clear affordance for range overrides');
});

test('clear style sits inline with the speaker title', () => {
	const inspector = section('const renderLineInspector =', 'const renderGranularitySelector =');
	assert.ok(inspector.includes('rangeStyleClear'), 'clear button missing from inspector');
	assert.ok(
		!inspector.includes("justifyContent: 'flex-end'"),
		'clear button must not sit in its own right-aligned row'
	);
	assert.ok(
		inspector.includes("justifyContent: 'space-between'"),
		'clear button must share the title header row'
	);
});

test('speaker subtitle shows the selected range instead of Full line', () => {
	const inspector = section('const renderLineInspector =', 'const renderGranularitySelector =');
	assert.ok(inspector.includes('allLine'), 'line fallback subtitle must stay');
	assert.ok(
		inspector.includes('currentFullLineChars.slice('),
		'subtitle must show the selected text, not character positions'
	);
});

test('first editor startup shows a one-time teaching toast', () => {
	const marker = 'One-time teaching toast on first editor startup';
	const start = source.indexOf(marker);
	assert.ok(start >= 0, 'missing startup toast effect');
	const end = source.indexOf('}, []);', start);
	assert.ok(end > start, 'startup toast must run once on mount');
	const effect = source.slice(start, end);
	assert.ok(effect.includes('offsetSelectionHintShown'), 'toast must be gated on a persisted once-flag');
	assert.ok(effect.includes('syncCreator.offsetSelectionHint'), 'toast must use a translated string');
	assert.ok(effect.includes('Toast.success'), 'toast must use the bottom toast system');
	assert.ok(effect.includes('6000'), 'teaching toast must stay longer than default');
	assert.ok(!effect.includes('offsetSelectionRange'), 'startup toast must not wait for a selection');
});

test('effects hint describes right-drag selection in every locale', () => {
	const files = readdirSync(new URL('../langs', import.meta.url)).filter((file) => file.endsWith('.js'));
	assert.ok(files.length >= 22, `expected 22 locale files, found ${files.length}`);
	for (const file of files) {
		const strings = readFileSync(new URL(`../langs/${file}`, import.meta.url), 'utf8');
		assert.ok(strings.includes('rangeStyleHint'), `${file}: missing rangeStyleHint`);
	}
	const english = readFileSync(new URL('../langs/LangEn.js', import.meta.url), 'utf8');
	assert.ok(
		english.includes('Right-drag'),
		'English hint must describe the right-drag gesture'
	);
});

test('pressing empty box area clears any selection', () => {
	const box = section('const handleContainerMouseDown =', 'const handleGlobalMove');
	assert.ok(
		/if \(charIndex < 0\) \{\s*clearOffsetSelection\(\);\s*clearRecordingLock\(\);\s*return;\s*\}/.test(box),
		'right-button empty press must clear offset and lock selections'
	);
	assert.ok(box.includes('clearRecordingLock()'), 'box presses must be able to clear the lock');
	const menuStart = source.indexOf('const handleCharacterContextMenu =');
	assert.ok(menuStart >= 0, 'missing handleCharacterContextMenu');
	const menuEnd = source.indexOf('const clearOffsetSelection =', menuStart);
	const menu = source.slice(menuStart, menuEnd > menuStart ? menuEnd : undefined);
	assert.ok(
		/if \(charIndex === null \|\| charIndex < 0\) \{\s*clearOffsetSelection\(\);\s*clearRecordingLock\(\);\s*return;\s*\}/.test(menu),
		'empty-area context menu must clear offset and lock selections instead of clamping to char 0'
	);
});
