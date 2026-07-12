const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { Worker } = require("node:worker_threads");

const source = fs.readFileSync(path.join(__dirname, "..", "Pages.js"), "utf8");
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
  "const KARAOKE_NO_WORD_WRAP_SCRIPT_REGEX =",
  "\nconst KARAOKE_RTL_STRONG_CHAR_REGEX"
);
const productionFunctionSource = extract(
  "const hasDominantNoWordWrapScript =",
  "\n\nconst shouldWrapKaraokeByWord"
);
const parentFunctionSource = `const hasDominantNoWordWrapScriptReference = (text) => {
\tconst chars = Array.from(typeof text === "string" ? text : "").filter((char) => /\\S/u.test(char));
\tif (chars.length === 0) {
\t\treturn false;
\t}

\tconst matchedCount = chars.reduce(
\t\t(count, char) => count + (KARAOKE_NO_WORD_WRAP_SCRIPT_REGEX.test(char) ? 1 : 0),
\t\t0
\t);
\treturn matchedCount / chars.length >= 0.45;
};`;

assert.equal(
  crypto.createHash("sha256").update(
    parentFunctionSource.replace(
      "hasDominantNoWordWrapScriptReference",
      "hasDominantNoWordWrapScript"
    )
  ).digest("hex"),
  "937a1de71a0f3480c9507843ae1de99adeeea7592b243ebc0d29d69c178a2242"
);
assert.equal(regexSource.includes("KARAOKE_NON_WHITESPACE_CHAR_REGEX = /\\S/u"), true);
assert.equal(productionFunctionSource.includes("Array.from"), false);
assert.equal(productionFunctionSource.includes(".filter("), false);
assert.equal(productionFunctionSource.includes(".reduce("), false);

function createHarness() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${regexSource}\n${parentFunctionSource}\n${productionFunctionSource}
     globalThis.__parent = hasDominantNoWordWrapScriptReference;
     globalThis.__production = hasDominantNoWordWrapScript;
     globalThis.__nonWhitespace = KARAOKE_NON_WHITESPACE_CHAR_REGEX;
     globalThis.__noWordWrapScript = KARAOKE_NO_WORD_WRAP_SCRIPT_REGEX;`,
    context,
    { filename: "Pages.word-wrap.extracted.js" }
  );
  return {
    parent: context.__parent,
    production: context.__production,
    nonWhitespace: context.__nonWhitespace,
    noWordWrapScript: context.__noWordWrapScript,
  };
}

function createDeterministicInputs(count) {
  let state = 0x57524150;
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

function runWorker(sourceBundle, inputs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `const { parentPort, workerData } = require("node:worker_threads");
       ${sourceBundle}
       const results = [];
       for (let round = 0; round < 100; round += 1) {
         for (const input of workerData) {
           results.push(hasDominantNoWordWrapScript(input));
         }
       }
       parentPort.postMessage(results);`,
      { eval: true, workerData: inputs }
    );
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });
}

test("Pages stays page-only and the Now Playing panel stays global", () => {
  assert.equal(manifest.subfiles.includes("Pages.js"), true);
  assert.equal(manifest.subfiles_extension.includes("Pages.js"), false);
  assert.equal(manifest.subfiles_extension.includes("NowPlayingPanelLyrics.js"), true);
  assert.equal(manifest.subfiles.includes("NowPlayingPanelLyrics.js"), false);
});

test("word-wrap script dominance preserves fixtures and threshold boundaries", () => {
  const { parent, production } = createHarness();
  const fixtures = [
    undefined,
    null,
    false,
    0,
    42,
    {},
    [],
    new String("日本語"),
    "",
    " \t\r\n\u00a0\u1680\u2003\u2028\u2029\ufeff",
    "日本語",
    "한글 가사",
    "English lyrics",
    "ああああaaaaa",
    "ああああaaaa",
    "あああああaaaaaa",
    "ไทย ລາວ ខ្មែរ မြန်မာ",
    "🎵🎵🎵 日本語",
    "e\u0301 한글 かな 普通话",
    "\ud800\udfff\u0000 あ a",
  ];
  for (const input of fixtures) assert.equal(production(input), parent(input));
});

test("non-global whitespace classification preserves every Unicode scalar", () => {
  const { parent, production, nonWhitespace, noWordWrapScript } = createHarness();
  const reference = /\S/u;
  assert.equal(nonWhitespace.global, false);
  assert.equal(nonWhitespace.sticky, false);
  assert.equal(noWordWrapScript.global, false);
  assert.equal(noWordWrapScript.sticky, false);

  nonWhitespace.lastIndex = 73;
  noWordWrapScript.lastIndex = 91;
  assert.equal(production("日本語 Latin"), parent("日本語 Latin"));
  assert.equal(nonWhitespace.lastIndex, 73);
  assert.equal(noWordWrapScript.lastIndex, 91);
  nonWhitespace.lastIndex = 0;
  noWordWrapScript.lastIndex = 0;

  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    const char = String.fromCodePoint(codePoint);
    assert.equal(nonWhitespace.test(char), reference.test(char), `U+${codePoint.toString(16)}`);
    assert.equal(nonWhitespace.lastIndex, 0);
    assert.equal(production(`${char}${char}あ`), parent(`${char}${char}あ`));
  }
});

test("30k Unicode and invalid UTF-16 inputs match the parent", () => {
  const { parent, production } = createHarness();
  for (const input of createDeterministicInputs(30000)) {
    assert.equal(production(input), parent(input));
  }
});

test("parallel page word-wrap classifications remain isolated", async () => {
  const { parent } = createHarness();
  const sourceBundle = `${regexSource}\n${productionFunctionSource}`;
  const inputs = Array.from({ length: 12 }, (_, workerIndex) =>
    createDeterministicInputs(80).map((input) => `${input}${workerIndex % 2 ? "日本語" : " latin"}`)
  );
  const actual = await Promise.all(inputs.map((workerInputs) =>
    runWorker(sourceBundle, workerInputs)
  ));
  const expected = inputs.map((workerInputs) => {
    const values = [];
    for (let round = 0; round < 100; round += 1) {
      for (const input of workerInputs) values.push(parent(input));
    }
    return values;
  });
  assert.deepEqual(actual, expected);
});
