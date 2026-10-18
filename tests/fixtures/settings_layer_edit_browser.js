// Run via playwright-cli run-code --filename on settings_hotfix_server.mjs.
async page => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("Use the offline Settings fixture");
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const results = [];
  page.setDefaultTimeout(7000);
  const cases = [
    [1440, 900, "en", "dark"], [1280, 800, "ko", "light"],
    [1100, 800, "ru", "dark"], [1024, 768, "de", "light"],
  ];
  for (const [width, height, language, theme] of cases) {
    const label = `${width}-${language}-${theme}`;
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/?language=${language}&theme=${theme}&tab=appearance`);
    await page.waitForFunction(() => settingsFixture.state.ready);
    const dock = page.locator(".settings-dock");
    const edit = dock.locator(".settings-preview-edit-link");
    await edit.waitFor({ state: "visible" });
    assert(await dock.locator(".settings-preview-layers button").count() === 1, `${label}: duplicate editor buttons`);
    assert(await dock.locator(".settings-preview-legend li").count() === 4, `${label}: missing layer color key`);
    assert(await dock.locator(".settings-preview-legend :is(button,a,[tabindex])").count() === 0,
      `${label}: informational labels still look interactive`);
    const translations = await page.evaluate(() => ({ edit: I18n.t("buttons.edit"),
      title: I18n.t("settingsUi.sections.lyricLayers.title") }));
    assert(await edit.innerText() === translations.edit, `${label}: edit action not localized`);
    assert(await edit.getAttribute("aria-label") === `${translations.title} · ${translations.edit}`,
      `${label}: edit action lacks a localized accessible name`);
    // Start away from typography, then exercise both pointer and keyboard
    // activation without changing settings or replacing the current dialog.
    await page.locator('.settings-toc-item').filter({ hasText: await page.evaluate(() => I18n.t("settingsAdvanced.syncMode.title")) }).click();
    const before = await page.evaluate(() => ({ visual: JSON.stringify(CONFIG.visual), calls: settingsFixture.state.calls.length }));
    await page.evaluate(() => { window.__layerEditDialog = document.getElementById("ivLyrics-config-container"); });
    if (language === "ko") {
      await edit.focus();
      await page.keyboard.press("Enter");
    } else if (language === "ru") {
      await edit.focus();
      await page.keyboard.press("Space");
    } else await edit.click();
    await page.waitForFunction(() => {
      const target = document.querySelector('[data-setting-key="lyric-layers"]');
      const main = document.querySelector(".settings-content");
      return !!target && target.getBoundingClientRect().top >= main.getBoundingClientRect().top - 3 &&
        target.getBoundingClientRect().top < main.getBoundingClientRect().top + 150;
    });
    const state = await page.evaluate(() => ({ sameDialog: __layerEditDialog === document.getElementById("ivLyrics-config-container"),
      visual: JSON.stringify(CONFIG.visual), calls: settingsFixture.state.calls.length,
      errors: settingsFixture.state.errors, network: settingsFixture.state.blockedNetwork }));
    assert(state.sameDialog && state.visual === before.visual && state.calls === before.calls,
      `${label}: navigating replaced the dialog or changed a preference`);
    assert(state.errors.length === 0 && state.network.length === 0, `${label}: runtime or external API error`);
    const geometry = await dock.locator(".settings-preview-layers, .settings-preview-layer-label, .settings-preview-edit-link").evaluateAll(nodes =>
      nodes.map(node => ({ name: node.className, overflow: node.scrollWidth - node.clientWidth,
        height: node.getBoundingClientRect().height })));
    assert(geometry.every(node => node.overflow <= 1), `${label}: preview controls clip ${JSON.stringify(geometry)}`);
    assert(geometry.find(node => node.name === "settings-preview-edit-link").height >= 32, `${label}: edit target too short`);
    if (language === "en" || language === "ru") await page.screenshot({ path: `output/playwright/layer-edit-${label}.png` });
    results.push({ label, editorButtons: 1, labels: 4, sameDialog: state.sameDialog, settingsUnchanged: true });
  }
  // Existing per-layer deep links still reveal the right editor tab when the
  // window is too narrow to show the preview dock.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const anchor of ["original-style", "pronunciation-style", "translation-style", "furigana-style"]) {
    await page.evaluate(key => settingsFixture.open("appearance", key), anchor);
    await page.waitForFunction(key => document.querySelector(`.settings-matrix [data-setting-key="${key}"][aria-checked="true"]`), anchor);
  }
  assert(await page.locator(".settings-dock").isHidden(), "narrow window: dock should stay hidden");
  results.push({ label: "390-de-light", deepLinks: 4 });
  return results;
}
