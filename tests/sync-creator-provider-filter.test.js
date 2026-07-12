const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "SyncDataCreator.js"),
  "utf8"
);

const start = source.indexOf("const isSyncCreatorLyricsProvider =");
const end = source.indexOf("const normalizeSyncCreatorIsrc =", start);
assert.notEqual(start, -1, "missing provider eligibility helper");
assert.notEqual(end, -1, "missing provider helper end marker");

const context = {};
vm.createContext(context);
vm.runInContext(
  `${source.slice(start, end)}\n` +
    "globalThis.__providerHelpers = { isSyncCreatorLyricsProvider, getSyncCreatorLyricsProviders };",
  context,
  { filename: "SyncDataCreator.providers.extracted.js" }
);

const {
  isSyncCreatorLyricsProvider,
  getSyncCreatorLyricsProviders,
} = context.__providerHelpers;

test("allows providers unless ivLyrics Sync is explicitly disabled", () => {
  assert.equal(isSyncCreatorLyricsProvider({ id: "lrclib", useIvLyricsSync: true }), true);
  assert.equal(isSyncCreatorLyricsProvider({ id: "legacy" }), true);
  assert.equal(isSyncCreatorLyricsProvider({ id: "unison", useIvLyricsSync: false }), false);
  assert.equal(isSyncCreatorLyricsProvider(null), false);
  assert.equal(isSyncCreatorLyricsProvider({ useIvLyricsSync: true }), false);
});

test("filters disabled Sync providers while preserving manager order", () => {
  const manager = {
    getEnabledProviders: () => [
      { id: "lrclib", useIvLyricsSync: true },
      { id: "unison", useIvLyricsSync: false },
      { id: "spotify" },
    ],
  };

  assert.deepEqual(
    Array.from(getSyncCreatorLyricsProviders(manager), (provider) => provider.id),
    ["lrclib", "spotify"]
  );
  assert.deepEqual(Array.from(getSyncCreatorLyricsProviders(null)), []);
});

test("uses the Sync provider filter for both listing and lyric loading", () => {
  const integrationCalls = source.match(
    /getSyncCreatorLyricsProviders\(window\.LyricsAddonManager\)/g
  ) || [];
  assert.ok(integrationCalls.length >= 2);
});
