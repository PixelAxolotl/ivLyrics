import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../FullscreenOverlay.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const normalize = value => value.trim().replace(/\s+/g, " ");
const rules = [...styles.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selectors, body]) => ({
    selectors: selectors.split(",").map(normalize),
    declarations: [...body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)]
      .map(([, key, value]) => [key, normalize(value)]),
  }));
const declarations = selector => Object.fromEntries(rules
  .filter(rule => rule.selectors.includes(selector)).flatMap(rule => rule.declarations));
const bound = "--iv-fullscreen-controller-max-width";
const left = ".fullscreen-left-controls";
const controller = `${left} > .fullscreen-player-controls`;
const start = source.indexOf("        const renderLeftPanel =");
const end = source.indexOf("        const renderTopRightOverlay =", start);
assert.ok(start >= 0 && end > start, "exercise the production under-album renderer");

function render(overrides = {}) {
  const context = vm.createContext({
    react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    uiVisible: true, showControlsInLeftPanel: true, tmiMode: false,
    setAlbumLyricsPanelRef() {}, setControllerHeightRef() {}, infoGap: 24, showAlbum: true,
    albumSize: 400, cdAlbumActive: false, cdScale: 1, albumRadius: 12,
    albumInteractionProps: {}, cdSlotStyle: {}, albumShadow: true,
    renderAlbumVisual() {}, renderAlbumModeHint() {}, showInfoInOverlay: false,
    showProgress: true, showControls: true, ProgressBar: "ProgressBar",
    PlayerControls: "PlayerControls", leftPanelShowVolume: true,
    leftPanelControlButtonSize: 36, leftPanelControlsBackground: true,
    leftPlayerControlsClass: "fullscreen-left-controls left-controls-player",
    leftProgressOnlyClass: "fullscreen-left-controls left-controls-progress-only",
    ...overrides,
  });
  return vm.runInContext(`${source.slice(start, end)}\nrenderLeftPanel();`, context);
}
const elements = node => Array.isArray(node) ? node.flatMap(elements)
  : node?.props ? [node, ...elements(node.props.children)] : [];
const findClass = (tree, name) => elements(tree).find(node => node.props.className?.split(" ").includes(name));

test("the background fits its contents with padding inside the available width", () => {
  const css = declarations(controller);
  assert.equal(css.width, "fit-content");
  assert.equal(css["box-sizing"], "border-box");
  assert.equal(css["min-width"], "0", "override the shared 350px minimum");
  assert.equal(css["max-width"], "100%");
  assert.equal(css["flex-shrink"], "0", "wrapped rows must not lose their background height");
  assert.equal(css["padding-inline"], "clamp(4px, 4%, 20px)", "small CDs retain room for actual button targets");
  assert.equal(declarations(".fullscreen-player-controls.with-background").padding, "16px 20px");
});

test("the album column can shrink and the controller respects both album and column bounds", () => {
  for (const selector of [".lyrics-fullscreen-left-panel", ".lyrics-fullscreen-left-content", left]) {
    assert.equal(declarations(selector)["min-width"], "0", selector);
  }
  assert.equal(declarations(left)["max-width"], `min(100%, var(${bound}, 100%))`);
  assert.equal(declarations(left)["align-items"], "center", "centering works on either side of the lyrics");
  assert.equal(declarations(".lyrics-lyricsContainer-LyricsContainer.fullscreen-active.layout-reversed").direction, "rtl");
  assert.equal(declarations(".lyrics-lyricsContainer-LyricsContainer.fullscreen-active.layout-reversed>*").direction, "ltr");
});

test("small covers and scaled CDs provide their visible width without constraining an absent album", () => {
  for (const [albumSize, cdAlbumActive, cdScale, expected] of [
    [400, false, 1, "400px"], [200, false, 1, "200px"],
    [320, true, 0.7, "224px"], [500, true, 1.4, "700px"],
    [100, true, 0.7, "70px"],
  ]) {
    const tree = render({ albumSize, cdAlbumActive, cdScale });
    assert.equal(findClass(tree, "lyrics-fullscreen-left-content").props.style[bound], expected);
  }
  assert.equal(findClass(render({ showAlbum: false }), "lyrics-fullscreen-left-content").props.style[bound], undefined);
});

