import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Fixture markers use \n, so normalize CRLF checkouts before slicing.
const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const slice = (start, end) => {
	const from = source.indexOf(start);
	const to = source.indexOf(end, from + start.length);
	assert.ok(from >= 0 && to > from, `missing production section: ${start}`);
	return source.slice(from, to);
};
const bindingsSource = slice('\tconst SYNC_CREATOR_SHORTCUTS =', '\tconst formatHotkeyToken =');
const seekSource = slice('\t\t\tconst shortcutBindings = getSyncCreatorShortcutBindings();', '\t\t\tconst isDragHotkey =');

const createSeekPresser = (stored = new Map()) => {
	const context = vm.createContext({
		seeks: [], consumes: [],
		localStorage: { getItem: key => stored.get(key) ?? null },
		Spicetify: { LocalStorage: { get: () => null } },
		window: {},
	});
	vm.runInContext(`${bindingsSource}
		globalThis.press = (ev, progressMs, durationMs = 180000) => {
			const normalizedHotkey = getNormalizedHotkeyFromEvent(ev);
			const e = ev;
			const consumeKeyboardEvent = () => consumes.push('consumed');
			const Spicetify = { Player: {
				getProgress: () => progressMs,
				getDuration: () => durationMs,
				seek: value => seeks.push(value),
			} };
${seekSource}
		};
	`, context);
	const event = (key, target = {}) => ({
		key, code: key, target,
		ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
	});
	return {
		press: (key, progressMs, target) => context.press(event(key, target), progressMs),
		seeks: context.seeks,
		consumes: context.consumes,
	};
};

test('seek keys jump 3 sec by default and 1 sec on their own bindings', () => {
	const editor = createSeekPresser();
	editor.press('z', 10000);
	editor.press('x', 10000);
	editor.press('a', 10000);
	editor.press('s', 10000);
	assert.deepEqual(editor.seeks, [7000, 13000, 9000, 11000]);
});

test('seek jumps clamp at both track edges', () => {
	const editor = createSeekPresser();
	editor.press('z', 500); // 500ms - 3000ms must not go negative
	editor.press('s', 179500); // +1000ms must not pass the 180000ms duration
	assert.deepEqual(editor.seeks, [0, 180000]);
});

test('a rebound primary key seeks and the replaced default no longer does', () => {
	const editor = createSeekPresser(new Map([['ivLyrics:visual:sync-creator-seek-back-key', 'q']]));
	editor.press('q', 10000);
	editor.press('z', 10000);
	assert.deepEqual(editor.seeks, [7000], 'rebound key seeks; replaced default must not');
	assert.equal(editor.consumes.length, 1, 'only the rebound key consumes the event');
});

test('seek keys ignore presses while typing in a field', () => {
	const editor = createSeekPresser();
	editor.press('z', 10000, { tagName: 'INPUT' });
	editor.press('a', 10000, { tagName: 'TEXTAREA' });
	assert.deepEqual(editor.seeks, []);
	assert.deepEqual(editor.consumes, []);
});

test('settings exposes rebind rows for all four seek directions', () => {
	const settings = readFileSync(new URL('../Settings.js', import.meta.url), 'utf8');
	const keys = [
		'sync-creator-seek-back-key', 'sync-creator-seek-back-alt-key',
		'sync-creator-seek-forward-key', 'sync-creator-seek-forward-alt-key',
		'sync-creator-seek-back-1-key', 'sync-creator-seek-back-1-alt-key',
		'sync-creator-seek-forward-1-key', 'sync-creator-seek-forward-1-alt-key',
	];
	for (const key of keys) {
		assert.ok(settings.includes(`"${key}"`), `missing settings key: ${key}`);
	}
});
