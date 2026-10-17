// Run against lyrics_supplement_server. Keeps the real overflow hook, CSS and
// Resize/MutationObservers; the clock is frozen between React playback commits.
async page => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Open the local supplement fixture');
  const results = [], errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    for (const canary of [true, false]) for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 760 });
      await page.route('**/VinylActiveLyricRenderer.js', async route => {
        const response = await route.fetch(), body = await response.text();
        const measurement = 'const progress = getCurrentScrollProgress(frameTime);';
        if (!body.includes(measurement)) throw new Error('Missing production measurement path');
        await route.fulfill({ response, body: canary ? body.replace(measurement,
          'const timing = scrollTimingRef.current; const progress = getLineScrollProgress(timing.position, timing.lineStartTime, timing.lineEndTime);') : body });
      });
      await page.goto(origin + '/');
      await page.waitForFunction(() => window.ivLyricsLyricRendererPrimitives);
      await page.addScriptTag({ url: origin + '/VinylActiveLyricRenderer.js' });
      errors.length = 0;
      const result = await page.evaluate(async () => {
        document.getElementById('host').style.display = 'none';
        const host = document.createElement('div');
        host.id = 'remeasure-replay';
        host.className = 'fullscreen-vinyl-active-lyric';
        host.style.cssText = 'position:relative;inset:auto;width:280px;height:320px;font-size:32px;--lyrics-font-size:32px;--lyrics-line-height:1.6';
        document.body.append(host);
        const root = ReactDOM.createRoot(host);
        // React's playback snapshot remains at 1400; live overflow has advanced
        // to 6000, half-way through the traversal of this 1000..11000 line.
        window.ivLyricsLyricRendererPrimitives = { ...window.ivLyricsLyricRendererPrimitives,
          getFrameAlignedLyricsPlaybackPosition: () => 6000 };
        ReactDOM.flushSync(() => root.render(React.createElement(window.ivLyricsActiveLyricLineRenderer, {
          lyrics: [{ text: 'A long lyric that must scroll smoothly without jumping backwards after layout is measured', startTime: 1000, endTime: 11000 }],
          activeLineIndex: 0, isKara: false, motionEnabled: true,
        })));
        const frames = async count => { for (let i = 0; i < count; i++) await new Promise(resolve => requestAnimationFrame(resolve)); };
        await frames(5);
        const content = host.querySelector('.ivlyrics-vinyl-lyric-scroll-content');
        const viewport = content.parentElement;
        if (!viewport.classList.contains('is-vinyl-lyric-overflowing')) throw new Error('Real text did not overflow');
        const offset = () => new DOMMatrix(content.style.transform).m41;
        const before = offset();
        if (!(before < -1)) throw new Error('Live traversal did not start');
        const offsets = [], writes = [];
        Object.defineProperty(content.style, 'transform', {
          get() { return this.getPropertyValue('transform'); },
          set(value) { this.setProperty('transform', value); if (value) writes.push(new DOMMatrix(value).m41); },
        });
        for (let repeat = 0; repeat < 3; repeat++) {
          content.append(document.createTextNode('')); // Observer notification, unchanged geometry.
          for (let frame = 0; frame < 3; frame++) { await frames(1); offsets.push(offset()); }
        }
        return { before, offsets, writes, maxRollback: Math.max(...writes.map(value => value - before)) };
      });
      await page.unroute('**/VinylActiveLyricRenderer.js');
      if (errors.length) throw new Error(errors.join('; '));
      if (!result.writes.length || (canary ? result.maxRollback < 1
        : Math.max(...result.writes.map(value => Math.abs(value - result.before))) > .01)) {
        throw new Error('Unexpected remeasurement continuity: ' + JSON.stringify({ canary, width, ...result }));
      }
      results.push({ canary, width, ...result });
    }
    return { passed: results.length, results, errors };
  } finally {
    page.off('pageerror', onError);
    await page.unroute('**/VinylActiveLyricRenderer.js');
  }
}
