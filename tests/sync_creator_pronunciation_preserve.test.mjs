import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../SyncDataCreator.js", import.meta.url), "utf8");
const startMarker = "const isSyncCreatorCharacterPronunciationCompatible = (result, lyricsLines) => {";
const from = source.indexOf(startMarker);
assert.ok(from >= 0, "missing isSyncCreatorCharacterPronunciationCompatible");
const to = source.indexOf("\n};", from);
assert.ok(to > from, "missing compat function end");
const snippet = source.slice(from, to + "\n};".length);
const isCompatible = new Function(`${snippet}; return isSyncCreatorCharacterPronunciationCompatible;`)();

const buildLine = (text, readings, index) => ({
	index,
	chars: Array.from(String(text || "")).map((char, i) => ({
		i,
		char,
		pronunciation: readings ? String(readings[i] ?? "") : "",
	})),
});

test("compatible result with readings passes", () => {
	const lyricsLines = ["hello world", "second line"];
	const result = {
		lines: [
			buildLine(lyricsLines[0], Array.from(lyricsLines[0]).map((_, i) => `p${i}`), 0),
			buildLine(lyricsLines[1], Array.from(lyricsLines[1]).map((_, i) => `q${i}`), 1),
		],
	};
	assert.equal(isCompatible(result, lyricsLines), true);
});

test("all-empty second line fails", () => {
	const lyricsLines = ["hello world", "second line"];
	const result = {
		lines: [
			buildLine(lyricsLines[0], Array.from(lyricsLines[0]).map((_, i) => `p${i}`), 0),
			buildLine(lyricsLines[1], Array.from(lyricsLines[1]).map(() => ""), 1),
		],
	};
	assert.equal(isCompatible(result, lyricsLines), false);
});

test("kana-echo line passes", () => {
	const lyricsLines = ["あいう", "second line"];
	const result = {
		lines: [
			buildLine(lyricsLines[0], Array.from(lyricsLines[0]), 0),
			buildLine(lyricsLines[1], Array.from(lyricsLines[1]).map((_, i) => `q${i}`), 1),
		],
	};
	assert.equal(isCompatible(result, lyricsLines), true);
});
