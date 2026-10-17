// Run on the loopback vinyl_player_server fixture with playwright_cli.sh run-code.
// Uses the production video mode and rich lyric renderer, never Spotify or a CDN.
async page => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Open the local vinyl_player_server fixture');
  const errors = [], results = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    await page.goto(origin + '/');
    await page.waitForFunction(() => window.ivLyricsVinylPlayerMode && window.ivLyricsActiveLyricLineRenderer);
    await page.evaluate(() => {
      document.getElementById('root').style.display = 'none';
      const host = document.createElement('main');
      host.id = 'video-box-replay';
      document.body.append(host);
      const style = document.createElement('style');
      style.textContent = `html, body { height: 100%; }
        body { background: repeating-linear-gradient(135deg, #567b8c 0 70px, #b687a9 70px 140px, #354151 140px 210px); }
        #video-box-replay .fullscreen-vinyl-overlay { background: transparent; }
        #video-box-replay .fullscreen-presentation-dock, #video-box-replay .fullscreen-stage-controls-dock { display: none; }`;
      document.head.append(style);
      const syllables = (text, start = 1000) => Array.from(text, (text, index) => ({ text, startTime: start + index * 220, endTime: start + 220 + index * 220 }));
      const lead = { text: 'All night 好きにしてね', startTime: 1000, endTime: 6500,
        syllables: syllables('All night 好きにしてね'), phonetic: 'All night suki ni shite ne', translation: 'All night, do as you please' };
      const backing = { text: 'Yeah', startTime: 4000, endTime: 6500, syllables: syllables('Yeah', 4000) };
      const multi = { text: 'All night 好きにしてね / Yeah', startTime: 1000, endTime: 6500,
        vocals: { lead, background: [backing] } };
      const single = { ...lead, text2: lead.translation, originalText: lead.phonetic };
      const root = ReactDOM.createRoot(host);
      const state = { mode: 'video', multiple: true, opacity: 55 };
      const render = options => {
        Object.assign(state, options);
        ReactDOM.flushSync(() => root.render(React.createElement(window.ivLyricsVinylPlayerMode, {
          // These are separate song scenarios, not a same-index lyric mutation.
          key: state.multiple ? 'multi-vocal-track' : 'single-vocal-track',
          track: { uri: 'spotify:track:video-box-fixture', title: 'Video stage background replay', artist: 'Local fixture' },
          presentationMode: state.mode, duration: 12000, position: 2500,
          activeLyrics: [state.multiple ? multi : single], activeLyricsKaraoke: true,
          lyricsTrackUri: 'spotify:track:video-box-fixture',
          vinylSettings: { lyricsEnabled: true, animations: false, reducedMotion: true,
            originalFontFamily: 'Arial', videoStageOriginalFontFamily: 'Arial', originalFontSize: 32,
            phoneticFontSize: 18, translationFontSize: 18, videoStageLyricBackgroundColor: '#101820',
            videoStageLyricBackgroundOpacity: state.opacity },
        })));
      };
      window.videoBoxFixture = { render };
      render({});
    });
    await page.waitForSelector('#video-box-replay .lyrics-karaoke-stack');
    const inspect = () => page.locator('#video-box-replay .fullscreen-vinyl-active-lyric').evaluate(root => {
      const paragraph = root.querySelector('.lyrics-lyricsContainer-LyricsLine > p');
      const sublines = [...root.querySelectorAll('.lyrics-karaoke-part-subline')];
      return { group: getComputedStyle(paragraph).backgroundColor,
        sublines: sublines.map(el => getComputedStyle(el).backgroundColor),
        geometry: [paragraph, ...root.querySelectorAll('.lyrics-vocal-main'), ...sublines].map(el => {
          const rect = el.getBoundingClientRect();
          return [el.textContent, ...['x', 'y', 'width', 'height'].map(key => +rect[key].toFixed(3))];
        }) };
    });
    const clear = color => color === 'rgba(0, 0, 0, 0)' || /\/\s*0\)$/.test(color);
    for (const [width, height] of [[1280, 800], [585, 300], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => videoBoxFixture.render({ mode: 'video', multiple: true, opacity: 55 }));
      const fixed = await inspect();
      assert(clear(fixed.group), 'the video multi-vocal paragraph still paints a large backing box');
      assert(fixed.sublines.length === 2 && fixed.sublines.every(color => !clear(color)), 'individual reading/translation boxes lost their backing');
      // Restore only the old paint property to compare identical production DOM.
      const control = await page.addStyleTag({ content: `#video-box-replay .fullscreen-vinyl-overlay.is-presentation-video .lyrics-lyricsContainer-LyricsLine > p:has(.lyrics-karaoke-stack) {
        background: color-mix(in srgb, var(--iv-video-stage-lyric-background-color) var(--iv-video-stage-lyric-background-opacity), transparent); }` });
      const before = await inspect();
      assert(!clear(before.group), 'the control failed to reproduce the reported large box');
      assert(JSON.stringify(before.geometry) === JSON.stringify(fixed.geometry), 'removing the large backing altered lyric geometry');
      assert(JSON.stringify(before.sublines) === JSON.stringify(fixed.sublines), 'the fix altered individual subtitle backing');
      await page.screenshot({ path: `output/playwright/video-stage-multiline-before-${width}.png` });
      await control.evaluate(element => element.remove());
      await page.screenshot({ path: `output/playwright/video-stage-multiline-after-${width}.png` });
      await page.evaluate(() => videoBoxFixture.render({ multiple: false }));
      assert(!clear((await inspect()).group), 'single-line video lyrics lost their configured backing');
      for (const mode of ['vinyl', 'compact-vinyl']) {
        await page.evaluate(mode => videoBoxFixture.render({ mode, multiple: true }), mode);
        assert(clear((await inspect()).group), `${mode} unexpectedly acquired a video backing`);
      }
      await page.evaluate(() => videoBoxFixture.render({ mode: 'video', multiple: true, opacity: 0 }));
      const noBacking = await inspect();
      assert(clear(noBacking.group) && noBacking.sublines.every(clear), 'background opacity zero stopped working');
      results.push({ width, height, unchangedGeometry: true, subtitleBoxes: fixed.sublines.length });
    }
    await page.evaluate(() => videoBoxFixture.render({ mode: 'video', multiple: true, opacity: 55 }));
    assert(errors.length === 0, `production renderer errors: ${errors.join('; ')}`);
    return { passed: results.length, results, errors };
  } finally { page.off('pageerror', onError); }
}
