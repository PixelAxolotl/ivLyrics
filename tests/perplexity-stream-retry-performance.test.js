const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "Addon_AI_Perplexity.js"),
  "utf8"
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);
const baseUrlMatch = source.match(/const BASE_URL = '([^']+)'/);
assert.ok(baseUrlMatch, "missing Perplexity BASE_URL");
const BASE_URL = baseUrlMatch[1];

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing production start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing production end marker: ${endMarker}`);
  return source.slice(start, end);
}

const productionFunctionSource = extract(
  "    async function callPerplexityAPIStream(",
  "\n\n    async function callPerplexityAPI(prompt"
);
const parentFunctionSource = productionFunctionSource
  .replace(
    "async function callPerplexityAPIStream(",
    "async function callPerplexityAPIStreamReference("
  )
  .replace(
    "let sseBuffer = '', accumulated = '';\n                    const lineState = { index: 0, offset: 0 };",
    "let sseBuffer = '', accumulated = '', emittedLines = 0;"
  )
  .replace(
    "                        emitStreamingLines(accumulated, onLine, lineState);",
    "                        if (onLine) { const cl = accumulated.split('\\n'); for (let i = emittedLines; i < cl.length - 1; i++) { onLine(i, cl[i]); emittedLines = i + 1; } }"
  )
  .replace(
    "                    emitStreamingLines(accumulated, onLine, lineState, true);",
    "                    if (onLine) { const fl = accumulated.split('\\n'); if (fl.length > emittedLines) onLine(emittedLines, fl[emittedLines]); }"
  );

assert.notEqual(parentFunctionSource, productionFunctionSource);
assert.equal(parentFunctionSource.includes("emitStreamingLines"), false);
assert.equal(parentFunctionSource.includes("accumulated.split('\\n')"), true);

function createHarness(functionSource, functionName, includeEmitter) {
  const runtimeRef = { current: null };
  const forward = (name) => (...args) => runtimeRef.current[name](...args);
  const context = {
    BASE_URL,
    TextDecoder,
    fetch: forward("fetch"),
    getApiKeys: forward("getApiKeys"),
    getSelectedModel: forward("getSelectedModel"),
    getAdvancedRequestParams: forward("getAdvancedRequestParams"),
    setTimeout: forward("setTimeout"),
    window: {},
  };
  vm.createContext(context);
  const emitterSource = includeEmitter
    ? extract(
        "    function emitStreamingLines(",
        "\n\n    async function callPerplexityAPIStream"
      )
    : "";
  vm.runInContext(
    `${emitterSource}\n${functionSource}\nglobalThis.__stream = ${functionName};`,
    context,
    { filename: `Addon_AI_Perplexity.${functionName}.extracted.js` }
  );
  return {
    call: context.__stream,
    setRuntime(runtime) {
      runtimeRef.current = runtime;
    },
  };
}

function normalizeForLog(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRuntime(scenario) {
  const logs = [];
  const encoder = new TextEncoder();
  let fetchIndex = 0;
  return {
    logs,
    getApiKeys() {
      logs.push(["getApiKeys"]);
      return [...(scenario.apiKeys || ["key-1"])];
    },
    getSelectedModel() {
      logs.push(["getSelectedModel"]);
      return scenario.model || "sonar-pro-test";
    },
    getAdvancedRequestParams() {
      logs.push(["getAdvancedRequestParams"]);
      if (scenario.advancedGetter) {
        return {
          get temperature() {
            logs.push(["get temperature"]);
            return 0.37;
          },
          max_tokens: 321,
        };
      }
      return { temperature: 0.2, max_tokens: 123 };
    },
    async fetch(url, options) {
      const responseIndex = fetchIndex++;
      const spec = scenario.responses[responseIndex];
      if (!spec) throw new Error(`Unexpected fetch ${responseIndex}`);
      logs.push([
        "fetch",
        responseIndex,
        String(url),
        options.method,
        normalizeForLog(options.headers),
        JSON.parse(options.body),
      ]);
      const status = spec.status ?? 200;
      return {
        status,
        ok: spec.ok ?? (status >= 200 && status < 300),
        async json() {
          logs.push(["json", responseIndex]);
          if (spec.jsonError) throw spec.jsonError;
          return spec.json || {};
        },
        body: {
          getReader() {
            logs.push(["getReader", responseIndex]);
            let readIndex = 0;
            return {
              async read() {
                const currentRead = readIndex++;
                logs.push(["read", responseIndex, currentRead]);
                if (spec.throwAtRead === currentRead) {
                  throw spec.readError || new Error("reader failed");
                }
                const chunk = spec.chunks?.[currentRead];
                if (chunk === undefined) return { value: undefined, done: true };
                return {
                  value: typeof chunk === "string" ? encoder.encode(chunk) : chunk,
                  done: false,
                };
              },
            };
          },
        },
      };
    },
    setTimeout(callback, delay) {
      logs.push(["setTimeout", delay]);
      callback();
      return logs.length;
    },
  };
}

function splitBytes(bytes, sizes) {
  const chunks = [];
  let offset = 0;
  let sizeIndex = 0;
  while (offset < bytes.length) {
    const size = Math.max(1, sizes[sizeIndex % sizes.length]);
    chunks.push(bytes.slice(offset, Math.min(bytes.length, offset + size)));
    offset += size;
    sizeIndex += 1;
  }
  return chunks;
}

function chunksFromPayload(payload, sizes = [7, 3, 19, 1, 11]) {
  return splitBytes(new TextEncoder().encode(payload), sizes);
}

function ssePayload(fragments, { done = true, prefix = "", suffix = "" } = {}) {
  const events = fragments
    .map(
      (content) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`
    )
    .join("");
  return `${prefix}${events}${done ? "data: [DONE]\n" : ""}${suffix}`;
}

