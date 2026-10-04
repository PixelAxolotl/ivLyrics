import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../LyricsService.js', import.meta.url), 'utf8');
const section = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `missing source section: ${start}`);
    return source.slice(from, to);
};
const localA = 'spotify:local:Artist:Album:Song%20A:180';
const localB = 'spotify:local:Artist:Album:Song%20B:180';
const spotifyId = '6QDv6s76britJEg8L9tXvX';

function load(uri = localA) {
    const calls = [], reads = [], writes = [], cache = new Map();
    const key = args => JSON.stringify(args);
    const player = { data: { item: { uri } } };
    const window = {
        AIAddonManager: {
            getTranslationStyle: () => 'natural',
            async translateLyrics(params) {
                calls.push(params);
                return params.wantSmartPhonetic
                    ? { phonetic: ['hello', 'world'] }
                    : { translation: ['안녕', '세상'] };
            },
            async translateMetadata(params) {
                calls.push(params);
                return { translated: { title: '노래', artist: '가수' } };
            },
        },
    };
    const context = vm.createContext({
        window, Spicetify: { Player: player },
        serviceDebug() {},
        console: { warn() {} },
        getTranslationTargetLanguage: () => 'ko',
        getServicePronunciationNotation: () => 'translation',
        getStorageItem: () => null,
        LyricsCache: {
            async getTranslation(...args) { reads.push(args); return cache.get(key(args)) ?? null; },
            async setTranslation(id, lang, phonetic, value, provider, hash) {
                writes.push([id, lang, phonetic, value, provider, hash]);
                cache.set(key([id, lang, phonetic, provider, hash]), value);
            },
            async getMetadata(id, lang) { return cache.get(key([id, lang])); },
            async setMetadata(id, lang, value) { cache.set(key([id, lang]), value); },
        },
    });
    vm.runInContext(section('    const TrackIdentity =', '    const MODULE_KEY =')
        + '\nconst Utils = TrackIdentity;\n'
        + section('    const getLyricsTextCacheHash =', '    const cleanupWorker =')
        + section('    const _translatorInflightRequests =', '    // I18n이 로드되기 전에')
        + `class Translator {
            static _metadataCache = new Map();
            static _metadataInflightRequests = new Map();
            ${section('        static async translateMetadata(', '        static getMetadataFromCache(')}
            ${section('        static async callGemini(', '        includeExternal(url)')}
        }
        globalThis.Translator = Translator;`, context);
    return { api: context.Translator, identity: window.ivLyricsTrackIdentity, calls, reads, writes, player, window };
}

const request = { text: 'Hello\nWorld', title: 'Song', artist: 'Artist', provider: 'local' };

test('local translation identities retain the whole URI and do not become Spotify IDs', () => {
    const { identity } = load();
    assert.equal(identity.extractTrackId(localA), null);
    assert.equal(identity.getTranslationCacheId(localA), `local-uri:${localA}`);
    assert.notEqual(identity.getTranslationCacheId(localA), identity.getTranslationCacheId(localB));
    assert.equal(identity.getTranslationCacheId(`spotify:track:${spotifyId}`), spotifyId);
    assert.equal(identity.getTranslationCacheId(`https://open.spotify.com/track/${spotifyId}`), spotifyId);
    for (const uri of [null, '', 'spotify:episode:other', 'spotify:ad:other']) {
        assert.equal(identity.getTranslationCacheId(uri), null);
    }
});

test('local lyrics and AI pronunciation reach providers and reuse independent persistent caches', async () => {
    const h = load();
    const translation = await h.api.callGemini(request);
    const phonetic = await h.api.callGemini({ ...request, wantSmartPhonetic: true });
    assert.equal(translation.translation[0], '안녕');
    assert.equal(phonetic.phonetic[0], 'hello');
    await h.api.callGemini(request);
    await h.api.callGemini({ ...request, wantSmartPhonetic: true });
    assert.equal(h.calls.length, 2);
    assert.ok(h.calls.every(call => call.trackId === `local-uri:${localA}`));
    assert.ok(h.reads.every(args => args[0] === `local-uri:${localA}`));
    assert.deepEqual(h.writes.map(args => args[2]), [false, true]);
});

test('songs with identical durations do not share translations; regeneration bypasses cache', async () => {
    const h = load();
    await h.api.callGemini(request);
    h.player.data.item.uri = localB;
    await h.api.callGemini(request);
    await h.api.callGemini({ ...request, ignoreCache: true });
    assert.deepEqual(h.calls.map(call => call.trackId), [`local-uri:${localA}`, `local-uri:${localB}`, `local-uri:${localB}`]);
});

test('an explicit local identity stays attached to its request when playback changes', async () => {
    const h = load(`spotify:track:${spotifyId}`);
    const trackId = h.identity.getTranslationCacheId(localA);
    await h.api.callGemini({ ...request, trackId });
    assert.equal(h.calls[0].trackId, trackId);
    assert.equal(h.writes[0][0], trackId);
});

test('local title and artist translation use the same identity and metadata cache', async () => {
    const h = load();
    assert.equal((await h.api.translateMetadata(request)).translated.title, '노래');
    await h.api.translateMetadata(request);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].trackId, `local-uri:${localA}`);
});

test('missing playback still rejects lyrics translation before a provider request', async () => {
    const h = load('');
    await assert.rejects(h.api.callGemini(request), /No track ID available/);
    assert.equal(await h.api.translateMetadata(request), null);
    assert.equal(h.calls.length, 0);
});
