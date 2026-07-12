const assert = require("node:assert/strict");
const { AsyncLocalStorage } = require("node:async_hooks");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "Addon_AI_Gemini.js"),
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

const productionFunctionSource = extract(
  "    async function callGeminiAPIStream(",
  "\n\n    /**\n     * Call Gemini API"
);
const parentFunctionSource = productionFunctionSource
  .replace(
    "async function callGeminiAPIStream(",
    "async function callGeminiAPIStreamReference("
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
  const storage = new AsyncLocalStorage();
  const forward = (name) => (...args) => storage.getStore()[name](...args);
  const context = {
    TextDecoder,
    encodeURIComponent: forward("encodeURIComponent"),
    fetch: forward("fetch"),
    getApiKeys: forward("getApiKeys"),
    getSelectedModel: forward("getSelectedModel"),
    getBaseUrl: forward("getBaseUrl"),
    getGenerationConfig: forward("getGenerationConfig"),
    setTimeout: forward("setTimeout"),
    window: {},
  };
  vm.createContext(context);
  const emitterSource = includeEmitter
    ? extract(
        "    function emitStreamingLines(",
        "\n\n    async function callGeminiAPIStream"
      )
    : "";
  vm.runInContext(
    `${emitterSource}\n${functionSource}\nglobalThis.__stream = ${functionName};`,
    context,
    { filename: `Addon_AI_Gemini.${functionName}.extracted.js` }
  );
  return {
    call(runtime, ...args) {
      return storage.run(runtime, () => context.__stream(...args));
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
      if (scenario.apiKeyCoercion) {
        return [{
          [Symbol.toPrimitive](hint) {
            logs.push(["coerce apiKey", hint]);
            return scenario.apiKey || "key /?한글";
          },
        }];
      }
      return [...(scenario.apiKeys ?? ["gemini-key-1"])];
    },
    getSelectedModel() {
      logs.push(["getSelectedModel"]);
      if (scenario.modelCoercion) {
        return {
          [Symbol.toPrimitive](hint) {
            logs.push(["coerce model", hint]);
            return scenario.model || "gemini-model-coerced";
          },
        };
      }
      return scenario.model ?? "gemini-2.5-flash-test";
    },
    getBaseUrl() {
      logs.push(["getBaseUrl"]);
      if (scenario.baseUrlReplace) {
        return {
          replace(pattern, replacement) {
            logs.push(["baseUrl replace", String(pattern), replacement]);
            return (scenario.baseUrl || "https://gemini.example/v1beta/")
              .replace(pattern, replacement);
          },
        };
      }
      return scenario.baseUrl ?? "https://gemini.example/v1beta/";
    },
    getGenerationConfig() {
      logs.push(["getGenerationConfig"]);
      if (scenario.generationGetter) {
        return {
          get maxOutputTokens() {
            logs.push(["get maxOutputTokens"]);
            return 4321;
          },
          thinkingConfig: { thinkingBudget: 0 },
        };
      }
      return { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } };
    },
    encodeURIComponent(value) {
      logs.push(["encodeURIComponent"]);
      return globalThis.encodeURIComponent(value);
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

function dataLine(payload, newline = "\n") {
  return `data: ${JSON.stringify(payload)}${newline}`;
}

function textData(content, newline = "\n") {
  return dataLine({
    candidates: [{ content: { parts: [{ text: content }] } }],
  }, newline);
}

function geminiPayload(fragments, { prefix = "", suffix = "", newline = "\n" } = {}) {
  return `${prefix}${fragments.map((text) => textData(text, newline)).join("")}${suffix}`;
}

function successResponse(fragments, sizes, options) {
  return { chunks: chunksFromPayload(geminiPayload(fragments, options), sizes) };
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
    const result = await harness.call(runtime, prompt, onLine, maxRetries);
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
      "callGeminiAPIStreamReference",
      false
    ),
    production: createHarness(
      productionFunctionSource,
      "callGeminiAPIStream",
      true
    ),
  };
}

