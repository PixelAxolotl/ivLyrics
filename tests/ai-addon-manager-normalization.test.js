const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "AIAddonManager.js"),
  "utf8"
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
);

function createManager() {
  const context = {
    console: { error() {}, warn() {} },
    setTimeout() {
      return 1;
    },
    Spicetify: {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "AIAddonManager.js" });
  return context.AIAddonManager;
}

test("AI manager remains a Spotify-wide extension", () => {
  assert.equal(manifest.subfiles_extension.includes("AIAddonManager.js"), true);
  assert.equal(manifest.subfiles.includes("AIAddonManager.js"), false);
});

test("character pronunciation normalization preserves indexed, duplicate, and positional selection", () => {
  const manager = createManager();
  const normalized = manager._normalizeCharacterPronunciationResult(
    {
      l: [
        { i: 2, p: ["third"] },
        { p: ["fallback"] },
        { i: "0", p: ["first"] },
        { i: 0, p: ["duplicate-must-not-win"] },
      ],
    },
    ["甲", "乙", "丙"],
    { unitMode: "char" }
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(normalized.lines)),
    [
      {
        index: 0,
        unitMode: "char",
        units: [],
        chars: [{ i: 0, char: "甲", pronunciation: "first" }],
      },
      {
        index: 1,
        unitMode: "char",
        units: [],
        chars: [{ i: 0, char: "乙", pronunciation: "fallback" }],
      },
      {
        index: 2,
        unitMode: "char",
        units: [],
        chars: [{ i: 0, char: "丙", pronunciation: "third" }],
      },
    ]
  );
});
