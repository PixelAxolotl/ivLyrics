import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../SyncDataCreator.js', import.meta.url), 'utf8');
const slice = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const helper = slice('const fetchSyncCreatorLrclib =', 'const SYNC_CREATOR_RTL_STRONG_CHAR_REGEX');
const callbacks = slice('\tconst loadLrclibById =', '\t// 가사를 줄 단위로 파싱');
const candidate = { id: 18694795, syncedLyrics: '[00:01.00]Fixture', candidateKey: 'fixture' };

function harness(transport) {
  const calls = [], messages = [];
  let current = true;
  const context = vm.createContext({
    window: { IvLyricsLrclibTransport: transport }, URLSearchParams,
    useCallback: callback => callback,
    I18n: { t: key => key },
    console: { error() {} },
    Toast: { error: value => messages.push(value), success: value => messages.push(value) },
    lrclibIdInput: '18694795', lrclibSearchQuery: 'Fixture & café', SYNC_CREATOR_SOURCE_ADDON_ID: 'lrclib',
    lrclibIdInputEditedRef: { current: true },
    beginSyncCreatorSourceChange: () => 1,
    isCurrentSyncCreatorSourceChange: () => current,
    resetSyncCreatorLyricsLoadingState() {}, clearLrclibCandidateState() {},
    getLrclibCandidateText: value => value.syncedLyrics || '',
    buildLrclibIdCandidate: value => value,
    buildLrclibSearchCandidate: value => value,
    buildLrclibSyncSource: value => ({ provider: 'lrclib', lrclibId: value.id }),
    buildSyntheticLrclibResult: value => ({ synced: [value] }),
    applyLoadedLyricsResult: async (...args) => { calls.push(['applyLoadedLyricsResult', ...args]); return true; },
  });
  for (const [, setter] of callbacks.matchAll(/\b(set[A-Z]\w*)\b/g)) {
    context[setter] = value => calls.push([setter, value]);
  }
  vm.runInContext(helper + callbacks + '\nglobalThis.api = {loadLrclibById, searchLrclibByQuery};', context);
  return { context, calls, messages, api: context.api, stale: () => { current = false; } };
}

test('editor ID loading and manual search both use the shared transport with a bounded timeout', async () => {
  const requests = [];
  const h = harness({ fetch: async (...args) => {
    requests.push(args);
    return Response.json(args[0].includes('/search?') ? [candidate] : candidate);
  } });
  await h.api.loadLrclibById();
  assert.equal(requests[0][0], 'https://lrclib.net/api/get/18694795');
  assert.equal(requests[0][2], 35000);
  assert.equal(h.calls.filter(([name]) => name === 'applyLoadedLyricsResult').length, 1);
  assert.ok(h.calls.some(([name, value]) => name === 'setIsLoadingLrclibId' && value === false));
  await h.api.searchLrclibByQuery();
  assert.equal(requests[1][0], 'https://lrclib.net/api/search?q=Fixture+%26+caf%C3%A9');
  assert.equal(requests[1][2], 35000);
  assert.ok(h.calls.some(([name, value]) => name === 'setLrclibSearchMeta' && value.success && value.totalResults === 1));
  assert.ok(h.calls.some(([name, value]) => name === 'setIsSearchingLrclib' && value === false));
  assert.doesNotMatch(callbacks, /await fetch\(/);
});

test('a click event is never treated as an LRCLIB id', async () => {
  const requests = [];
  const h = harness({ fetch: async (...args) => {
    requests.push(args);
    return Response.json(candidate);
  } });
  // The "Load by ID" button wires the handler straight to onClick, so React
  // hands it the click event. That event must never become the requested id.
  await h.api.loadLrclibById({ type: 'click', target: {}, preventDefault() {} });
  assert.equal(h.calls.some(([name, value]) => name === 'setLrclibIdInput' && value === '[object Object]'), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], 'https://lrclib.net/api/get/18694795');
  assert.equal(h.calls.filter(([name]) => name === 'applyLoadedLyricsResult').length, 1);
  assert.equal(h.context.lrclibIdInputEditedRef.current, false, 'a loaded typed id may be mirrored again');
});

test('missing transport, failed network, HTTP errors and invalid JSON stop editor loading cleanly', async () => {
  for (const transport of [
    undefined, { fetch: async () => null },
    { fetch: async () => new Response('Unavailable', { status: 503 }) },
    { fetch: async () => new Response('not json') },
  ]) {
    const h = harness(transport);
    await h.api.loadLrclibById();
    assert.equal(h.calls.some(([name]) => name === 'applyLoadedLyricsResult'), false);
    assert.ok(h.calls.some(([name, value]) => name === 'setIsLoadingLrclibId' && value === false));
    assert.ok(h.messages.length > 0);
    await h.api.searchLrclibByQuery();
    assert.ok(h.calls.some(([name, value]) => name === 'setLrclibSearchMeta' && value.success === false));
    assert.ok(h.calls.some(([name, value]) => name === 'setIsSearchingLrclib' && value === false));
  }
});

test('late ID responses cannot replace lyrics after the editor source changes', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = harness({ fetch: () => pending });
  const loading = h.api.loadLrclibById();
  h.stale(); resolve(Response.json(candidate));
  await loading;
  assert.equal(h.calls.some(([name]) => name === 'applyLoadedLyricsResult'), false);
  assert.equal(h.calls.some(([name]) => name === 'setAddonId'), false);
});
