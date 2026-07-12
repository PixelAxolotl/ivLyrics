const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "Addon_AI_Pollinations.js"),
  "utf8"
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);
const baseUrlMatch = source.match(/const BASE_URL = '([^']+)'/);
assert.ok(baseUrlMatch, "missing Pollinations BASE_URL");
const BASE_URL = baseUrlMatch[1];

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing production start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing production end marker: ${endMarker}`);
  return source.slice(start, end);
}

const productionFunctionSource = extract(
  "    async function callPollinationsAPIStream(",
  "\n\n    /**\n     * Call Pollinations.ai API"
);
const parentFunctionSource = productionFunctionSource
  .replace(
    "async function callPollinationsAPIStream(",
    "async function callPollinationsAPIStreamReference("
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
    getSelectedModel: forward("getSelectedModel"),
    getApiKeys: forward("getApiKeys"),
    getAdvancedRequestParams: forward("getAdvancedRequestParams"),
    setTimeout: forward("setTimeout"),
    window: {},
  };
  vm.createContext(context);
  const emitterSource = includeEmitter
    ? extract(
        "    function emitStreamingLines(",
        "\n\n    async function callPollinationsAPIStream"
      )
    : "";
  vm.runInContext(
    `${emitterSource}\n${functionSource}\nglobalThis.__stream = ${functionName};`,
    context,
    { filename: `Addon_AI_Pollinations.${functionName}.extracted.js` }
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
    getSelectedModel() {
      logs.push(["getSelectedModel"]);
      return scenario.model || "openai-large-test";
    },
    getApiKeys() {
      logs.push(["getApiKeys"]);
      return [...(scenario.apiKeys ?? ["key-1"])];
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
  const onLine = scenario.noCallback
    ? null
    : (index, line) => {
        calls.push([index, line]);
        runtime.logs.push(["onLine", index, line]);
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
      "callPollinationsAPIStreamReference",
      false
    ),
    production: createHarness(
      productionFunctionSource,
      "callPollinationsAPIStream",
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

test("manifest keeps Pollinations global and Pages page-only", () => {
  assert.equal(
    manifest.subfiles_extension.includes("Addon_AI_Pollinations.js"),
    true
  );
  assert.equal(manifest.subfiles.includes("Addon_AI_Pollinations.js"), false);
  assert.equal(manifest.subfiles_extension.includes("Pages.js"), false);
  assert.equal(manifest.subfiles.includes("Pages.js"), true);
});

test("full Pollinations SSE flow preserves provider semantics", async () => {
  const harnesses = createHarnesses();
  const readerError = new Error("reader interrupted");
  const scenarios = [
    {
      responses: [
        successResponse(["first\nsec", "ond\r\n🎵", " final"], [1, 2, 5, 13]),
      ],
    },
    {
      noCallback: true,
      responses: [successResponse(["silent\ncallback"], [2, 9])],
    },
    {
      apiKeys: [],
      responses: [],
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
      maxRetries: 2,
      responses: [
        { status: 502, json: { message: "top-level failure" } },
        successResponse(["top level recovered"], [4, 7]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        { status: 503, jsonError: new Error("not json") },
        successResponse(["status fallback"], [6]),
      ],
    },
    {
      apiKeys: ["rate-limited", "working"],
      responses: [{ status: 429 }, successResponse(["next key"], [2, 7])],
    },
    {
      apiKeys: ["", "working"],
      responses: [{ status: 403 }, successResponse(["conditional auth"], [8])],
    },
    {
      maxRetries: 2,
      responses: [
        { status: 401, json: { error: { message: "Invalid API key" } } },
        successResponse(["401 still retries"], [5, 2]),
      ],
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
      responses: [
        {
          chunks: chunksFromPayload(
            ssePayload(["valid\ntext"], {
              prefix: "data: {broken}\ncomment: ignored\n",
            }),
            [1, 17, 2]
          ),
        },
      ],
    },
  ];
  for (const scenario of scenarios) await compareScenario(harnesses, scenario);
});

test("full Pollinations flow preserves callback exception retries", async () => {
  const harnesses = createHarnesses();
  const chunkError = new Error("chunk callback failed");
  const chunkScenario = {
    maxRetries: 3,
    throwOnLine: 0,
    responses: [
      successResponse(["zero\none"], [2, 7]),
      successResponse(["zero\none"], [5, 1]),
      successResponse(["zero\none"], [3, 4]),
    ],
  };
  const chunkOutcomes = await compareScenario(
    harnesses,
    chunkScenario,
    chunkError
  );
  assert.equal(chunkOutcomes.parent.error, chunkError);
  assert.equal(chunkOutcomes.production.error, chunkError);

  const finalError = new Error("final callback failed");
  const finalScenario = {
    maxRetries: 2,
    throwOnLine: 0,
    responses: [
      successResponse(["only final"], [3, 8]),
      successResponse(["only final"], [4, 1]),
    ],
  };
  const finalOutcomes = await compareScenario(
    harnesses,
    finalScenario,
    finalError
  );
  assert.equal(finalOutcomes.parent.error, finalError);
  assert.equal(finalOutcomes.production.error, finalError);
});

test("full Pollinations SSE Unicode byte-split fuzz matches the parent", async () => {
  const harnesses = createHarnesses();
  for (const scenario of createDeterministicScenarios(500)) {
    await compareScenario(harnesses, scenario);
  }
});
