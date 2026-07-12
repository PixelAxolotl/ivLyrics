const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { Worker } = require("node:worker_threads");

const source = fs.readFileSync(
  path.join(__dirname, "..", "NowPlayingPanelLyrics.js"),
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

const regexSource = extract(
  "    const KARAOKE_RTL_STRONG_CHAR_REGEX =",
  "\n    const KARAOKE_TEXT_RUN_FILL_STEPS"
);
const productionDominantSource = extract(
  "    const hasDominantNoWordWrapScript =",
  "\n\n    const getKaraokeDetectedLanguage"
);
const wrapSource = extract(
  "    const shouldWrapKaraokeByWord =",
  "\n\n    const getKaraokeSyllablesText"
);
const parentDominantSource = `    const hasDominantNoWordWrapScript = (text) => {
        const chars = Array.from(typeof text === "string" ? text : "").filter((char) => /\\S/u.test(char));
        if (chars.length === 0) {
            return false;
        }

        const matchedCount = chars.reduce(
            (count, char) => count + (KARAOKE_NO_WORD_WRAP_SCRIPT_REGEX.test(char) ? 1 : 0),
            0
        );
        return matchedCount / chars.length >= 0.45;
    };`;

assert.equal(
  crypto.createHash("sha256").update(parentDominantSource).digest("hex"),
  "00d2ba9eb9922c8eac20c4c1bee57c5e904cb197cd33a880bb81f89a5e3afdd5"
);
assert.equal(regexSource.includes("KARAOKE_NON_WHITESPACE_CHAR_REGEX = /\\S/u"), true);
assert.equal(productionDominantSource.includes("Array.from"), false);
assert.equal(productionDominantSource.includes(".filter("), false);
assert.equal(productionDominantSource.includes(".reduce("), false);

function createHarness(dominantSource) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${regexSource}\n${dominantSource}\n${wrapSource}
     globalThis.__dominant = hasDominantNoWordWrapScript;
     globalThis.__wrap = shouldWrapKaraokeByWord;
     globalThis.__nonWhitespace = KARAOKE_NON_WHITESPACE_CHAR_REGEX;
     globalThis.__noWordWrapScript = KARAOKE_NO_WORD_WRAP_SCRIPT_REGEX;`,
    context,
    { filename: "NowPlayingPanelLyrics.word-wrap.extracted.js" }
  );
  return {
    dominant: context.__dominant,
    wrap: context.__wrap,
    nonWhitespace: context.__nonWhitespace,
    noWordWrapScript: context.__noWordWrapScript,
  };
}

function createHarnesses() {
  return {
    parent: createHarness(parentDominantSource),
    production: createHarness(productionDominantSource),
  };
}

function createDeterministicInputs(count) {
  let state = 0x50414e45;
  const tokens = [
    "", "a", "Z", "0", " ", "\t", "\r", "\n", "\u00a0", "\u1680",
    "\u2003", "\u2028", "\u2029", "\ufeff", "あ", "カ", "漢", "한",
    "ไทย", "ລາວ", "ខ្មែរ", "မြန်မာ", "🎵", "e\u0301", "\ud800", "\udfff",
    "\u0000",
  ];
  const inputs = [];
  for (let inputIndex = 0; inputIndex < count; inputIndex += 1) {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
    const tokenCount = (state >>> 0) % 96;
    let value = "";
    for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
      state = (Math.imul(state ^ (state >>> 13), 0x5bd1e995) + tokenIndex) | 0;
      value += tokens[(state >>> 0) % tokens.length];
    }
    inputs.push(value);
  }
  return inputs;
}

function runWorker(sourceBundle, scenarios) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `const { parentPort, workerData } = require("node:worker_threads");
       ${sourceBundle}
       const output = [];
       for (let round = 0; round < 100; round += 1) {
         for (const scenario of workerData) {
           output.push([
             hasDominantNoWordWrapScript(scenario.text),
             shouldWrapKaraokeByWord(scenario.text, scenario.language)
           ]);
         }
       }
       parentPort.postMessage(output);`,
      { eval: true, workerData: scenarios }
    );
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });
}

function compare(harnesses, text, language) {
  assert.equal(
    harnesses.production.dominant(text),
    harnesses.parent.dominant(text)
  );
  assert.equal(
    harnesses.production.wrap(text, language),
    harnesses.parent.wrap(text, language)
  );
}

test("Now Playing panel stays global while Pages stays page-only", () => {
  assert.equal(manifest.subfiles_extension.includes("NowPlayingPanelLyrics.js"), true);
  assert.equal(manifest.subfiles.includes("NowPlayingPanelLyrics.js"), false);
  assert.equal(manifest.subfiles.includes("Pages.js"), true);
  assert.equal(manifest.subfiles_extension.includes("Pages.js"), false);
});

test("panel word wrapping preserves threshold and language-prefix behavior", () => {
  const harnesses = createHarnesses();
  const texts = [
    undefined, null, false, 0, 42, {}, [], new String("日本語"), "",
    " \t\r\n\u00a0\u1680\u2003\u2028\u2029\ufeff", "日本語 の 歌詞",
    "English lyrics", "한글 가사", "ああああ aaaaa", "ああああ aaaa",
    "あああああ aaaaaa", "ไทย ລາວ ខ្មែរ မြန်မာ", "🎵🎵🎵 日本語",
    "e\u0301 한글 かな 普通话", "\ud800\udfff\u0000 あ a",
  ];
  const languages = [undefined, null, "", "en", "ja", "ja-JP", "zh-CN", "th", "lo-LA", "ko"];
  for (const text of texts) {
    for (const language of languages) compare(harnesses, text, language);
  }
});

test("panel non-global regexes preserve every Unicode scalar and lastIndex", () => {
  const harnesses = createHarnesses();
  const { nonWhitespace, noWordWrapScript } = harnesses.production;
  const whitespaceReference = /\S/u;
  assert.equal(nonWhitespace.global, false);
  assert.equal(nonWhitespace.sticky, false);
  assert.equal(noWordWrapScript.global, false);
  assert.equal(noWordWrapScript.sticky, false);

  nonWhitespace.lastIndex = 73;
  noWordWrapScript.lastIndex = 91;
  compare(harnesses, "日本語 Latin", "en");
  assert.equal(nonWhitespace.lastIndex, 73);
  assert.equal(noWordWrapScript.lastIndex, 91);
  nonWhitespace.lastIndex = 0;
  noWordWrapScript.lastIndex = 0;

  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    const char = String.fromCodePoint(codePoint);
    assert.equal(nonWhitespace.test(char), whitespaceReference.test(char));
    assert.equal(nonWhitespace.lastIndex, 0);
    compare(harnesses, `${char}${char} あ`, "en");
  }
});

test("30k panel Unicode and invalid UTF-16 inputs match the parent", () => {
  const harnesses = createHarnesses();
  const languages = [undefined, "", "en", "ja-JP", "zh-TW", "ko"];
  const inputs = createDeterministicInputs(30000);
  for (let index = 0; index < inputs.length; index += 1) {
    compare(harnesses, inputs[index], languages[index % languages.length]);
  }
});

test("parallel panel word-wrap classifications remain isolated", async () => {
  const harnesses = createHarnesses();
  const sourceBundle = `${regexSource}\n${productionDominantSource}\n${wrapSource}`;
  const workers = Array.from({ length: 12 }, (_, workerIndex) =>
    createDeterministicInputs(80).map((text, index) => ({
      text: `${text}${workerIndex % 2 ? " 日本語" : " latin"}`,
      language: index % 3 === 0 ? "en" : (index % 3 === 1 ? "ja-JP" : null),
    }))
  );
  const actual = await Promise.all(workers.map((scenarios) =>
    runWorker(sourceBundle, scenarios)
  ));
  const expected = workers.map((scenarios) => {
    const output = [];
    for (let round = 0; round < 100; round += 1) {
      for (const scenario of scenarios) {
        output.push([
          harnesses.parent.dominant(scenario.text),
          harnesses.parent.wrap(scenario.text, scenario.language),
        ]);
      }
    }
    return output;
  });
  assert.deepEqual(actual, expected);
});
