// Run against vinyl_player_server.mjs /cd with playwright-cli run-code --filename.
// Uses the production CD module/renderers with deterministic local analysis.
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(new URL(origin).hostname === "127.0.0.1", "Use the loopback CD fixture");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/cd`);
  await page.evaluate(async () => {
    localStorage.removeItem("cd-fixture-settings");
    // Only this disposable loopback origin is reset for a cold request count.
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("ivLyricsCdAnalysis");
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  });
  await page.reload();
  await page.waitForSelector('canvas[data-state="ready"]');
  const rects = () => page.evaluate(() => [".qa-cd-slot", ".qa-lyrics", ".ivlyrics-cd-disc"].map(selector => {
    const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height };
  }));
  const originalRects = await rects();
  assert(await page.evaluate(() => qaAudio.requests.length) === 1, "two canvases must share one analysis request");
  await page.evaluate(() => {
    window.cdQa = { paints: 0, rotor: document.querySelector(".ivlyrics-cd-print-rotor"), clock: document.querySelector(".ivlyrics-cd-print-rotor").getAnimations()[0] };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) { cdQa.paints++; return clear.apply(this, args); };
  });
  const renders = [];
  const styles = await page.evaluate(() => window.ivLyricsCdVisualizer.STYLES);
  for (const style of styles) {
    await page.getByLabel("Shape", { exact: true }).selectOption(style);
    const output = await page.evaluate(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return document.querySelector("canvas").toDataURL();
    });
    assert(JSON.stringify(await rects()) === JSON.stringify(originalRects), `${style}: shape moved CD/lyrics`);
    renders.push(output);
    await page.screenshot({ path: `output/playwright/cd-${style}-dark.png` });
  }
  assert(new Set(renders).size === styles.length, "shapes must render genuinely different pixels");
  assert(await page.evaluate(() => qaAudio.requests.length) === 1, "shape changes refetched analysis");
  await page.getByRole("button", { name: "Hydrate metadata", exact: true }).click();
  assert(await page.evaluate(() => cdQa.rotor === document.querySelector(".ivlyrics-cd-print-rotor") && cdQa.clock === document.querySelector(".ivlyrics-cd-print-rotor").getAnimations()[0]), "metadata hydration restarted the rotation clock");
  await page.getByRole("checkbox", { name: "Visualizer", exact: true }).uncheck();
  await page.waitForSelector('canvas[data-state="disabled"]');
  assert(JSON.stringify(await rects()) === JSON.stringify(originalRects), "visualizer OFF moved CD/lyrics");
  const disabled = await page.evaluate(async () => { const before = cdQa.paints; await new Promise(resolve => setTimeout(resolve, 250)); return cdQa.paints - before; });
  assert(disabled === 0, "disabled canvas continued painting");
  await page.getByRole("checkbox", { name: "Visualizer", exact: true }).check();
  await page.waitForSelector('canvas[data-state="ready"]');
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const paused = await page.evaluate(async () => {
    const clock = cdQa.clock, time = clock.currentTime, paints = cdQa.paints;
    await new Promise(resolve => setTimeout(resolve, 250));
    return { state: clock.playState, delta: Math.abs(clock.currentTime - time), paints: cdQa.paints - paints };
  });
  assert(paused.state === "paused" && paused.delta < 2 && paused.paints === 0, `paused clock/canvas did work ${JSON.stringify(paused)}`);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("checkbox", { name: "Reduce motion", exact: true }).check();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const reduced = await page.evaluate(async () => { const time = cdQa.clock.currentTime, paints = cdQa.paints; await new Promise(resolve => setTimeout(resolve, 250)); return { delta: Math.abs(cdQa.clock.currentTime - time), paints: cdQa.paints - paints }; });
  assert(reduced.delta < 2 && reduced.paints === 0, `reduce motion still animates ${JSON.stringify(reduced)}`);
  await page.getByRole("checkbox", { name: "Reduce motion", exact: true }).uncheck();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const osReduced = await page.evaluate(async () => { const paints = cdQa.paints; await new Promise(resolve => setTimeout(resolve, 250)); return { state: cdQa.clock.playState, paints: cdQa.paints - paints }; });
  assert(osReduced.state === "paused" && osReduced.paints === 0, "OS reduce-motion did not stop both layers");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const budget = await page.evaluate(async () => { const before = cdQa.paints, t = performance.now(); await new Promise(resolve => setTimeout(resolve, 1100)); return { elapsed: performance.now() - t, paints: cdQa.paints - before }; });
  assert(budget.paints > 20 && budget.paints <= budget.elapsed / 1000 * 30 * 2 + 6, `two-canvas draw budget exceeded ${JSON.stringify(budget)}`);
  await page.getByRole("button", { name: "Album interaction", exact: true }).click();
  assert(await page.evaluate(() => cdFixture.clicks) === 1, "decorative canvas swallowed album clicks");
  await page.evaluate(() => { qaAudio.available = false; cdFixture.setIndex(20); });
  await page.waitForFunction(() => [...document.querySelectorAll("canvas")].every(canvas => canvas.dataset.state === "unavailable"));
  assert(await page.evaluate(() => qaAudio.requests.length) === 2, "failed lookup retried or was duplicated");
  await page.screenshot({ path: "output/playwright/cd-analysis-unavailable.png" });
  const unavailable = await page.evaluate(async () => { const before = cdQa.paints; await new Promise(resolve => setTimeout(resolve, 250)); return cdQa.paints - before; });
  assert(unavailable === 0, "unavailable analysis invented animation");
  await page.evaluate(() => { qaAudio.available = true; qaAudio.delay = 200; cdFixture.setIndex(21); });
  await page.waitForSelector('canvas[data-state="loading"]');
  await page.evaluate(() => { cdFixture.setIndex(22); });
  await page.waitForFunction(() => cdFixture.track.uri.endsWith("22") && [...document.querySelectorAll("canvas")].every(canvas => canvas.dataset.state === "ready"));
  await page.getByLabel("Presentation", { exact: true }).selectOption("compact-vinyl");
  await page.waitForSelector(".ivlyrics-compact-vinyl-stage .ivlyrics-cd-disc");
  await page.getByLabel("Presentation", { exact: true }).selectOption("vinyl");
  await page.waitForSelector(".ivlyrics-vinyl-player");
  assert(await page.locator(".qa-main .ivlyrics-cd-disc").count() === 0, "full LP mode was replaced or retained a CD canvas");
  await page.getByLabel("Presentation", { exact: true }).selectOption("video");
  await page.waitForSelector(".fullscreen-vinyl-overlay.is-presentation-video");
  await page.getByLabel("Presentation", { exact: true }).selectOption("inline");
  const responsive = [];
  for (const [width, height, theme] of [[1440, 900, "light"], [840, 800, "dark"], [390, 844, "light"]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => cdFixture.setTheme(theme), theme);
    await page.screenshot({ path: `output/playwright/cd-${width}-${theme}.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(overflow <= 1, `${width}: horizontal overflow`);
    responsive.push({ width, height, theme, overflow });
  }
  const overlayGeometry = [];
  for (const [width, height] of [[1440, 900], [1200, 720], [800, 1000], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/cd`);
    await page.waitForSelector(".qa-controls");
    if (await page.locator("details").getAttribute("open") === null) await page.getByText("CD fixture controls", { exact: true }).click();
    await page.getByLabel("Presentation", { exact: true }).selectOption("overlay");
    await page.getByLabel("Disc size", { exact: true }).press("Home");
    for (let i = 0; i < 6; i++) await page.getByLabel("Disc size", { exact: true }).press("ArrowRight");
    await page.waitForSelector(".clickable-album-container .ivlyrics-cd-size");
    const defaultCd = await page.evaluate(() => {
      const slot = document.querySelector(".clickable-album-container");
      return { slot: slot.getBoundingClientRect().width, disc: slot.querySelector(".ivlyrics-cd-disc").getBoundingClientRect().width,
        scale: cdFixture.visual["fullscreen-cd-disc-size"] };
    });
    assert(defaultCd.scale === 100, `${width}: enlargement changed the saved CD scale`);
    if (width === 1440) assert(Math.abs(defaultCd.slot - 500) < 1 && Math.abs(defaultCd.disc - 380) < 1, "default CD artwork was not enlarged by 25%");
    await page.getByLabel("Disc size", { exact: true }).press("End");
    await page.getByText("CD fixture controls", { exact: true }).click();
    await page.waitForSelector(".clickable-album-container .ivlyrics-cd-size");
    const geometry = await page.evaluate(() => {
      const album = document.querySelector(".clickable-album-container"), frame = album.querySelector(".ivlyrics-cd-size");
      const title = document.querySelector(".portrait-track-info, .lyrics-fullscreen-track-info");
      const box = node => { const { x, y, width, height, right, bottom } = node.getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
      return { portrait: matchMedia("(orientation: portrait)").matches, album: box(album), frame: box(frame), title: box(title), errors: cdFixture.errors };
    });
    assert(geometry.album.width > 0 && Math.abs(geometry.album.width - geometry.album.height) < 1, `${width}: CD slot collapsed/not square`);
    if (geometry.portrait) assert(geometry.frame.right <= geometry.title.x + 1, `${width}: enlarged portrait CD overlaps title ${JSON.stringify(geometry)}`);
    else assert(geometry.frame.bottom <= geometry.title.y + 1, `${width}: enlarged CD overlaps title ${JSON.stringify(geometry)}`);
    assert(geometry.frame.y >= 0 && geometry.title.bottom <= height, `${width}: enlarged CD or title clipped outside viewport ${JSON.stringify(geometry)}`);
    assert(geometry.errors.length === 0, `${width}: production overlay runtime error`);
    await page.locator(".clickable-album-container").hover();
    assert(await page.locator(".album-mode-hint").count() === 0, `${width}: CD still renders the LP/Research hover menu`);
    assert(await page.locator(".clickable-album-container").getAttribute("title") === null, `${width}: CD still shows a native gesture tooltip`);
    const hover = await page.locator(".clickable-album-container").evaluate(node => ({
      shadow: getComputedStyle(node).boxShadow, transform: getComputedStyle(node).transform,
    }));
    assert(hover.shadow === "none" && hover.transform === "none", `${width}: square hover card remains ${JSON.stringify(hover)}`);
    await page.screenshot({ path: `output/playwright/cd-overlay-${width}.png` });
    overlayGeometry.push({ width, height, defaultCd, ...geometry });
  }
  await page.locator(".clickable-album-container").press("Enter");
  await page.waitForFunction(() => cdFixture.overlayMode === "standard" && !document.documentElement.classList.contains("is-lp-view-transition"));
  assert(await page.locator(".album-mode-hint").count() > 0, "normal albums lost their hover menu");
  assert(await page.evaluate(() => cdFixture.errors.length) === 0, "fixture runtime errors");
  return { shapes: renders.length, paused, reduced, osReduced, budget, disabled, unavailable, responsive, overlayGeometry };
}
