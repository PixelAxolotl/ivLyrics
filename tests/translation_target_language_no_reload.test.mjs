import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const readSource = (file) =>
	readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// Extract the onChange arrow-function body that belongs to the
// translate:target-language OptionList block in Settings.js.
const readTargetLanguageOnChange = () => {
	const source = readSource("Settings.js");
	const keyMarker = 'key: "translate:target-language"';
	const keyIndex = source.indexOf(keyMarker);
	assert.ok(keyIndex >= 0, "missing translate:target-language setting");
	const onChangeIndex = source.indexOf("onChange:", keyIndex);
	assert.ok(onChangeIndex > keyIndex, "missing onChange for translate:target-language");
	const bodyStart = source.indexOf("{", source.indexOf("=>", onChangeIndex));
	assert.ok(bodyStart > onChangeIndex, "missing onChange body for translate:target-language");
	let depth = 0;
	for (let i = bodyStart; i < source.length; i++) {
		if (source[i] === "{") depth++;
		if (source[i] === "}") {
			depth--;
			if (depth === 0) return source.slice(bodyStart, i + 1);
		}
	}
	assert.fail("unterminated onChange body for translate:target-language");
};

// Changing the translation target language must update lyrics live. A full
// page reload (queueReloadIntoIvLyrics -> window.location.reload) wipes
// scroll position, tears down playback UI state, and needlessly reopens
// settings. Only the interface language needs a reload.
test("translation target language change does not reload the page", () => {
	const handler = readTargetLanguageOnChange();
	assert.ok(
		!handler.includes("queueReloadIntoIvLyrics"),
		"translate:target-language onChange must not queue a page reload",
	);
	assert.ok(
		!handler.includes("location.reload"),
		"translate:target-language onChange must not reload the page",
	);
});

test("translation target language change refreshes translations live", () => {
	const handler = readTargetLanguageOnChange();
	assert.ok(
		handler.includes('new CustomEvent("ivLyrics"'),
		"translate:target-language onChange must dispatch a live config event " +
			"so the Now Playing panel and overlay pick up the new language",
	);
	assert.ok(
		handler.includes("_dmResults"),
		"translate:target-language onChange must invalidate cached translation " +
			"results so the new language is re-requested",
	);
});

// Already-generated translations are served from the in-memory display-mode
// cache. If its key ignores the target language, switching languages keeps
// resolving the previous language's entry and the screen never updates.
const loadDisplayModeCacheKey = () => {
	const source = readSource("index.js");
	const startMarker = "const getDisplayModeCacheKey =";
	const start = source.indexOf(startMarker);
	assert.ok(start >= 0, "missing getDisplayModeCacheKey in index.js");
	const end = source.indexOf("\n};", start);
	assert.ok(end > start, "unterminated getDisplayModeCacheKey in index.js");
	let targetLanguage = "ko";
	const context = vm.createContext({
		getLyricsProcessingShapeSignature: () => "shape",
		getSyncDataRendererCacheVersion: () => "renderer-version",
		getCurrentLyricsPronunciationNotation: () => "latin",
		getCurrentTranslationTargetLanguage: () => targetLanguage,
	});
	vm.runInContext(
		`${source.slice(start, end + 3)}\nglobalThis.getDisplayModeCacheKey = getDisplayModeCacheKey;`,
		context,
	);
	const lyricsState = { uri: "spotify:track:x", provider: "lrclib", cacheVersion: "v1" };
	return {
		keyFor: (mode) => context.getDisplayModeCacheKey(lyricsState, mode),
		setTargetLanguage: (value) => { targetLanguage = value; },
	};
};

test("display-mode cache key varies with translation target language", () => {
	const cacheKey = loadDisplayModeCacheKey();
	cacheKey.setTargetLanguage("ko");
	const koreanKey = cacheKey.keyFor("gemini_ko");
	cacheKey.setTargetLanguage("ja");
	const japaneseKey = cacheKey.keyFor("gemini_ko");
	assert.notEqual(
		japaneseKey,
		koreanKey,
		"translation cache entries must be keyed by target language, " +
			"otherwise a language switch keeps serving the previous language",
	);
});

test("display-mode cache key is stable for one target language", () => {
	const cacheKey = loadDisplayModeCacheKey();
	cacheKey.setTargetLanguage("ko");
	assert.equal(
		cacheKey.keyFor("gemini_ko"),
		cacheKey.keyFor("gemini_ko"),
		"same language must resolve the cached translation instead of refetching",
	);
});

test("phonetic cache key stays shared across target languages", () => {
	const cacheKey = loadDisplayModeCacheKey();
	cacheKey.setTargetLanguage("ko");
	const koreanKey = cacheKey.keyFor("gemini_romaji");
	cacheKey.setTargetLanguage("ja");
	assert.equal(
		cacheKey.keyFor("gemini_romaji"),
		koreanKey,
		"romanized phonetics do not depend on the translation target language " +
			"and must keep sharing one cache entry",
	);
});
