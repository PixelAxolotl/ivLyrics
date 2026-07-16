const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadPaxsenixAddon(sharedParser = null) {
    let addon = null;
    const window = {
        LyricsAddonManager: {
            register(value) {
                addon = value;
            }
        },
        __ivLyricsDebugLog() {},
        ...(sharedParser ? { ivLyricsLyricsParser: sharedParser } : {})
    };
    const context = {
        window,
        URL,
        URLSearchParams,
        AbortController,
        atob: global.atob,
        setTimeout,
        clearTimeout,
        console,
        fetch: global.fetch
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(root, 'Addon_Lyrics_Paxsenix.js'), 'utf8'),
        context,
        { filename: 'Addon_Lyrics_Paxsenix.js' }
    );
    assert.ok(addon, 'Paxsenix addon should register');
    return { addon, debug: window.__ivLyricsPaxsenixDebug };
}

test('decodes one layer of valid XML lyric entities without consuming literal ampersands', () => {
    const { debug } = loadPaxsenixAddon();
    assert.equal(
        debug.decodeLyricTextEntities(
            'Don&apos;t &#39;stop&#x27; &amp; listen &quot;now&quot; &lt;3 AT&T &unknown; &amp;apos;'
        ),
        'Don\'t \'stop\' & listen "now" <3 AT&T &unknown; &apos;'
    );
    assert.equal(debug.decodeLyricTextEntities('invalid &#0; &#xD800; &#x110000;'), 'invalid &#0; &#xD800; &#x110000;');
});

test('decodes structured lead, background, reference, and plain lyric text fields', () => {
    const { debug } = loadPaxsenixAddon();
    const parsed = debug.parseStructuredLyrics({
        syncType: 'Syllable',
        metadata: {
            rawData: {
                lyrics_text: '[1000,2000]<0,1000,0>Don&amp;apos;t<1000,1000,0> stop'
            }
        },
        lyrics: [{
            timestamp: 1000,
            endtime: 3000,
            text: [
                { text: 'Don&apos;t', timestamp: 1000, endtime: 2000, part: true },
                { text: ' stop', timestamp: 2000, endtime: 3000, part: false }
            ],
            backgroundText: [
                { text: 'Rock &amp; Roll', timestamp: 1500, endtime: 2800, part: false }
            ]
        }]
    }, 4000, { title: 'Song', artist: 'Artist' });

    assert.equal(parsed.karaoke[0].vocals.lead.text, "Don't stop");
    assert.equal(parsed.karaoke[0].vocals.background[0].text, 'Rock & Roll');
    assert.equal(parsed.synced[0].text, "Don't stop Rock & Roll");
    assert.equal(debug.parseStructuredReferenceLines({
        metadata: { rawData: { lyrics_text: '[1000,1000]<0,1000,0>Don&amp;apos;t' } }
    }).get(1000), 'Don&amp;apos;t', 'reference extraction must not eagerly decode twice');

    const plain = debug.parsePayload({
        plain: 'Don&apos;t stop\nAT&T &amp; friends\n&amp;apos; stays encoded once'
    }, 0);
    assert.deepEqual(
        Array.from(plain.unsynced, line => line.text),
        ["Don't stop", 'AT&T & friends', '&apos; stays encoded once']
    );
});

test('does not insert a word boundary before an entity-encoded apostrophe token', () => {
    const { debug } = loadPaxsenixAddon();
    const tokens = debug.parseTimedTokens([
        { text: 'Don', timestamp: 1000, endtime: 1400, part: false },
        { text: '&apos;', timestamp: 1400, endtime: 1500, part: true },
        { text: 't', timestamp: 1500, endtime: 2000, part: false }
    ], 1000, 2000);

    assert.equal(tokens.map(token => token.text).join(''), "Don't");
});

test('restores whitespace encoded as a numeric entity in structured reference text', () => {
    const { debug } = loadPaxsenixAddon();
    const items = [
        { text: 'Can', timestamp: 1000, endtime: 1400, part: true },
        { text: 'we', timestamp: 1400, endtime: 1800, part: false }
    ];

    for (const referenceText of ['Can&#32;we', 'Can&#x20;we']) {
        const tokens = debug.parseTimedTokens(items, 1000, 1800, referenceText);
        assert.equal(tokens.map(token => token.text).join(''), 'Can we');
    }

    const singlePassTokens = debug.parseTimedTokens([
        { text: 'A&amp;apos;', timestamp: 1000, endtime: 1400, part: true },
        { text: 'B', timestamp: 1400, endtime: 1800, part: false }
    ], 1000, 1800, 'A&amp;apos;&#32;B');
    assert.equal(singlePassTokens.map(token => token.text).join(''), 'A&apos; B');
});

test('decodes line-based LRC before parsing but leaves XML payload decoding to the XML parser', () => {
    const calls = [];
    const sharedParser = {
        parseLrcLyrics(value) {
            calls.push({ type: 'lrc', value });
            return { karaoke: null, synced: [], unsynced: [] };
        },
        parseTtmlLyrics(value) {
            calls.push({ type: 'ttml', value });
            return { karaoke: null, synced: [], unsynced: [] };
        }
    };
    const { debug } = loadPaxsenixAddon(sharedParser);

    debug.parsePayload({ lrc: '[00:01.00]Don&apos;t &amp; stop &amp;apos;' }, 5000);
    debug.parsePayload({ ttmlContent: '<p>Don&apos;t &amp;amp;</p>' }, 5000);

    assert.deepEqual(calls, [
        { type: 'lrc', value: "[00:01.00]Don't & stop &apos;" },
        { type: 'ttml', value: '<p>Don&apos;t &amp;amp;</p>' }
    ]);
});
