// Run on lyrics_supplement_server.mjs with playwright-cli run-code --filename.
// Mount the actual page components on the report's track; never copy a renderer
// or borrow another worker's browser session. No Vinyl fixture route is needed.
async page => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Open the loopback supplement fixture');
  const trackUri = 'spotify:track:3XBczMvty8PbFcvs2QYDoe';
  const errors = [], results = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const width of [1000, 390]) for (const surface of ['Compact', 'Expanded']) {
      await page.setViewportSize({ width, height: 760 });
      await page.goto(origin + '/');
      await page.waitForFunction(() => window.ProductionSupplement && window.supplementFixture
        && window.Spicetify?.React && window.ReactDOM && window.CONFIG);
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate(({ width, surface, trackUri }) => {
        const assert = (ok, message) => { if (!ok) throw new Error(`${surface}/${width}: ${message}`); };
        const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected),
          `${message}: ${JSON.stringify({ actual, expected })}`);
        const f = window.supplementFixture, React = Spicetify.React;
        f.reset({ style: 'expressive', reveal: false });
        f.track(trackUri.split(':').pop());
        f.pause();
        f.step(1100 - f.position);
        const originalHost = document.getElementById('host');
        originalHost.style.display = 'none';
        const host = document.createElement('main');
        host.className = 'lyrics-lyricsContainer-LyricsContainer';
        host.style.cssText = 'height:680px;font-size:32px;--font-family:Arial;--lyrics-font-size:32px;'
          + '--lyrics-color-active:#fff;--lyrics-color-inactive:#888;--lyrics-line-height:1.6';
        document.body.append(host);
        const root = ReactDOM.createRoot(host);
        const sourceLine = (text, startTime = 1000) => ({ text, originalText: text,
          startTime, endTime: startTime + 4000, karaokeGranularity: 'character',
          syllables: Array.from(text, (text, index) => ({ text,
            startTime: startTime + index * 110, endTime: startTime + (index + 1) * 110 })) });
        const next = sourceLine('Next line', 6000);
        const sourceByText = new Map();
        let revision = 0, pageNode = null;
        const glyphText = element => [...element.querySelectorAll('.lyrics-karaoke-glyph-fill')]
          .map(glyph => glyph.textContent).join('');
        // Canonicalize attribute/style order only. Every DOM node, class,
        // reading, fill and motion value remains part of the Classic comparison.
        const dom = node => {
          if (node.nodeType === Node.TEXT_NODE) return node.textContent;
          if (node.nodeType !== Node.ELEMENT_NODE) return null;
          return { tag: node.tagName,
            attributes: [...node.attributes].map(({ name, value }) => [name, name === 'style'
              ? [...node.style].sort().map(property => [property, node.style.getPropertyValue(property)]) : value])
              .sort(([a], [b]) => a.localeCompare(b)),
            children: [...node.childNodes].map(dom) };
        };
        const render = (text, style, position) => {
          let line = sourceByText.get(text);
          if (!line) sourceByText.set(text, line = sourceLine(text));
          const sourceBefore = JSON.stringify(line);
          if (style === 'unset') delete CONFIG.visual['karaoke-motion-style'];
          else CONFIG.visual['karaoke-motion-style'] = style;
          ReactDOM.flushSync(() => root.render(React.createElement(ProductionSupplement[surface], {
            lyrics: [line, next], isKara: true, karaokeRenderGranularity: 'character',
            trackUri, trackRevealKey: null, reRenderLyricsPage: ++revision,
          })));
          f.step(position - f.position);
          assert(Spicetify.Player.data.item.uri === trackUri, 'the replay changed tracks');
          if (pageNode) assert(host.firstElementChild === pageNode, 'same-track replay remounted the page');
          pageNode = host.firstElementChild;
          const row = host.querySelector('[data-lyrics-seek-time="1000"]');
          const karaoke = row?.querySelector('.lyrics-karaoke-line');
          assert(karaoke, `missing production karaoke DOM for ${text}`);
          assert(!karaoke.classList.contains('is-word-timed'), 'character-mode replay switched to word timing');
          assert(glyphText(karaoke) === text, `source text changed for ${text}`);
          const glyphs = [...karaoke.querySelectorAll('.lyrics-karaoke-char')];
          equal(glyphs.map(glyph => glyph.dataset.outlineText).join(''), text, 'glyph indices lost source text');
          equal(JSON.stringify(line), sourceBefore, 'source syllables/timing were mutated');
          const entries = [...ProductionSupplement.painter.entries].filter(entry =>
            [...entry.units.values()].some(unit => unit.elements.some(element => karaoke.contains(element))));
          assert(entries.length === 1 && entries[0].data.wordTimed === false, 'missing real character-mode live painter');
          const words = [...karaoke.querySelectorAll('.lyrics-karaoke-word')];
          return {
            text: glyphText(karaoke), hasWrap: karaoke.classList.contains('has-word-wrap'),
            expressive: karaoke.classList.contains('is-motion-expressive'),
            words: words.map(glyphText),
            moving: words.filter(word => word.classList.contains('is-expressive-unit')).map(glyphText),
            wordKeys: words.map(word => word.getAttribute('data-karaoke-live')),
            painterWords: [...entries[0].units.keys()].filter(key => key.startsWith('w:')),
            fills: glyphs.map(glyph => ({ text: glyph.dataset.outlineText,
              key: glyph.getAttribute('data-karaoke-live'),
              state: glyph.className.match(/char--(pending|active|done)/)?.[1],
              fill: glyph.style.getPropertyValue('--karaoke-char-fill'),
              softStart: glyph.style.getPropertyValue('--karaoke-char-fill-soft-start'),
              softEnd: glyph.style.getPropertyValue('--karaoke-char-fill-soft-end') })),
            dom: dom(karaoke),
          };
        };
        const cases = [
          ['period', 'hi.yo', ['hi.', 'yo']],
          ['repeated', 'hi..yo', ['hi..', 'yo']],
          ['edges', '...hi...yo...', ['...hi...', 'yo...']],
          ['contraction', "isn't.go", ["isn't.", 'go']],
          ['curly-contraction', 'isn’t.go', ['isn’t.', 'go']],
          ['only-dots', '...', []],
          ['trailing-only', 'hi...', []],
          ['mixed', "hi.-isn't..go-yes", ['hi.-', "isn't..", 'go-', 'yes']],
        ];
        const checks = [];
        for (const [id, text, expected] of cases) {
          for (const position of [1100]) {
            const classic = render(text, 'classic', position);
            assert(!classic.expressive && !classic.hasWrap && classic.words.length === 0,
              `Classic added punctuation wrappers for ${id}`);
            const expressive = render(text, 'expressive', position);
            equal(expressive.words, expected, `production wrapper split for ${id}`);
            equal(expressive.moving, expected, `Expressive motion wrappers for ${id}`);
            assert(expressive.hasWrap === (expected.length > 0), `incorrect wrapper path for ${id}`);
            equal(expressive.fills, classic.fills, `punctuation changed the live fill for ${id}/${position}`);
            equal(expressive.painterWords, expressive.wordKeys, `DOM/live painter ranges diverged for ${id}`);
            const restored = render(text, 'classic', position);
            equal(restored.dom, classic.dom, `Classic DOM changed after Expressive for ${id}/${position}`);
            const unset = render(text, 'unset', position);
            equal(unset.dom, classic.dom, `unset style diverged from Classic for ${id}/${position}`);
          }
          checks.push({ id, text, wrappers: expected, sourceTextPreserved: true,
            liveFillPreserved: true, classicRestored: true, samples: 1 });
        }
        render(cases.at(-1)[1], 'expressive', 1500);
        window.punctuationReplayCleanup = () => {
          ReactDOM.flushSync(() => root.unmount());
          host.remove();
          originalHost.style.display = '';
          delete window.punctuationReplayCleanup;
        };
        return { width, surface, trackUri, checks };
      }, { width, surface, trackUri });
      await page.screenshot({ path: `output/playwright/expressive-punctuation-${width}-${surface.toLowerCase()}.png` });
      await page.evaluate(() => window.punctuationReplayCleanup());
      results.push(result);
    }
    if (errors.length) throw new Error('Production browser errors: ' + errors.join('; '));
    return { passed: results.length, cases: results.reduce((count, result) => count + result.checks.length, 0), results, errors };
  } finally {
    page.off('pageerror', onError);
    await page.evaluate(() => window.punctuationReplayCleanup?.());
  }
}
