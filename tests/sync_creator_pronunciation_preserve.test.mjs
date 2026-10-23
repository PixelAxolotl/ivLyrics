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

const syllableBuilderBody = () => {
  const start = source.indexOf('const buildCharSyllables = (targetChars, targetTimesMs, targetAbsoluteStart)');
  assert.notEqual(start, -1, 'preview syllable builder not found');
  const end = source.indexOf('const parallelParts', start);
  assert.ok(end > start, 'preview syllable builder has no visible end');
  return source.slice(start, end);
};

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

test('untimed non-whitespace keeps its syllable slot instead of shifting later readings', () => {
  const body = syllableBuilderBody();
  assert.ok(
    !body.includes('if (!/\\s/.test(targetChars[charIndex]'),
    'untimed non-whitespace must emit the same placeholder as untimed whitespace'
  );
  assert.ok(body.includes('if (!Number.isFinite(charStart)) {'), 'untimed chars take the placeholder path');
  assert.ok(body.includes('targetAbsoluteStart + charIndex'), 'placeholder keeps the glyph index');
});

test('aligned single-vocal preview keeps the exact edited-line readings call', () => {
  assert.ok(
    source.includes('previewReadings = getCachedPreviewCharReadings(currentLineChars, currentLineCharacterPronunciationMap, currentLineRenderedPronunciationUnits, previewGlyphSize);'),
    'edited-line preview call is byte-identical'
  );
});

test('group centre math is unchanged for word-unit readings', () => {
  assert.ok(/(?:const|let) mid = \(item\.start \+ item\.end\) >> 1;/.test(source), 'word-unit reading sits at mid-group');
  assert.ok(source.includes('const evenWidth = ((item.end - item.start) % 2) === 1;'), 'even-width shift detection unchanged');
  assert.ok(source.includes("chars.slice(item.start, item.end + 1).join('') !== item.text) mid = item.start;"), 'mid falls back to start on text mismatch');
  assert.ok(source.includes("if (/\\s/u.test(chars[mid] ?? '')) mid = item.start;"), 'mid falls back to start on whitespace');
});
