import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../AIAddonManager.js", import.meta.url), "utf8");

const loadManager = async () => {
	const window = {};
	vm.runInNewContext(source, {
		window,
		Spicetify: { LocalStorage: { get: () => null, set: () => {} } },
		console: { log: () => {}, warn: () => {}, error: () => {} },
		setTimeout, clearTimeout,
	});
	const manager = window.AIAddonManager;
	await manager._initPromise;
	return manager;
};

const slots = (n, fill = "x") => Array.from({ length: n }, (_, i) => (i % 4 === 3 ? "" : `${fill}${i}`));

test("exact slot counts pass through without warnings", async () => {
	const manager = await loadManager();
	const lines = ["abcdef"];
	const result = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: slots(6) }] }, lines, { unitMode: "char" });
	assert.equal(result.lines.length, 1);
	assert.equal(result.lines[0].chars.length, 6);
	assert.equal(result.warnings.length, 0);
});

test("14 slots for 12 chars stay retryable instead of dropping slots", async () => {
	const manager = await loadManager();
	const text = "abcdefghijkl";
	assert.throws(
		() => manager._normalizeCharacterPronunciationResult(
			{ l: [{ i: 0, p: slots(14) }] }, [text], { unitMode: "char" }),
		(error) => {
			assert.equal(error.code, "character-pronunciation-slot-mismatch");
			assert.equal(error.details.got, 14);
			assert.equal(error.details.expected, 12);
			assert.equal(manager._isCharacterPronunciationRetryableError(error), true);
			return true;
		});
});

test("short arrays with unknown missing positions stay retryable", async () => {
	const manager = await loadManager();
	// Reviewer repro: きょうは (4 chars) answered with 3 readings — padding
	// would attach the readings to the wrong characters and drop は.
	assert.throws(
		() => manager._normalizeCharacterPronunciationResult(
			{ l: [{ i: 0, p: ["kyo", "u", "wa"] }] }, ["きょうは"], { unitMode: "char" }),
		(error) => {
			assert.equal(error.code, "character-pronunciation-slot-mismatch");
			assert.equal(error.details.got, 3);
			assert.equal(error.details.expected, 4);
			assert.equal(manager._isCharacterPronunciationRetryableError(error), true);
			return true;
		});
	// Within-tolerance shortfalls are equally position-unknown.
	assert.throws(
		() => manager._normalizeCharacterPronunciationResult(
			{ l: [{ i: 0, p: ["a", "b", "c", "d"] }] }, ["abcdef"], { unitMode: "char" }),
		(error) => {
			assert.equal(error.code, "character-pronunciation-slot-mismatch");
			assert.equal(error.details.got, 4);
			assert.equal(error.details.expected, 6);
			return true;
		});
});

test("whitespace-omitted responses are realigned, not appended", async () => {
	const manager = await loadManager();
	const text = "ab cd";
	const result = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: ["A", "B", "C", "D"] }] }, [text], { unitMode: "char" });
	assert.equal(result.warnings[0].strategy, "reinsert-whitespace");
	assert.equal(result.lines[0].chars[2].pronunciation, "");
	assert.equal(result.lines[0].chars[3].pronunciation, "C");
});

test("gross mismatches still throw a structured retryable error", async () => {
	const manager = await loadManager();
	const text = "abcdefghijkl";
	assert.throws(
		() => manager._normalizeCharacterPronunciationResult(
			{ l: [{ i: 0, p: ["x", "y"] }] }, [text], { unitMode: "char" }),
		(error) => {
			assert.equal(error.code, "character-pronunciation-slot-mismatch");
			assert.equal(error.details.lineIndex, 0);
			assert.equal(error.details.got, 2);
			assert.equal(error.details.expected, 12);
			assert.equal(error.details.preview, text);
			assert.match(error.message, /line 0.*2 slots, expected 12/);
			assert.equal(manager._isCharacterPronunciationFormatError(error), true);
			assert.equal(manager._isCharacterPronunciationRetryableError(error), true);
			return true;
		});
});

test("one missing p array degrades to an empty line; all missing still throws", async () => {
	const manager = await loadManager();
	const partial = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: slots(3) }] }, ["abc", "def"], { unitMode: "char" });
	assert.equal(partial.lines.length, 2);
	assert.equal(partial.lines[1].chars.every(item => !item.pronunciation), true);

	assert.throws(
		() => manager._normalizeCharacterPronunciationResult(
			{ l: [] }, ["abc"], { unitMode: "char" }),
		/missing p array/);
});

test("repair note names the failing line and counts", async () => {
	const manager = await loadManager();
	const error = manager._characterPronunciationSlotError(0, 14, 12, "abcdefghijkl");
	const note = manager._buildCharacterPronunciationRepairNote(error);
	assert.match(note, /chunk line 0.*14.*12/);
	assert.match(note, /exactly 12 strings/);
});

test("prompt requires exact counts and forbids omitting slots", async () => {
	const manager = await loadManager();
	const prompt = manager.buildCharacterPronunciationPrompt({ lines: ["あいう"], lang: "en", unitMode: "char" });
	assert.match(prompt, /p\.length === n/);
	assert.match(prompt, /Never omit array slots/);
	assert.match(prompt, /never omit the slot/);
});

test("prompt requires CJK brackets/punctuation slots to stay empty", async () => {
	const manager = await loadManager();
	const prompt = manager.buildCharacterPronunciationPrompt({ lines: ["あいう"], lang: "en", unitMode: "char" });
	assert.match(prompt, /p\[i\] for 「/);
});

