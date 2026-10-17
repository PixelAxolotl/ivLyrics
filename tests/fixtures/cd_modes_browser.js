// Replay the production fullscreen switcher, not a fixture-only mode setter.
async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(new URL(origin).hostname === "127.0.0.1", "Use the loopback CD fixture");
  const results = [];
  for (const [width, height] of [[1440, 900], [800, 1000]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/cd`);
    if (await page.locator("details").getAttribute("open") === null) await page.getByText("CD fixture controls", { exact: true }).click();
    await page.getByLabel("Presentation", { exact: true }).selectOption("overlay");
    await page.getByText("CD fixture controls", { exact: true }).click();
    await page.waitForSelector(".ivlyrics-cd-disc");
    const labels = await page.evaluate(() => Object.fromEntries([
      ["standard", "standardLabel"], ["compact-vinyl", "compactLabel"], ["vinyl", "vinylLabel"], ["video", "videoLabel"],
    ].map(([id, key]) => [id, I18n.t(`vinyl.presentation.${key}`)])));
    await page.evaluate(() => {
      window.cdTransitionQa = { count: 0, directions: [] };
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = update => {
        cdTransitionQa.count++;
        const transition = start(update);
        cdTransitionQa.active = transition;
        transition.ready.then(() => {
          cdTransitionQa.directions.push(document.documentElement.className);
        }).catch(() => {});
        return transition;
      };
    });
    const choose = async (mode, capture = false) => {
      const option = page.getByRole("button", { name: labels[mode], exact: true });
      if (!await option.isVisible()) await page.locator(".fullscreen-presentation-hotspot").hover({ position: { x: 8, y: 62 } });
      await option.focus();
      await option.click();
      await page.waitForFunction(mode => cdFixture.overlayMode === mode, mode);
      if (capture) {
        await page.evaluate(() => cdTransitionQa.active.ready);
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 220)));
        await page.screenshot({ path: `output/playwright/cd-switch-${width}-${mode}-mid.png` });
      }
      await page.evaluate(() => cdTransitionQa.active?.finished.catch(() => {}));
      assert(await page.evaluate(() => !document.documentElement.classList.contains("is-lp-view-transition")), "mode transition classes leaked");
    };
    // Every directed edge between Standard, CD, LP and Video is exercised.
    const sequence = ["standard", "vinyl", "compact-vinyl", "video", "vinyl", "standard", "video", "compact-vinyl", "vinyl", "video", "standard", "compact-vinyl"];
    for (const mode of sequence) await choose(mode, mode === "vinyl" || mode === "compact-vinyl");
    assert(await page.evaluate(() => cdTransitionQa.count) === sequence.length, "some modes bypassed the shared handoff");
    await page.locator(".clickable-album-container").hover();
    const hover = await page.locator(".clickable-album-container").evaluate(node => ({
      shadow: getComputedStyle(node).boxShadow, transform: getComputedStyle(node).transform,
    }));
    assert(hover.shadow === "none" && hover.transform === "none", "CD retained its square hover box");
    assert(await page.locator(".album-mode-hint").count() === 0, "CD retained LP/Research hints");
    await page.screenshot({ path: `output/playwright/cd-hover-fixed-${width}.png` });
    await choose("standard");
    const normalWidth = await page.locator(".clickable-album-container").evaluate(node => node.getBoundingClientRect().width);
    assert(normalWidth > 40, "standard album's contained hit area collapsed in portrait");
    await page.locator(".clickable-album-container").hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".clickable-album-container")).boxShadow !== "none");
    assert(await page.locator(".album-mode-hint").count() === 1, "normal album hover changed");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const before = await page.evaluate(() => cdTransitionQa.count);
    await choose("compact-vinyl");
    assert(await page.evaluate(() => cdTransitionQa.count) === before, "reduced-motion user received snapshot animations");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert(await page.evaluate(() => cdFixture.errors.length) === 0, "production fullscreen runtime errors");
    results.push({ width, height, transitions: sequence.length, hover, reducedMotion: "immediate" });
  }
  return results;
}