test("configured button sizes wrap without shrinking or clipping the playlist popover", () => {
  assert.equal(declarations(`${left} .fullscreen-control-main-row`)["flex-wrap"], "wrap");
  for (const selector of [`${left} .fullscreen-control-btn`, `${left} .fullscreen-playlist-control`]) {
    assert.equal(declarations(selector)["flex-shrink"], "0", selector);
    assert.equal(declarations(selector)["box-sizing"], "border-box", selector);
  }
  assert.equal(declarations(left).overflow, "visible");
  assert.equal(declarations(`${left}:has(.fullscreen-playlist-popover)`).overflow, "visible");
  const volume = declarations(`${left} .fullscreen-volume-wrapper`);
  assert.equal(volume["max-width"], "100%");
  assert.equal(volume["flex-wrap"], "wrap", "the transient volume percentage stays within the controller");
});

test("volume, progress, background and 28-48px button preferences still reach the player", () => {
  for (const buttonSize of [28, 36, 48]) for (const showVolume of [false, true]) {
    for (const showProgress of [false, true]) for (const showBackground of [false, true]) {
      const tree = render({ leftPanelControlButtonSize: buttonSize,
        leftPanelShowVolume: showVolume, showProgress, leftPanelControlsBackground: showBackground });
      const player = elements(tree).find(node => node.type === "PlayerControls");
      assert.equal(player.props.buttonSize, buttonSize);
      assert.equal(player.props.showVolume, showVolume);
      assert.equal(player.props.showBackground, showBackground);
      assert.equal(elements(tree).some(node => node.type === "ProgressBar"), showProgress);
    }
  }
  const progressOnly = render({ showControlsInLeftPanel: false, showControls: false });
  assert.ok(findClass(progressOnly, "left-controls-progress-only"));
  assert.equal(elements(progressOnly).some(node => node.type === "PlayerControls"), false);
});