function createDeterministicScenarios(count) {
  let state = 0x47454d49;
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

test("manifest keeps Gemini global and Pages page-only", () => {
  assert.equal(manifest.subfiles_extension.includes("Addon_AI_Gemini.js"), true);
  assert.equal(manifest.subfiles.includes("Addon_AI_Gemini.js"), false);
  assert.equal(manifest.subfiles_extension.includes("Pages.js"), false);
  assert.equal(manifest.subfiles.includes("Pages.js"), true);
});

test("full Gemini flow preserves Google request, SSE, and retry semantics", async () => {
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
    { model: "", responses: [] },
    {
      maxRetries: 2,
      maxRetriesCoercion: true,
      promptCoercion: true,
      modelCoercion: true,
      apiKeyCoercion: true,
      baseUrlReplace: true,
      generationGetter: true,
      responses: [
        { status: 500, json: { error: { message: "temporary" } } },
        successResponse(["recovered\nvalue"], [3, 1, 8]),
      ],
    },
    {
      baseUrl: "https://gemini.example/v1beta///",
      responses: [successResponse(["one slash removed"], [4])],
    },
    {
      apiKeys: ["rate limited", "working/key"],
      responses: [{ status: 429 }, successResponse(["next key"], [2, 7])],
    },
    {
      apiKeys: ["forbidden", "working"],
      responses: [{ status: 403 }, successResponse(["after forbidden"], [4, 3])],
    },
    {
      maxRetries: 2,
      responses: [
        { status: 401, json: { error: { message: "invalid key" } } },
        successResponse(["401 retries"], [5, 2]),
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
          chunks: chunksFromPayload(geminiPayload(["partial\nline"]), [999]),
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
            "event: ping\n: comment\ndata: [DONE]\ndata:{\"ignored\":true}\n",
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
            textData("lost").slice(0, -1),
            [2, 1, 4]
          ),
        },
        successResponse(["after incomplete"], [6]),
      ],
    },
    {
      responses: [successResponse(["crlf\ntransport"], [1, 7, 2], { newline: "\r\n" })],
    },
    {
      responses: [{
        chunks: chunksFromPayload(
          "data: {broken}\n" +
            dataLine({ candidates: [{ content: { parts: [{}, { text: "second ignored" }] } }] }) +
            dataLine({ candidates: [{ content: { parts: [{ text: "chosen\ntext" }] } }, { content: { parts: [{ text: "other ignored" }] } }] }),
          [1, 17, 2]
        ),
      }],
    },
    {
      responses: [{
        chunks: chunksFromPayload(
          dataLine({ candidates: [{ content: { parts: [{ text: 123 }] } }] }) +
            textData("\nnumber"),
          [2, 11, 1]
        ),
      }],
    },
  ];

  for (const scenario of scenarios) await compareScenario(harnesses, scenario);
});

test("full Gemini flow preserves callback timing, retries, and error identity", async () => {
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
});

test("full Gemini Unicode byte-split fuzz matches the parent", async () => {
  const harnesses = createHarnesses();
  for (const scenario of createDeterministicScenarios(500)) {
    await compareScenario(harnesses, scenario);
  }
});

test("concurrent Gemini streams keep request and line state isolated", async () => {
  const harnesses = createHarnesses();
  const scenarios = Array.from({ length: 40 }, (_, index) => ({
    prompt: `prompt-${index}`,
    model: `gemini-model-${index}`,
    apiKeys: [`key ${index}/한글`],
    baseUrl: `https://gemini-${index}.example/v1beta/`,
    maxRetries: 1,
    responses: [successResponse([
      `stream-${index}\n`,
      `${index % 2 ? "🎵" : "한글"}-${index}\nfinal-${index}`,
    ], [1 + (index % 9), 2 + (index % 7), 3 + (index % 5)])],
  }));

  const parent = await Promise.all(scenarios.map((scenario) =>
    execute(harnesses.parent, createRuntime(scenario), scenario, null)
  ));
  const production = await Promise.all(scenarios.map((scenario) =>
    execute(harnesses.production, createRuntime(scenario), scenario, null)
  ));
  assert.deepEqual(production.map(comparable), parent.map(comparable));
});
