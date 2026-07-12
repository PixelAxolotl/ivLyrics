const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "Addon_AI_Claude.js"),
  "utf8"
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);
const baseUrlMatch = source.match(/const BASE_URL = '([^']+)'/);
assert.ok(baseUrlMatch, "missing Claude BASE_URL");
const BASE_URL = baseUrlMatch[1];

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing production start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing production end marker: ${endMarker}`);
  return source.slice(start, end);
}

const productionFunctionSource = extract(
  "    async function callClaudeAPIStream(",
  "\n\n    async function callClaudeAPI(prompt"
);
const parentFunctionSource = productionFunctionSource
  .replace(
    "async function callClaudeAPIStream(",
    "async function callClaudeAPIStreamReference("
  )
  .replace(
    "let accumulated = '';\n                    const lineState = { index: 0, offset: 0 };",
    "let accumulated = '';\n                    let emittedLines = 0;"
  )
  .replace(
    "                        emitStreamingLines(accumulated, onLine, lineState);",
    `                        if (onLine) {
                            const currentLines = accumulated.split('\\n');
                            for (let i = emittedLines; i < currentLines.length - 1; i++) {
                                onLine(i, currentLines[i]);
                                emittedLines = i + 1;
                            }
                        }`
  )
  .replace(
    "                    emitStreamingLines(accumulated, onLine, lineState, true);",
    `                    if (onLine) {
                        const finalLines = accumulated.split('\\n');
                        if (finalLines.length > emittedLines) {
                            onLine(emittedLines, finalLines[emittedLines]);
                        }
                    }`
  );

assert.notEqual(parentFunctionSource, productionFunctionSource);
assert.equal(parentFunctionSource.includes("emitStreamingLines"), false);
assert.equal(parentFunctionSource.includes("const lineState"), false);
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
    window: { __ivLyricsDebugLog: forward("debugLog") },
  };
  vm.createContext(context);
  const emitterSource = includeEmitter
    ? extract(
        "    function emitStreamingLines(",
        "\n\n    async function callClaudeAPIStream"
      )
    : "";
  vm.runInContext(
    `${emitterSource}\n${functionSource}\nglobalThis.__stream = ${functionName};`,
    context,
    { filename: `Addon_AI_Claude.${functionName}.extracted.js` }
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
      return [...(scenario.apiKeys ?? ["claude-key-1"])];
    },
    getSelectedModel() {
      logs.push(["getSelectedModel"]);
      if (scenario.modelCoercion) {
        return {
          toJSON() {
            logs.push(["model toJSON"]);
            return scenario.model || "claude-model-coerced";
          },
        };
      }
      return scenario.model ?? "claude-sonnet-test";
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
      if (spec.fetchError) throw spec.fetchError;
      const status = spec.status ?? 200;
      const body = {
        getReader() {
          logs.push(["getReader", responseIndex]);
          if (spec.getReaderError) throw spec.getReaderError;
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
      };
      return {
        get status() {
          logs.push(["status", responseIndex]);
          if (spec.statusError) throw spec.statusError;
          return status;
        },
        get ok() {
          logs.push(["ok", responseIndex]);
          if (spec.okError) throw spec.okError;
          return spec.ok ?? (status >= 200 && status < 300);
        },
        async json() {
          logs.push(["json", responseIndex]);
          if (spec.jsonError) throw spec.jsonError;
          return spec.json || {};
        },
        get body() {
          logs.push(["body", responseIndex]);
          if (spec.bodyError) throw spec.bodyError;
          return spec.bodyValue === undefined ? body : spec.bodyValue;
        },
      };
    },
    debugLog(...args) {
      logs.push(["debugLog", ...args]);
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

function claudeEvent(eventType, data) {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

function deltaEvent(content) {
  return claudeEvent("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: content },
  });
}

function claudePayload(fragments, { prefix = "", suffix = "" } = {}) {
  return `${prefix}${fragments.map(deltaEvent).join("")}${suffix}`;
}

function successResponse(fragments, sizes, options) {
  return {
    chunks: chunksFromPayload(claudePayload(fragments, options), sizes),
  };
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
          return scenario.prompt || "prompt-coerced";
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
      "callClaudeAPIStreamReference",
      false
    ),
    production: createHarness(
      productionFunctionSource,
      "callClaudeAPIStream",
      true
    ),
  };
}

function createDeterministicScenarios(count) {
  let state = 0x4c415544;
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

test("manifest keeps Claude global and Pages page-only", () => {
  assert.equal(manifest.subfiles_extension.includes("Addon_AI_Claude.js"), true);
  assert.equal(manifest.subfiles.includes("Addon_AI_Claude.js"), false);
  assert.equal(manifest.subfiles_extension.includes("Pages.js"), false);
  assert.equal(manifest.subfiles.includes("Pages.js"), true);
});

test("full Claude flow preserves Anthropic request, SSE, and retry semantics", async () => {
  const harnesses = createHarnesses();
  const scenarios = [
    {
      responses: [
        successResponse(["first\nsec", "ond\r\n🎵", " final\n"], [1, 2, 5, 13]),
      ],
    },
    {
      noCallback: true,
      responses: [successResponse(["silent\ncallback"], [2, 9])],
    },
    { apiKeys: [], responses: [] },
    {
      maxRetries: 2,
      maxRetriesCoercion: true,
      promptCoercion: true,
      modelCoercion: true,
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
      apiKeys: ["forbidden", "working"],
      responses: [{ status: 403 }, successResponse(["after forbidden"], [4, 3])],
    },
    {
      maxRetries: 3,
      responses: [
        { status: 401, json: { error: { message: "Invalid API key supplied" } } },
      ],
    },
    {
      maxRetries: 3,
      responses: [{ status: 401, jsonError: new Error("not json") }],
    },
    {
      maxRetries: 2,
      responses: [
        { status: 401, json: { error: { message: "expired credential" } } },
        successResponse(["custom 401 retries"], [5, 2]),
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
      maxRetries: 3,
      responses: [
        { status: 500, json: { error: { message: "permission denied upstream" } } },
      ],
    },
    {
      maxRetries: 2,
      responses: [
        { fetchError: new Error("fetch failed") },
        successResponse(["fetch recovered"], [3, 8]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        { statusError: new Error("status getter failed") },
        successResponse(["status recovered"], [4]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        { okError: new Error("ok getter failed") },
        successResponse(["ok recovered"], [5]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        { bodyError: new Error("body getter failed") },
        successResponse(["body recovered"], [6]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        { bodyValue: null },
        successResponse(["null body recovered"], [6, 2]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        { getReaderError: new Error("getReader failed") },
        successResponse(["reader acquired"], [7]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        {
          chunks: chunksFromPayload(claudePayload(["partial\nline"]), [999]),
          throwAtRead: 1,
          readError: new Error("reader interrupted"),
        },
        successResponse(["retry\ndone"], [4, 9]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        { chunks: [{ invalid: true }] },
        successResponse(["decoder recovered"], [5]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        {
          chunks: chunksFromPayload(
            claudeEvent("message_start", { type: "message_start" }) +
              claudeEvent("ping", { type: "ping" }),
            [2, 3]
          ),
        },
        successResponse(["after empty"], [5]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        {
          chunks: chunksFromPayload(
            `event: content_block_delta\ndata: ${JSON.stringify({ delta: { text: "lost" } })}`,
            [2, 1, 4]
          ),
        },
        successResponse(["after incomplete"], [6]),
      ],
    },
    {
      maxRetries: 2,
      responses: [
        {
          chunks: chunksFromPayload(
            `event: content_block_delta\r\ndata: ${JSON.stringify({ delta: { text: "crlf framed" } })}\r\n\r\n`,
            [3, 1, 7]
          ),
        },
        successResponse(["after CRLF framing"], [8]),
      ],
    },
    {
      responses: [
        {
          chunks: chunksFromPayload(
            claudeEvent("content_block_delta", { broken: true }) +
              "event: content_block_delta\ndata: {broken}\n\n" +
              "event: ping\ndata: {\"delta\":{\"text\":\"ignored\"}}\n\n" +
              deltaEvent("valid\ntext"),
            [1, 17, 2]
          ),
        },
      ],
    },
    {
      responses: [
        {
          chunks: chunksFromPayload(
            "event: content_block_delta \n" +
              "data: {\"delta\":{\"text\":\"first data ignored\"}}\n" +
              "data: {\"delta\":{\"text\":\"last data wins\\n\"}}\n\n",
            [2, 11, 1]
          ),
        },
      ],
    },
  ];

  const outcomes = [];
  for (const scenario of scenarios) {
    outcomes.push(await compareScenario(harnesses, scenario));
  }
  assert.equal(outcomes[6].parent.logs.filter((entry) => entry[0] === "fetch").length, 1);
  assert.equal(outcomes[7].parent.logs.filter((entry) => entry[0] === "fetch").length, 1);
  assert.equal(outcomes[8].parent.logs.filter((entry) => entry[0] === "fetch").length, 2);
  assert.equal(outcomes[10].parent.logs.filter((entry) => entry[0] === "fetch").length, 1);
});

test("full Claude flow preserves callback timing, retries, and error identity", async () => {
  const harnesses = createHarnesses();
  const chunkError = new Error("chunk callback failed");
  const chunkScenario = {
    maxRetries: 3,
    throwOnLine: 1,
    responses: [
      successResponse(["zero\none\ntwo"], [999]),
      successResponse(["zero\none\ntwo"], [999]),
      successResponse(["zero\none\ntwo"], [999]),
    ],
  };
  const chunkOutcomes = await compareScenario(harnesses, chunkScenario, chunkError);
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
  const finalOutcomes = await compareScenario(harnesses, finalScenario, finalError);
  assert.equal(finalOutcomes.parent.error, finalError);
  assert.equal(finalOutcomes.production.error, finalError);

  const classifiedError = new Error("Invalid API key callback");
  const classifiedScenario = {
    maxRetries: 3,
    throwOnLine: 0,
    responses: [successResponse(["zero\none"], [999])],
  };
  const classifiedOutcomes = await compareScenario(
    harnesses,
    classifiedScenario,
    classifiedError
  );
  assert.equal(classifiedOutcomes.parent.error, classifiedError);
  assert.equal(classifiedOutcomes.production.error, classifiedError);
  assert.equal(
    classifiedOutcomes.parent.logs.filter((entry) => entry[0] === "fetch").length,
    1
  );
});

test("full Claude SSE Unicode byte-split fuzz matches the parent", async () => {
  const harnesses = createHarnesses();
  for (const scenario of createDeterministicScenarios(500)) {
    await compareScenario(harnesses, scenario);
  }
});
