const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "Addon_AI_OpenRouter.js"),
  "utf8"
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);
const baseUrlMatch = source.match(/const BASE_URL = '([^']+)'/);
assert.ok(baseUrlMatch, "missing OpenRouter BASE_URL");
const BASE_URL = baseUrlMatch[1];

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing production start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing production end marker: ${endMarker}`);
  return source.slice(start, end);
}

function createProductionHarness() {
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
  vm.runInContext(
    `${extract(
      "    function emitStreamingLines(",
      "\n\n    async function callOpenRouterAPI(prompt"
    )}\n    globalThis.__callOpenRouterAPIStream = callOpenRouterAPIStream;`,
    context,
    { filename: "Addon_AI_OpenRouter.stream.extracted.js" }
  );

  return {
    call: context.__callOpenRouterAPIStream,
    setRuntime(runtime) {
      runtimeRef.current = runtime;
    },
  };
}

async function callOpenRouterAPIStreamReference(
  runtime,
  prompt,
  onLine,
  maxRetries = 3
) {
  const apiKeys = runtime.getApiKeys();
  if (apiKeys.length === 0) throw new Error("[OpenRouter] API key is required.");
  const model = runtime.getSelectedModel();
  let lastError = null;

  for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex += 1) {
    const apiKey = apiKeys[keyIndex];
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        const response = await runtime.fetch(`${BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "https://github.com/ivLis-STUDIO/ivLyrics",
            "X-Title": "ivLyrics",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            ...runtime.getAdvancedRequestParams(),
            stream: true,
          }),
        });
        if (response.status === 429 || response.status === 403) break;
        if (!response.ok) {
          let message = `HTTP ${response.status}`;
          try {
            const data = await response.json();
            if (data.error?.message) message = data.error.message;
          } catch (error) {}
          throw new Error(`[OpenRouter] ${message}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let accumulated = "";
        let emittedLines = 0;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const parts = sseBuffer.split("\n");
          sseBuffer = parts.pop() || "";
          for (const line of parts) {
            if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              const text = parsed.choices?.[0]?.delta?.content || "";
              if (text) accumulated += text;
            } catch (error) {}
          }
          if (onLine) {
            const currentLines = accumulated.split("\n");
            for (
              let index = emittedLines;
              index < currentLines.length - 1;
              index += 1
            ) {
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
        if (!accumulated) {
          throw new Error("[OpenRouter] Empty response from streaming API");
        }
        return accumulated;
      } catch (error) {
        lastError = error;
        if (
          error.message.includes("Invalid API key") ||
          error.message.includes("permission denied")
        ) {
          throw error;
        }
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) =>
            runtime.setTimeout(resolve, 1000 * (attempt + 1))
          );
        }
      }
    }
  }

  throw lastError || new Error("[OpenRouter] All API keys and retries exhausted");
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
      return scenario.model || "openai/test-model";
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
      const responseIndex = fetchIndex;
      fetchIndex += 1;
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
      const ok = spec.ok ?? (status >= 200 && status < 300);
      return {
        status,
        ok,
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
                const currentRead = readIndex;
                readIndex += 1;
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
  return {
    chunks: chunksFromPayload(ssePayload(fragments, options), sizes),
  };
}

function createCallInputs(runtime, scenario) {
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

async function execute(call, runtime, scenario, callbackError = null) {
  const calls = [];
  const onLine = scenario.withoutCallback
    ? null
    : (index, line) => {
        calls.push([index, line]);
        if (scenario.throwOnLine === index) throw callbackError;
      };
  const { prompt, maxRetries } = createCallInputs(runtime, scenario);

  try {
    const result = await call(prompt, onLine, maxRetries);
    return { result, error: null, calls, logs: runtime.logs };
  } catch (error) {
    return { result: null, error, calls, logs: runtime.logs };
  }
}

function comparableOutcome(outcome) {
  return {
    result: outcome.result,
    errorName: outcome.error?.name || null,
    errorMessage: outcome.error?.message || null,
    calls: outcome.calls,
    logs: outcome.logs,
  };
}

async function compareScenario(harness, scenario, callbackError = null) {
  const referenceRuntime = createRuntime(scenario);
  const productionRuntime = createRuntime(scenario);
  const reference = await execute(
    (prompt, onLine, maxRetries) =>
      callOpenRouterAPIStreamReference(
        referenceRuntime,
        prompt,
        onLine,
        maxRetries
      ),
    referenceRuntime,
    scenario,
    callbackError
  );
  harness.setRuntime(productionRuntime);
  const production = await execute(
    harness.call,
    productionRuntime,
    scenario,
    callbackError
  );

  assert.deepEqual(comparableOutcome(production), comparableOutcome(reference));
  return { reference, production };
}

function createDeterministicScenarios(count) {
  let state = 0x0f3e7e12;
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

test("OpenRouter addon remains a Spotify-wide extension", () => {
  assert.equal(manifest.subfiles_extension.includes("Addon_AI_OpenRouter.js"), true);
  assert.equal(manifest.subfiles.includes("Addon_AI_OpenRouter.js"), false);
});

test("full OpenRouter SSE flow preserves output, callbacks, and retries", async () => {
  const harness = createProductionHarness();
  const readerError = new Error("reader interrupted");
  const scenarios = [
    {
      responses: [
        successResponse(["first\nsec", "ond\n🎵", " final"], [1, 2, 5, 13]),
      ],
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
      responses: [
        { status: 429 },
        successResponse(["next key"], [2, 7]),
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
              prefix: "data: {malformed json}\ncomment: ignored\n",
            }),
            [1, 17, 2]
          ),
        },
      ],
    },
    {
      responses: [
        { status: 401, json: { error: { message: "Invalid API key" } } },
      ],
    },
  ];

  for (const scenario of scenarios) {
    await compareScenario(harness, scenario);
  }
});

test("full OpenRouter flow preserves callback exception retry order", async () => {
  const harness = createProductionHarness();
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

  const { reference, production } = await compareScenario(
    harness,
    scenario,
    expectedError
  );
  assert.equal(reference.error, expectedError);
  assert.equal(production.error, expectedError);
});

test("full OpenRouter SSE Unicode fuzz matches the parent implementation", async () => {
  const harness = createProductionHarness();
  for (const scenario of createDeterministicScenarios(500)) {
    await compareScenario(harness, scenario);
  }
});
