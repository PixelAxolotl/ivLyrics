const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "NowPlayingPanelLyrics.js"),
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

function createResolverHarness(lyrics) {
  let calls = 0;
  let trackEndTime = 9000;
  let autoInstrumentalBreakEnabled = true;
  const context = {
    isAutoInstrumentalBreakEnabled() {
      return autoInstrumentalBreakEnabled;
    },
    getTrailingKaraokeInterludeInfo(line, nextLine, lineIndex, lineCount, autoEnabled) {
      calls += 1;
      return {
        autoEnabled,
        line: line.id,
        nextLine: nextLine?.id ?? null,
        lineIndex,
        lineCount,
        endTime: lineIndex === lineCount - 1 ? trackEndTime : nextLine.startTime,
      };
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extract(
      "    const createTrailingKaraokeInterludeResolver =",
      "\n\n    // ============================================\n    // 노래방 단어 컴포넌트"
    )}\n    globalThis.__createResolver = createTrailingKaraokeInterludeResolver;`,
    context,
    { filename: "NowPlayingPanelLyrics.resolver.extracted.js" }
  );

  return {
    resolve: context.__createResolver(lyrics),
    getCalls: () => calls,
    setTrackEndTime(value) {
      trackEndTime = value;
    },
    setAutoInstrumentalBreakEnabled(value) {
      autoInstrumentalBreakEnabled = value;
    },
  };
}

test("Now Playing panel remains a Spotify-wide extension", () => {
  assert.equal(manifest.subfiles_extension.includes("NowPlayingPanelLyrics.js"), true);
  assert.equal(manifest.subfiles.includes("NowPlayingPanelLyrics.js"), false);
});

test("reuses stable trailing-interlude data while preserving settings, line, and final-duration changes", () => {
  const lyrics = [
    { id: "first", startTime: 0 },
    { id: "second", startTime: 3000 },
    { id: "last", startTime: 6000 },
  ];
  const harness = createResolverHarness(lyrics);

  const first = harness.resolve(0);
  for (let tick = 0; tick < 120; tick += 1) {
    assert.deepEqual(harness.resolve(0), first);
  }
  assert.equal(harness.getCalls(), 1);

  harness.setAutoInstrumentalBreakEnabled(false);
  assert.equal(harness.resolve(0).autoEnabled, false);
  assert.equal(harness.getCalls(), 2);

  assert.equal(harness.resolve(1).endTime, 6000);
  assert.equal(harness.resolve(1).endTime, 6000);
  assert.equal(harness.getCalls(), 3);

  assert.equal(harness.resolve(0).endTime, 3000);
  assert.equal(harness.getCalls(), 4);

  assert.equal(harness.resolve(2).endTime, 9000);
  harness.setTrackEndTime(9500);
  assert.equal(harness.resolve(2).endTime, 9500);
  assert.equal(harness.getCalls(), 6);
});
