// Replay real Settings controls with production typography/presentation helpers.
// Playback, accounts and network APIs remain explicit offline host stubs.
async page => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Use settings_hotfix_server');
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const row = key => page.locator(`.tab-content.active [data-setting-key="${key}"]`);
  const line = '.settings-live-preview-line > .lyrics-lyricsContainer-LyricsLine-active';
  const layer = name => `${line} > .lyrics-lyricsContainer-LyricsLine-${name}`;
  const results = [];
  const expandPreview = async () => {
    const collapsed = page.locator('.settings-dock-toggle[aria-expanded="false"]');
    if (await collapsed.count()) await collapsed.click();
  };
  page.setDefaultTimeout(7000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${origin}/?language=en&theme=dark&tab=appearance&seed=defaults`);
  await page.waitForFunction(() => settingsFixture.state.ready);
  await page.evaluate(() => {
    settingsFixture.setConfig({ 'translation-mode:japanese': 'gemini_romaji',
      'translation-mode-2:japanese': 'gemini', 'karaoke-mode-enabled': true,
      'translate:display-mode': 'below' });
    settingsFixture.open('appearance', 'phonetic-spacing');
  });
  await expandPreview();
  await page.locator(layer('translation')).waitFor();
  for (const [key, name, value] of [['phonetic-spacing', 'phonetic', 18], ['translation-spacing', 'translation', 20]]) {
    const input = row(key).locator('input[type="text"]');
    await input.fill(String(value));
    await input.press('Enter');
    await page.waitForFunction(([selector, value]) =>
      getComputedStyle(document.querySelector(selector)).marginTop === `${value}px`, [layer(name), value]);
  }
  results.push('actual spacing inputs update production subline margins');
  await page.evaluate(() => settingsFixture.setConfig({ 'translation-mode:japanese': 'none', 'translation-mode-2:japanese': 'none' }));
  await page.waitForFunction(selector => document.querySelector(selector).children.length === 1, line);
  results.push('explicitly disabled pronunciation and translation are absent');
  await page.evaluate(() => settingsFixture.setConfig({ 'karaoke-mode-enabled': false,
    'translation-mode:japanese': 'none', 'translation-mode-2:japanese': 'gemini', 'translate:display-mode': 'replace' }));
  await page.waitForFunction(selector => document.querySelector(selector).textContent === I18n.t('settingsAdvanced.livePreview.sampleText'), line);
  assert(!(await page.locator('.settings-live-preview-stage').getAttribute('class')).includes('is-karaoke'), 'non-karaoke retains karaoke class');
  results.push('non-karaoke translation-only replacement matches playback');
  await page.evaluate(() => settingsFixture.setConfig({ 'translation-mode:japanese': 'gemini_romaji', 'translate:display-mode': 'below' }));
  await page.locator(layer('phonetic')).waitFor();
  await page.locator(layer('translation')).waitFor();
  results.push('below mode restores typed layers without reopening Settings');
  await page.screenshot({ path: 'output/playwright/settings-preview-lyrics-visibility.png' });

  await page.evaluate(() => { settingsFixture.setConfig({ 'cultural-annotations-enabled': false });
    settingsFixture.open('ai-providers', 'cultural-annotations-enabled'); });
  await row('cultural-annotations-enabled').getByRole('switch').waitFor();
  await expandPreview();
  await page.locator('.settings-page-head .settings-toc-item').nth(2).click();
  assert(await page.locator(layer('culturalNote')).count() === 0, 'disabled annotation is shown');
  await row('cultural-annotations-enabled').getByRole('switch').click();
  await page.locator(layer('culturalNote')).waitFor();
  await row('cultural-annotations-enabled').getByRole('switch').click();
  await page.waitForFunction(selector => !document.querySelector(selector), layer('culturalNote'));
  results.push('actual cultural-note switch hides and restores the sample');

  await page.evaluate(() => { settingsFixture.setConfig({ 'panel-lyrics-enabled': true,
    'panel-lyrics-original-size': 26, 'panel-font-scale': 100 }); settingsFixture.open('nowplaying', 'panel-lyrics-enabled'); });
  await expandPreview();
  const panel = '.settings-dock-body > .option-list-wrapper';
  const slots = `${panel} div[style*="flex: 0 0"]`;
  await page.locator(slots).first().waitFor();
  const metrics = await page.locator(slots).nth(4).evaluate(node => ({
    basis: getComputedStyle(node).flexBasis,
    originalSize: getComputedStyle(node.firstElementChild).fontSize,
    weight: getComputedStyle(node.firstElementChild).fontWeight,
    layers: node.children.length,
  }));
  assert(metrics.basis === '72px' && metrics.originalSize === '26px' && metrics.weight === '700' && metrics.layers === 3,
    `panel defaults differ from playback: ${JSON.stringify(metrics)}`);
  await row('panel-lyrics-enabled').getByRole('switch').click();
  await page.waitForFunction(selector => !document.querySelector(selector), panel);
  await row('panel-lyrics-enabled').getByRole('switch').click();
  await page.locator(slots).first().waitFor();
  results.push('actual panel master switch disables and reenables its subscribed preview');

  // Preset/reset notifications intentionally contain no per-setting value.
  await page.evaluate(() => {
    CONFIG.visual['panel-lyrics-original-size'] = 32;
    CONFIG.visual['panel-font-scale'] = 125;
    CONFIG.visual['panel-bg-type'] = 'custom';
    CONFIG.visual['panel-bg-color'] = '#224466';
    window.dispatchEvent(new CustomEvent('ivLyrics:panel-preview-update', { detail: { source: 'settings-preset' } }));
  });
  await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector).firstElementChild).fontSize === '40px', slots);
  await page.evaluate(() => {
    CONFIG.visual['panel-lyrics-original-size'] = 26;
    CONFIG.visual['panel-font-scale'] = 100;
    window.dispatchEvent(new CustomEvent('ivLyrics', { detail: { type: 'config', source: 'settings-reset' } }));
  });
  await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector).firstElementChild).fontSize === '26px', slots);
  results.push('source-only preset/reset events refresh from current CONFIG');
  await page.evaluate(() => settingsFixture.setConfig({ 'translation-mode:japanese': 'none', 'translation-mode-2:japanese': 'none' }));
  await page.waitForFunction(selector => document.querySelector(selector).children.length === 1, slots);
  await page.evaluate(() => settingsFixture.setConfig({ 'translation-mode:japanese': 'gemini_romaji', 'translation-mode-2:japanese': 'gemini' }));
  await page.waitForFunction(selector => document.querySelector(selector).children.length === 3, slots);
  await page.screenshot({ path: 'output/playwright/settings-preview-panel-visibility.png' });
  results.push('panel independently preserves original-first typed layers');
  const errors = await page.evaluate(() => settingsFixture.state.errors);
  assert(errors.length === 0, JSON.stringify(errors));
  return { passed: results.length, results, panelMetrics: metrics, errors };
}
