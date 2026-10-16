import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// The preview playback painter must not clobber per-character effect
// colors: each span stores its React-rendered color in
// data-iv-sync-creator-base-color, and the painter has to restore that
// instead of stamping the line-level speaker color over it.
const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const slice = (startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	assert.ok(start >= 0, `missing source section: ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(end > start, `missing source section end: ${endMarker}`);
	return source.slice(start, end);
};

const loadPainter = () => {
	const elements = [0, 1, 2].map(() => ({
		style: {},
		dataset: { ivSyncCreatorSynced: '1', ivSyncCreatorBaseColor: '#effect' },
	}));
	const context = vm.createContext({
		useCallback: (fn) => fn,
		charElementsRef: { current: elements },
		getPreviewCharsForLine: () => [10, 20, 30],
		currentLineIndex: 0,
		currentLineChars: ['a', 'b', 'c'],
		currentLineDirection: 'ltr',
		currentSpeakerMutedColor: '#muted',
		currentSpeakerTextColor: '#line',
		useCurrentLineTextRun: false,
		lastPaintedPlaybackIndexRef: { current: -2 },
		rtlTextRunRef: { current: null },
		SYNC_CREATOR_PROGRESS_BACKGROUND: 'progress',
		SYNC_CREATOR_SYNCED_BACKGROUND: 'synced',
	});
	vm.runInContext(
		slice('const isFiniteSyncCreatorTime =', 'const roundSyncCreatorTime =')
			+ '\n'
			+ slice('const hasOrderedSyncCreatorTimes =', 'const hasReusableSyncCreatorParallelChars =')
			+ '\n'
			+ slice('const applyPlaybackProgressVisual =', 'useEffect(() => {\n\t\tcharElementsRef.current = [];')
			+ '\nglobalThis.__paint = applyPlaybackProgressVisual;',
		context
	);
	return { paint: context.__paint, elements };
};

test('playback repaint keeps per-character effect colors', () => {
	const { paint, elements } = loadPainter();
	paint(1, 25);
	for (const element of elements) {
		assert.equal(element.style.color, '#effect');
	}
});

test('chars without a stored base color still fall back to the line color', () => {
	const { paint, elements } = loadPainter();
	for (const element of elements) delete element.dataset.ivSyncCreatorBaseColor;
	paint(1, 25);
	for (const element of elements) {
		assert.equal(element.style.color, '#line');
	}
});

test('rendered spans store the per-character color for the painter', () => {
	assert.ok(
		source.includes('const baseColor = !options.wordSpacer ? (inlineStyleColor || currentSpeakerTextColor)'),
		'char spans must persist the resolved per-char color in data-iv-sync-creator-base-color'
	);
});
