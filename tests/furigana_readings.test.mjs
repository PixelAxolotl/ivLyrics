import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Coverage for Japanese reading annotation:
// - a historical kana spelling (想ひ) is sung おもい, so it must not inherit the
//   modern reading of the bare kanji (想 -> そう);
// - kana are annotated only for the listed historical spellings, never through
//   a blanket kana -> sound rule;
// - a ruby that covers several kanji must not have its reading divided evenly.

const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../Pages.js", import.meta.url), "utf8");
const quiet = { log: () => {}, warn: () => {}, error: () => {} };

const slice = (source, startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(start >= 0 && end > start, `${startMarker} .. ${endMarker}`);
	return source.slice(start, end);
};

// Runs the real converter module against a tokenizer backed by a
// surface -> katakana reading table instead of the Kuromoji dictionary.
const loadConverter = (readings) => {
	const moduleSource = `${slice(indexSource, "const FuriganaConverter = (() => {", "\n})();")}})();`;
	const entries = Object.entries(readings).sort((a, b) => b[0].length - a[0].length);
	const tokenizer = {
		tokenize(text) {
			const tokens = [];
			let index = 0;
			while (index < text.length) {
				const entry = entries.find(([surface]) => text.startsWith(surface, index));
				const surface = entry ? entry[0] : text[index];
				tokens.push({ surface_form: surface, reading: entry ? entry[1] : surface });
				index += surface.length;
			}
			return tokens;
		},
	};

	function FakeXMLHttpRequest() {}
	FakeXMLHttpRequest.prototype.open = () => {};

	const window = {
		kuromoji: { builder: () => ({ build: (callback) => callback(null, tokenizer) }) },
		dispatchEvent: () => {},
	};
	const context = vm.createContext({
		window,
		XMLHttpRequest: FakeXMLHttpRequest,
		CustomEvent: class {},
		setTimeout: () => 0,
		console: quiet,
	});
	vm.runInContext(`${moduleSource}\nglobalThis.FuriganaConverter = FuriganaConverter;`, context);
	return context.FuriganaConverter;
};

// 想/唄/買 resolve to their modern single-kanji reading, which is exactly the
// wrong answer for the historical spellings below.
const readings = {
	君: "キミ",
	想: "ソウ",
	思: "オモ",
	雪: "ユキ",
	唄: "ウタ",
	出: "デ",
	買: "カ",
};

test("historical 想ひ is annotated with the sung reading おも + い", async () => {
	const converter = loadConverter(readings);
	await converter.init();

	assert.equal(
		converter.convertToFurigana("想ひ"),
		"<ruby>想<rt>おも</rt></ruby><ruby>ひ<rt>い</rt></ruby>",
	);
});

test("the annotated lyric keeps its text and only adds ruby", async () => {
	const converter = loadConverter(readings);
	await converter.init();

	const result = converter.convertToFurigana("君を想ひ 雪に唄えば");
	assert.equal(
		result,
		"<ruby>君<rt>きみ</rt></ruby>を"
			+ "<ruby>想<rt>おも</rt></ruby><ruby>ひ<rt>い</rt></ruby> "
			+ "<ruby>雪<rt>ゆき</rt></ruby>に<ruby>唄<rt>うた</rt></ruby>えば",
	);
	assert.equal(result.replace(/<rt>[^<]*<\/rt>|<\/?ruby>/g, ""), "君を想ひ 雪に唄えば");
});

test("an unlisted kana ending is not rewritten by a blanket rule", async () => {
	const converter = loadConverter(readings);
	await converter.init();

	const result = converter.convertToFurigana("買ひ");
	assert.equal(result, "<ruby>買<rt>か</rt></ruby>ひ");
	assert.ok(!result.includes("<ruby>ひ<"));
});

test("the modern spelling keeps the dictionary behaviour", async () => {
	const converter = loadConverter(readings);
	await converter.init();

	const result = converter.convertToFurigana("想い");
	assert.equal(result, "<ruby>想<rt>そう</rt></ruby>い");
	assert.ok(!result.includes("<ruby>い<"));
});

test("a historical spelling inside a longer word is annotated on its own", async () => {
	const converter = loadConverter(readings);
	await converter.init();

	assert.equal(
		converter.convertToFurigana("思ひ出"),
		"<ruby>思<rt>おも</rt></ruby><ruby>ひ<rt>い</rt></ruby><ruby>出<rt>で</rt></ruby>",
	);
});

test("without an initialized tokenizer the text is returned unchanged", () => {
	const converter = loadConverter(readings);
	assert.equal(converter.convertToFurigana("想ひ"), "想ひ");
});

test("repeated conversions are cached and stable", async () => {
	const converter = loadConverter(readings);
	await converter.init();

	const first = converter.convertToFurigana("想ひ");
	const second = converter.convertToFurigana("想ひ");
	assert.equal(second, first);
});

const loadFuriganaMap = () => {
	const context = vm.createContext({ console: quiet, window: {} });
	vm.runInContext([
		slice(pageSource, "const KARAOKE_COMBINING_MARK_REGEX", "const coalesceKaraokeTimedGraphemes"),
		slice(pageSource, "const buildKaraokeFuriganaMap", "const buildKaraokeTimedChars"),
		"globalThis.api = { buildKaraokeFuriganaMap };",
	].join("\n"), context);
	return context.api.buildKaraokeFuriganaMap;
};

test("a ruby over several kanji keeps the whole reading on its first character", () => {
	const buildFuriganaMap = loadFuriganaMap();

	const map = buildFuriganaMap("<ruby>今日<rt>きょう</rt></ruby>は晴れ");
	assert.equal(map.get(0), "きょう");
	assert.equal(map.has(1), false);
});

test("character positions stay aligned after a multi-kanji ruby", () => {
	const buildFuriganaMap = loadFuriganaMap();

	const map = buildFuriganaMap("お<ruby>大人<rt>おとな</rt></ruby><ruby>人<rt>ひと</rt></ruby>");
	assert.equal(map.get(1), "おとな");
	assert.equal(map.has(2), false);
	assert.equal(map.get(3), "ひと");
});

test("historical kana ruby maps each annotated character", () => {
	const buildFuriganaMap = loadFuriganaMap();

	const map = buildFuriganaMap("君を<ruby>想<rt>おも</rt></ruby><ruby>ひ<rt>い</rt></ruby>");
	assert.equal(map.has(0), false);
	assert.equal(map.get(2), "おも");
	assert.equal(map.get(3), "い");
});
