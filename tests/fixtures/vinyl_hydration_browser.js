// Run only through playwright_cli.sh --session <own-session> run-code --filename.
// Uses real browser timers and production LP DOM. No Spotify or production APIs.
async (page) => {
  const origin = new URL(page.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("Use the loopback LP fixture");
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(origin + "/");
  await page.waitForFunction(() => window.fixture && window.ivLyricsActiveLyricLineRenderer);
  const results = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    window.fixture.save("reduce-motion", false);
    window.fixture.save("fullscreen-vinyl-animations", true);
    window.fixture.save("fullscreen-vinyl-track-change-animation", true);
    window.qaRead = () => {
      const root = document.querySelector(".fullscreen-vinyl-overlay");
      const phase = [...(root?.classList || [])].find(value => value.startsWith("is-track-")) || "idle";
      const image = selector => {
        const node = document.querySelector(selector);
        const src = node?.getAttribute("src");
        return node ? { src: src?.startsWith("data:") ? "[local SVG data URI]" : src, complete: node.complete, naturalWidth: node.naturalWidth } : null;
      };
      return { phase, title: document.getElementById("ivlyrics-vinyl-current-title")?.textContent,
        incomingTitle: document.getElementById("ivlyrics-vinyl-incoming-title")?.textContent || null,
        art: image(".ivlyrics-vinyl-sleeve img"), incomingArt: image(".ivlyrics-vinyl-incoming-sleeve img") };
    };
    window.qaWatch = () => {
      window.qaObserver?.disconnect();
      window.qaEvents = [];
      const started = performance.now();
      let previous = "";
      window.qaObserver = new MutationObserver(() => {
        const state = window.qaRead(), signature = JSON.stringify(state);
        if (signature !== previous) window.qaEvents.push({ ms: +(performance.now() - started).toFixed(1), ...state });
        previous = signature;
      });
      window.qaObserver.observe(document.getElementById("root"), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "src"] });
    };
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: "steady-1280.png" });
  const transition = async (index, patch, hydrate = false) => {
    await page.evaluate(({ index, patch, hydrate }) => {
      window.fixture.overrideTrack(index, patch);
      window.fixture.setIndex(index);
      window.qaWatch();
      if (hydrate) {
        window.qaHydrated = null;
        const observer = new MutationObserver(() => {
          if (window.qaRead().phase !== "is-track-handoff") return;
          observer.disconnect();
          const at = performance.now();
          window.fixture.overrideTrack(index, { title: "HYDRATED DURING HANDOFF", coverUrl: "/qa-art.svg?hydrated=1" });
          const verify = new MutationObserver(() => {
            const state = window.qaRead();
            if (state.title !== "HYDRATED DURING HANDOFF" || state.incomingTitle !== "HYDRATED DURING HANDOFF") return;
            window.qaHydrated = { afterHandoffMs: +(performance.now() - at).toFixed(1), ...state };
            verify.disconnect();
          });
          verify.observe(document.getElementById("root"), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["src"] });
        });
        observer.observe(document.getElementById("root"), { subtree: true, attributes: true, attributeFilter: ["class"] });
      }
    }, { index, patch, hydrate });
    await page.waitForFunction(() => window.qaRead().phase === "is-track-album-arriving");
    await page.screenshot({ path: `flight-${index}-1280.png` });
    if (hydrate) {
      await page.waitForFunction(() => window.qaHydrated !== null, null, { timeout: 5000 });
      await page.screenshot({ path: "handoff-hydrated-1280.png" });
    }
    await page.waitForFunction(() => window.qaRead().phase === "idle" && !window.qaRead().incomingTitle);
    return page.evaluate(() => ({ final: window.qaRead(), events: window.qaEvents, hydrated: window.qaHydrated }));
  };
  const delayed = await transition(2, { title: "DELAYED IMAGE TRACK", coverUrl: "/qa-art.svg?delay=12000&id=delayed" });
  check(delayed.final.title === "DELAYED IMAGE TRACK", "Delayed image prevented track commit");
  check(!delayed.final.art.complete, "Delayed image unexpectedly completed before transition");
  check(delayed.events.some(event => event.phase === "is-track-handoff"), "Delayed image skipped handoff");
  results.push({ case: "delayed image", ...delayed });
  const failed = await transition(3, { title: "FAILED IMAGE TRACK", coverUrl: "/qa-art.svg?fail=1" });
  check(failed.final.title === "FAILED IMAGE TRACK" && failed.final.art.naturalWidth === 0, "Failed image did not settle on new track");
  results.push({ case: "failed image", ...failed });
  const hydrated = await transition(4, { title: "BEFORE HYDRATION", coverUrl: "/qa-art.svg?delay=12000&id=hydrate" }, true);
  check(hydrated.hydrated?.phase === "is-track-handoff", "Hydration cancelled handoff");
  check(hydrated.hydrated.art.src === hydrated.hydrated.incomingArt.src, "Both handoff artwork copies did not hydrate");
  check(hydrated.final.title === "HYDRATED DURING HANDOFF", "Stale title after hydration");
  results.push({ case: "same URI hydration in final handoff", ...hydrated });
  await page.evaluate(() => {
    window.qaWatch();
    window.fixture.setIndex(5);
    setTimeout(() => { window.fixture.overrideTrack(5, { title: "STALE FIVE" }); window.fixture.setIndex(6); }, 150);
    setTimeout(() => window.fixture.setIndex(7), 300);
  });
  await page.waitForFunction(() => window.qaRead().phase === "idle" && window.qaRead().title?.includes("7"));
  await page.waitForTimeout(400);
  const rapid = await page.evaluate(() => ({ final: window.qaRead(), events: window.qaEvents }));
  check(!rapid.events.some(event => event.title === "STALE FIVE"), "Cancelled track committed stale title");
  results.push({ case: "rapid skips", ...rapid });
  await page.evaluate(() => {
    window.qaWatch();
    window.fixture.setIndex(8);
    setTimeout(() => window.fixture.setIndex(7), 180);
  });
  await page.waitForTimeout(3700);
  const returned = await page.evaluate(() => ({ final: window.qaRead(), events: window.qaEvents }));
  check(returned.final.phase === "idle" && returned.final.title.includes("7") && !returned.final.incomingTitle, "Return to outgoing committed stale track");
  results.push({ case: "return to outgoing", ...returned });
  await page.evaluate(() => {
    window.qaWatch();
    window.fixture.setIndex(8);
    setTimeout(() => window.fixture.overrideTrack(8, { title: "LATE STALE EIGHT", coverUrl: "/qa-art.svg?late=8" }), 2200);
    setTimeout(() => window.fixture.setIndex(7), 2350);
  });
  await page.waitForTimeout(5900);
  const lateReturn = await page.evaluate(() => ({ final: window.qaRead(), events: window.qaEvents }));
  check(lateReturn.final.phase === "idle" && lateReturn.final.title.includes("7") &&
    !lateReturn.events.some(event => event.title === "LATE STALE EIGHT"), "Late return committed stale metadata");
  results.push({ case: "late hydration then return to outgoing", ...lateReturn });
  await page.screenshot({ path: "final-1280.png" });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.screenshot({ path: "final-900.png" });
  const geometry = await page.evaluate(() => {
    const selectors = [".fullscreen-vinyl-overlay", ".ivlyrics-vinyl-record-shell", ".ivlyrics-vinyl-sleeve", ".qa-controls"];
    return selectors.map(selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { selector, x: r.x, y: r.y, width: r.width, height: r.height }; });
  });
  const lyrics = await page.evaluate(async () => {
    const host = document.createElement("div");
    host.id = "qa-active-lyric";
    Object.assign(host.style, { position: "fixed", bottom: "130px", left: "20px", width: "560px", background: "#20212d", color: "white", zIndex: "9999", fontSize: "30px", padding: "12px" });
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    let lines = [{ text: "漢字の歌", originalText: "漢字の歌", phoneticText: "kanji no uta", translationText: "A song", startTime: 1000, endTime: 11000 }];
    let revision = 0;
    const states = [];
    const render = label => {
      ReactDOM.flushSync(() => root.render(React.createElement(window.ivLyricsActiveLyricLineRenderer,
        { lyrics: lines, activeLineIndex: 0, positionOverride: 2500 + states.length * 10, settingsRevision: revision, motionEnabled: false })));
      states.push({ label, text: host.textContent, ruby: host.querySelectorAll("ruby").length, counts: { ...window.qaLyricPreparations } });
    };
    render("initial");
    render("playback tick");
    if (states[0].counts.display !== states[1].counts.display) throw new Error("Playback tick recomputed cached lyric display");
    window.CONFIG.visual["translate:display-mode"] = "replace";
    render("replace display");
    window.CONFIG.visual["translate:display-mode"] = "below";
    window.CONFIG.visual["furigana-enabled"] = true;
    render("furigana pending");
    window.qaLyricState.ready = true;
    render("furigana ready");
    window.qaLyricState.locale = "zh";
    render("locale changed");
    lines[0].translationText = "Revised meaning"; revision++;
    render("mutated supplement with revision");
    lines = [{ ...lines[0], text: "新しい歌", originalText: "新しい歌", phoneticText: "new reading" }];
    render("new source identity");
    window.qaLyricRoot = root;
    return states.filter(state => state.label !== "playback tick");
  });
  check(lyrics[0].text.includes("漢字の歌") && lyrics[0].text.includes("A song"), "Initial production lyric missing");
  check(!lyrics[1].text.includes("漢字の歌") && lyrics[1].text.includes("kanji no uta"), "Display-mode cache did not refresh");
  check(lyrics[2].ruby === 0 && lyrics[3].ruby > 0 && lyrics[4].ruby === 0, "Furigana readiness or language did not invalidate display cache");
  check(lyrics[5].text.includes("Revised meaning") && lyrics[6].text.includes("新しい歌") && lyrics[6].text.includes("new reading"), "Source/supplement cache did not invalidate");
  await page.screenshot({ path: "lyric-source-refresh-900.png" });
  await page.evaluate(() => window.qaObserver?.disconnect());
  check(errors.length === 0, errors.join("\n"));
  const report = { results, geometry, lyrics, pageErrors: errors };
  await page.evaluate(report => {
    window.qaReport = report;
    console.log("VINYL_QA_RESULTS=" + JSON.stringify(report));
  }, report);
  return report;
}
