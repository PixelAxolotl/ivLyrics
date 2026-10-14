import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../Settings.js", import.meta.url), "utf8");
const optionsSource = readFileSync(new URL("../OptionsMenu.js", import.meta.url), "utf8");

const slice = (source, startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	assert.notEqual(start, -1, `start marker not found: ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.notEqual(end, -1, `end marker not found: ${endMarker}`);
	return source.slice(start, end);
};

const LOCAL_URI = "spotify:local:Artist:Album:Song:215";
const OTHER_URI = "spotify:local:Other:Album:Song:180";

const createStorage = (initial = {}) => {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key) => (values.has(key) ? values.get(key) : null),
		setItem: (key, value) => values.set(key, String(value)),
		read: (key) => JSON.parse(values.get(key) || "{}"),
	};
};

// Runs the real local-lyrics methods of the ivLyrics page component.
const createLyricsPage = ({ confirmResult = true, savedUris = [LOCAL_URI, OTHER_URI] } = {}) => {
	const methods = slice(indexSource, "  getLocalLyricsStore() {", "  resetTranslationCache(uri) {");
	const store = Object.fromEntries(savedUris.map((uri) => [uri, { synced: [{ text: "line", startTime: 0 }] }]));
	const storage = createStorage({ "ivLyrics:local-lyrics": JSON.stringify(store) });
	const events = [];
	const toasts = [];
	const reloads = [];
	const confirms = [];
	const context = vm.createContext({
		APP_NAME: "ivLyrics",
		StorageManager: storage,
		CACHE: {},
		CacheManager: { clearByUri() {} },
		Toast: {
			success: (message) => toasts.push(["success", message]),
			error: (message) => toasts.push(["error", message]),
		},
		CustomEvent: class {
			constructor(type, init) {
				this.type = type;
				this.detail = init?.detail;
			}
		},
		Spicetify: { Player: { data: { item: { uri: LOCAL_URI } } } },
		window: {
			confirm: (message) => {
				confirms.push(message);
				return confirmResult;
			},
			dispatchEvent: (event) => events.push(event),
			LyricsService: { clearLyricsSnapshot() {} },
		},
		console,
	});
	vm.runInContext(
		`class LyricsPage {
			constructor() {
				this.state = { uri: null };
				this.currentTrackUri = "${LOCAL_URI}";
			}
			setState(update) {
				Object.assign(this.state, update);
			}
			getText(key, fallback) {
				return fallback;
			}
			getTranslationStates() {
				return {};
			}
${methods}
		}
		globalThis.LyricsPage = LyricsPage;`,
		context
	);
	const page = new context.LyricsPage();
	page.reloadLyrics = async (clearCache) => {
		reloads.push(clearCache);
	};
	return { page, storage, events, toasts, reloads, confirms };
};

test("deleting local lyrics removes only the current track's saved lyrics and reloads", async () => {
	const { page, storage, events, toasts, reloads, confirms } = createLyricsPage();
	assert.equal(page.hasLocalLyricsForCurrentTrack(), true);

	assert.equal(await page.removeLocalLyricsForCurrentTrack(), true);

	const remaining = storage.read("ivLyrics:local-lyrics");
	assert.equal(remaining[LOCAL_URI], undefined, "current track lyrics must be deleted");
	assert.ok(remaining[OTHER_URI], "other tracks must keep their local lyrics");
	assert.equal(page.hasLocalLyricsForCurrentTrack(), false);
	assert.equal(confirms.length, 1, "deletion asks for confirmation");
	assert.deepEqual(reloads, [true], "lyrics and the local-uri cache are reloaded");
	assert.equal(events.length, 1);
	assert.equal(events[0].type, "ivLyrics:local-lyrics-updated");
	assert.deepEqual({ ...events[0].detail }, { trackUri: LOCAL_URI, deleted: true });
	assert.equal(toasts.at(-1)[0], "success");
});

test("cancelling the confirmation keeps the local lyrics", async () => {
	const { page, storage, reloads, events } = createLyricsPage({ confirmResult: false });
	assert.equal(await page.removeLocalLyricsForCurrentTrack(), false);
	assert.ok(storage.read("ivLyrics:local-lyrics")[LOCAL_URI]);
	assert.deepEqual(reloads, []);
	assert.deepEqual(events, []);
});

test("deleting reports when the track has no saved local lyrics", async () => {
	const { page, toasts, confirms } = createLyricsPage({ savedUris: [OTHER_URI] });
	assert.equal(await page.removeLocalLyricsForCurrentTrack(), false);
	assert.equal(confirms.length, 0);
	assert.equal(toasts.at(-1)[0], "error");
});

test("local lyrics menu offers deletion only when the track has saved lyrics", () => {
	const button = slice(optionsSource, "const LyricsProviderSelectButton = react.memo(", "function openRegenerateTranslationChoiceModal(");
	assert.match(button, /const hasLocalLyrics = !!getHasLocalLyrics\?\.\(\);/);
	assert.match(button, /hasLocalLyrics && \{[\s\S]*key: "local-lyrics-delete"[\s\S]*onDeleteLocalLyrics\?\.\(\);/);
	assert.match(button, /\]\.filter\(Boolean\)/);
	assert.match(indexSource, /getHasLocalLyrics: this\.hasLocalLyricsForCurrentTrack,/);
	assert.match(indexSource, /onDeleteLocalLyrics: this\.removeLocalLyricsForCurrentTrack,/);
});

test("cache manager clears local tracks by their local-uri cache id and can delete saved lyrics", () => {
	const helpers = slice(settingsSource, "const LOCAL_LYRICS_STORAGE_KEY", "const LocalCacheManager = () => {");
	const storage = createStorage({
		"ivLyrics:local-lyrics": JSON.stringify({ [LOCAL_URI]: { synced: [] }, [OTHER_URI]: { synced: [] } }),
	});
	const events = [];
	const context = vm.createContext({
		StorageManager: storage,
		CustomEvent: class {
			constructor(type, init) {
				this.type = type;
				this.detail = init?.detail;
			}
		},
		window: { dispatchEvent: (event) => events.push(event) },
		console,
	});
	vm.runInContext(`${helpers}\nglobalThis.helpers = { hasSavedLocalLyrics, deleteSavedLocalLyrics };`, context);
	assert.equal(context.helpers.hasSavedLocalLyrics(LOCAL_URI), true);
	assert.equal(context.helpers.deleteSavedLocalLyrics(LOCAL_URI), true);
	assert.equal(context.helpers.hasSavedLocalLyrics(LOCAL_URI), false);
	assert.equal(context.helpers.hasSavedLocalLyrics(OTHER_URI), true);
	assert.equal(context.helpers.deleteSavedLocalLyrics(LOCAL_URI), false);
	assert.equal(events.length, 1);
	assert.equal(events[0].type, "ivLyrics:local-lyrics-updated");

	const clearCurrent = slice(settingsSource, "  const handleClearCurrent = async () => {", "  // 통계 문자열 생성");
	assert.doesNotMatch(clearCurrent, /split\(':'\)\[2\]/, "local URIs must not be keyed by their artist segment");
	assert.match(clearCurrent, /Utils\.getTranslationCacheId\?\.\(trackUri\)/);
	assert.match(clearCurrent, /hasSavedLocalLyrics\(trackUri\)/);
	assert.match(clearCurrent, /window\.confirm\(/);
});
