import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../VinylPlayerMode.js", import.meta.url), "utf8");
const first = { uri: "spotify:track:one", title: "First", artist: "Artist", album: "Album", coverUrl: "one.png" };
const second = { ...first, uri: "spotify:track:two", title: "Second", coverUrl: "two.png" };
const elements = node => Array.isArray(node) ? node.flatMap(elements)
  : node && typeof node === "object" && "type" in node ? [node, ...elements(node.props.children)] : [];

const createHarness = ({ component = "Mode", reducedMotion = false, clocks = [], ...initialProps } = {}) => {
  const slots = [], mediaListeners = new Set(), timers = new Map();
  let cursor = 0, dirty = false, effects = [], tree, now = 0, timerId = 0;
  let props = { track: first, isPlaying: true, vinylSettings: {}, ...initialProps };
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const useMemo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const useState = initial => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
    return [slots[index].value, next => {
      const value = typeof next === "function" ? next(slots[index].value) : next;
      if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
    }];
  };
  const useEffect = (effect, deps) => {
    const index = cursor++;
    if (!slots[index] || !sameDeps(slots[index].deps, deps)) effects.push(() => {
      slots[index]?.cleanup?.();
      slots[index] = { deps, cleanup: effect() };
    });
  };
  const react = {
    useState, useMemo, useEffect, useLayoutEffect: useEffect,
    useCallback: (callback, deps) => useMemo(() => callback, deps),
    useRef: current => useMemo(() => ({ current }), []),
    memo: fn => fn,
    createElement: (type, elementProps, ...children) => ({ type, props: { ...elementProps, children } }),
  };
  const media = {
    matches: reducedMotion,
    addEventListener: (_, callback) => mediaListeners.add(callback),
    removeEventListener: (_, callback) => mediaListeners.delete(callback),
  };
  const window = {
    matchMedia: () => media,
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, due: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => window.setTimeout(callback, 16),
    cancelAnimationFrame: id => timers.delete(id),
    addEventListener() {}, removeEventListener() {},
  };
  const context = vm.createContext({
    Spicetify: { React: react, SVGIcons: {} }, window,
    document: { addEventListener() {}, removeEventListener() {} },
    I18n: { t: key => key }, createOutsideTextOutlineShadow: () => "none",
  });
  vm.runInContext(source.replace("    return Mode;", "    window.testComponents = { Mode, VinylPlayer, CompactVinyl, CompactAlbumVinyl };\n    return Mode;"), context);
  const render = (nextProps = {}) => {
    props = { ...props, ...nextProps };
    let passes = 0;
    do {
      assert.ok(++passes < 10, "LP updates must settle");
      dirty = false; cursor = 0; effects = [];
      tree = window.testComponents[component](props);
      for (const node of elements(tree)) if (node.props.ref) node.props.ref.current = { getAnimations: () => clocks };
      for (const effect of effects) effect();
    } while (dirty);
    return tree;
  };
  render();
  return {
    render, get tree() { return tree; }, get timerCount() { return timers.size; },
    player: () => elements(tree).find(node => node.type === window.testComponents.VinylPlayer)?.props,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due).find(([, timer]) => timer.due <= end);
        if (!next) break;
        now = next[1].due; timers.delete(next[0]); next[1].callback();
        if (dirty) render();
      }
      now = end;
    },
    setReducedMotion(matches) { media.matches = matches; for (const listener of mediaListeners) listener(); return render(); },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
      assert.equal(timers.size, 0, "unmount cancels transition timers");
      assert.equal(mediaListeners.size, 0, "unmount releases reduced-motion subscription");
    },
  };
};

test("disabling track changes swaps metadata immediately while preserving the playing record", () => {
  const h = createHarness({ vinylSettings: { trackChangeAnimation: false, rotationSpeed: 150 } });
  h.render({ track: second });
  assert.equal(h.player().title, second.title);
  assert.equal(h.player().incomingTrack, null);
  assert.equal(h.player().isPlaying, true);
  assert.equal(h.player().animationsEnabled, true);
  assert.equal(h.player().rotationSpeed, 150);
  assert.equal(h.timerCount, 0);
  h.unmount();
});

