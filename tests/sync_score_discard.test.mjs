import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { create } = require('../SyncCreatorScoreTracker.js');
const copy = value => structuredClone(value);
const snapshot = (count) => ({
  version: 5,
  source: { provider: 'lrclib', lrclibId: '1', lyricsFingerprint: 'x', lineCharCounts: Array(50).fill(2) },
  lines: Array.from({ length: count }, (_, i) => ({ start: i * 2, end: i * 2 + 1, granularity: 'character', chars: [i + 1, i + 1.5] }))
});

function fixture({ request, onDiscard } = {}) {
  let clock = 0;
  let stored = null;
  const sent = [];
  const discarded = [];
  const tracker = create({
    accountId: 'a', isrc: 'ISRC1', initialSyncData: snapshot(0),
    now: () => clock, setInterval: false,
    isActive: () => true, isAuthorized: () => true,
    storage: { getScoreWork: async () => null, saveScoreWork: async () => {} },
    request: async (event) => { sent.push(copy(event)); return request(event); },
    onDiscard: (err, evt) => { discarded.push({ err, evt }); onDiscard?.(err, evt); },
  });
  return { tracker, sent, discarded };
}

test('422 poison snapshot is discarded with a visible signal, later edits continue', async () => {
  let calls = 0;
  const { tracker, sent, discarded } = fixture({
    request: (event) => {
      calls++;
      if (calls === 2) throw Object.assign(new Error('unprocessable'), { status: 422 });
      return { success: true, sessionId: event.sessionId || 's', sequence: event.sequence };
    },
  });
  tracker.enqueue('record', snapshot(1), { start: 0, end: 1, inputCount: 1 });
  tracker.enqueue('record', snapshot(2), { start: 2, end: 3, inputCount: 1 });
  const receipt = await tracker.submission(snapshot(2));
  assert.equal(discarded.length, 1);
  assert.equal(discarded[0].err.status, 422);
  assert.ok(receipt.workSessionId);
  assert.ok(sent.length >= 3);
  tracker.stop();
});

test('403 still blocks the queue (auth must not be silently dropped)', async () => {
  const { tracker } = fixture({
    request: () => { throw Object.assign(new Error('forbidden'), { status: 403 }); },
  });
  tracker.enqueue('record', snapshot(1), { start: 0, end: 1, inputCount: 1 });
  await assert.rejects(tracker.flush(), /forbidden/);
  assert.ok(tracker.__test.getState().queue.length >= 1);
  assert.equal(tracker.__test.getState().queue.at(-1).action, 'record');
  tracker.stop();
});
