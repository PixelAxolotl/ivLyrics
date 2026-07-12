const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { Worker } = require("node:worker_threads");

const pagesSource = fs.readFileSync(path.join(__dirname, "..", "Pages.js"), "utf8");
const panelSource = fs.readFileSync(
  path.join(__dirname, "..", "NowPlayingPanelLyrics.js"),
  "utf8"
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing production start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing production end marker: ${endMarker}`);
  return source.slice(start, end);
}

function parentFromProduction(productionSource, expectedHash) {
  const parentSource = productionSource.replace(
    "getKaraokeDirectionCharacters(normalizedText)",
    "Array.from(normalizedText)"
  );
  assert.notEqual(parentSource, productionSource);
  assert.equal(
    crypto.createHash("sha256").update(parentSource).digest("hex"),
    expectedHash
  );
  return parentSource;
}

const pageRegexSource = extract(
  pagesSource,
  "const KARAOKE_RTL_STRONG_CHAR_REGEX =",
  "\n\nconst getKaraokeTextDirection"
);
const pageProductionSource = extract(
  pagesSource,
  "const getKaraokeTextDirection =",
  "\n\nconst shouldUseKaraokeTextRun"
);
const pageParentSource = parentFromProduction(
  pageProductionSource,
  "a462eff1e63e64f20c191014fe797eaf22d0b2368f6020eb1754779208d91d17"
);

const panelRegexSource = extract(
  panelSource,
  "    const KARAOKE_RTL_STRONG_CHAR_REGEX =",
  "\n    const KARAOKE_TEXT_RUN_FILL_STEPS"
);
const panelProductionSource = extract(
  panelSource,
  "    const getKaraokeTextDirection =",
  "\n\n    const shouldUseKaraokeTextRun"
);
const panelParentSource = parentFromProduction(
  panelProductionSource,
  "e8136853fe133cf8e0ff0ac77a43114c12b9d53fe6198cdeaa9ec4f2115d1b21"
);

assert.equal(pageProductionSource.includes("Array.from"), false);
assert.equal(panelProductionSource.includes("Array.from"), false);

function createDirection(regexSource, functionSource, filename) {
  return createDirectionRealm(regexSource, functionSource, filename).direction;
}

function createDirectionRealm(regexSource, functionSource, filename, beforeSource = "") {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${beforeSource}\n${regexSource}\n${functionSource}\n` +
      "globalThis.__direction = getKaraokeTextDirection;",
    context,
    { filename }
  );
  return { context, direction: context.__direction };
}

function createHarnesses() {
  return {
    pageParent: createDirection(pageRegexSource, pageParentSource, "Pages.direction.parent.js"),
    pageProduction: createDirection(
      pageRegexSource,
      pageProductionSource,
      "Pages.direction.production.js"
    ),
    panelParent: createDirection(
      panelRegexSource,
      panelParentSource,
      "Panel.direction.parent.js"
    ),
    panelProduction: createDirection(
      panelRegexSource,
      panelProductionSource,
      "Panel.direction.production.js"
    ),
  };
}

function compare(harnesses, value) {
  const pageExpected = harnesses.pageParent(value);
  assert.equal(harnesses.pageProduction(value), pageExpected);
  const panelExpected = harnesses.panelParent(value);
  assert.equal(harnesses.panelProduction(value), panelExpected);
  assert.equal(pageExpected, panelExpected);
}

