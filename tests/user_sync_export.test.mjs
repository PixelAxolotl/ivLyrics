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

test("folder selection happens before profile network work and cancellation stops export", async () => {
  const events = [];
  const { api, sandbox } = loadApiInBrowserGlobals({
    prelude: `const Utils = {
      getUserHash: () => "user-1",
      fetchSyncCreatorProfile: async () => { window.record("profile"); return { contributions: [] }; }
    };`,
    windowProps: {
      record: value => events.push(value),
      showDirectoryPicker: async () => { events.push("picker"); return {}; },
    },
  });
  await assert.rejects(api.exportMySyncs(), error => error.code === "NO_USER_SYNCS");
  assert.deepEqual(events, ["picker", "profile"]);
  events.length = 0;
  sandbox.window.showDirectoryPicker = async () => {
    events.push("cancel");
    const error = new Error("cancelled");
    error.name = "AbortError";
    throw error;
  };
  await assert.rejects(api.exportMySyncs(), { name: "AbortError" });
  assert.deepEqual(events, ["cancel"]);
});

test("directory export preserves duplicate titles and skips unavailable syncs", async () => {
  const files = new Map(), closed = [];
  const { api } = loadApiInBrowserGlobals({
    prelude: `const Utils = {
      getUserHash: () => "user-1",
      fetchSyncCreatorProfile: async () => ({ contributions: ["a", "b", "missing"].map(trackId => ({
        trackId, provider: "lrclib", trackName: "Song", artists: "Artist"
      })) })
    };`,
    windowProps: { SyncDataService: { getSyncData: async trackId => trackId === "missing"
      ? null : { lines: [{ text: trackId }] } } },
  });
  const directoryHandle = {
    getFileHandle: async name => ({ createWritable: async () => ({
      write: async text => files.set(name, JSON.parse(text)),
      close: async () => closed.push(name),
    }) }),
  };
  const result = await api.exportMySyncs({ directoryHandle });
  assert.deepEqual(shapeOf(result), { total: 3, exported: 2, skipped: 1 });
  assert.deepEqual([...files.keys()], ["Song-Artist.json", "Song-Artist-2.json"]);
  assert.equal(files.get("Song-Artist-2.json").lines[0].text, "b");
  assert.equal(closed.length, 2);
});

function loadExportSetting(extra = {}) {
  const source = readFileSync(new URL("../Settings.js", import.meta.url), "utf8");
  const key = source.indexOf('key: "export-my-syncs"');
  const start = source.lastIndexOf("            {", key);
  const end = source.indexOf("\n            },", key) + "\n            }".length;
  const container = { innerHTML: "" }, translations = [];
  const sandbox = {
    ConfigButton: {}, I18n: { t: (key, params) => { translations.push([key, params]); return ""; } },
    getSettingsResultContainer: () => container,
    Utils: { escapeHtml: text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") },
    ...extra,
  };
  const setting = vm.runInNewContext("(" + source.slice(start, end) + ")", sandbox);
  return { setting, container, translations };
}

test("export settings tolerate a missing module and render errors as text", async () => {
  const button = { textContent: "Export", disabled: false };
  await loadExportSetting().setting.onChange(null, { target: button });
  const { setting, container } = loadExportSetting({
    UserSyncExport: { exportMySyncs: async () => { throw new Error('<img src=x onerror="bad()">'); } },
  });
  await setting.onChange(null, { target: button });
  assert.ok(container.innerHTML.includes("&lt;img"));
  assert.ok(!container.innerHTML.includes("<img"));
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Export");
});

test("export result translation receives the exported, total and skipped counts", async () => {
  const summary = { exported: 2, total: 3, skipped: 1 };
  const { setting, translations } = loadExportSetting({
    UserSyncExport: { exportMySyncs: async () => summary },
  });
  await setting.onChange(null, { target: { textContent: "Export" } });
  assert.equal(translations.find(([key]) => key === "notifications.mySyncsExportSuccessDesc")[1], summary);
});
