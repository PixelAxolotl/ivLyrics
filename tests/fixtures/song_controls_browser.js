// Run with playwright-cli against settings_hotfix_server.mjs. These are the
// production Settings component, styles and translations with offline storage.
async page => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Use the loopback Settings fixture');
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const keys = ['fullscreen-show-controls', 'fullscreen-show-volume', 'fullscreen-show-progress',
    'fullscreen-control-button-size', 'fullscreen-controls-background'];
  const sectionSelector = '.tab-content.active .settings-section[data-section-key="controller-style"]';
  const results = [];
  const waitForAnchor = selector => page.waitForFunction(selector => {
    const node = document.querySelector(selector), head = document.querySelector('.settings-page-head');
    if (!node || !head) return false;
    const top = node.getBoundingClientRect().top, bottom = head.getBoundingClientRect().bottom;
    return top >= bottom - 1 && top < bottom + 32;
  }, selector);
  page.setDefaultTimeout(7000);
  for (const [width, height, language, theme] of [[1280, 900, 'en', 'dark'], [640, 900, 'ko', 'light'], [390, 844, 'en', 'dark']]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/?language=${language}&theme=${theme}&tab=fullscreen`);
    await page.waitForFunction(() => window.settingsFixture?.state.ready);
    const title = await page.evaluate(() => I18n.t('settingsAdvanced.controllerStyle.title'));
    await page.getByRole('button', { name: title, exact: true }).click();
    const section = page.locator(sectionSelector);
    await section.getByRole('heading', { name: title, exact: true }).waitFor();
    await waitForAnchor(`${sectionSelector} .section-title`);
    const actual = await section.locator('.setting-row[data-setting-key]').evaluateAll(nodes => nodes.map(node => node.dataset.settingKey));
    assert(JSON.stringify(actual) === JSON.stringify(keys), `${width}: expected one ordered group of five controls`);
    assert(await section.locator('.option-list-wrapper').count() === 1, `${width}: split cards remain`);
    const labels = await section.locator('.setting-name').allTextContents();
    const row = key => section.locator(`.setting-row[data-setting-key="${key}"]`);
    const toggle = key => row(key).getByRole('switch');
    const metrics = await section.evaluate(node => {
      const content = node.closest('.settings-content'), bounds = node.getBoundingClientRect();
      return { overflow: content.scrollWidth - content.clientWidth,
        sectionWidth: bounds.width, rows: [...node.querySelectorAll('.setting-row')].map(row => ({
          key: row.dataset.settingKey, overflow: row.scrollWidth - row.clientWidth,
        })) };
    });
    assert(metrics.overflow <= 1 && metrics.rows.every(row => row.overflow <= 1), `${width}: horizontal overflow`);
    await page.screenshot({ path: `output/playwright/song-controls-${width}-${theme}.png` });

    for (const key of keys.slice(1, 3)) await toggle(key).click();
    await row(keys[3]).getByRole('slider').focus();
    for (let index = 0; index < 4; index++) await page.keyboard.press('ArrowRight');
    await toggle(keys[4]).click();
    await toggle(keys[0]).click();
    await page.waitForFunction(keys => CONFIG.visual[keys[0]] === false && CONFIG.visual[keys[1]] === false &&
      CONFIG.visual[keys[2]] === false && CONFIG.visual[keys[3]] === 44 && CONFIG.visual[keys[4]] === true, keys);
    assert(await row(keys[1]).count() === 0 && await row(keys[2]).count() === 0, `${width}: master visibility no longer hides dependent choices`);
    const saved = await page.evaluate(keys => keys.map(key => StorageManager.getPersisted(`ivLyrics:visual:${key}`)), keys);
    assert(JSON.stringify(saved) === JSON.stringify(['false', 'false', 'false', '44', 'true']), `${width}: persisted keys/values changed`);

    await page.locator('.settings-changed-chip').click();
    const changed = page.locator('.settings-changed-menu').filter({
      has: page.getByRole('heading', { name: await page.evaluate(() => I18n.t('tabs.fullscreen')), exact: true }),
    });
    const changedKeys = await changed.locator('.setting-row[data-setting-key]').evaluateAll(nodes => nodes.map(node => node.dataset.settingKey));
    assert(JSON.stringify(changedKeys) === JSON.stringify(keys), `${width}: changed settings have incorrect owners`);
    assert((await changed.locator('.settings-jump-link').allTextContents()).every(label => label.trim() === title), `${width}: stale changed-setting section label`);
    await changed.locator(`[data-setting-key="${keys[3]}"] .settings-jump-link`).click();
    await row(keys[3]).waitFor({ state: 'visible' });

    await page.evaluate(() => settingsFixture.open('fullscreen', 'controller-style'));
    await toggle(keys[0]).waitFor();
    assert(await toggle(keys[0]).getAttribute('aria-checked') === 'false', `${width}: reopening lost master choice`);
    await toggle(keys[0]).click();
    await toggle(keys[1]).waitFor();
    assert(await toggle(keys[1]).getAttribute('aria-checked') === 'false' &&
      await toggle(keys[2]).getAttribute('aria-checked') === 'false', `${width}: child choices did not survive hiding/reopening`);
    for (const [index, label] of [...labels, title].entries()) {
      await page.locator('.settings-search-input').fill(label);
      const exact = new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
      let result = page.getByRole('option').filter({ has: page.locator('b').filter({ hasText: exact }) });
      if (index < keys.length) {
        const context = new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
        result = result.filter({ has: page.locator('small').filter({ hasText: context }) });
      }
      await result.waitFor();
      assert(await result.count() === 1, `${width}: duplicate/missing search result for ${label}`);
      await result.click();
      const destination = index < keys.length ? row(keys[index]) : section.locator('.section-title');
      await destination.waitFor({ state: 'visible' });
      await waitForAnchor(index < keys.length ? `${sectionSelector} [data-setting-key="${keys[index]}"]` : `${sectionSelector} .section-title`);
      assert(await destination.evaluate(node => node.closest('.settings-section')?.dataset.sectionKey === 'controller-style'), `${width}: search leads to the old group`);
    }
    await row(keys[3]).locator('.settings-reset-btn').click();
    for (const key of [keys[1], keys[2], keys[4]]) await toggle(key).click();
    await page.waitForFunction(keys => keys.every(key => CONFIG.visual[key] === settingsFixture.defaults[key]), keys);
    const state = await page.evaluate(() => ({ errors: settingsFixture.state.errors, network: settingsFixture.state.blockedNetwork }));
    assert(state.errors.length === 0 && state.network.length === 0, `${width}: runtime/network errors ${JSON.stringify(state)}`);
    results.push({ width, language, theme, grouped: keys.length, searchTargets: 6,
      persistedAndReset: true, changedLinks: true, ...metrics, ...state });
  }
  return { passed: results.length, results };
}
