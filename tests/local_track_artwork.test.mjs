import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Utils.js', import.meta.url), 'utf8');
const start = source.indexOf('  getTrackArtwork(track) {');
const end = source.indexOf('\n  /**', start);
const utils = vm.runInNewContext(`({isLocalTrackUri: uri => uri?.startsWith('spotify:local:'), ${source.slice(start, end)}})`, { window: {} });
test('embedded local artwork wins over catalog images in all metadata sizes', () => {
  for (const field of ['image_url', 'image_large_url', 'image_xlarge_url']) {
    const track = { uri: 'spotify:local:Artist:Album:Song:180', metadata: {
      image_xlarge_url: 'https://catalog/other-album', [field]: 'spotify:localfile:embedded',
    }};
    assert.equal(utils.getTrackArtwork(track), 'spotify:localfile:embedded');
  }
});
test('local base artwork wins and unrelated album images are not a fallback', () => {
  const track = { uri: 'spotify:local:A:B:C:180', metadata: { image_url: 'https://file/cover', image_xlarge_url: 'https://catalog/cover' } };
  assert.equal(utils.getTrackArtwork(track), 'https://file/cover');
  assert.equal(utils.getTrackArtwork({ ...track, metadata: {}, album: { images: [{ url: 'https://catalog/cover' }] } }), '');
  assert.equal(utils.getTrackArtwork({ ...track, metadata: { image_xlarge_url: 'https://i.scdn.co/image/other-album', image_url: 'spotify:image:other-album' } }), '');
});
test('online artwork retains high resolution and Spotify URI conversion', () => {
  assert.equal(utils.getTrackArtwork({ uri: 'spotify:track:id', metadata: { image_xlarge_url: 'spotify:image:abc', image_url: 'https://small' } }), 'https://i.scdn.co/image/abc');
  assert.equal(utils.getTrackArtwork(null), '');
});

test('the independent extension and panel resolve artwork without custom-app Utils', () => {
  const service = readFileSync(new URL('../LyricsService.js', import.meta.url), 'utf8');
  const window = {};
  vm.runInNewContext(service.slice(service.indexOf('    const TrackIdentity ='), service.indexOf('    const MODULE_KEY =')), { window });
  const identity = window.ivLyricsTrackIdentity;
  for (const track of [null, { uri: 'spotify:track:id', metadata: { image_url: 'spotify:image:abc' } },
    { uri: 'spotify:local:A:B:C:180', metadata: { image_url: 'spotify:localfile:embedded', image_xlarge_url: 'https://i.scdn.co/image/wrong' } },
    { uri: 'spotify:local:A:B:C:180', metadata: { image_url: 'spotify:image:wrong' } }]) {
    assert.equal(identity.getTrackArtwork(track), utils.getTrackArtwork(track));
  }
  const panel = readFileSync(new URL('../NowPlayingPanelLyrics.js', import.meta.url), 'utf8');
  const from = panel.indexOf('            const getCurrentCoverUrl =');
  const to = panel.indexOf('            // 앨범에서 색상 추출', from);
  const track = { uri: 'spotify:local:A:B:C:180', metadata: { image_url: 'spotify:localfile:embedded' } };
  assert.equal(vm.runInNewContext(panel.slice(from, to) + '\ngetCurrentCoverUrl()', {
    window, Spicetify: { Player: { data: { item: track } } },
  }), 'spotify:localfile:embedded');
});
