const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "SyncDataCreator.js"),
  "utf8"
);

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing production start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing production end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("renders the bulk custom speaker dialog in the active Sync Creator layout", () => {
  const activeModalTree = extract(
    "\tconst renderModals = () => {",
    "\n\treturn react.createElement('div', { className: 'ivlyrics-sync-creator-shell'"
  );

  assert.match(activeModalTree, /renderBulkCustomSpeakerDialog\(\)/);
  assert.match(source, /autoFocus: true/);
  assert.match(source, /applyBulkCustomSpeaker\(\)/);
});

test("defers bulk CUSTOM application until the color dialog is confirmed", () => {
  const bulkFlow = extract(
    "\tconst requestSongVocalSpeaker = useCallback",
    "\n\tconst currentManualSplitPoints = useMemo"
  );

  assert.match(bulkFlow, /setShowBulkCustomSpeakerDialog\(true\)/);
  assert.match(
    bulkFlow,
    /applySongVocalSpeaker\('CUSTOM', \{ color, fallback \}\)/
  );
});

test("keeps line and vocal-part CUSTOM selection inline without opening the bulk dialog", () => {
  const inspectorFlow = extract(
    "\tconst renderLineInspector = () => {",
    "\n\tconst renderLrclibCandidatesPanel = () =>"
  );

  assert.doesNotMatch(inspectorFlow, /setShowBulkCustomSpeakerDialog|renderBulkCustomSpeakerDialog/);
  assert.match(inspectorFlow, /updateSpeakerMeta\('speaker', transition\.speaker\)/);
  assert.match(inspectorFlow, /updateSpeakerMeta\('speaker-color', transition\.color\)/);
});