test("「いざや、」 aligned slots pass; shifted slots throw retryable", async () => {
	const manager = await loadManager();
	const text = "「いざや、」";
	const aligned = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: ["", "i", "za", "ya", "", ""] }] }, [text], { unitMode: "char" });
	assert.equal(aligned.lines[0].chars.map(item => item.pronunciation).join("|"), ["", "i", "za", "ya", "", ""].join("|"));
	assert.throws(
		() => manager._normalizeCharacterPronunciationResult(
			{ l: [{ i: 0, p: ["i", "za", "ya", "", "", ""] }] }, [text], { unitMode: "char" }),
		(error) => {
			assert.equal(error.code, "character-pronunciation-slot-mismatch");
			assert.equal(manager._isCharacterPronunciationRetryableError(error), true);
			return true;
		});
});

test("brackets-only line stays empty exempt", async () => {
	const manager = await loadManager();
	const result = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: ["", ""] }] }, ["「」"], { unitMode: "char" });
	assert.equal(result.lines[0].chars.every(item => !item.pronunciation), true);
});

test("latin target おも with romaji passes writing-system validation", async () => {
	const manager = await loadManager();
	const result = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: ["o", "mo"] }] }, ["おも"], { unitMode: "char", lang: "en" });
	assert.equal(result.lines[0].chars.map(item => item.pronunciation).join("|"), "o|mo");
	assert.equal(manager._validateCharacterPronunciationWritingSystem(result, { lang: "en" }), result);
});

test("latin target empty kana slots stay empty instead of echoing kana", async () => {
	const manager = await loadManager();
	const result = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: ["o", ""] }] }, ["おも"], { unitMode: "char", lang: "en" });
	assert.equal(result.lines[0].chars[0].pronunciation, "o");
	assert.equal(result.lines[0].chars[1].pronunciation, "");
	assert.equal(result.warnings.some(warning => warning.reason === "kana-echo"), false);
	assert.equal(manager._validateCharacterPronunciationWritingSystem(result, { lang: "en" }), result);
});

test("latin target all-empty kana line throws slot mismatch, not writing-system error", async () => {
	const manager = await loadManager();
	assert.throws(
		() => manager._normalizeCharacterPronunciationResult(
			{ l: [{ i: 0, p: ["", ""] }] }, ["おも"], { unitMode: "char", lang: "en" }),
		(error) => {
			assert.equal(error.code, "character-pronunciation-slot-mismatch");
			assert.doesNotMatch(error.message, /wrong writing system/);
			assert.equal(manager._isCharacterPronunciationRetryableError(error), true);
			return true;
		});
});

test("kana target おも echoes source characters", async () => {
	const manager = await loadManager();
	const result = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: ["", ""] }] }, ["おも"], { unitMode: "char", lang: "ja" });
	assert.equal(result.lines[0].chars[0].pronunciation, "お");
	assert.equal(result.lines[0].chars[1].pronunciation, "も");
	assert.equal(result.warnings.some(warning => warning.reason === "kana-echo"), true);
});

test("prompt kana rule branches on target script", async () => {
	const manager = await loadManager();
	const latinPrompt = manager.buildCharacterPronunciationPrompt({ lines: ["あいう"], lang: "en", unitMode: "char" });
	assert.match(latinPrompt, /お->o/);
	assert.doesNotMatch(latinPrompt, /お->お/);
	const kanaPrompt = manager.buildCharacterPronunciationPrompt({ lines: ["あいう"], lang: "ja", unitMode: "char" });
	assert.match(kanaPrompt, /お->お/);
});

test("kana-only empty slots echo source characters (おも)", async () => {
	const manager = await loadManager();
	const result = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: ["", ""] }] }, ["おも"], { unitMode: "char" });
	assert.equal(result.lines[0].chars[0].pronunciation, "お");
	assert.equal(result.lines[0].chars[1].pronunciation, "も");
	assert.equal(result.warnings.some(warning => warning.reason === "kana-echo"), true);
});

test("kanji empty slots stay empty", async () => {
	const manager = await loadManager();
	const result = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: ["かん", ""] }] }, ["漢字"], { unitMode: "char" });
	assert.equal(result.lines[0].chars[0].pronunciation, "かん");
	assert.equal(result.lines[0].chars[1].pronunciation, "");
});

test("all-empty kana line throws instead of caching (おも guard)", async () => {
	const manager = await loadManager();
	assert.throws(
		() => manager._normalizeCharacterPronunciationResult(
			{ l: [{ i: 0, p: ["", ""] }] }, ["漢字"], { unitMode: "char" }),
		(error) => {
			assert.equal(error.code, "character-pronunciation-slot-mismatch");
			assert.equal(manager._isCharacterPronunciationRetryableError(error), true);
			return true;
		});
	assert.throws(
		() => manager._normalizeCharacterPronunciationResult(
			{ l: [{ i: 0, p: [""] }] }, ["おも"], { unitMode: "char" }),
		(error) => {
			assert.equal(error.code, "character-pronunciation-slot-mismatch");
			assert.equal(manager._isCharacterPronunciationRetryableError(error), true);
			return true;
		});
	const spacesOnly = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: ["", " ", ""] }] }, [" , "], { unitMode: "char" });
	assert.equal(spacesOnly.lines[0].chars.every(item => !item.pronunciation), true);
});

test("empty small-kana slot stays empty instead of echoing (きゃ)", async () => {
	const manager = await loadManager();
	const result = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: ["ki", ""] }] }, ["きゃ"], { unitMode: "char" });
	assert.equal(result.lines[0].chars[0].pronunciation, "ki");
	assert.equal(result.lines[0].chars[1].pronunciation, "");
});

test("emoji-only line stays empty exempt (🎵)", async () => {
	const manager = await loadManager();
	const result = manager._normalizeCharacterPronunciationResult(
		{ l: [{ i: 0, p: [""] }] }, ["🎵"], { unitMode: "char" });
	assert.equal(result.lines[0].chars.every(item => !item.pronunciation), true);
});
