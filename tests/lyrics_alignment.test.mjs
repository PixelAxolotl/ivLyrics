import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../LyricsAlignment.js", import.meta.url), "utf8");

const harness = ({ providers = [], values = {} } = {}) => {
  const store = new Map(Object.entries(values));
  const events = [];
  const window = {
    Spicetify: { LocalStorage: { get: key => store.get(key) ?? null, set: (key, value) => store.set(key, value) } },
    AIAddonManager: {
      getEnabledProvidersFor: () => providers,
      generateLyricsAlignment: async params => {
        events.push(params);
        return { lines: [{ id: params.lines[0].id, groups: [{ source: [[0, 1]], target: [[2, 3]] }] }] };
      },
    },
    dispatchEvent: () => {},
  };
  vm.runInNewContext(source, { window, Intl, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } });
  return { api: window.LyricsAlignment, events };
};

test("Bing and Google-only translation providers do not trigger semantic alignment", async () => {
  const { api, events } = harness({
    providers: [{ id: "bing", generateLyricsAlignment: undefined }, { id: "google", generateLyricsAlignment: undefined }],
    values: { "ivLyrics:visual:translation-semantic-highlight": "true" },
  });
  const rows = await api.request({ id: "line", kind: "translation", sourceText: "I love you", targetText: "사랑해", sourceUnits: ["I", "love", "you"], targetUnits: ["사", "랑", "해"] });
  assert.equal(events.length, 0);
  assert.equal(rows[0].status, "fallback");
  assert.equal(api.getAvailability("translation").reason, "no-provider");
});

test("semantic mapping preserves target order while allowing a non-monotonic source range", () => {
  const { api } = harness();
  const result = api.normalizeResult({ id: "line", kind: "translation", sourceUnits: ["a", "b", "c"], targetUnits: ["x", "y", "z"] }, {
    lines: [{ id: "line", groups: [{ source: [[2, 3], [0, 1]], target: [[0, 3]] }] }],
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(JSON.parse(JSON.stringify(result.groups[0].source)), [[2, 3], [0, 1]]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.groups[0].target)), [[0, 3]]);
});
