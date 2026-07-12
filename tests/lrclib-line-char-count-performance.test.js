const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { Worker } = require("node:worker_threads");

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

const productionSource = extract(
  "    function getLineCharCounts(",
  "\n\n    function getSyncDataLineCharCounts"
);
const parentSource = `    function getLineCharCounts(lines) {
        return lines.map(line => Array.from(line).length);
    }`;

assert.equal(
  crypto.createHash("sha256").update(parentSource).digest("hex"),
  "e421391c7797ca62b4b3e90157d2c8f8d5852e7dadfb76d654728b1a47f78b57"
);
assert.equal(productionSource.includes("line.charCodeAt(index)"), true);
assert.equal(productionSource.includes("Array.from(line)"), true);

function createCounter(functionSource) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${functionSource}\nglobalThis.__count = getLineCharCounts;`,
    context,
    { filename: "Addon_Lyrics_Lrclib.line-char-count.extracted.js" }
  );
  return context.__count;
}

function createCounters() {
  return {
    parent: createCounter(parentSource),
    production: createCounter(productionSource),
  };
}

function execute(counter, lines) {
  try {
    return { result: Array.from(counter(lines)), error: null };
  } catch (error) {
    return {
      result: null,
      error: { name: error.name, message: error.message },
    };
  }
}

function compare(counters, lines) {
  assert.deepEqual(execute(counters.production, lines), execute(counters.parent, lines));
}

function createDeterministicStrings(count) {
  let state = 0x43484152;
  const codeUnits = [
    0x0000, 0x0009, 0x000a, 0x0020, 0x0041, 0x0061, 0x0301, 0x3042,
    0x4e00, 0xac00, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000,
    0xfeff, 0xffff,
  ];
  const strings = [];
  for (let stringIndex = 0; stringIndex < count; stringIndex += 1) {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
    const length = (state >>> 0) % 192;
    let value = "";
    for (let index = 0; index < length; index += 1) {
      state = (Math.imul(state ^ (state >>> 13), 0x5bd1e995) + index) | 0;
      const mode = (state >>> 0) % 5;
      value += String.fromCharCode(
        mode === 0 ? codeUnits[(state >>> 8) % codeUnits.length] : (state >>> 0) & 0xffff
      );
    }
    strings.push(value);
  }
  return strings;
}

function runWorker(functionSource, lines) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `const { parentPort, workerData } = require("node:worker_threads");
       ${functionSource}
       let output;
       for (let round = 0; round < 500; round += 1) {
         output = getLineCharCounts(workerData);
       }
       parentPort.postMessage(output);`,
      { eval: true, workerData: lines }
    );
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });
}

test("LRCLIB stays global while Pages stays page-only", () => {
  assert.equal(manifest.subfiles_extension.includes("Addon_Lyrics_Lrclib.js"), true);
  assert.equal(manifest.subfiles.includes("Addon_Lyrics_Lrclib.js"), false);
  assert.equal(manifest.subfiles.includes("Pages.js"), true);
  assert.equal(manifest.subfiles_extension.includes("Pages.js"), false);
});

test("line counts preserve fixtures and non-string fallback behavior", () => {
  const counters = createCounters();
  const fixtures = [
    [],
    [""],
    ["ASCII", "한글", "日本語", "ไทย"],
    ["🎵", "👨‍👩‍👧‍👦", "e\u0301", "\ud800", "\udfff", "\ud800\udfff"],
    ["\ud800\ud800\udfff", "\ud800\udfff\udfff", "\udfff\ud800"],
    [new String("🎵")],
    [["a", "b"]],
    [new Set(["a", "b"])],
    [{ 0: "a", 1: "b", length: 2 }],
    [null],
    [undefined],
    [42],
  ];
  for (const fixture of fixtures) compare(counters, fixture);
});

test("all Unicode scalars and UTF-16 surrogate pairs match Array.from", () => {
  const counters = createCounters();
  const batch = [];
  const flush = () => {
    if (batch.length === 0) return;
    compare(counters, batch);
    batch.length = 0;
  };

  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    batch.push(String.fromCodePoint(codePoint));
    if (batch.length === 4096) flush();
  }
  flush();

  for (let high = 0xd800; high <= 0xdbff; high += 1) {
    for (let low = 0xdc00; low <= 0xdfff; low += 1) {
      batch.push(String.fromCharCode(high, low));
      if (batch.length === 4096) flush();
    }
  }
  flush();
});

test("50k arbitrary and invalid UTF-16 lines match the parent", () => {
  const counters = createCounters();
  const strings = createDeterministicStrings(50000);
  for (let offset = 0; offset < strings.length; offset += 257) {
    compare(counters, strings.slice(offset, offset + 257));
  }
});

test("parallel LRCLIB line counting remains isolated", async () => {
  const counters = createCounters();
  const workers = Array.from({ length: 12 }, (_, workerIndex) =>
    createDeterministicStrings(80).map((line) => `${line}${workerIndex % 2 ? "🎵" : "\ud800"}`)
  );
  const actual = await Promise.all(workers.map((lines) => runWorker(productionSource, lines)));
  const expected = workers.map((lines) => execute(counters.parent, lines).result);
  assert.deepEqual(actual, expected);
});
