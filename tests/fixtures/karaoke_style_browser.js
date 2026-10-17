// Production DOM/CSS regression for PR #131. Run on lyrics_supplement_server
// with playwright-cli run-code --filename, not as a browser benchmark.
async (page) => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Use the loopback supplement fixture');
  const results = [];
  for (const width of [1000, 390]) for (const style of ['classic', 'expressive']) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(origin + '/');
    await page.waitForFunction(() => window.supplementFixture?.entries.length > 0);
    results.push(await page.evaluate(async ({ width, style }) => {
      const f = window.supplementFixture;
      const frames = async () => {
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
      };
      const settle = async () => {
        let previous = '';
        for (let attempt = 0; attempt < 10; attempt++) {
          document.getElementById('root').getAnimations({ subtree: true }).forEach(animation => {
            try { animation.finish(); } catch { /* Only finite row animations matter. */ }
          });
          await frames();
          const signature = [...document.querySelectorAll('.lyrics-lyricsContainer-LyricsLine')]
            .map(row => { const box = row.getBoundingClientRect(); return [box.top, box.left, box.width, box.height].map(value => value.toFixed(2)).join(','); }).join(';');
          if (signature === previous) return;
          previous = signature;
        }
        throw new Error('Production row geometry did not settle');
      };
      const setSheet = async (name) => {
        const sheet = document.querySelector('link[rel="stylesheet"]');
        await new Promise((resolve, reject) => {
          sheet.onload = resolve;
          sheet.onerror = reject;
          sheet.href = name;
        });
        await settle();
      };
      const snapshot = () => [...document.querySelectorAll('.lyrics-lyricsContainer-LyricsLine')]
      .filter(row => row.textContent.trim() && row.getBoundingClientRect().height > 0).map(row => {
        const css = getComputedStyle(row), box = row.getBoundingClientRect();
        return { text: row.textContent, opacity: css.opacity, color: css.color,
          filter: css.filter, fontSize: css.fontSize, transitionProperty: css.transitionProperty,
          transitionDuration: css.transitionDuration,
          top: box.top, left: box.left, width: box.width, height: box.height };
      });
      f.reset({ style, reveal: false });
      const voice = (index) => ({
        id: 'voice-' + index, text: 'Voice ' + index,
        syllables: [{ text: 'Voice ' + index, startTime: 1000 + index * 500, endTime: 4000 + index * 500 }],
      });
      const rows = [0, 1, 2, 3].map(voice);
      f.replaceLyrics([
        { text: 'Four voices', originalText: 'Four voices', startTime: 1000, endTime: 5500,
          vocals: { lead: rows[0], background: rows.slice(1) } },
        { text: 'Next line', originalText: 'Next line', startTime: 9000, endTime: 11000,
          syllables: [{ text: 'Next line', startTime: 9000, endTime: 11000 }] },
      ], 'style-multivocal');
      const stages = [];
      for (const position of [1400, 1800, 2400, 3000, 4300, 6000, 9200, 11500, 2400, 0, 1400]) {
        f.step(position - f.position);
        await settle();
        const list = document.querySelector('.lyrics-lyricsContainer-SyncedLyrics');
        const expectedAnchor = !!list.querySelector('.lyrics-karaoke-part.active-vocal-row');
        if (list.hasAttribute('data-active-vocal-row') !== expectedAnchor) {
          throw new Error('Vocal anchor mark does not match the production rows at ' + position);
        }
        const rows = [...list.querySelectorAll(':scope > .lyrics-lyricsContainer-LyricsLine')];
        for (const row of rows) {
          if (!row.textContent.trim() || row.getBoundingClientRect().height === 0 ||
              row.classList.contains('lyrics-lyricsContainer-LyricsLine-paddingLine')) continue;
          const oldPast = row.matches(':not(.lyrics-lyricsContainer-LyricsLine-active):has(.lyrics-karaoke-line.is-complete)');
          const newPast = row.matches('.lyrics-lyricsContainer-LyricsLine-complete:not(.lyrics-lyricsContainer-LyricsLine-active)');
          if (oldPast !== newPast) throw new Error('Visible past-line style changed at ' + position);
        }
        const after = snapshot();
        await setSheet('/karaoke-before.css');
        const before = snapshot();
        if (before.length !== after.length) throw new Error('Stylesheet swap changed row count');
        let maxGeometryDelta = 0;
        before.forEach((row, index) => {
          const actual = after[index];
          for (const field of ['text', 'opacity', 'color', 'filter', 'fontSize', 'transitionProperty', 'transitionDuration']) {
            if (row[field] !== actual[field]) throw new Error('CSS presentation changed: ' + field + ' at ' + position);
          }
          for (const field of ['top', 'left', 'width', 'height']) {
            maxGeometryDelta = Math.max(maxGeometryDelta, Math.abs(row[field] - actual[field]));
          }
        });
        if (maxGeometryDelta > 0.2) throw new Error('Row geometry changed at ' + position + ': ' + maxGeometryDelta);
        await setSheet('/style.css');
        stages.push({ position, activeVocalRow: expectedAnchor, maxGeometryDelta });
      }
      return { width, style, stages };
    }, { width, style }));
    await page.screenshot({ path: `output/playwright/pr131-${width}-${style}.png` });
  }
  return results;
}
