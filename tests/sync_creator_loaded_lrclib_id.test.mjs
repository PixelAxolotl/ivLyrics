import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8');

const slice = (from, to) => {
	const start = source.indexOf(from);
	const end = source.indexOf(to, start + 1);
	assert.ok(start >= 0 && end > start, `the source contains ${from}`);
	return source.slice(start, end);
};

const helpersSource = slice('const normalizeSyncCreatorLrclibId =', 'const isCompleteSyncCreatorLrclibSource =');
const loadLyricsSource = slice('const loadLyrics = useCallback(', '// 제작기에 진입하면');

const TRACK_URI = 'spotify:track:fixture';

const createHarness = ({ snapshot = null, lrclibIdInput = '' } = {}) => {
	const calls = [];
	const applied = [];
	const context = vm.createContext({
		console,
		I18n: { t: key => key },
		useCallback: fn => fn,
		SYNC_CREATOR_SOURCE_ADDON_ID: 'lrclib',
		Spicetify: { Player: { data: { item: { uri: TRACK_URI, duration: { milliseconds: 180000 } } } } },
		trackInfo: { uri: TRACK_URI, artists: [{ name: 'Artist' }], album: { name: 'Album' } },
		trackUri: TRACK_URI,
		trackName: 'Title',
		artistName: 'Artist',
		albumName: 'Album',
		lrclibIdInput,
		window: {
			LyricsService: { getLyricsSnapshot: uri => (uri === TRACK_URI ? snapshot : null) }
		},
		Providers: {
			lrclib: async () => ({ provider: 'lrclib', lrclibId: '222', synced: [{ startTime: 0, text: 'line' }] })
		},
		beginSyncCreatorSourceChange: () => 1,
		isCurrentSyncCreatorSourceChange: () => true,
		clearLrclibCandidateState() {},
		buildSyntheticLrclibResult() { throw new Error('the candidate branch was not selected'); },
		applyLoadedLyricsResult: async result => {
			applied.push(result);
			// The real callback mirrors the loaded entry's id into the box.
			context.setLrclibIdInput(String(result.lrclibId || ''));
			return true;
		}
	});
	for (const [, setter] of loadLyricsSource.matchAll(/\b(set[A-Z]\w*)\b/g)) {
		context[setter] = value => { calls.push([setter, value]); };
	}
	vm.runInContext(
		`${helpersSource}\n${loadLyricsSource}\nglobalThis.loadCreatorLyrics = loadLyrics;`,
		context
	);
	return {
		context,
		calls,
		applied,
		boxValues: () => calls.filter(([name]) => name === 'setLrclibIdInput').map(([, value]) => value)
	};
};

test('the editor prefills the LRCLIB ID box with the id of the lyrics the app is showing', async () => {
	const h = createHarness({
		snapshot: {
			provider: 'lrclib',
			rawResult: { provider: 'lrclib', lrclibSource: { provider: 'lrclib', lrclibId: '5206921' } }
		}
	});
	await h.context.loadCreatorLyrics();
	assert.equal(h.applied.length, 1);
	// The metadata search still picks its own entry, but the box ends on the
	// id of the lyrics the app is currently showing.
	assert.deepEqual(h.boxValues(), ['222', '5206921']);
});

test('the prefill uses the plain LRCLIB id when the loaded lyrics carry no source', async () => {
	const h = createHarness({
		snapshot: { provider: 'lrclib', rawResult: { provider: 'lrclib', lrclibId: '5206921' } }
	});
	await h.context.loadCreatorLyrics();
	assert.deepEqual(h.boxValues(), ['222', '5206921']);
});

test('a hand-typed LRCLIB id is never replaced by the prefill', async () => {
	const h = createHarness({
		lrclibIdInput: '999',
		snapshot: {
			provider: 'lrclib',
			rawResult: { provider: 'lrclib', lrclibSource: { provider: 'lrclib', lrclibId: '5206921' } }
		}
	});
	await h.context.loadCreatorLyrics();
	assert.equal(h.boxValues().includes('5206921'), false);
});

test('lyrics that do not come from the official LRCLIB API never prefill an id', async () => {
	const h = createHarness({
		snapshot: { provider: 'spotify', rawResult: { provider: 'spotify' } }
	});
	await h.context.loadCreatorLyrics();
	assert.deepEqual(h.boxValues(), ['222']);
});

test('local LRCLIB lyrics without an official id never prefill an id', async () => {
	const h = createHarness({
		snapshot: { provider: 'lrclib', rawResult: { provider: 'lrclib', lrclibSource: null } }
	});
	await h.context.loadCreatorLyrics();
	assert.deepEqual(h.boxValues(), ['222']);
});
