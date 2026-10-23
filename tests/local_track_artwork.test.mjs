import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Utils.js', import.meta.url), 'utf8');
const start = source.indexOf('  getTrackArtwork(track) {');
const end = source.indexOf('\n  /**', start);
const utils = vm.runInNewContext(`({isLocalTrackUri: uri => uri?.startsWith('spotify:local:'), ${source.slice(start, end)}})`);
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