function successResponse(fragments, sizes, options) {
  return { chunks: chunksFromPayload(ssePayload(fragments, options), sizes) };
}

function createInputs(runtime, scenario) {
  const maxRetries = scenario.maxRetriesCoercion
    ? {
        valueOf() {
          runtime.logs.push(["coerce maxRetries"]);
          return scenario.maxRetries ?? 2;
        },
      }
    : (scenario.maxRetries ?? 3);
  const prompt = scenario.promptCoercion
    ? {
        toJSON() {
          runtime.logs.push(["prompt toJSON"]);
          return scenario.prompt || "prompt";
        },
      }
    : (scenario.prompt || "prompt");
  return { prompt, maxRetries };
}

async function execute(harness, runtime, scenario, callbackError) {
  harness.setRuntime(runtime);
  const calls = [];
  const onLine = (index, line) => {
    calls.push([index, line]);
    if (scenario.throwOnLine === index) throw callbackError;
  };
  const { prompt, maxRetries } = createInputs(runtime, scenario);
  try {
    const result = await harness.call(prompt, onLine, maxRetries);
    return { result, error: null, calls, logs: runtime.logs };
  } catch (error) {
    return { result: null, error, calls, logs: runtime.logs };
  }
}

function comparable(outcome) {
  return {
    result: outcome.result,
    errorName: outcome.error?.name || null,
    errorMessage: outcome.error?.message || null,
    calls: outcome.calls,
    logs: outcome.logs,
  };
}

async function compareScenario(harnesses, scenario, callbackError = null) {
  const parent = await execute(
    harnesses.parent,
    createRuntime(scenario),
    scenario,
    callbackError
  );
  const production = await execute(
    harnesses.production,
    createRuntime(scenario),
    scenario,
    callbackError
  );
  assert.deepEqual(comparable(production), comparable(parent));
  return { parent, production };
}

function createHarnesses() {
  return {
    parent: createHarness(
      parentFunctionSource,
      "callPerplexityAPIStreamReference",
      false
    ),
    production: createHarness(
      productionFunctionSource,
      "callPerplexityAPIStream",
      true
    ),
  };
}

