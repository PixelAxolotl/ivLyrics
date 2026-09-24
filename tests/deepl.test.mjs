import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
function harness(responder, key = 'fake-key:fx') {
    let addon;
    const requests = [];
    const window = { AIAddonManager: { register: value => addon = value, getAddonSetting: () => key },
        async ivLyricsFetch(url, options) {
            const request = { url, ...options, body: JSON.parse(options.body) }; requests.push(request);
            return responder ? responder(request) : Response.json({ translations: request.body.text.map(text => ({ text: `T:${text}` })) });
        } };
    vm.runInNewContext(readFileSync(new URL('../Addon_AI_DeepL.js', import.meta.url), 'utf8'), { window, TextEncoder, setTimeout });
    return { get addon() { return addon; }, requests };
}
test('DeepL only exposes translation and preserves blanks, instrumental markers and vocal parts', async () => {
    const h = harness();
    const output = await h.addon.translateLyrics({ text: '\none / two\n[Instrumental]\nthree\n', lang: 'zh-TW' });
    assert.deepEqual(Array.from(output.translation), ['', 'T:one / T:two', '[Instrumental]', 'T:three', '']);
    assert.equal(h.requests[0].body.target_lang, 'ZH-HANT');
    assert.deepEqual(h.requests[0].body.text, ['one', 'two', 'three']);
    assert.equal(h.requests[0].headers.Authorization, 'DeepL-Auth-Key fake-key:fx');
    for (const feature of ['pronunciation', 'tmi', 'researchWebSearch', 'lyricsStudy', 'characterPronunciation', 'culturalAnnotations', 'lyricsAlignment']) assert.equal(h.addon.supports[feature], false);
    await assert.rejects(h.addon.translateLyrics({ text: 'one', wantSmartPhonetic: true }), /not supported/);
});
test('large sets batch at 50 and retain their order', async () => {
    const h = harness();
    const output = await h.addon.translateLyrics({ text: Array.from({ length: 104 }, (_, i) => String(i)).join('\n'), lang: 'ko' });
    assert.deepEqual(h.requests.map(r => r.body.text.length), [50, 50, 4]);
    assert.equal(output.translation[103], 'T:103');
});
test('missing key, quota errors and malformed partial responses fail without claiming completion', async () => {
    await assert.rejects(harness(null, '').addon.testConnection(), /key is required/);
    await assert.rejects(harness(() => Response.json({}, { status: 456 })).addon.testConnection(), /456/);
    await assert.rejects(harness(() => Response.json({ translations: [] })).addon.testConnection(), /Invalid/);
});
