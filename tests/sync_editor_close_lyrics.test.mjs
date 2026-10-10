import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const constantsStart = source.indexOf("const KARAOKE =");
const constantsEnd = source.indexOf("const VINYL_TYPOGRAPHY_DEFAULT_SCALE", constantsStart);
const modeMethodsStart = source.indexOf("  isModeAvailable(mode,");
const modeMethodsEnd = source.indexOf("\n  render() {", modeMethodsStart);
const resolveStart = source.indexOf("  resolveLyricsForMode(lyricsState, mode) {");
const resolveEnd = source.indexOf("\n  lyricsSource(lyricsState, mode) {", resolveStart);
assert.ok(constantsStart >= 0 && constantsEnd > constantsStart);
assert.ok(modeMethodsStart >= 0 && modeMethodsEnd > modeMethodsStart);
assert.ok(resolveStart >= 0 && resolveEnd > resolveStart);

const createSelector = (state = {}, karaokeEnabled = true, modes = ["karaoke", "synced", "unsynced"]) => {
	const context = vm.createContext({
		CONFIG: { visual: { "karaoke-mode-enabled": karaokeEnabled }, modes },
	});
	vm.runInContext(
		`${source.slice(constantsStart, constantsEnd)}
     class ModeSelector {
       ${source.slice(modeMethodsStart, modeMethodsEnd)}
       ${source.slice(resolveStart, resolveEnd)}
     }
     globalThis.selector = new ModeSelector();`,
		context
	);
	context.selector.state = { lockedMode: -1, explicitMode: -1, ...state };
	return context.selector;
};

const line = { text: "Test lyric", startTime: 1000, endTime: 2000 };
const lyrics = [line];

test("empty lyric arrays are not treated as available modes", () => {
	const selector = createSelector();
	assert.equal(selector.isModeAvailable(0, { karaoke: [] }), false);
	assert.equal(selector.isModeAvailable(1, { synced: [] }), false);
	assert.equal(selector.isModeAvailable(2, { unsynced: [] }), false);
	assert.equal(selector.isModeAvailable(0, { karaoke: lyrics }), true);
	assert.equal(selector.isModeAvailable(1, { synced: lyrics }), true);
	assert.equal(selector.isModeAvailable(2, { unsynced: lyrics }), true);
});

test("automatic mode skips empty karaoke after the sync editor closes", () => {
	const selector = createSelector({ karaoke: [], synced: lyrics, unsynced: lyrics });
	assert.equal(selector.getAutomaticMode(), 1);
	assert.equal(createSelector({ karaoke: [], synced: [], unsynced: lyrics }).getAutomaticMode(), 2);
	assert.equal(createSelector({ karaoke: [], synced: [], unsynced: [] }).getAutomaticMode(), -1);
});

test("resolveLyricsForMode falls through empty arrays instead of blanking the page", () => {
	const selector = createSelector({ karaoke: [], synced: lyrics, unsynced: lyrics });
	assert.strictEqual(selector.resolveLyricsForMode(selector.state, 0), lyrics);
	assert.strictEqual(
		createSelector({ karaoke: [], synced: [], unsynced: lyrics }).resolveLyricsForMode(
			{ karaoke: [], synced: [], unsynced: lyrics }, 1
		),
		lyrics
	);
	assert.equal(
		createSelector({}).resolveLyricsForMode({ karaoke: [], synced: [], unsynced: [] }, 1),
		null
	);
});

test("closing the sync editor forces a lyrics re-derive on the next render", () => {
	const visibilityStart = source.indexOf("this.handleSyncCreatorVisibility = (event) => {");
	const visibilityEnd = source.indexOf("window.addEventListener(\"ivLyrics:sync-creator-visibility\"", visibilityStart);
	assert.ok(visibilityStart >= 0 && visibilityEnd > visibilityStart);
	const visibilityBody = source.slice(visibilityStart, visibilityEnd);
	assert.ok(visibilityBody.includes("this.lastProcessedMode = null"));
	assert.ok(visibilityBody.includes("this.lastProcessedUri = null"));
});