test("coarse pointers keep 44px touch targets without reducing the configured buttons", () => {
  assert.match(styles, /@media\s*\(pointer:\s*coarse\)\s*\{\s*\.fullscreen-left-controls \.fullscreen-control-btn\s*\{\s*min-width:\s*44px;\s*min-height:\s*44px;/);
});

test("hide animations and the separate portrait, bottom and TV layouts retain their owners", () => {
  for (const selector of [`${left}.hidden`, `.lyrics-fullscreen-left-panel.controls-hidden ${left}`]) {
    const css = declarations(selector);
    assert.equal(css.opacity, "0", selector);
    assert.equal(css["max-height"], "0", selector);
    assert.equal(css["pointer-events"], "none", selector);
    assert.match(css.transform, /translateY\(var\(--iv-motion-distance-md\)\) scale\(0\.985\)/);
  }
  assert.match(declarations(left).transition, /max-height var\(--iv-motion-duration-slow\)/);
  assert.ok(findClass(render({ uiVisible: false }), "controls-hidden"));
  assert.equal(declarations(".portrait-overlay-bottom .fullscreen-player-controls").width, "100%");
  assert.equal(declarations(".portrait-overlay-bottom .fullscreen-player-controls.with-background").background, "transparent !important");
  assert.equal(declarations(".fullscreen-bottom").position, "fixed");
  assert.equal(declarations(".fullscreen-tv-controls").display, "flex");
  assert.equal(source.slice(start, end).match(/"--iv-fullscreen-controller-max-width"/g)?.length, 1,
    "the under-album content publishes its album width bound");
});

test("an oversized album stack scrolls from its top instead of hiding its first or last controls", () => {
  const panel = declarations(".lyrics-fullscreen-left-panel:has(.left-controls-player)");
  assert.equal(panel["overflow-y"], "auto");
  assert.equal(panel["justify-content"], "flex-start");
  assert.equal(declarations(".lyrics-fullscreen-left-panel")["min-height"], "0",
    "the grid row must stay bounded by the fullscreen viewport");
  const content = declarations(".lyrics-fullscreen-left-panel:has(.left-controls-player) > .lyrics-fullscreen-left-content");
  assert.equal(content["margin-block"], "auto", "positive free space still centers the stack");
  assert.equal(content["flex-shrink"], "0", "overflow is scrollable rather than compressed over the metadata");
});

function heightHarness({ resizeObserver = true } = {}) {
  const frames = new Map(), resizes = [], mutations = [], listeners = new Map();
  const properties = new Map(), writes = [], cancelled = [];
  let nextFrame = 0;
  const progress = { offsetHeight: 18, css: { marginBottom: "12px" } };
  const controls = { offsetHeight: 280, css: {} };
  const container = {
    isConnected: true, offsetHeight: 0, children: [progress, controls], css: {},
    style: {
      getPropertyValue: name => properties.get(name) || "",
      setProperty(name, value) { properties.set(name, value); writes.push([name, value]); },
      removeProperty: name => properties.delete(name),
    },
    getBoundingClientRect() { assert.fail("hidden transforms must not affect the measured collapse height"); },
  };
  const view = {
    getComputedStyle: node => node.css,
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { cancelled.push(id); frames.delete(id); },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
    MutationObserver: class {
      targets = [];
      constructor(callback) { this.callback = callback; mutations.push(this); }
      observe(node, options) { this.targets.push([node, options]); }
      disconnect() { this.targets = []; }
    },
  };
  if (resizeObserver) view.ResizeObserver = class {
    targets = new Set();
    constructor(callback) { this.callback = callback; resizes.push(this); }
    observe(node) { this.targets.add(node); }
    disconnect() { this.targets.clear(); }
  };
  const from = source.indexOf("    const observeFullscreenControllerHeight =");
  const to = source.indexOf("    // Center standard fullscreen lyrics", from);
  assert.ok(from >= 0 && to > from);
  const context = vm.createContext({ window: view, container });
  const stop = vm.runInContext(`${source.slice(from, to)}\nobserveFullscreenControllerHeight(container);`, context);
  return {
    frames, resizes, mutations, listeners, properties, writes, cancelled, progress, controls, container, stop,
    height: () => properties.get("--iv-fullscreen-controls-height"),
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
  };
}

test("wrapped controls reserve their full height before paint even above the old 228px limit", () => {
  const h = heightHarness();
  assert.equal(h.height(), "310px");
  assert.equal(h.frames.size, 0, "initial attachment measures synchronously");
  assert.deepEqual([...h.resizes[0].targets], [h.progress, h.controls]);
  assert.equal(h.mutations[0].targets[0][0], h.container);
  assert.deepEqual({ ...h.mutations[0].targets[0][1] }, { childList: true },
    "nested playlist/lyric mutations must not drive the height observer");
  for (const selector of [`${left} > .fullscreen-progress-container`, `${left} > .fullscreen-progress-standalone`]) {
    assert.equal(declarations(selector)["flex-shrink"], "0");
  }
  h.stop();
});

test("width, button and volume changes coalesce and can reduce the collapse height again", () => {
  const h = heightHarness();
  h.controls.offsetHeight = 128;
  for (let i = 0; i < 30; i++) h.resizes[0].callback();
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.equal(h.height(), "158px", "small rows must not retain a stale large maximum");
  h.resizes[0].callback(); h.flush();
  assert.equal(h.writes.length, 2, "identical geometry does not rewrite CSS");
  h.stop();
});

test("progress insertion/removal rebinds children without losing or clipping pending height changes", () => {
  const h = heightHarness();
  h.resizes[0].callback();
  h.container.children = [h.controls];
  h.mutations[0].callback();
  assert.equal(h.height(), "280px");
  assert.equal(h.frames.size, 0, "child replacement cancels the older scheduled measurement");
  assert.deepEqual([...h.resizes[0].targets], [h.controls]);
  h.container.children = [h.progress, h.controls];
  h.mutations[0].callback();
  assert.equal(h.height(), "310px");
  h.stop();
});

test("unmount cancels work, disconnects and ignores late observer callbacks", () => {
  const h = heightHarness();
  h.resizes[0].callback();
  const stale = [...h.frames.values()][0];
  h.stop();
  h.resizes[0].callback(); h.mutations[0].callback(); stale();
  assert.equal(h.frames.size, 0);
  assert.equal(h.properties.size, 0);
  assert.equal(h.resizes[0].targets.size, 0);
  assert.equal(h.mutations[0].targets.length, 0);
  assert.equal(h.writes.length, 1);
});

test("older hosts can remeasure on resize without polling", () => {
  const h = heightHarness({ resizeObserver: false });
  assert.deepEqual([...h.listeners.keys()], ["resize"]);
  h.controls.offsetHeight = 340;
  h.listeners.get("resize")(); h.flush();
  assert.equal(h.height(), "370px");
  h.container.isConnected = false;
  h.controls.offsetHeight = 400;
  h.listeners.get("resize")(); h.flush();
  assert.equal(h.height(), "370px");
  h.stop();
  assert.equal(h.listeners.size, 0);
});
