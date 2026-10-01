import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const loadApi = () => {
  const source = readFileSync(new URL("../UserSyncExport.js", import.meta.url), "utf8");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.UserSyncExport;
};

// Values created inside the vm context carry a different realm prototype,
// so compare their JSON shape instead of object identity.
const shapeOf = (value) => JSON.parse(JSON.stringify(value));

test("normalizeContribution picks track identity and display fields", () => {
  const api = loadApi();
  assert.deepEqual(shapeOf(api.normalizeContribution({
    trackId: "t1",
    provider: "lrclib",
    trackName: "Hello",
    artists: "Adele",
    syncPoints: 5,
  })), {
    trackId: "t1",
    provider: "lrclib",
    trackName: "Hello",
    artists: "Adele",
  });
});

test("normalizeContribution drops entries without trackId", () => {
  const api = loadApi();
  assert.equal(api.normalizeContribution({ provider: "lrclib", trackName: "Hello" }), null);
});

test("buildExportFileName mirrors the sync editor naming", () => {
  const api = loadApi();
  const sanitize = (value, fallback) => String(value || fallback).replace(/\//g, "-");
  assert.equal(
    api.buildExportFileName({ trackName: "Hello", artists: "Adele", trackId: "t1" }, sanitize),
    "Hello-Adele.json"
  );
  assert.equal(
    api.buildExportFileName({ trackName: "", artists: "", trackId: "t1" }, sanitize),
    "sync-t1.json"
  );
  assert.equal(
    api.buildExportFileName({ trackName: "", artists: "", trackId: "" }, sanitize),
    "ivLyrics-sync.json"
  );
});

test("extractSyncBody unwraps getSyncData shapes and rejects empty bodies", () => {
  const api = loadApi();
  const body = { lines: [{ text: "hi" }], version: 3 };
  assert.equal(api.extractSyncBody({ syncData: body }), body);
  assert.equal(api.extractSyncBody(body), body);
  assert.equal(api.extractSyncBody({ syncData: { lines: [] } }), null);
  assert.equal(api.extractSyncBody(null), null);
});

test("collectAllContributions paginates and dedupes by track and provider", async () => {
  const api = loadApi();
  const pages = [
    [
      { trackId: "t1", provider: "lrclib", trackName: "A", artists: "X" },
      { trackId: "t2", provider: "lrclib", trackName: "B", artists: "Y" },
    ],
    [
      { trackId: "t2", provider: "lrclib", trackName: "B", artists: "Y" },
    ],
  ];
  const seenOffsets = [];
  const result = await api.collectAllContributions(async (offset, limit) => {
    seenOffsets.push([offset, limit]);
    return pages[offset / limit] || [];
  }, 2);
  assert.deepEqual(seenOffsets, [[0, 2], [2, 2]]);
  assert.deepEqual(shapeOf(result.map((item) => item.trackId)), ["t1", "t2"]);
});

// In Spicetify, subfiles share script scope: `Utils` is a top-level const,
// NOT a window property. The sandbox below mirrors that layout so regressions
// that only read window.Utils are caught.
const loadApiInBrowserGlobals = (stubs) => {
  const source = readFileSync(new URL("../UserSyncExport.js", import.meta.url), "utf8");
  const sandbox = { window: { ...(stubs.windowProps || {}) }, Blob };
  vm.createContext(sandbox);
  vm.runInContext(stubs.prelude, sandbox);
  vm.runInContext(source, sandbox);
  return { api: sandbox.window.UserSyncExport, sandbox };
};

test("listMyContributions uses the shared Utils global instead of window.Utils", async () => {
  const { api } = loadApiInBrowserGlobals({
    prelude: `const Utils = {
      getUserHash: () => "user-1",
      fetchSyncCreatorProfile: async () => ({ contributions: [
        { trackId: "t1", provider: "lrclib", trackName: "A", artists: "B" },
      ] }),
    };`,
  });
  const contributions = await api.listMyContributions();
  assert.deepEqual(shapeOf(contributions), [
    { trackId: "t1", provider: "lrclib", trackName: "A", artists: "B" },
  ]);
});

test("exportMySyncs saves one editor-named file per own contribution", async () => {
  const { api, sandbox } = loadApiInBrowserGlobals({
    windowProps: {
      SyncDataService: {
        getSyncData: async (trackId) => ({ syncData: { lines: [{ text: `lyrics-${trackId}` }], version: 3 } }),
      },
    },
    prelude: `const Utils = {
      getUserHash: () => "user-1",
      sanitizeFileName: (value, fallback) => String(value || fallback).replace(/\\//g, "-"),
      saveBlobAs: async (blob, fileName) => { globalThis.__savedFiles.push(fileName); },
      fetchSyncCreatorProfile: async () => ({ contributions: [
        { trackId: "t1", provider: "lrclib", trackName: "Hello", artists: "Adele" },
        { trackId: "t2", provider: "lrclib", trackName: "Rolling", artists: "Adele" },
      ] }),
    };
    globalThis.__savedFiles = [];`,
  });
  const result = await api.exportMySyncs({ directoryHandle: null });
  assert.deepEqual(shapeOf(result), { total: 2, exported: 2, skipped: 0 });
  const files = vm.runInContext(`globalThis.__savedFiles`, sandbox);
  assert.deepEqual(shapeOf(files), ["Hello-Adele.json", "Rolling-Adele.json"]);
});