function createDeterministicScenarios(count) {
  let state = 0x6e2b9a71;
  const tokens = [
    "", "latin", "한글", "かな", "普通话", "🎵", "e\u0301", "\r", "\n",
    "\r\n", "\n\n", "\ud83c", "\udfb5", "\ud800", "\udfff", "\u0000",
  ];
  const scenarios = [];
  for (let scenarioIndex = 0; scenarioIndex < count; scenarioIndex += 1) {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
    const fragmentCount = (state >>> 0) % 18;
    const fragments = [];
    for (let index = 0; index < fragmentCount; index += 1) {
      state = (Math.imul(state ^ (state >>> 13), 0x5bd1e995) + index) | 0;
      fragments.push(tokens[(state >>> 0) % tokens.length]);
    }
    const sizes = [];
    for (let index = 0; index < 7; index += 1) {
      state = (Math.imul(state ^ (state >>> 16), 0x45d9f3b) + index) | 0;
      sizes.push(1 + ((state >>> 0) % 31));
    }
    scenarios.push({
      maxRetries: 1,
      responses: [successResponse(fragments, sizes)],
    });
  }
  return scenarios;
}

test("Perplexity addon remains a Spotify-wide extension", () => {
  assert.equal(
    manifest.subfiles_extension.includes("Addon_AI_Perplexity.js"),
    true
  );
  assert.equal(manifest.subfiles.includes("Addon_AI_Perplexity.js"), false);
});

test("full Perplexity SSE flow preserves provider semantics", async () => {
  const harnesses = createHarnesses();
  const readerError = new Error("reader interrupted");
  const scenarios = [
    {
      responses: [successResponse(["first\nsec", "ond\r\n🎵", " final"], [1, 2, 5, 13])],
    },
    {
      maxRetries: 2,
      maxRetriesCoercion: true,
      promptCoercion: true,
      advancedGetter: true,
      responses: [
        { status: 500, json: { error: { message: "temporary" } } },
        successResponse(["recovered\nvalue"], [3, 1, 8]),
      ],
    },
    {
      apiKeys: ["rate-limited", "working"],
      responses: [{ status: 429 }, successResponse(["next key"], [2, 7])],
    },
    {
      maxRetries: 2,
      responses: [
        {
          chunks: chunksFromPayload(ssePayload(["partial\nline"]), [999]),
          throwAtRead: 1,
          readError: readerError,
        },
        successResponse(["retry\ndone"], [4, 9]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        { chunks: chunksFromPayload("data: [DONE]\n", [2, 3]) },
        successResponse(["after empty"], [5]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        {
          chunks: chunksFromPayload(
            `data: ${JSON.stringify({ choices: [{ delta: { content: "lost" } }] })}`,
            [2, 1, 4]
          ),
        },
        successResponse(["after leftover"], [6]),
      ],
    },
    {
      responses: [{
        chunks: chunksFromPayload(
          ssePayload(["valid\ntext"], {
            prefix: "data: {broken}\ncomment: ignored\n",
          }),
          [1, 17, 2]
        ),
      }],
    },
    {
      responses: [{
        status: 401,
        json: { error: { message: "Invalid API key" } },
      }],
    },
  ];
  for (const scenario of scenarios) await compareScenario(harnesses, scenario);
});

test("full Perplexity flow preserves callback exception retries", async () => {
  const harnesses = createHarnesses();
  const expectedError = new Error("callback failed");
  const scenario = {
    maxRetries: 3,
    throwOnLine: 0,
    responses: [
      successResponse(["zero\none"], [2, 7]),
      successResponse(["zero\none"], [5, 1]),
      successResponse(["zero\none"], [3, 4]),
    ],
  };
  const { parent, production } = await compareScenario(
    harnesses,
    scenario,
    expectedError
  );
  assert.equal(parent.error, expectedError);
  assert.equal(production.error, expectedError);
});

test("full Perplexity SSE Unicode byte-split fuzz matches the parent", async () => {
  const harnesses = createHarnesses();
  for (const scenario of createDeterministicScenarios(500)) {
    await compareScenario(harnesses, scenario);
  }
});
