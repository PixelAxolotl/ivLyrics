// Check real IndexedDB reloads, artwork pixels and visible caption expiry.
async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  assert(new URL(origin).hostname === "127.0.0.1", "Use the loopback CD fixture");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/cd`);
  await page.getByLabel("Color mode", { exact: true }).selectOption("album");
  await page.getByRole("checkbox", { name: "Album gradient", exact: true }).check();
  await page.waitForSelector('canvas[data-state="ready"]');
  const palette = await page.evaluate(() => ivLyricsCdVisualizer.loadPalette(cdFixture.track.coverUrl));
  assert(palette?.length >= 2, "artwork did not yield distinct real colors");
  await page.screenshot({ path: "output/playwright/cd-album-gradient-default.png" });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await settle();
  const colorRange = () => page.evaluate(() => {
    const canvas = document.querySelector(".qa-main canvas");
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const min = [255, 255, 255], max = [0, 0, 0];
    let opaque = 0;
    // The paused ring intentionally uses 20% opacity; ignore only its AA edge.
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 48) {
      opaque++;
      for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], data[i + c]); max[c] = Math.max(max[c], data[i + c]); }
    }
    return { opaque, range: Math.max(...max.map((value, i) => value - min[i])) };
  });
  const gradient = await colorRange();
  assert(gradient.opaque > 100 && gradient.range > 30, `multicolor radial paint is missing ${JSON.stringify(gradient)}`);
  await page.getByRole("checkbox", { name: "Album gradient", exact: true }).uncheck();
  await settle();
  const solid = await colorRange();
  assert(solid.opaque > 100 && solid.range < 8, `gradient OFF is not a single album color ${JSON.stringify(solid)}`);
  await page.getByRole("checkbox", { name: "Album gradient", exact: true }).check();
  const unique = Math.floor(Date.now() / 10);
  const first = await page.evaluate(index => {
    const before = qaAudio.requests.length;
    qaAudio.available = true; cdFixture.setIndex(index);
    return before;
  }, unique);
  await page.waitForFunction(index => cdFixture.track.uri.endsWith(String(index)) && [...document.querySelectorAll("canvas")].every(canvas => canvas.dataset.state === "ready"), unique);
  assert(await page.evaluate(before => qaAudio.requests.length - before, first) === 1, "two canvases duplicated Spotify lookup");
  await page.reload();
  await page.waitForSelector('canvas[data-state="ready"]');
  const reloaded = await page.evaluate(index => {
    const before = qaAudio.requests.length;
    qaAudio.available = false;
    cdFixture.setIndex(index);
    return before;
  }, unique);
  await page.waitForFunction(index => cdFixture.track.uri.endsWith(String(index)) && [...document.querySelectorAll("canvas")].every(canvas => canvas.dataset.state === "ready"), unique);
  const repeatRequests = await page.evaluate(before => qaAudio.requests.length - before, reloaded);
  assert(repeatRequests === 0, "a full reload requested Spotify instead of durable analysis");
  await page.evaluate(index => cdFixture.setIndex(index + 1), unique);
  await page.waitForFunction(() => document.querySelector(".qa-main canvas")?.dataset.state === "unavailable");
  const caption = page.locator(".qa-main .ivlyrics-cd-status");
  assert(await caption.isVisible(), "failure caption never appeared");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".qa-main .ivlyrics-cd-status")).visibility === "hidden");
  assert(!await caption.isVisible(), "failure caption remained below the CD");
  await page.getByLabel("Shape", { exact: true }).selectOption("line");
  assert(!await caption.isVisible(), "a settings update repeated the dismissed failure notice");
  assert(await page.evaluate(() => cdFixture.errors.length) === 0, "production CD runtime errors");
  return { palette, gradient, solid, repeatRequests, failureCaption: "dismissed after 3.2 s with fade" };
}
