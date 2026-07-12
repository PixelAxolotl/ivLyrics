const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "Addon_AI_ChatGPT.js"),
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
      "    function emitStreamingLines(",
      "\n\n    async function callChatGPTAPIStream"
    )}\n    globalThis.__emitStreamingLines = emitStreamingLines;`,
    context,
    { filename: "Addon_AI_ChatGPT.stream-lines.extracted.js" }
  );
  return context.__emitStreamingLines;
}

function runReference(chunks, onLine) {
  let accumulated = "";
  let emittedLines = 0;

  for (const chunk of chunks) {
    accumulated += chunk;
    if (onLine) {
      const currentLines = accumulated.split("\n");
      for (let index = emittedLines; index < currentLines.length - 1; index++) {
        onLine(index, currentLines[index]);
        emittedLines = index + 1;
      }
    }
  }

  if (onLine) {
    const finalLines = accumulated.split("\n");
    if (finalLines.length > emittedLines) {
      onLine(emittedLines, finalLines[emittedLines]);
    }
  }

  return { accumulated, emittedLines };
}

function runProduction(emitStreamingLines, chunks, onLine) {
  let accumulated = "";
  const state = { index: 0, offset: 0 };

  for (const chunk of chunks) {
    accumulated += chunk;
    emitStreamingLines(accumulated, onLine, state);
  }
  emitStreamingLines(accumulated, onLine, state, true);

  return { accumulated, emittedLines: state.index, offset: state.offset };
}

function createDeterministicChunkSets(count) {
  let state = 0x5eecafe;
  const tokens = [
    "",
    "latin",
    "한글",
    "かな",
    "普通话",
    "🎵",
    "e\u0301",
    "\r",
    "\n",
    "\r\n",
    "\n\n",
    "\ud83c",
    "\udfb5",
    "\ud800",
    "\udfff",
    "\u0000",
  ];
  const chunkSets = [];

  for (let setIndex = 0; setIndex < count; setIndex += 1) {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
    const chunkCount = (state >>> 0) % 32;
    const chunks = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      state = (Math.imul(state ^ (state >>> 13), 0x5bd1e995) + chunkIndex) | 0;
      chunks.push(tokens[(state >>> 0) % tokens.length]);
    }
    chunkSets.push(chunks);
  }

  return chunkSets;
}

function collectRun(run) {
  const calls = [];
  const result = run((index, line) => calls.push([index, line]));
  return { calls, result };
}

test("ChatGPT addon remains a Spotify-wide extension", () => {
  assert.equal(manifest.subfiles_extension.includes("Addon_AI_ChatGPT.js"), true);
  assert.equal(manifest.subfiles.includes("Addon_AI_ChatGPT.js"), false);
});

test("streamed line callbacks preserve chunk boundaries and Unicode text", () => {
  const emitStreamingLines = createProductionHarness();
  const chunkSets = [
    [],
    [""],
    ["one line"],
    ["first\nsecond"],
    ["first\n", "second\n"],
    ["\n"],
    ["\n\n"],
    ["a\r", "\nb\r\n", ""],
    ["한글\nかな\n普通话"],
    ["emoji \ud83c", "\udfb5\ncombining e", "\u0301"],
    ["\ud800\n", "\udfff\u0000\n"],
    ...createDeterministicChunkSets(4000),
  ];

  for (const chunks of chunkSets) {
    const reference = collectRun((onLine) => runReference(chunks, onLine));
    const production = collectRun((onLine) =>
      runProduction(emitStreamingLines, chunks, onLine)
    );

    assert.deepEqual(production.calls, reference.calls, JSON.stringify(chunks));
    assert.equal(production.result.accumulated, reference.result.accumulated);
    assert.equal(production.result.emittedLines, reference.result.emittedLines);
    assert.equal(
      production.result.offset,
      reference.calls.slice(0, -1).reduce(
        (offset, [, line]) => offset + line.length + 1,
        0
      )
    );
  }
});

test("streamed line callbacks preserve callback exception order", () => {
  const emitStreamingLines = createProductionHarness();
  const chunks = ["zero\none\nt", "wo\nthree"];

  for (let throwAt = 0; throwAt < 4; throwAt += 1) {
    const expectedError = new Error(`callback ${throwAt}`);
    const runWithFailure = (run) => {
      const calls = [];
      let error = null;
      try {
        run((index, line) => {
          calls.push([index, line]);
          if (index === throwAt) throw expectedError;
        });
      } catch (caught) {
        error = caught;
      }
      return { calls, error };
    };

    const reference = runWithFailure((onLine) => runReference(chunks, onLine));
    const production = runWithFailure((onLine) =>
      runProduction(emitStreamingLines, chunks, onLine)
    );

    assert.deepEqual(production.calls, reference.calls);
    assert.equal(production.error, reference.error);
    assert.equal(production.error, expectedError);
  }
});

test("a missing callback preserves the accumulated response without emission", () => {
  const emitStreamingLines = createProductionHarness();
  const chunks = ["first\n", "second\nthird"];

  assert.deepEqual(
    runProduction(emitStreamingLines, chunks, null).accumulated,
    runReference(chunks, null).accumulated
  );
});
