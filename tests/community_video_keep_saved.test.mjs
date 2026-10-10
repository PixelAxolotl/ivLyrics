import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../Utils.js', import.meta.url), 'utf8');

const section = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source section: ${startMarker}`);
  return text.slice(start, end);
};

// Keep-local contract: resolving against the community list must never delete
// the user's saved pick. Mismatch => don't play, but preserve the record.
test('mismatched community list keeps the saved pick (no delete)', () => {
  const fn = section(source, 'async resolveCommunityVideoForTrack(trackUri', 'if (decision.status !== "play")');
  assert.doesNotMatch(fn, /removeSelectedVideo/, 'caller must not delete the saved video on mismatch');
});