test("the default sleeve handoff still runs, and metadata updates never restart it", () => {
  const h = createHarness();
  h.render({ track: second });
  assert.match(h.tree.props.className, /is-track-record-clearing/);
  assert.equal(h.player().title, first.title);
  h.advance(190);
  assert.match(h.tree.props.className, /is-track-record-sleeving/);
  h.render({ track: { ...second, title: "Translated second" } });
  assert.match(h.tree.props.className, /is-track-record-sleeving/);
  assert.equal(h.player().incomingTrack.title, "Translated second");
  h.advance(3100);
  assert.equal(h.player().title, "Translated second");
  assert.equal(h.player().incomingTrack, null);
  assert.doesNotMatch(h.tree.props.className, /is-track-/);
  h.render({ track: { ...second, title: "Simplified title" } });
  assert.equal(h.player().title, "Simplified title");
  assert.equal(h.timerCount, 0);
  h.unmount();
});

test("disabling track changes mid-handoff cancels all delayed stale-track work", () => {
  const h = createHarness();
  h.render({ track: second });
  h.advance(1000);
  h.render({ vinylSettings: { trackChangeAnimation: false } });
  assert.equal(h.player().title, second.title);
  assert.equal(h.player().incomingTrack, null);
  assert.equal(h.timerCount, 0);
  h.advance(5000);
  assert.equal(h.player().title, second.title);
  h.unmount();
});

test("master, app and live OS reduced-motion settings override track transitions", () => {
  for (const setting of [{ animations: false }, { reducedMotion: true }, {}]) {
    const h = createHarness({ vinylSettings: setting });
    if (setting.animations !== false && !setting.reducedMotion) {
      h.render({ track: second });
      assert.ok(h.timerCount > 0);
      h.setReducedMotion(true);
    } else h.render({ track: second });
    assert.match(h.tree.props.className, /is-motion-disabled/);
    assert.equal(h.player().title, second.title);
    assert.equal(h.timerCount, 0);
    h.unmount();
  }
});

test("speed bounds and updates retain the CSS clock time without changing other animations", () => {
  for (const component of ["VinylPlayer", "CompactVinyl", "CompactAlbumVinyl"]) {
    const clock = { animationName: "ivlyrics-vinyl-spin-clock", currentTime: 1375, playbackRate: 1,
      updatePlaybackRate(rate) { this.playbackRate = rate; } };
    const entrance = { animationName: "fullscreen-compact-vinyl-in", updatePlaybackRate() { assert.fail("entrance speed must remain independent"); } };
    const h = createHarness({ component, clocks: [clock, entrance], centerRotationEnabled: false });
    for (const [value, rate] of [[150, 1.5], ["50", 0.5], [999, 2], [-10, 0.25], [0, 0.25], [NaN, 1], [undefined, 1]]) {
      h.render({ rotationSpeed: value, isPlaying: false });
      assert.equal(clock.playbackRate, rate);
      assert.equal(clock.currentTime, 1375, "speed changes retain paused rotation phase");
    }
    h.render({ isPlaying: true });
    assert.equal(clock.currentTime, 1375);
    h.unmount();
  }
});

test("saved LP preferences reload with bounded speeds and unchanged defaults", () => {
  const index = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const fields = index.slice(index.indexOf('    "fullscreen-vinyl-track-change-animation":'), index.indexOf('    "fullscreen-vinyl-center-rotation":'));
  for (const [stored, speed] of [[null, 100], ["175", 175], ["-10", 25], ["400", 200], ["invalid", 100]]) {
    const config = vm.runInNewContext(`({${fields}})`, { StorageManager: { get: (_, fallback) => fallback, getItem: () => stored } });
    assert.equal(config["fullscreen-vinyl-rotation-speed"], speed);
    assert.equal(config["fullscreen-vinyl-track-change-animation"], true);
  }
  const config = vm.runInNewContext(`({${fields}})`, { StorageManager: { get: () => false, getItem: () => "50" } });
  assert.equal(config["fullscreen-vinyl-track-change-animation"], false);
  assert.equal(config["fullscreen-vinyl-rotation-speed"], 50);
});
