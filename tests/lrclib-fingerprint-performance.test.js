const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "Addon_Lyrics_Lrclib.js"),
  "utf8"
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing production start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing production end marker: ${endMarker}`);
  return source.slice(start, end);
}

function createProductionHarness() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${extract(
      "    function getLyricsTextFingerprint(text) {",
      "\n\n    function getSyncDataLrclibSource"
    )}\n    globalThis.__getLyricsTextFingerprint = getLyricsTextFingerprint;`,
    context,
    { filename: "Addon_Lyrics_Lrclib.fingerprint.extracted.js" }
  );
  return context.__getLyricsTextFingerprint;
}

function getLyricsTextFingerprintReference(text) {
  const value = String(text || "").normalize("NFC");
  let hash = 2166136261;
  for (const char of Array.from(value)) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return `lrclib-${(hash >>> 0).toString(36)}-${Array.from(value).length.toString(36)}`;
}

function createDeterministicStrings(count) {
  let state = 0x6d2b79f5;
  const tokens = [
    "a", "Z", " ", "\n", "é", "e\u0301", "한", "🎵", "👨‍👩‍👧‍👦",
    "\u0000", "\ud800", "\udfff", "：", "|",
  ];
  const strings = [];
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
    const length = (state >>> 0) % 48;
    let value = "";
    for (let offset = 0; offset < length; offset += 1) {
      state = (Math.imul(state ^ (state >>> 13), 0x5bd1e995) + offset) | 0;
      value += tokens[(state >>> 0) % tokens.length];
    }
    strings.push(value);
  }
  return strings;
}

test("LRCLIB addon remains a Spotify-wide extension", () => {
  assert.equal(manifest.subfiles_extension.includes("Addon_Lyrics_Lrclib.js"), true);
  assert.equal(manifest.subfiles.includes("Addon_Lyrics_Lrclib.js"), false);
});

test("lyrics fingerprints preserve normalized Unicode code-point hashing", () => {
  const getLyricsTextFingerprint = createProductionHarness();
  const cases = [
    undefined,
    null,
    false,
    0,
    42,
    "",
    "plain lyrics",
    "e\u0301",
    "é",
    "한글 🎵 lyrics",
    "👨‍👩‍👧‍👦",
    "\ud800A\udfff",
    ...createDeterministicStrings(2500),
  ];

  for (const value of cases) {
    assert.equal(
      getLyricsTextFingerprint(value),
      getLyricsTextFingerprintReference(value)
    );
  }
});

test("lyrics fingerprints preserve input coercion and normalization behavior", () => {
  const getLyricsTextFingerprint = createProductionHarness();
  const calls = [];
  const input = {
    toString() {
      calls.push("toString");
      return "e\u0301 🎵";
    },
  };

  assert.equal(
    getLyricsTextFingerprint(input),
    getLyricsTextFingerprintReference("e\u0301 🎵")
  );
  assert.deepEqual(calls, ["toString"]);
});
