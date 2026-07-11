const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "LyricsService.js"),
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
    [
      extract(
        "        const AGGRESSIVE_SCRIPT_REGEX =",
        "\n        const HANGUL_BASE_CODE"
      ),
      extract("        function clamp(value", "\n\n        function parseMs"),
      extract(
        "        function isAggressiveChar(char)",
        "\n\n        function isHangulSyllable"
      ),
      extract(
        "        function estimateAggressiveChunkSize(",
        "\n\n        function getUnitWeight"
      ),
      "globalThis.__tokenizeLine = tokenizeLine;",
    ].join("\n"),
    context,
    { filename: "LyricsService.tokenize-line.extracted.js" }
  );
  return context.__tokenizeLine;
}

const AGGRESSIVE_SCRIPT_REGEX_REFERENCE =
  /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

function clampReference(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isAggressiveCharReference(char) {
  return AGGRESSIVE_SCRIPT_REGEX_REFERENCE.test(char);
}

function estimateAggressiveChunkSizeReference(
  coreToken,
  lineConfidence,
  lineDurationMs
) {
  const charCount = Array.from(coreToken).length;
  if (charCount <= 1) return 1;

  const msPerChar = lineDurationMs / Math.max(1, charCount);
  if (lineConfidence >= 0.62 || msPerChar >= 170) return 1;
  if (lineConfidence >= 0.42 || msPerChar >= 110) return 2;
  return charCount >= 8 ? 3 : 2;
}

function tokenizeLineReference(text, options = {}) {
  if (!text) return [];

  const lineConfidence = clampReference(options.lineConfidence ?? 0.5, 0, 1);
  const lineDurationMs = Math.max(1, options.lineDurationMs ?? 2000);
  const coarseTokens = text.match(/\S+\s*|\s+/g) || [text];
  const units = [];

  for (const token of coarseTokens) {
    if (!token) continue;

    const trimmed = token.trim();
    if (!trimmed) {
      units.push(token);
      continue;
    }

    const shouldSplitAggressively = Array.from(trimmed).some(
      isAggressiveCharReference
    );
    if (!shouldSplitAggressively) {
      units.push(token);
      continue;
    }

    const trailingWhitespaceMatch = token.match(/\s+$/);
    const trailingWhitespace = trailingWhitespaceMatch
      ? trailingWhitespaceMatch[0]
      : "";
    const coreToken = trailingWhitespace
      ? token.slice(0, -trailingWhitespace.length)
      : token;
    const chars = Array.from(coreToken);
    const chunkSize = estimateAggressiveChunkSizeReference(
      coreToken,
      lineConfidence,
      lineDurationMs
    );

    if (!chars.length) {
      units.push(token);
      continue;
    }

    for (let index = 0; index < chars.length; index += chunkSize) {
      const chunk = chars.slice(index, index + chunkSize).join("");
      units.push(
        index + chunkSize >= chars.length && trailingWhitespace
          ? chunk + trailingWhitespace
          : chunk
      );
    }
  }

  return units;
}

function createDeterministicLines(count) {
  let state = 0x51a256;
  const tokens = [
    "latin",
    "123",
    "한글가사",
    "かなカナ",
    "普通话歌词",
    "🎵",
    "e\u0301",
    "\ud800",
    "\udfff",
    " ",
    "\t",
    "\n",
    "\u00a0",
    "\ufeff",
  ];
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
    const tokenCount = 1 + ((state >>> 0) % 18);
    let line = "";
    for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
      state = (Math.imul(state ^ (state >>> 13), 0x5bd1e995) + tokenIndex) | 0;
      line += tokens[(state >>> 0) % tokens.length];
    }
    lines.push(line);
  }
  return lines;
}

test("LyricsService remains a Spotify-wide extension", () => {
  assert.equal(manifest.subfiles_extension.includes("LyricsService.js"), true);
  assert.equal(manifest.subfiles.includes("LyricsService.js"), false);
});

test("CJK tokenization preserves Unicode chunks and whitespace", () => {
  const tokenizeLine = createProductionHarness();
  const lines = [
    "",
    "   ",
    "plain latin lyrics",
    "안녕하세요 반갑습니다 ",
    "君の名前は何ですか\t",
    "普通话歌词同步测试\r\n",
    "🎵한글e\u0301かな 漢字 123",
    "\ud800한\udfff\ufeff",
    ...createDeterministicLines(2500),
  ];
  const options = [
    undefined,
    {},
    { lineConfidence: -1, lineDurationMs: 1 },
    { lineConfidence: 0.31, lineDurationMs: 720 },
    { lineConfidence: 0.42, lineDurationMs: 1100 },
    { lineConfidence: 0.62, lineDurationMs: 1700 },
    { lineConfidence: 2, lineDurationMs: Infinity },
    { lineConfidence: "0.5", lineDurationMs: "900" },
    { lineConfidence: NaN, lineDurationMs: NaN },
  ];

  for (const line of lines) {
    for (const option of options) {
      assert.deepEqual(
        Array.from(tokenizeLine(line, option)),
        tokenizeLineReference(line, option),
        JSON.stringify({ line, option })
      );
    }
  }
});

test("tokenization preserves option getter order and failures", () => {
  const tokenizeLine = createProductionHarness();
  const createOptions = () => {
    const calls = [];
    return {
      calls,
      options: {
        get lineConfidence() {
          calls.push("lineConfidence");
          return 0.31;
        },
        get lineDurationMs() {
          calls.push("lineDurationMs");
          return 720;
        },
      },
    };
  };
  const reference = createOptions();
  const production = createOptions();

  assert.deepEqual(
    Array.from(tokenizeLine("안녕하세요 世界 ", production.options)),
    tokenizeLineReference("안녕하세요 世界 ", reference.options)
  );
  assert.deepEqual(production.calls, reference.calls);
  assert.deepEqual(production.calls, ["lineConfidence", "lineDurationMs"]);

  const expectedError = new Error("duration getter failed");
  assert.throws(
    () => tokenizeLine("한글", {
      lineConfidence: 0.5,
      get lineDurationMs() {
        throw expectedError;
      },
    }),
    (error) => error === expectedError
  );
});
