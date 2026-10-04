import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Addon_Lyrics_Spotify.js', import.meta.url), 'utf8');
const id = '6QDv6s76britJEg8L9tXvX';
const track = { uri: `spotify:track:${id}`, title: 'Song', artist: 'Artist' };
const payload = {
    lyrics: { provider: 'MusixMatch', syncType: 'LINE_SYNCED', lines: [
        { startTimeMs: '1000', words: 'First' },
        { startTimeMs: '2500', words: 'Second' },
    ] },
};

function load({ platformResponse, legacyResponse, platformError } = {}) {
    let addon;
    const calls = [];
    const builder = {};
    for (const method of ['withHost', 'withPath', 'withEndpointIdentifier', 'withQueryParameters']) {
        builder[method] = value => { calls.push([method, value]); return builder; };
    }
    builder.send = async () => {
        calls.push(['send']);
        if (platformError) throw platformError;
        return platformResponse;
    };
    const Spicetify = {
        Platform: platformResponse !== undefined || platformError
            ? { RequestBuilder: { build: () => builder } } : {},
        ...(legacyResponse !== undefined ? { CosmosAsync: {
            async get(url) { calls.push(['cosmos', url]); return legacyResponse; },
        } } : {}),
    };
    const window = {
        LyricsService: { extractTrackId: uri => /^spotify:track:([A-Za-z0-9]{22})$/.exec(uri)?.[1] || null },
        LyricsAddonManager: { register(value) { addon = value; } },
    };
    vm.runInNewContext(source, { window, Spicetify, console: { warn() {} }, setTimeout() { throw new Error('unexpected timer'); } });
    return { addon, calls };
}

test('Spotify lyrics work through authenticated RequestBuilder when CosmosAsync is absent', async () => {
    const h = load({ platformResponse: { status: 200, body: payload } });
    const result = await h.addon.getLyrics(track);
    assert.equal(result.error, null);
    assert.equal(result.provider, 'spotify-MusixMatch');
    assert.equal(result.synced[0].startTime, 1000);
    assert.equal(result.synced[1].text, 'Second');
    assert.equal(result.unsynced, result.synced);
    assert.deepEqual(h.calls.find(call => call[0] === 'withHost'), ['withHost', 'https://spclient.wg.spotify.com/color-lyrics/v2']);
    assert.deepEqual(h.calls.find(call => call[0] === 'withPath'), ['withPath', `/track/${id}`]);
    assert.equal(h.calls.some(call => call[0] === 'cosmos'), false);
});

test('JSON text responses and unsynced lyrics are supported', async () => {
    const body = { lyrics: { ...payload.lyrics, syncType: 'UNSYNCED' } };
    const h = load({ platformResponse: { status: 200, body: JSON.stringify(body) } });
    const result = await h.addon.getLyrics(track);
    assert.equal(result.error, null);
    assert.equal(result.synced, null);
    assert.equal(result.unsynced[1].text, 'Second');
});

test('legacy CosmosAsync remains usable without RequestBuilder or after a transport failure', async () => {
    for (const platformError of [undefined, new Error('platform transport unavailable')]) {
        const h = load({ platformError, legacyResponse: payload });
        assert.equal((await h.addon.getLyrics(track)).synced.length, 2);
        assert.equal(h.calls.filter(call => call[0] === 'cosmos').length, 1);
    }
});

test('no-lyrics and restricted responses do not trigger duplicate legacy requests', async () => {
    for (const status of [204, 404, 401, 403, 429]) {
        const h = load({ platformResponse: { status }, legacyResponse: payload });
        const result = await h.addon.getLyrics(track);
        assert.equal(result.error, [204, 404].includes(status) ? 'No lyrics' : `Request error (${status})`);
        assert.equal(h.calls.some(call => call[0] === 'cosmos'), false);
    }
});

test('missing APIs and malformed or empty lyrics produce provider errors instead of exceptions', async () => {
    assert.equal((await load().addon.getLyrics(track)).error, 'Request error');
    for (const body of [{}, { lyrics: {} }, { lyrics: { lines: [] } }]) {
        assert.equal((await load({ platformResponse: { status: 200, body } }).addon.getLyrics(track)).error, 'No lyrics');
    }
});

test('Spotify provider still rejects local tracks without sending them to Spotify', async () => {
    const h = load({ platformResponse: { status: 200, body: payload } });
    assert.equal((await h.addon.getLyrics({ uri: 'spotify:local:Artist:Album:Song:180' })).error, 'Missing Spotify track ID');
    assert.equal(h.calls.length, 0);
});