function createDeterministicInputs(count) {
  let state = 0x44495245;
  const tokens = [
    "", "a", "Z", "é", "Ω", "Ж", "א", "ش", "ࠀ", "﷽", "한", "日",
    " ", "\t", "\n", "🎵", "e\u0301", "\ud800", "\udfff", "\u0000",
  ];
  const inputs = [];
  for (let inputIndex = 0; inputIndex < count; inputIndex += 1) {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
    const tokenCount = (state >>> 0) % 128;
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
       const output = [];
       for (let round = 0; round < 100; round += 1) {
         for (const input of workerData) output.push(getKaraokeTextDirection(input));
       }
       parentPort.postMessage(output);`,
      { eval: true, workerData: inputs }
    );
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });
}

test("direction detection keeps Pages page-only and the panel global", () => {
  assert.equal(manifest.subfiles.includes("Pages.js"), true);
  assert.equal(manifest.subfiles_extension.includes("Pages.js"), false);
  assert.equal(manifest.subfiles_extension.includes("NowPlayingPanelLyrics.js"), true);
  assert.equal(manifest.subfiles.includes("NowPlayingPanelLyrics.js"), false);
});

test("direction detection preserves fixtures and non-string coercion", () => {
  const harnesses = createHarnesses();
  const fixtures = [
    undefined, null, false, true, 0, 42, {}, [], new String("שלום"), "",
    "Latin", "עברית", "العربية", "Latin עברית", "abא", "aאב", "אבa",
    "ΩЖé", "한글 日本語 🎵", "\ud800", "\udfff", "\ud800\udfff",
    "e\u0301 ش A", "\u0000\n\t",
  ];
  for (const fixture of fixtures) compare(harnesses, fixture);
});

test("patched Array.from falls back to the parent call and exception behavior", () => {
  for (const beforeSource of ["", "Array.from = () => [];"]) {
    const pageParent = createDirectionRealm(
      pageRegexSource,
      pageParentSource,
      "Pages.direction.parent.patched.js",
      beforeSource
    );
    const pageProduction = createDirectionRealm(
      pageRegexSource,
      pageProductionSource,
      "Pages.direction.production.patched.js",
      beforeSource
    );
    const panelParent = createDirectionRealm(
      panelRegexSource,
      panelParentSource,
      "Panel.direction.parent.patched.js",
      beforeSource
    );
    const panelProduction = createDirectionRealm(
      panelRegexSource,
      panelProductionSource,
      "Panel.direction.production.patched.js",
      beforeSource
    );

    if (!beforeSource) {
      vm.runInContext("Array.from = () => [];", pageParent.context);
      vm.runInContext("Array.from = () => [];", pageProduction.context);
      vm.runInContext("Array.from = () => [];", panelParent.context);
      vm.runInContext("Array.from = () => [];", panelProduction.context);
    }
    assert.equal(pageProduction.direction("א"), pageParent.direction("א"));
    assert.equal(panelProduction.direction("א"), panelParent.direction("א"));
  }

  const throwingSource = "Array.from = () => { throw new Error('array-from-sentinel'); };";
  for (const [regexSource, parentSource, productionSource, label] of [
    [pageRegexSource, pageParentSource, pageProductionSource, "Pages"],
    [panelRegexSource, panelParentSource, panelProductionSource, "Panel"],
  ]) {
    const parent = createDirectionRealm(
      regexSource,
      parentSource,
      `${label}.direction.parent.throw.js`,
      throwingSource
    );
    const production = createDirectionRealm(
      regexSource,
      productionSource,
      `${label}.direction.production.throw.js`,
      throwingSource
    );
    for (const realm of [parent, production]) {
      assert.throws(
        () => realm.direction("א"),
        (error) => error.name === "Error" && error.message === "array-from-sentinel"
      );
    }
  }
});

test("patched String iterator preserves parent consumption and throw order", () => {
  const iteratorSource = `String.prototype[Symbol.iterator] = function* () {
    yield "א";
    throw new Error("iterator-sentinel");
  };`;
  for (const [regexSource, parentSource, productionSource, label] of [
    [pageRegexSource, pageParentSource, pageProductionSource, "Pages"],
    [panelRegexSource, panelParentSource, panelProductionSource, "Panel"],
  ]) {
    for (const before of [true, false]) {
      const parent = createDirectionRealm(
        regexSource,
        parentSource,
        `${label}.direction.parent.iterator.js`,
        before ? iteratorSource : ""
      );
      const production = createDirectionRealm(
        regexSource,
        productionSource,
        `${label}.direction.production.iterator.js`,
        before ? iteratorSource : ""
      );
      if (!before) {
        vm.runInContext(iteratorSource, parent.context);
        vm.runInContext(iteratorSource, production.context);
      }
      for (const realm of [parent, production]) {
        assert.throws(
          () => realm.direction("abc"),
          (error) => error.name === "Error" && error.message === "iterator-sentinel"
        );
      }
    }
  }
});

test("every Unicode scalar preserves page and panel direction", () => {
  const harnesses = createHarnesses();
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    compare(harnesses, String.fromCodePoint(codePoint));
  }
});

test("50k arbitrary and invalid UTF-16 inputs match the parent", () => {
  const harnesses = createHarnesses();
  for (const input of createDeterministicInputs(50000)) compare(harnesses, input);
});

test("parallel page and panel direction checks remain isolated", async () => {
  const harnesses = createHarnesses();
  const workerInputs = Array.from({ length: 12 }, (_, workerIndex) =>
    createDeterministicInputs(80).map((input) =>
      `${input}${workerIndex % 2 === 0 ? " אב" : " Latin"}`
    )
  );
  const pageBundle = `${pageRegexSource}\n${pageProductionSource}`;
  const panelBundle = `${panelRegexSource}\n${panelProductionSource}`;
  const pageActual = await Promise.all(
    workerInputs.map((inputs) => runWorker(pageBundle, inputs))
  );
  const panelActual = await Promise.all(
    workerInputs.map((inputs) => runWorker(panelBundle, inputs))
  );
  const expected = workerInputs.map((inputs) => {
    const output = [];
    for (let round = 0; round < 100; round += 1) {
      for (const input of inputs) output.push(harnesses.pageParent(input));
    }
    return output;
  });
  assert.deepEqual(pageActual, expected);
  assert.deepEqual(panelActual, expected);
});
