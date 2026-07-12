const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { Worker } = require("node:worker_threads");

const source = fs.readFileSync(
  path.join(__dirname, "..", "Addon_Lyrics_Unison.js"),
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

const timestampFunctionSource = extract(
  "    function parseLrcTimestamp(",
  "\n\n    function parseLrcLyrics("
);
const productionFunctionSource = extract(
  "    function parseLrcLyrics(",
  "\n\n    function parsePlainLyrics("
);
const plainFunctionSource = extract(
  "    function parsePlainLyrics(",
  "\n\n    function normalizeDurationSeconds("
);
const parentProductionNameSource = productionFunctionSource
  .replace(
    `            const timestamps = [];
            const strippedLine = rawLine.replace(
                /\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]/g,
                (_match, minutes, seconds, fraction) => {
                    const captureIndex = timestamps.length;
                    timestamps[captureIndex] = minutes;
                    timestamps[captureIndex + 1] = seconds;
                    timestamps[captureIndex + 2] = fraction;
                    return '';
                }
            );
            if (!timestamps.length) return;
            const text = strippedLine.trim();`,
    `            const timestamps = Array.from(rawLine.matchAll(/\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]/g));
            if (!timestamps.length) return;
            const text = rawLine.replace(/\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]/g, '').trim();`
  )
  .replace(
    `            for (let index = 0; index < timestamps.length; index += 3) {
                synced.push({
                    startTime: Math.max(0, parseLrcTimestamp(
                        timestamps[index],
                        timestamps[index + 1],
                        timestamps[index + 2]
                    ) + offset),
                    text
                });
            }`,
    `            timestamps.forEach(match => {
                synced.push({
                    startTime: Math.max(0, parseLrcTimestamp(match[1], match[2], match[3]) + offset),
                    text
                });
            });`
  );
const parentFunctionSource = parentProductionNameSource
  .replace("function parseLrcLyrics(", "function parseLrcLyricsReference(");

assert.notEqual(parentFunctionSource, productionFunctionSource);
assert.equal(productionFunctionSource.includes("timestamps.push"), false);
assert.equal(productionFunctionSource.includes("captureIndex"), true);
assert.equal(productionFunctionSource.includes("index += 3"), true);
assert.equal(parentFunctionSource.includes("rawLine.matchAll"), true);
assert.equal(parentFunctionSource.includes("timestamps.forEach"), true);
assert.equal(
  crypto.createHash("sha256").update(parentProductionNameSource).digest("hex"),
  "6795e1abe8f041cba0e2cb56acc939fc2b8538587313da22c47d69440ef500b1"
);

function createParser(functionSource, functionName) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${timestampFunctionSource}\n${plainFunctionSource}\n${functionSource}\nglobalThis.__parse = ${functionName};`,
    context,
    { filename: `Addon_Lyrics_Unison.${functionName}.extracted.js` }
  );
  return context.__parse;
}

function createParsers() {
  return {
    parent: createParser(parentFunctionSource, "parseLrcLyricsReference"),
    production: createParser(productionFunctionSource, "parseLrcLyrics"),
  };
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function createArgs(parser, scenario, logs) {
  const lrc = scenario.lrcCoercion
    ? {
        [Symbol.toPrimitive](hint) {
          logs.push(["coerce lrc", hint]);
          if (scenario.lrcError) throw scenario.lrcError;
          return scenario.lrc;
        },
      }
    : scenario.lrc;
  const duration = scenario.durationCoercion
    ? {
        valueOf() {
          logs.push(["coerce duration"]);
          if (scenario.durationError) throw scenario.durationError;
          if (scenario.reentrantDuration) {
            logs.push(["nested", normalize(parser("[00:01.00] nested", 2500))]);
          }
          return scenario.duration ?? 0;
        },
      }
    : (scenario.duration ?? 0);
  return { lrc, duration };
}

function execute(parser, scenario) {
  const logs = [];
  const { lrc, duration } = createArgs(parser, scenario, logs);
  try {
    return { result: normalize(parser(lrc, duration)), error: null, logs };
  } catch (error) {
    return {
      result: null,
      error: { name: error.name, message: error.message },
      logs,
    };
  }
}

function compareScenario(parsers, scenario) {
  const parent = execute(parsers.parent, scenario);
  const production = execute(parsers.production, scenario);
  assert.deepEqual(production, parent);
  return { parent, production };
}

function splitBytes(bytes, sizes) {
  const chunks = [];
  let offset = 0;
  let index = 0;
  while (offset < bytes.length) {
    const size = Math.max(1, sizes[index % sizes.length]);
    chunks.push(bytes.slice(offset, Math.min(bytes.length, offset + size)));
    offset += size;
    index += 1;
  }
  return chunks;
}

function decodeByChunks(value, sizes) {
  const decoder = new TextDecoder();
  let result = "";
  for (const chunk of splitBytes(new TextEncoder().encode(value), sizes)) {
    result += decoder.decode(chunk, { stream: true });
  }
  return result + decoder.decode();
}

function createDeterministicScenarios(count) {
  let state = 0x554e4953;
  const texts = [
    "latin", "한글", "かな", "普通话", "🎵", "e\u0301", "\ud800", "\udfff",
    "[literal]", "<tag>", "", " ", "\u0000", "line\rpart",
  ];
  const timestampForms = [
    "[0:00]", "[00:01.2]", "[001:02.34]", "[99:59:123]", "[12:03.4567]",
    "[1:2.]", "[1234:01]", "[-1:02]", "[ab:cd]",
  ];
  const scenarios = [];
  for (let scenarioIndex = 0; scenarioIndex < count; scenarioIndex += 1) {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
    const lineCount = 1 + ((state >>> 0) % 18);
    const lines = [];
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      state = (Math.imul(state ^ (state >>> 13), 0x5bd1e995) + lineIndex) | 0;
      const mode = (state >>> 0) % 9;
      if (mode === 0) {
        lines.push(`[offset:${(state >> 8) % 5000}]`);
      } else if (mode === 1) {
        lines.push(`[ar:${texts[(state >>> 4) % texts.length]}]`);
      } else if (mode === 2) {
        lines.push(texts[(state >>> 6) % texts.length]);
      } else {
        const first = timestampForms[(state >>> 3) % timestampForms.length];
        const second = mode % 3 === 0
          ? timestampForms[(state >>> 10) % timestampForms.length]
          : "";
        lines.push(`${first}${second}${texts[(state >>> 17) % texts.length]}`);
      }
    }
    const separator = scenarioIndex % 3 === 0 ? "\r\n" : "\n";
    scenarios.push({
      lrc: `${scenarioIndex % 5 === 0 ? "\uFEFF" : ""}${lines.join(separator)}`,
      duration: (state >>> 0) % 360000,
    });
  }
  return scenarios;
}

function runWorker(sourceBundle, lrc, duration) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `const { parentPort, workerData } = require("node:worker_threads");
       ${sourceBundle}
       let result;
       for (let index = 0; index < 400; index++) {
         result = parseLrcLyrics(workerData.lrc, workerData.duration);
       }
       parentPort.postMessage(JSON.parse(JSON.stringify(result)));`,
      { eval: true, workerData: { lrc, duration } }
    );
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });
}

test("manifest keeps Unison global and Pages page-only", () => {
  assert.equal(manifest.subfiles_extension.includes("Addon_Lyrics_Unison.js"), true);
  assert.equal(manifest.subfiles.includes("Addon_Lyrics_Unison.js"), false);
  assert.equal(manifest.subfiles_extension.includes("Pages.js"), false);
  assert.equal(manifest.subfiles.includes("Pages.js"), true);
});

test("full Unison LRC parser preserves formats, boundaries, and coercion", () => {
  const parsers = createParsers();
  const fixtures = [
    { lrc: null },
    { lrc: undefined },
    { lrc: "" },
    { lrc: "plain\n한글\r\n🎵" },
    { lrc: "\uFEFF[ar:Artist]\n[al:Album]\n[00:01.2]first\n[00:02.34]second", duration: 9000 },
    { lrc: "[offset:-2500]\n[00:01.00]clamped\n[offset:+500]\n[00:01.00]shifted" },
    { lrc: "[00:01.2][00:02.34][001:03:456]same line", duration: 10000 },
    { lrc: "[00:01]   \n[bad]ignored\n[1234:01]not timestamp\n[01:02]valid" },
    { lrc: "[00:01]한글🎵e\u0301\ud800\udfff\u0000\n[00:02]普通话" },
    { lrc: "[00:01]one\r[00:02]still one raw line", duration: 5000 },
    { lrc: "[00:01.1234]fraction boundary", duration: -10 },
    { lrc: "[00:01]final", duration: Number.NaN },
    { lrc: "[00:01]final", duration: "7000" },
    { lrc: "[00:01]final", duration: 7000n },
    { lrc: "[00:01]coerced", lrcCoercion: true, duration: 8000 },
    { lrc: "[00:01]nested", duration: 8000, durationCoercion: true, reentrantDuration: true },
    { lrc: "plain only", duration: 8000, durationCoercion: true },
    { lrc: "unused", lrcCoercion: true, lrcError: new Error("lrc coercion failed") },
    { lrc: "[00:01]duration error", durationCoercion: true, durationError: new Error("duration coercion failed") },
  ];
  for (const fixture of fixtures) compareScenario(parsers, fixture);
});

test("Unison LRC Unicode UTF-8 byte boundaries and 10k fuzz match the parent", () => {
  const parsers = createParsers();
  const boundaryInput = "\uFEFF[offset:-250]\r\n[00:01.23][00:02.345]한글🎵e\u0301\ud800\r\n[00:03]普通话";
  for (let first = 1; first <= 37; first += 1) {
    for (let second = 1; second <= 11; second += 2) {
      const decoded = decodeByChunks(boundaryInput, [first, second, 1, 7, 2, 13]);
      compareScenario(parsers, { lrc: decoded, duration: 12000 });
    }
  }
  for (const scenario of createDeterministicScenarios(10000)) {
    compareScenario(parsers, scenario);
  }
});

test("parallel Unison LRC parses remain isolated", async () => {
  const parsers = createParsers();
  const bundle = `${timestampFunctionSource}\n${plainFunctionSource}\n${productionFunctionSource}`;
  const inputs = Array.from({ length: 12 }, (_, index) => ({
    lrc: `[offset:${index * 17 - 40}]\n[00:01.${index}]worker-${index}-한글🎵\n[00:02.34][00:03.456]shared-${index}`,
    duration: 8000 + index,
  }));
  const actual = await Promise.all(inputs.map(({ lrc, duration }) =>
    runWorker(bundle, lrc, duration)
  ));
  const expected = inputs.map((scenario) => execute(parsers.parent, scenario).result);
  assert.deepEqual(actual, expected);
});
