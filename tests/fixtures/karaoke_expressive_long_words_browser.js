// Replay the Discord long-word request with production React and live painting.
async page => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Open the loopback Expressive fixture');
  const errors = [], results = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const apply = options => page.evaluate(options => expressiveFixture.apply(options), options);
  const read = () => page.evaluate(() => [...document.querySelectorAll('.preview-row')].map(row => ({
    id: row.dataset.case, width: row.offsetWidth, height: row.offsetHeight,
    hostHeight: row.querySelector('.lyric-host').offsetHeight,
    fills: [...row.querySelectorAll('.lyrics-karaoke-glyph-fill')].map(el => el.textContent),
    readings: [...row.querySelectorAll('.lyrics-karaoke-char-reading,.lyrics-karaoke-run-reading,rt')].map(el => el.textContent),
  })));
  const motion = id => page.locator(`[data-case="${id}"]`).evaluate(row => ({
    words: [...row.querySelectorAll('.is-expressive-unit')].map(el => el.textContent),
    glyphs: [...row.querySelectorAll('.lyrics-karaoke-char')].filter(el => /\S/u.test(el.dataset.outlineText || ''))
      .map(el => ({ text: el.dataset.outlineText, y: el.style.getPropertyValue('--karaoke-bounce-y'),
        scale: el.style.getPropertyValue('--karaoke-bounce-scale'), fill: el.style.getPropertyValue('--karaoke-char-fill') })),
  }));
  try {
    for (const width of [1000, 390]) for (const live of [false, true]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto(`${origin}/?longWords=1`);
      await page.waitForFunction(() => expressiveFixture?.entryCount > 0);
      await page.evaluate(() => document.fonts.ready);
      await apply({ style: 'classic', live, position: 900, reduced: false });
      const classic = JSON.stringify(await read());
      assert((await read()).length === 16, 'all baseline and long-word examples must render');
      await apply({ style: 'expressive', position: 900 });
      assert(JSON.stringify(await read()) === classic, 'pending long-word motion changed wrapping, readings or dimensions');
      assert((await motion('long-cyrillic')).words.length === 0, 'Russian 7/8-letter words still move as whole words');
      assert(!(await motion('longer-cyrillic')).words.some(word => word.includes('синхронизация')), '13-letter Russian word is still capped at 12');
      assert((await motion('quick-cyrillic')).words.length === 2, 'fast words must keep their coherent whole-word motion');
      assert(!(await motion('long-compound')).words.some(word => word.includes('electric')), 'a longer hyphen piece did not gain per-letter motion');
      await apply({ position: 1000 });
      await page.evaluate(() => expressiveFixture.tick(18, 1000 / 120));
      const active = await motion('long-cyrillic');
      assert(active.glyphs.some(glyph => glyph.y.endsWith('em')), 'long-word glyph springs were not painted');
      assert(new Set(active.glyphs.map(glyph => glyph.scale)).size > 1, 'long-word letters did not move successively');
      assert(JSON.stringify(await read()) === classic, 'active long-word motion changed layout');
      const paused = JSON.stringify(active);
      await page.evaluate(() => expressiveFixture.repaint());
      assert(JSON.stringify(await motion('long-cyrillic')) === paused, 'unrelated paused render restarted glyph motion');
      await page.locator('[data-case="long-cyrillic"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `output/playwright/expressive-long-words-${width}-${live ? 'live' : 'react'}.png` });
      for (const position of [2150, 3600, 1250]) {
        await page.evaluate(position => expressiveFixture.seek(position), position);
        assert(JSON.stringify(await read()) === classic, `seek to ${position} changed source text or layout`);
      }
      await apply({ reduced: true });
      assert(await page.locator('.is-motion-expressive').count() === 0, 'app reduced-motion still enables long-word springs');
      await apply({ reduced: false, bounce: false });
      assert(await page.locator('.is-motion-expressive').count() === 0, 'Bounce OFF still enables long-word springs');
      await apply({ bounce: true });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await apply({});
      assert(await page.locator('.is-motion-expressive').count() === 0, 'OS reduced-motion still enables long-word springs');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await apply({ reduced: false, bounce: true, position: 1000 });
      // Replay advancing clocks rather than timing an idle/paused painter.
      const paintBudget = await page.evaluate(() => {
        const { painter, paint } = ProductionKaraoke;
        const entries = [...painter.entries];
        if (!entries.length) return { entries: 0 };
        const clocks = entries.map(entry => entry.clock);
        const old = Element.prototype.getBoundingClientRect;
        let reads = 0;
        Element.prototype.getBoundingClientRect = function(...args) { reads++; return old.apply(this, args); };
        const start = Math.max(performance.now(), ...entries.map(entry => entry.lastMotionFrameTime || 0)) + 1;
        for (const entry of entries) entry.clock = { getPosition: timestamp => 1000 + timestamp - start };
        const t = performance.now();
        try {
          for (let frame = 0; frame < 120; frame++) for (const entry of entries) paint(entry, start + frame * 1000 / 120);
          return { entries: entries.length, layoutReads: reads, elapsed: performance.now() - t };
        } finally {
          Element.prototype.getBoundingClientRect = old;
          entries.forEach((entry, index) => { entry.clock = clocks[index]; });
        }
      });
      if (live) assert(paintBudget.layoutReads === 0, 'live long-word painter forced new layout measurements');
      results.push({ width, live, paintBudget, animatedRussianWords: ['длинный', 'красивый', 'синхронизация'] });
    }
    assert(errors.length === 0, `production runtime errors: ${errors.join('; ')}`);
    return { passed: results.length, results, errors };
  } finally { page.off('pageerror', onError); await page.emulateMedia({ reducedMotion: 'no-preference' }); }
}
