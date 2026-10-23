import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Fixture markers use \n, so normalize CRLF checkouts before slicing.
const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const effectSource = (() => {
	const start = source.indexOf('\tuseEffect(() => {\n\t\tconst handleLineNavigationShortcut =');
	const end = source.indexOf('\tconst goToFirstLine =', start);
	assert.ok(start >= 0 && end > start, 'missing line navigation effect');
	return source.slice(start, end);
})();

const makeEvent = (key, target = {}, changes = {}) => {
	const result = {
		key, target,
		ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
		defaultPrevented: false, stopped: false,
		preventDefault() { result.defaultPrevented = true; },
		stopPropagation() { result.stopped = true; },
		...changes,
	};
	return result;
};

const createEditor = (mode) => {
	let handler = null;
	const navigated = [], toggled = [];
	const context = vm.createContext({
		mode, lyricsText: 'word', lyricsLines: ['word'],
		goToNextSyncTarget: () => navigated.push('next'),
		goToPreviousSyncTarget: () => navigated.push('prev'),
		toggleMode: value => toggled.push(value),
		useEffect: (effect) => { effect(); },
		window: {
			addEventListener: (name, fn) => { if (name === 'keydown') handler = fn; },
			removeEventListener: () => {},
		},
	});
	vm.runInContext(effectSource, context);
	assert.equal(typeof handler, 'function', 'keydown listener was not registered');
	return {
		press: (key, target, changes) => {
			const ev = makeEvent(key, target, changes);
			handler(ev);
			return ev;
		},
		navigated, toggled,
	};
};

test('preview mode exits to the default state and moves the line on ArrowUp', () => {
	const editor = createEditor('preview');
	const up = editor.press('ArrowUp');
	assert.deepEqual(editor.toggled, ['preview']);
	assert.deepEqual(editor.navigated, ['prev']);
	assert.equal(up.defaultPrevented, true);
	assert.equal(up.stopped, true);
});

test('preview mode exits to the default state and moves the line on ArrowDown', () => {
	const editor = createEditor('preview');
	editor.press('ArrowDown');
	assert.deepEqual(editor.toggled, ['preview']);
	assert.deepEqual(editor.navigated, ['next']);
});

test('record and idle modes keep navigating lines', () => {
	const record = createEditor('record');
	record.press('ArrowDown');
	assert.deepEqual(record.navigated, ['next']);
	assert.deepEqual(record.toggled, []);
	const idle = createEditor('idle');
	idle.press('ArrowUp');
	assert.deepEqual(idle.navigated, ['prev']);
	assert.deepEqual(idle.toggled, []);
});

test('preview exit keeps the modifier and text-field guards', () => {
	const editor = createEditor('preview');
	editor.press('ArrowDown', {}, { ctrlKey: true });
	assert.deepEqual(editor.toggled, [], 'modified arrow must not exit preview');
	assert.deepEqual(editor.navigated, []);
	const inInput = editor.press('ArrowDown', { tagName: 'INPUT' });
	assert.deepEqual(editor.toggled, [], 'typing field arrow must not exit preview');
	assert.equal(inInput.defaultPrevented, false);
});
