import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('lyric DOM changes do not make the main view re-measure its scroll size', () => {
  // Spotify's OverlayScrollbars wrapper ignores mutations inside an element
  // marked data-scroll-size-contained. Otherwise every glyph state commit,
  // painted karaoke frame and row motion step made it measure scrollWidth in
  // a microtask, forcing a synchronous style and layout pass.
  const start = indexSource.indexOf('className: `lyrics-lyricsContainer-LyricsContainer');
  assert.ok(start >= 0);
  const props = indexSource.slice(start, indexSource.indexOf('ref: (el) =>', start));
  assert.match(props, /"data-scroll-size-contained": ""/);
  // The marker is only truthful while the page cannot change the main view's
  // scroll size: it is absolutely positioned, clipped and layout-contained.
  const containerRule = styles.match(/\n\.lyrics-lyricsContainer-LyricsContainer\s*\{([^}]*)\}/)[1];
  assert.match(containerRule, /position: absolute;/);
  assert.match(containerRule, /height: 100%;/);
  assert.match(containerRule, /overflow: hidden;/);
  assert.match(containerRule, /contain: layout paint;/);
});
