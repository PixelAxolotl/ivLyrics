import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../SyncDataCreator.js", import.meta.url), "utf8");
const start = source.indexOf("const SYNC_CREATOR_PREVIEW_STATE_INTERVAL_MS");
const end = source.indexOf("const countSyncCreatorRangeChars", start);
assert.ok(start >= 0 && end > start);
const clockSource = source.slice(start, end);

const createClock = ({ playing = true, progress = 0, reducedMotion = false, now = 0 } = {}) => {
	const player = { progress, playing };
	const clock = { now };
	let nextId = 1;
	let frame = null;
	let timer = null;
	const cancelled = [];
	let stateValue;
	let hasState = false;
	let effect = null;
	let effectDeps = null;
	let cleanup = null;
	const rendered = [];
	const context = vm.createContext({
		window: { matchMedia: (query) => ({ matches: reducedMotion && query === "(prefers-reduced-motion: reduce)" }) },
		performance: { now: () => clock.now },
		Spicetify: { Player: { getProgress: () => player.progress, isPlaying: () => player.playing } },
		requestAnimationFrame: (callback) => { assert.equal(frame, null); frame = { id: nextId++, callback }; return frame.id; },
		cancelAnimationFrame: (id) => { cancelled.push(["frame", id]); if (frame?.id === id) frame = null; },
		setTimeout: (callback, delay) => { assert.equal(timer, null); timer = { id: nextId++, callback, delay }; return timer.id; },
		clearTimeout: (id) => { cancelled.push(["timer", id]); if (timer?.id === id) timer = null; },
		react: {
			useState: (init) => {
				if (!hasState) { hasState = true; stateValue = typeof init === "function" ? init() : init; }
				return [stateValue, (next) => { stateValue = typeof next === "function" ? next(stateValue) : next; }];
			},
			useEffect: (fn, deps) => {
				if (effectDeps && deps.length === effectDeps.length && deps.every((value, index) => Object.is(value, effectDeps[index]))) return;
				cleanup?.();
				effectDeps = deps;
				effect = fn;
				cleanup = fn() || null;
			},
		},
	});
	vm.runInContext(`${clockSource}
globalThis.api = { SyncCreatorLivePreviewClock, syncCreatorPreviewLiveClock, syncCreatorPreviewUsesLiveClock };`, context);
	const { api } = context;
	const render = (fallbackPosition) => api.SyncCreatorLivePreviewClock({
		fallbackPosition,
		render: (position) => { rendered.push(position); return position; },
	});
	return {
		api, player, clock, rendered, cancelled,
		render,
		state: () => stateValue,
		pending: () => ({ frame: Boolean(frame), timer: timer && timer.delay }),
		frame: (frameTime) => { const { callback } = frame; frame = null; callback(frameTime); },
		timer: () => { const { callback } = timer; timer = null; callback(); },
		unmount: () => { cleanup?.(); cleanup = null; },
	};
};

test("the preview clock commits frame-aligned raw progress at most every 15 ms while playing", () => {
	const h = createClock({ progress: 10000, now: 1000 });
	assert.equal(h.render(9950), 9950);
	// Mounting syncs to the current progress at once, then waits for frames.
	assert.equal(h.state(), 10000);
	assert.deepEqual(h.pending(), { frame: true, timer: null });
	// Sampled 6 ms into a frame that started at 1000 ms.
	Object.assign(h.player, { progress: 10006 }); h.clock.now = 1006;
	h.frame(1000);
	assert.equal(h.state(), 10000);
	Object.assign(h.player, { progress: 10014.4 }); h.clock.now = 1014.4;
	h.frame(1008.3);
	assert.equal(h.state(), 10000, "commits are throttled to the 15 ms state cadence");
	Object.assign(h.player, { progress: 10021 }); h.clock.now = 1021;
	h.frame(1016.6);
	assert.equal(h.state(), 10017);
	assert.equal(h.render(9950), 10017);
	assert.deepEqual(h.pending(), { frame: true, timer: null });
});

test("the painter clock reads the same raw progress, aligned only while playing", () => {
	const h = createClock({ progress: 5000, now: 2010 });
	assert.equal(h.api.syncCreatorPreviewLiveClock.getPosition(2000), 4990);
	assert.equal(h.api.syncCreatorPreviewLiveClock.getPosition(2020), 5000);
	assert.equal(h.api.syncCreatorPreviewLiveClock.getPosition(NaN), 5000);
	h.player.playing = false;
	assert.equal(h.api.syncCreatorPreviewLiveClock.getPosition(2000), 5000);
	h.player.progress = undefined;
	assert.ok(Number.isNaN(h.api.syncCreatorPreviewLiveClock.getPosition(2000)));
});

test("paused previews poll every 120 ms for seeks and resume frames on play", () => {
	const h = createClock({ playing: false, progress: 3000, now: 500 });
	h.render(2990);
	assert.equal(h.state(), 3000);
	assert.deepEqual(h.pending(), { frame: false, timer: 120 });
	h.player.progress = 42000;
	h.timer();
	assert.equal(h.state(), 42000);
	assert.deepEqual(h.pending(), { frame: false, timer: 120 });
	h.player.playing = true;
	h.timer();
	assert.deepEqual(h.pending(), { frame: true, timer: null });
	h.unmount();
	assert.deepEqual(h.pending(), { frame: false, timer: null });
	assert.equal(h.cancelled.at(-1)[0], "frame");
});

test("reduced motion keeps the editor position and schedules nothing", () => {
	const h = createClock({ reducedMotion: true, progress: 7000 });
	assert.equal(h.api.syncCreatorPreviewUsesLiveClock(), false);
	assert.equal(h.render(6900), 6900);
	assert.equal(h.render(6980), 6980);
	assert.deepEqual(h.pending(), { frame: false, timer: null });
});
