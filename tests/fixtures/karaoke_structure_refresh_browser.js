// Run against lyrics_supplement_server with playwright-cli run-code.
// Replays same-track, same-index source replacements with real React hooks.
async page => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Open the loopback supplement fixture');
  const results = [], key = 'key: hasKaraokeVocalRows(line) ? "parallel-vocals" : "single-vocal",';
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    for (const canary of [true, false]) for (const surface of ['compact', 'expanded', 'vinyl']) {
      for (const initiallyParallel of [false, true]) {
        await page.route('**/Pages.js', async route => {
          const response = await route.fetch();
          const body = await response.text();
          if (!body.includes(key)) throw new Error('Missing production structural boundary');
          await route.fulfill({ response, body: canary ? body.replace(key, '') : body });
        });
        await page.goto(origin + '/');
        await page.waitForFunction(() => window.ProductionSupplement);
        await page.addScriptTag({ url: origin + '/VinylActiveLyricRenderer.js' });
        errors.length = 0;
        const result = await page.evaluate(({ surface, initiallyParallel }) => {
          document.getElementById('host').style.display = 'none';
          const host = document.createElement('div');
          host.className = 'lyrics-lyricsContainer-LyricsContainer';
          host.style.cssText = 'height:700px;font-size:32px;--lyrics-font-size:32px;--lyrics-color-active:#fff;--lyrics-line-height:1.6';
          document.body.append(host);
          const root = ReactDOM.createRoot(host);
          const line = (text, startTime = 1000) => ({ text, startTime, endTime: startTime + 4000,
            syllables: Array.from(text, (text, i) => ({ text, startTime: startTime + i * 120, endTime: startTime + (i + 1) * 120 })) });
          const lead = line('Same source'), backing = line('Echo', 1300);
          const shapes = [lead, { ...lead, text: 'Same source / Echo', vocals: { lead, background: [backing] } }];
          const component = surface === 'vinyl' ? window.ivLyricsActiveLyricLineRenderer
            : ProductionSupplement[surface === 'expanded' ? 'Expanded' : 'Compact'];
          const render = (parallel, supplements = false) => {
            const first = { ...shapes[Number(parallel)], ...(supplements ? { text2: 'Translation',
              culturalAnnotations: [{ marker: 1, expression: 'Same', note: 'Explanation' }] } : {}) };
            const lyrics = [first, line('Next lyric', 6000)];
            ReactDOM.flushSync(() => root.render(React.createElement(component, {
              lyrics, isKara: true, activeLineIndex: 0, positionOverride: 1400,
              trackUri: 'spotify:track:same-structure-fixture', trackRevealKey: null,
              motionEnabled: true, singleLineScroll: true,
            })));
          };
          render(initiallyParallel);
          const rowSelector = '.lyrics-lyricsContainer-LyricsLine-active';
          const row = host.querySelector(rowSelector);
          if (!row) throw new Error('Missing initial lyric on ' + surface);
          const glyph = row.querySelector('.lyrics-karaoke-char');
          render(initiallyParallel, true);
          const supplementsRetained = row.isConnected && glyph.isConnected
            && row === host.querySelector(rowSelector);
          let failure = null;
          try { render(!initiallyParallel); } catch (error) { failure = error.message; }
          const after = host.querySelector(rowSelector);
          return { surface, initiallyParallel, supplementsRetained, failure,
            rowRetained: row === after, rendered: !!after,
            vocalRows: after?.querySelectorAll('.lyrics-karaoke-part').length ?? 0 };
        }, { surface, initiallyParallel });
        await page.unroute('**/Pages.js');
        const hookError = [result.failure, ...errors].filter(Boolean).some(message =>
          /hooks|hook|queue/i.test(message));
        if (canary && !hookError) throw new Error('Missing pre-fix hook-order failure: ' + JSON.stringify(result));
        if (!canary && (result.failure || errors.length || !result.rendered || !result.rowRetained
          || !result.supplementsRetained || result.vocalRows !== (initiallyParallel ? 0 : 2))) {
          throw new Error('Source refresh failed: ' + JSON.stringify({ ...result, errors }));
        }
        results.push({ canary, ...result, hookError });
      }
    }
    return { passed: results.length, results };
  } finally {
    page.off('pageerror', onError);
    await page.unroute('**/Pages.js');
  }
}
