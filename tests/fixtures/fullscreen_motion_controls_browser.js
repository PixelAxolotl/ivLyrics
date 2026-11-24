// Actual production overlay + production player controls, motion presentation.
// Run against settings_hotfix_server.mjs with playwright-cli run-code --filename.
async page => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("Use the offline Settings fixture");
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  page.setDefaultTimeout(7000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/?language=en&theme=dark&tab=fullscreen`);
  await page.waitForFunction(() => settingsFixture.state.ready);
  await page.addScriptTag({ url: origin + "/VinylPlayerMode.js" });
  await page.addScriptTag({ url: origin + "/PlaylistPicker.js" });
  await page.addScriptTag({ url: origin + "/FullscreenOverlay.js" });
  await page.evaluate(() => {
    window.ivLyricsCloseConfig?.(true);
    const container = document.createElement("div");
    container.id = "motion-controls-runtime";
    container.style.cssText = "position:fixed;inset:0;color:#fff;--spice-text:#fff;--spice-main:#17191d;--lyrics-color-active:#fff;--lyrics-color-inactive:rgba(255,255,255,.7);--lyrics-align-text:center;--lyrics-original-font-size:36px;";
    document.body.append(container);
    const root = ReactDOM.createRoot(container);
    const art = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#335976"/><circle cx="250" cy="180" r="160" fill="#cf794f"/><path d="M0 350 400 120v280H0" fill="#222d50"/></svg>');
    Object.assign(Spicetify.Player.data.item.metadata, { title: "Sample song", artist_name: "Sample artist", album_title: "Sample album", image_url: art });
    Spicetify.Player.data.item.duration = { milliseconds: 240000 };
    Spicetify.Player.getProgress = () => 90000;
    Spicetify.Player.getDuration = () => 240000;
    Utils.getTrackArtwork = item => item?.metadata?.image_url || art;
    Spicetify.Platform.RootlistAPI = { getContents: async () => ({ items: Array.from({ length: 12 }, (_, index) => ({
      type: "playlist", uri: `spotify:playlist:offline${index}`, name: `Offline playlist ${index + 1}`, isOwnedBySelf: true,
    })) }) };
    Spicetify.Platform.PlaylistAPI = {
      getMetadata: async () => null,
      getContents: async () => ({ items: [{ uri: "spotify:track:offlineSettingsFixture" }] }),
    };
    for (const name of ["heart", "heart-active", "shuffle", "play", "pause", "skip-back", "skip-forward", "repeat", "repeat-once", "volume-one-wave", "volume-two-wave", "volume-off"]) {
      Spicetify.SVGIcons[name] = '<path d="M4 3 13 8 4 13Z"/>';
    }
    let revision = 0;
    const render = presentation => {
      settingsFixture.setConfig({ ...settingsFixture.defaults,
        "fullscreen-controls-position": "bottom", "fullscreen-auto-hide-ui": false,
        "fullscreen-show-controls": true, "fullscreen-show-progress": true,
        "fullscreen-show-volume": true, "fullscreen-controls-background": true,
        "fullscreen-control-button-size": 48, "fullscreen-show-clock": false,
        "fullscreen-show-context": false, "fullscreen-show-next-track": false,
        "fullscreen-show-queue": false, "fullscreen-two-column": true,
        "fullscreen-show-album-name": false, "fullscreen-cd-visualizer-enabled": false });
      container.className = "lyrics-lyricsContainer-LyricsContainer fullscreen-active fullscreen-page-ui";
      ReactDOM.flushSync(() => root.render(React.createElement(FullscreenOverlay, {
        isFullscreen: true, coverUrl: art, title: "Sample song", artist: "Sample artist",
        currentLyricIndex: 2, totalLyrics: 12,
        activeLyric: "A long lyric line stays clear of the playback controller",
        trackUri: "spotify:track:offlineSettingsFixture",
        lyricsSettingsRevision: ++revision, presentationMode: presentation,
      })));
    };
    window.motionControlsRuntime = {
      renderMotion() { render("motion"); },
      renderStandard() { render("standard"); },
      cleanup() { root.unmount(); container.remove(); },
    };
  });

  const surfaceState = () => page.evaluate(() => {
    const node = document.querySelector("#motion-controls-runtime .fullscreen-motion-controls .fullscreen-player-controls");
    if (!node) return null;
    const style = getComputedStyle(node);
    return { visibility: style.visibility, opacity: parseFloat(style.opacity), pointerEvents: style.pointerEvents };
  });
  const waitRevealed = revealed => page.waitForFunction(expected => {
    const node = document.querySelector("#motion-controls-runtime .fullscreen-motion-controls .fullscreen-player-controls");
    if (!node) return false;
    const style = getComputedStyle(node);
    return expected
      ? style.visibility === "visible" && parseFloat(style.opacity) > 0.99 && style.pointerEvents === "auto"
        && (style.transform === "none" || style.transform === "matrix(1, 0, 0, 1, 0, 0)")
      : style.visibility === "hidden" && parseFloat(style.opacity) === 0;
  }, revealed);

  const results = [];
  try {
    await page.evaluate(() => motionControlsRuntime.renderMotion());
    await page.waitForFunction(() => document.querySelector("#motion-controls-runtime .fullscreen-motion-controls .fullscreen-player-controls"));
    await page.mouse.move(720, 300);
    await waitRevealed(false);

    const metrics = await page.evaluate(() => {
      const host = document.getElementById("motion-controls-runtime");
      const bar = host.querySelector(".fullscreen-motion-controls");
      const surface = bar.querySelector(".fullscreen-player-controls");
      const rect = node => { const { left, right, top, bottom, width, height } = node.getBoundingClientRect(); return { left, right, top, bottom, width, height }; };
      const tree = node => ({ tag: node.tagName, cls: node.className, children: [...node.children].map(tree) });
      return {
        bar: rect(bar), surface: rect(surface),
        stageDock: !!host.querySelector(".fullscreen-stage-controls-dock"),
        play: !!surface.querySelector(".fullscreen-control-play"),
        progress: !!surface.querySelector(".fullscreen-progress-bar"),
        volume: !!surface.querySelector(".fullscreen-volume-wrapper"),
        tree: tree(surface),
        playSize: rect(surface.querySelector(".fullscreen-control-play")),
      };
    });
    assert(!metrics.stageDock, "motion still renders the stage dock");
    assert(metrics.play && metrics.progress && metrics.volume, `motion bar is missing the standard controls ${JSON.stringify(metrics)}`);
    assert(Math.abs(metrics.bar.left - 24) <= 1, `motion bar is not bottom-left: ${JSON.stringify(metrics.bar)}`);
    assert(Math.abs(metrics.bar.bottom - 876) <= 1, `motion bar is not at the bottom edge: ${JSON.stringify(metrics.bar)}`);
    assert(Math.abs(metrics.surface.left - 24) <= 1, `motion controls do not start at the dock position: ${JSON.stringify(metrics.surface)}`);

    await page.mouse.move(60, 870);
    await waitRevealed(true);
    const revealed = await surfaceState();
    assert(revealed.visibility === "visible" && revealed.opacity > 0.99, `hover did not reveal the motion controls: ${JSON.stringify(revealed)}`);
    const stillAnchored = await page.evaluate(() => {
      const node = document.querySelector("#motion-controls-runtime .fullscreen-motion-controls .fullscreen-player-controls");
      const { left, bottom } = node.getBoundingClientRect();
      return { left, bottom };
    });
    assert(Math.abs(stillAnchored.left - 24) <= 1 && Math.abs(stillAnchored.bottom - 876) <= 1,
      `revealed controls moved away from bottom-left: ${JSON.stringify(stillAnchored)}`);

    await page.evaluate(() => { window.__motionPlayClicks = 0; Spicetify.Player.togglePlay = () => { window.__motionPlayClicks += 1; }; });
    await page.locator("#motion-controls-runtime .fullscreen-motion-controls .fullscreen-control-play").click();
    assert(await page.evaluate(() => window.__motionPlayClicks) === 1, "motion play button did not reach playback");

    await page.mouse.move(720, 300);
    await waitRevealed(false);
    assert((await surfaceState()).visibility === "hidden", "motion controls stayed visible after the pointer left");

    await page.evaluate(() => motionControlsRuntime.renderStandard());
    await page.waitForFunction(() => document.querySelector("#motion-controls-runtime .fullscreen-bottom:not(.fullscreen-motion-controls) .fullscreen-player-controls"));
    const standard = await page.evaluate(() => {
      const surface = document.querySelector("#motion-controls-runtime .fullscreen-bottom:not(.fullscreen-motion-controls) .fullscreen-player-controls");
      const rect = node => { const { left, right, top, bottom, width, height } = node.getBoundingClientRect(); return { left, right, top, bottom, width, height }; };
      const tree = node => ({ tag: node.tagName, cls: node.className, children: [...node.children].map(tree) });
      return { tree: tree(surface), playSize: rect(surface.querySelector(".fullscreen-control-play")),
        buttons: surface.querySelectorAll("button").length };
    });
    assert(JSON.stringify(standard.tree) === JSON.stringify(metrics.tree), "motion and standard render different player control trees");
    assert(Math.abs(standard.playSize.width - metrics.playSize.width) <= 1 && Math.abs(standard.playSize.height - metrics.playSize.height) <= 1,
      `motion and standard play buttons differ: ${JSON.stringify({ motion: metrics.playSize, standard: standard.playSize })}`);
    results.push({ anchored: metrics.bar, play: metrics.playSize, buttons: standard.buttons });

    await page.setViewportSize({ width: 600, height: 800 });
    await page.evaluate(() => motionControlsRuntime.renderMotion());
    await page.mouse.move(300, 400);
    await page.waitForFunction(() => document.querySelector("#motion-controls-runtime .fullscreen-motion-controls"));
    await page.mouse.move(60, 780);
    await waitRevealed(true);
    const narrow = await page.evaluate(() => {
      const bar = document.querySelector("#motion-controls-runtime .fullscreen-motion-controls");
      const surface = bar.querySelector(".fullscreen-player-controls");
      const style = getComputedStyle(surface);
      const { left, width } = bar.getBoundingClientRect();
      return { left, width, surfaceWidth: surface.getBoundingClientRect().width, padding: style.padding };
    });
    assert(Math.abs(narrow.left - 16) <= 1 && Math.abs(narrow.width - 568) <= 1,
      `narrow motion bar is not inset 16px: ${JSON.stringify(narrow)}`);
    assert(Math.abs(narrow.surfaceWidth - 568) <= 1 && narrow.padding === "12px 14px",
      `narrow motion surface did not fit the bar: ${JSON.stringify(narrow)}`);
    results.push({ narrow });

    const reported = await page.evaluate(() => ({
      errors: [...settingsFixture.state.errors],
      blockedNetwork: [...settingsFixture.state.blockedNetwork],
    }));
    assert(reported.errors.length === 0 && reported.blockedNetwork.length === 0,
      `fixture reported page errors or blocked requests: ${JSON.stringify(reported)}`);
  } finally {
    await page.evaluate(() => motionControlsRuntime.cleanup());
  }
  return results;
}
