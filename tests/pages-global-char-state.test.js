const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "Pages.js"), "utf8");
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

function createProductionHarness() {
  const context = {
    getTimedSyllablesFromLine(line) {
      return line?.syllables || [];
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${extract(
      "const countKaraokeCharacters =",
      "\n\nconst EMPTY_GLOBAL_CHAR_STATE"
    )}\nglobalThis.__buildGlobalCharState = buildGlobalCharState;`,
    context,
    { filename: "Pages.global-char-state.extracted.js" }
  );
  return context.__buildGlobalCharState;
}

function buildGlobalCharStateReference(lyrics, position) {
  const offsets = [];
  let totalChars = 0;
  let activeCharIndex = -1;
  let lastPassedCharIndex = -1;
  let lastPassedCharEndTime = 0;
  let lastPassedCharDuration = 100;

  for (let index = 0; index < lyrics.length; index += 1) {
    const line = lyrics[index];
    offsets.push(totalChars);
    const syllables = line?.syllables || [];
    if (!Array.isArray(syllables) || syllables.length === 0) continue;

    for (const syllable of syllables) {
      if (!syllable || !syllable.text) continue;
      const characters = Array.from(syllable.text || "");
      const syllableStart = syllable.startTime || 0;
      const syllableEnd = syllable.endTime || syllableStart + 500;

      for (let charIndex = 0; charIndex < characters.length; charIndex += 1) {
        const charDuration = (syllableEnd - syllableStart) / characters.length;
        const charStart = syllableStart + charIndex * charDuration;
        const charEnd = charStart + charDuration;
        if (position >= charStart && position < charEnd) activeCharIndex = totalChars;
        if (position >= charEnd && charEnd > lastPassedCharEndTime) {
          lastPassedCharEndTime = charEnd;
          lastPassedCharIndex = totalChars;
          lastPassedCharDuration = charDuration || 100;
        }
        totalChars += 1;
      }
    }
  }

  if (activeCharIndex === -1 && lastPassedCharIndex !== -1) {
    const timeDiff = position - lastPassedCharEndTime;
    const simulateDuration = Math.max(40, lastPassedCharDuration * 0.01);
    const virtualProgress = Math.floor(timeDiff / simulateDuration);
    if (timeDiff < 2000) activeCharIndex = lastPassedCharIndex + 1 + virtualProgress;
  }

  return {
    globalCharOffsets: offsets,
    activeGlobalCharIndex: activeCharIndex,
  };
}

test("Pages remains an ivLyrics-page-only subfile", () => {
  assert.equal(manifest.subfiles.includes("Pages.js"), true);
  assert.equal(manifest.subfiles_extension.includes("Pages.js"), false);
});

test("global character state preserves Unicode offsets and timing boundaries", () => {
  const buildGlobalCharState = createProductionHarness();
  const lyrics = [
    {
      syllables: [
        { text: "A🎵", startTime: 0, endTime: 300 },
        { text: "한 글", startTime: 300, endTime: 900 },
      ],
    },
    { syllables: [] },
    {
      syllables: [
        { text: "e\u0301", startTime: 1000, endTime: 1200 },
        { text: ["x", "y"], startTime: 1200, endTime: 1400 },
      ],
    },
  ];
  const positions = [
    -1, 0, 149.999, 150, 299.999, 300, 499.999, 500, 899.999, 900,
    999.999, 1000, 1099.999, 1100, 1199.999, 1200, 1399.999, 1400, 3399,
  ];

  for (const position of positions) {
    const expected = buildGlobalCharStateReference(lyrics, position);
    const actual = JSON.parse(JSON.stringify(buildGlobalCharState(lyrics, position)));
    assert.deepEqual(actual, expected, `position ${position}`);
  }
});

test("global character state preserves per-character numeric coercion", () => {
  const buildGlobalCharState = createProductionHarness();
  const createLyrics = () => {
    const calls = { start: 0, end: 0 };
    const log = [];
    return {
      calls,
      log,
      lyrics: [{
        syllables: [{
          text: "abc",
          startTime: {
            valueOf() {
              calls.start += 1;
              log.push("start");
              return 0;
            },
          },
          endTime: {
            valueOf() {
              calls.end += 1;
              log.push("end");
              return 300;
            },
          },
        }],
      }],
    };
  };

  const referenceInput = createLyrics();
  const productionInput = createLyrics();
  const expected = buildGlobalCharStateReference(referenceInput.lyrics, 150);
  const actual = JSON.parse(JSON.stringify(buildGlobalCharState(productionInput.lyrics, 150)));

  assert.equal(expected.activeGlobalCharIndex, 1);
  assert.equal(actual.activeGlobalCharIndex, expected.activeGlobalCharIndex);
  assert.deepEqual(productionInput.calls, referenceInput.calls);
  assert.deepEqual(productionInput.calls, { start: 6, end: 3 });
  assert.deepEqual(productionInput.log, referenceInput.log);
});

test("empty iterable text still evaluates timing getters", () => {
  const buildGlobalCharState = createProductionHarness();
  const verify = (build) => {
    const expectedError = new Error("startTime getter evaluated");
    const emptyIterable = {
      *[Symbol.iterator]() {},
    };
    const lyrics = [{
      syllables: [{
        text: emptyIterable,
        get startTime() {
          throw expectedError;
        },
        endTime: 500,
      }],
    }];

    assert.throws(
      () => build(lyrics, 0),
      (error) => error === expectedError
    );
  };

  verify(buildGlobalCharStateReference);
  verify(buildGlobalCharState);
});
