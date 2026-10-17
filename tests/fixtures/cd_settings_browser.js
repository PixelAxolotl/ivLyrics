// Run against settings_hotfix_server.mjs with playwright-cli run-code --filename.
// Production Settings, save handlers, previews and CSS; Spotify/network are stubs.
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(new URL(origin).hostname === "127.0.0.1", "Use the loopback Settings fixture");
  const results = [];
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const row = key => page.locator(`.tab-content.active [data-setting-key="fullscreen-cd-${key}"]`);
  for (const [width, height, language, theme] of [[1440, 900, "en", "dark"], [1100, 800, "ko", "light"], [840, 900, "en", "light"], [640, 900, "ko", "dark"], [390, 844, "ar", "dark"]]) {
    const label = `${width}-${language}-${theme}`;
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/?language=${language}&theme=${theme}&tab=fullscreen`);
    await page.waitForFunction(() => window.settingsFixture?.state.ready);
    const words = await page.evaluate(() => ({
      mode: I18n.t("vinyl.cd.mode"), fullscreen: I18n.t("tabs.fullscreen"),
      styles: { line: I18n.t("vinyl.cd.styles.line"), pulse: I18n.t("vinyl.cd.styles.pulse"), particles: I18n.t("vinyl.cd.styles.particles") },
      colorModes: { custom: I18n.t("vinyl.cd.colorModes.custom"), rainbow: I18n.t("vinyl.cd.colorModes.rainbow") },
    }));
    await page.getByRole("radio", { name: words.mode, exact: true }).click();
    await row("visualizer-enabled").getByRole("switch").waitFor();
    assert(await row("visualizer-enabled").getByRole("switch").getAttribute("aria-checked") === "true", `${label}: default is not ON`);
    const tiles = row("visualizer-style").getByRole("radio");
    assert(await tiles.count() === 9, `${label}: shape tiles missing`);
    assert(await row("visualizer-style").locator(".settings-cd-style-thumb").count() === 9, `${label}: tile previews missing`);
    const tileBoxes = await tiles.evaluateAll(nodes => nodes.map(node => { const { width, height } = node.getBoundingClientRect(); return { width, height, clipped: node.scrollWidth - node.clientWidth }; }));
    assert(tileBoxes.every(box => box.width >= 80 && box.height >= 72 && box.clipped <= 1), `${label}: cramped tiles ${JSON.stringify(tileBoxes)}`);
    await row("visualizer-style").getByRole("radio", { name: words.styles.pulse, exact: true }).click();
    await settle();
    assert(await row("visualizer-density").getByRole("slider").isDisabled(), `${label}: density enabled for Pulse`);
    assert(await row("visualizer-mirror").getByRole("switch").isDisabled(), `${label}: mirror enabled for Pulse`);
    await row("visualizer-style").getByRole("radio", { name: words.styles.particles, exact: true }).click();
    await row("visualizer-mirror").getByRole("switch").click();
    await settle();
    assert((await page.evaluate(() => CONFIG.visual["fullscreen-cd-visualizer-mirror"])) === true, `${label}: mirror not saved`);
    assert(await row("visualizer-style").locator('.settings-cd-style-thumb[data-cd-mirror="true"]').count() === 9, `${label}: tiles ignore mirror`);
    await row("visualizer-color-mode").getByRole("radio", { name: words.colorModes.rainbow, exact: true }).click();
    await settle();
    if (width > 980) {
      const live = page.locator('.settings-cd-disc-preview[data-cd-style="particles"][data-cd-mirror="true"]');
      assert(await live.count() >= 1, `${label}: live preview ignores particles/mirror`);
      assert(await live.locator("linearGradient").count() >= 1, `${label}: live preview ignores rainbow`);
    }
    await page.screenshot({ path: `output/playwright/cd-settings-shapes-${label}.png` });
    await row("visualizer-mirror").getByRole("switch").click();
    await row("visualizer-style").getByRole("radio", { name: words.styles.line, exact: true }).click();
    await row("visualizer-color-mode").getByRole("radio", { name: words.colorModes.custom, exact: true }).click();
    const color = row("visualizer-color").getByRole("textbox").last();
    await color.fill("#81b5d3");
    await color.press("Tab");
    await row("visualizer-thickness").getByRole("textbox").fill("3.5");
    await row("visualizer-thickness").getByRole("textbox").press("Tab");
    await row("visualizer-density").getByRole("slider").press("Home");
    await row("visualizer-density").getByRole("slider").press("ArrowRight");
    await settle();
    const saved = () => page.evaluate(() => Object.fromEntries(Object.entries(CONFIG.visual).filter(([key]) => key.startsWith("fullscreen-cd-"))));
    const tuned = await saved();
    assert(tuned["fullscreen-cd-visualizer-style"] === "line", `${label}: shape not saved`);
    assert(tuned["fullscreen-cd-visualizer-color"] === "#81b5d3", `${label}: custom colour not saved`);
    assert(tuned["fullscreen-cd-visualizer-thickness"] === 3.5, `${label}: fractional thickness lost`);
    assert(tuned["fullscreen-cd-visualizer-density"] === 32, `${label}: keyboard density update lost`);
    if (width > 980) {
      const preview = page.locator('.settings-cd-disc-preview[data-cd-style="line"]');
      assert(await preview.count() >= 1, `${label}: preview shape did not update`);
      assert(await preview.locator('g[stroke="#81b5d3"]').count() >= 1, `${label}: preview colour did not update`);
    }
    await row("visualizer-enabled").getByRole("switch").click();
    await settle();
    assert(await row("visualizer-color").count() === 0, `${label}: custom colour still editable while off`);
    assert(await row("visualizer-thickness").getByRole("slider").isDisabled(), `${label}: thickness still enabled`);
    assert(await row("visualizer-style").getByRole("radio").first().isDisabled(), `${label}: shape still enabled`);
    const off = await saved();
    for (const key of Object.keys(tuned).filter(key => key !== "fullscreen-cd-visualizer-enabled")) assert(off[key] === tuned[key], `${label}: disabling lost ${key}`);
    await row("visualizer-enabled").getByRole("switch").click();
    await page.getByRole("radio", { name: await page.evaluate(() => I18n.t("vinyl.mode")), exact: true }).click();
    assert(await page.locator('.tab-content.active [data-setting-key^="fullscreen-cd-"]:visible').count() === 0, `${label}: duplicated LP editor`);
    await page.getByRole("radio", { name: words.mode, exact: true }).click();
    assert((await saved())["fullscreen-cd-visualizer-color"] === "#81b5d3", `${label}: navigating lost settings`);
    await page.locator(".settings-changed-chip").click();
    await page.waitForSelector('.tab-content.active[data-tab-id="changed"]');
    const group = page.locator(".settings-changed-menu").filter({ has: page.locator(".settings-changed-menu-title", { hasText: words.fullscreen }) });
    assert(await group.locator('[data-setting-key^="fullscreen-cd-"]').count() === 5, `${label}: changed-setting ownership/count incorrect`);
    await group.locator('[data-setting-key="fullscreen-cd-visualizer-style"] .settings-jump-link').click();
    await row("visualizer-style").waitFor();
    assert(await page.getByRole("radio", { name: words.mode, exact: true }).getAttribute("aria-checked") === "true", `${label}: changed jump missed CD view`);
    const geometry = await page.evaluate(() => {
      const content = document.querySelector(".settings-content");
      return { overflow: content.scrollWidth - content.clientWidth,
        errors: window.settingsFixture.state.errors, network: window.settingsFixture.state.blockedNetwork,
        visibleRows: [...document.querySelectorAll('.tab-content.active [data-setting-key^="fullscreen-cd-"]')].filter(node => node.getClientRects().length).map(node => node.dataset.settingKey),
      };
    });
    assert(geometry.overflow <= 1, `${label}: horizontal overflow ${geometry.overflow}`);
    assert(geometry.errors.length === 0 && geometry.network.length === 0, `${label}: errors/network ${JSON.stringify(geometry)}`);
    assert(new Set(geometry.visibleRows).size === 11 && geometry.visibleRows.length === 11, `${label}: missing/duplicate CD controls`);
    await page.screenshot({ path: `output/playwright/cd-settings-${label}.png` });
    results.push({ label, saved: tuned, ...geometry });
  }
  return results;
}
