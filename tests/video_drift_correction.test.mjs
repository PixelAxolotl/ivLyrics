import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../VideoBackground.js", import.meta.url), "utf8");
const helperBoundary = source.indexOf("const disableYouTubeCaptions");
assert.ok(helperBoundary > 0, "VideoBackground sync helpers must remain before the component helpers");

const context = vm.createContext({ window: {} });
vm.runInContext(
    `${source.slice(0, helperBoundary)}\n` +
    "globalThis.__drift = { createVideoDriftState, resetVideoDriftState, planVideoDriftCorrection, syncYouTubePlayerTimeline };",
    context
);
const { createVideoDriftState, resetVideoDriftState, planVideoDriftCorrection, syncYouTubePlayerTimeline } = context.__drift;

const TICK_MS = 250;

// A player whose video stalls for `resumeDelay` seconds after every seek, with
// an optional clock error `jitter(tick)` in what it reports.
function simulate({ seconds, resumeDelay = 0, startDrift = 0, jitter = () => 0, rateSkew = 0, plan = planVideoDriftCorrection }) {
    const state = createVideoDriftState();
    let spotify = 10;
    let video = spotify + startDrift;
    let stalledUntil = -Infinity;
    const seeks = [];
    const drifts = [];
    for (let tick = 0, now = 0; now <= seconds * 1000; tick++, now += TICK_MS) {
        const isStalled = now < stalledUntil;
        const action = plan(state, {
            currentTime: video + jitter(tick),
            targetTime: spotify,
            now,
            isPlaying: true,
            isSteady: !isStalled,
        });
        if (action.type === "seek") {
            seeks.push({ now, time: action.time });
            video = action.time;
            stalledUntil = now + resumeDelay * 1000;
        }
        drifts.push(video - spotify);
        spotify += TICK_MS / 1000;
        if (now + TICK_MS > stalledUntil) {
            const playedMs = Math.min(TICK_MS, now + TICK_MS - Math.max(now, stalledUntil));
            video += (playedMs / 1000) * (1 + rateSkew);
        }
    }
    return { state, seeks, finalDrift: drifts[drifts.length - 1] };
}

test("re-seeks at once when the video is more than half a second off", () => {
    const state = createVideoDriftState();
    state.leadSeconds = 0.2;
    assert.deepEqual({ ...planVideoDriftCorrection(state, { currentTime: 9, targetTime: 10, now: 0, isPlaying: true }) },
        { type: "seek", time: 10.2 });
    assert.deepEqual({ ...planVideoDriftCorrection(state, { currentTime: 9, targetTime: 10, now: 5000, isPlaying: false }) },
        { type: "seek", time: 10 }, "a paused video needs no lead");
    assert.deepEqual({ ...planVideoDriftCorrection(state, { currentTime: NaN, targetTime: 4, now: 9000 }) },
        { type: "seek", time: 4 });
});

test("a seek that resumes late no longer leaves the video steadily behind", () => {
    const { seeks, state, finalDrift } = simulate({ seconds: 30, startDrift: -2, resumeDelay: 0.3 });
    assert.ok(Math.abs(finalDrift) <= 0.1, `final drift ${finalDrift.toFixed(3)} s`);
    assert.ok(seeks.length <= 4, `${seeks.length} seeks`);
    assert.ok(state.leadSeconds > 0.15 && state.leadSeconds < 0.45, `learned lead ${state.leadSeconds}`);
});

test("a seek that takes over a second to resume is not re-sent while the video buffers", () => {
    // Re-seeking every time drift crossed half a second restarted the
    // buffering: on a slow connection the video never played (27 seeks in
    // 20 s) and the page stuttered under them.
    for (const resumeDelay of [0.8, 1.5]) {
        const { seeks, state, finalDrift } = simulate({ seconds: 20, startDrift: -2, resumeDelay });
        assert.ok(seeks.length <= 3, `${resumeDelay} s resume: ${seeks.length} seeks`);
        assert.ok(Math.abs(finalDrift) <= 0.1, `${resumeDelay} s resume: final drift ${finalDrift.toFixed(3)} s`);
        assert.ok(state.leadSeconds >= resumeDelay - 0.3, `the lead covers the resume time (${state.leadSeconds} s)`);
    }
});

test("a seek that never resumes is retried with growing patience", () => {
    const { seeks } = simulate({ seconds: 30, startDrift: -2, resumeDelay: 1000 });
    const gaps = seeks.slice(1).map((seek, index) => seek.now - seeks[index].now);
    assert.ok(seeks.length <= 5, `${seeks.length} seeks in 30 s`);
    assert.deepEqual(gaps, [2500, 5000, 10000, 10000], "waits double up to 10 s");
});

test("a timing nudge seeks at once even while a previous seek buffers", () => {
    const state = createVideoDriftState();
    assert.equal(planVideoDriftCorrection(state, { currentTime: 0, targetTime: 10, now: 0, isPlaying: true }).type, "seek");
    assert.equal(planVideoDriftCorrection(state, { currentTime: 9, targetTime: 10.75, now: 750, isPlaying: true }).type, "none",
        "buffering: no second seek");
    state.seekRequested = true;
    assert.equal(planVideoDriftCorrection(state, { currentTime: 9, targetTime: 11, now: 1000, isPlaying: true }).type, "seek");
});

test("Spotify timeline jumps bypass pending buffering grace in both video transports", () => {
    for (const canAdjustRate of [false, true]) for (const targetTime of [70, 2]) {
        const state = createVideoDriftState();
        planVideoDriftCorrection(state, {
            currentTime: 8, targetTime: 10, now: 0, isPlaying: true,
            isSteady: false, canAdjustRate,
        });
        const correction = planVideoDriftCorrection(state, {
            currentTime: 10, targetTime, now: 250, isPlaying: true,
            isSteady: false, canAdjustRate,
        });
        assert.deepEqual({ ...correction }, { type: "seek", time: targetTime },
            `a jump to ${targetTime} must not wait for the old seek`);
        assert.equal(state.leadSeconds, 0, "the jump is not buffering latency");
        planVideoDriftCorrection(state, {
            currentTime: targetTime + 0.25, targetTime: targetTime + 0.25,
            now: 500, isPlaying: true, isSteady: true, canAdjustRate,
        });
        assert.equal(state.leadSeconds, 0);
    }
});

test("a timeline jump on the first resumed frame cannot train an incorrect seek lead", () => {
    for (const canAdjustRate of [false, true]) {
        const state = createVideoDriftState();
        planVideoDriftCorrection(state, {
            currentTime: 8, targetTime: 10, now: 0,
            isPlaying: true, isSteady: true, canAdjustRate,
        });
        const correction = planVideoDriftCorrection(state, {
            currentTime: 10.75, targetTime: 70, now: 1000,
            isPlaying: true, isSteady: true, canAdjustRate,
        });
        assert.deepEqual({ ...correction }, { type: "seek", time: 70 });
        assert.equal(state.leadSeconds, 0, "do not learn the 59-second jump as a 3-second lead");
        const settled = planVideoDriftCorrection(state, {
            currentTime: 70.25, targetTime: 70.25, now: 1250,
            isPlaying: true, isSteady: true, canAdjustRate,
        });
        assert.notEqual(settled.type, "seek", "no compensating second seek is needed");
    }
});

test("a video loop wrap is a new target, not a long buffering delay", () => {
    const state = createVideoDriftState();
    planVideoDriftCorrection(state, {
        currentTime: 17, targetTime: 19, now: 0, isPlaying: true, isSteady: false,
    });
    const correction = planVideoDriftCorrection(state, {
        currentTime: 19, targetTime: 0.25, now: 1250, isPlaying: true, isSteady: false,
    });
    assert.deepEqual({ ...correction }, { type: "seek", time: 0.25 });
    assert.equal(state.leadSeconds, 0);
});

test("timeline jumps retain already learned latency without training on the jump", () => {
    const state = createVideoDriftState();
    state.leadSeconds = 0.3;
    planVideoDriftCorrection(state, {
        currentTime: 8, targetTime: 10, now: 0, isPlaying: true, isSteady: true,
    });
    const correction = planVideoDriftCorrection(state, {
        currentTime: 10.3, targetTime: 70, now: 250, isPlaying: true, isSteady: false,
    });
    assert.deepEqual({ ...correction }, { type: "seek", time: 70.3 });
    assert.equal(state.leadSeconds, 0.3);
});

test("the old half-second threshold left the same player 0.3 s behind for good", () => {
    const oldPlan = (state, { currentTime, targetTime }) =>
        Math.abs(currentTime - targetTime) > 0.5 ? { type: "seek", time: targetTime } : { type: "none" };
    const { finalDrift } = simulate({ seconds: 30, startDrift: -2, resumeDelay: 0.3, plan: oldPlan });
    assert.ok(Math.abs(finalDrift + 0.3) < 0.01, `final drift ${finalDrift.toFixed(3)} s`);
});

test("clock jitter alone never triggers a seek", () => {
    const pattern = [0.08, -0.06, 0.02, -0.09, 0.05, -0.03, 0.07, -0.08];
    const { seeks } = simulate({ seconds: 120, jitter: (tick) => pattern[tick % pattern.length] });
    assert.equal(seeks.length, 0);
});

test("stops chasing drift a player cannot hold", () => {
    // The video keeps falling behind at 10% speed whatever we do.
    const { state, seeks } = simulate({ seconds: 120, rateSkew: -0.1 });
    assert.equal(state.softThresholdSeconds, 0.35);
    // Only the unavoidable half-second re-seeks remain once it backs off.
    const lateSeeks = seeks.filter(({ now }) => now > 60_000);
    assert.ok(lateSeeks.length <= 12, `${lateSeeks.length} seeks in the last minute`);
});

test("a local helper video is eased back with its playback rate", () => {
    const ahead = createVideoDriftState();
    ahead.lastSeekAt = -10_000;
    let action;
    for (let now = 0; now < 1000; now += TICK_MS) {
        action = planVideoDriftCorrection(ahead, { currentTime: 10.1, targetTime: 10, now, isPlaying: true, isSteady: true, canAdjustRate: true });
    }
    assert.deepEqual({ ...action }, { type: "rate", rate: 0.95 });

    const behind = createVideoDriftState();
    for (let now = 0; now < 1000; now += TICK_MS) {
        action = planVideoDriftCorrection(behind, { currentTime: 9.96, targetTime: 10, now, isPlaying: true, isSteady: true, canAdjustRate: true });
    }
    assert.deepEqual({ ...action }, { type: "rate", rate: 1.02 });

    const inSync = createVideoDriftState();
    for (let now = 0; now < 1000; now += TICK_MS) {
        action = planVideoDriftCorrection(inSync, { currentTime: 10.01, targetTime: 10, now, isPlaying: true, isSteady: true, canAdjustRate: true });
    }
    assert.deepEqual({ ...action }, { type: "rate", rate: 1 });
});

test("a new video keeps the learned lead but starts fresh", () => {
    const state = createVideoDriftState();
    state.leadSeconds = 0.3;
    state.samples = [0.2, 0.2];
    state.softThresholdSeconds = 0.35;
    resetVideoDriftState(state);
    assert.equal(state.leadSeconds, 0.3);
    assert.equal(state.samples.length, 0);
    assert.equal(state.softThresholdSeconds, 0.15);
});

test("pausing clears stale drift samples and restores a helper's normal speed", () => {
    const state = createVideoDriftState();
    state.samples = [-0.2, -0.2, -0.2];
    const action = planVideoDriftCorrection(state, {
        currentTime: 10, targetTime: 10, now: 5000,
        isPlaying: false, isSteady: false, canAdjustRate: true,
    });
    assert.deepEqual({ ...action }, { type: "rate", rate: 1 });
    assert.equal(state.samples.length, 0);
});

test("an explicit 10ms adjustment overrides drift thresholds and learned lead while paused", () => {
    const driftState = createVideoDriftState();
    driftState.leadSeconds = 0.4;
    const player = createPlayer({ time: 10, state: 2 });
    syncYouTubePlayerTimeline({
        player, targetVideoTime: 10.01, shouldHoldAtStart: false, shouldPlay: false,
        holdState: { isHolding: false }, driftState, forceSeek: true, now: 5000,
    });
    assert.deepEqual(player.calls, [["seekTo", 10.01]]);
    assert.equal(driftState.lastSeekAt, 5000);
});

test("forced YouTube seeks record the new target so the next buffering tick does not seek again", () => {
    const driftState = createVideoDriftState();
    const player = createPlayer({ time: 8, state: 3 });
    const holdState = { isHolding: false };
    const tick = (targetVideoTime, now, forceSeek = false) => syncYouTubePlayerTimeline({
        player, targetVideoTime, now, forceSeek, driftState, holdState,
        shouldHoldAtStart: false, shouldPlay: true,
    });
    tick(10, 0);
    player.calls.length = 0;
    tick(70, 250, true);
    player.getCurrentTime = () => 70;
    tick(70.25, 500);
    assert.deepEqual(player.calls, [["seekTo", 70]], "do not treat the already sent forced seek as another jump");
    assert.equal(driftState.leadSeconds, 0);
});

test("a paused seek and subsequent resume do not inherit stale target or latency samples", () => {
    const state = createVideoDriftState();
    planVideoDriftCorrection(state, {
        currentTime: 8, targetTime: 10, now: 0, isPlaying: true, isSteady: true,
    });
    const paused = planVideoDriftCorrection(state, {
        currentTime: 10, targetTime: 70, now: 250, isPlaying: false, isSteady: false,
    });
    assert.deepEqual({ ...paused }, { type: "seek", time: 70 });
    const resumed = planVideoDriftCorrection(state, {
        currentTime: 70.25, targetTime: 70.25, now: 1000, isPlaying: true, isSteady: true,
    });
    assert.notEqual(resumed.type, "seek");
    assert.equal(state.leadSeconds, 0);
    resetVideoDriftState(state);
    assert.ok(Number.isNaN(state.lastTargetTime));
    assert.ok(Number.isNaN(state.lastTargetAt));
});

test("learned seek lead wraps at the video end instead of seeking beyond its duration", () => {
    const driftState = createVideoDriftState();
    driftState.leadSeconds = 0.4;
    const player = createPlayer({ time: 18, state: 1 });
    player.getDuration = () => 20;
    syncYouTubePlayerTimeline({
        player, targetVideoTime: 19.8, shouldHoldAtStart: false, shouldPlay: true,
        holdState: { isHolding: false }, driftState, now: 5000,
    });
    assert.equal(player.calls[0][0], "seekTo");
    assert.ok(Math.abs(player.calls[0][1] - 0.2) < 0.000001);
});

function createPlayer({ time, state = 1 }) {
    const calls = [];
    return {
        calls,
        getPlayerState: () => state,
        getCurrentTime: () => time,
        seekTo: (seconds) => calls.push(["seekTo", seconds]),
        playVideo: () => calls.push(["playVideo"]),
        pauseVideo: () => calls.push(["pauseVideo"]),
    };
}

test("the YouTube sync leaves the held pre-roll exactly on the mapped time", () => {
    const driftState = createVideoDriftState();
    driftState.leadSeconds = 0.3;
    const player = createPlayer({ time: 0, state: 2 });
    syncYouTubePlayerTimeline({
        player, targetVideoTime: 0.4, shouldHoldAtStart: false, shouldPlay: true,
        holdState: { isHolding: true, primePending: false }, driftState, now: 0,
    });
    assert.deepEqual(player.calls[0], ["seekTo", 0.4]);
});

test("the YouTube sync only reloads the video for drift past the seek threshold", () => {
    // VideoBackgroundDepend turns a seek into a positioned reload (a
    // muted-autoplay embed ignores seekTo): 0.3-0.9 s of black. A steady 0.3 s
    // lag used to be "corrected" that way every ~3 s, each reload lagging a
    // little again, so the picture kept cutting to black.
    const run = ({ lag, playerState = 1, shouldPlay = true, seconds = 30 }) => {
        const driftState = createVideoDriftState();
        const player = createPlayer({ time: 0, state: playerState });
        const seeks = [];
        for (let now = 0; now <= seconds * 1000; now += TICK_MS) {
            const target = 20 + now / 1000;
            player.getCurrentTime = () => target - lag;
            player.calls.length = 0;
            syncYouTubePlayerTimeline({
                player, targetVideoTime: target, shouldHoldAtStart: false, shouldPlay,
                holdState: { isHolding: false, primePending: false }, driftState, now,
            });
            seeks.push(...player.calls.filter(([name]) => name === "seekTo"));
        }
        return seeks;
    };
    for (const lag of [0.2, 0.3, -0.3, 0.45]) {
        assert.equal(run({ lag }).length, 0, `a steady ${lag} s drift is left alone`);
    }
    assert.ok(run({ lag: 0.8, seconds: 2 }).length >= 1, "drift past half a second still gets one seek");
    assert.equal(run({ lag: 0.3, playerState: 2, shouldPlay: false }).length, 0, "paused: nothing to correct");
});

test("the drift planner leaves soft corrections to players that can take them", () => {
    const drive = (options) => {
        const state = createVideoDriftState();
        const actions = [];
        for (let now = 0; now <= 12000; now += TICK_MS) {
            actions.push(planVideoDriftCorrection(state, {
                currentTime: 20 + now / 1000 - 0.3, targetTime: 20 + now / 1000, now,
                isPlaying: true, isSteady: true, ...options,
            }));
        }
        return actions;
    };
    assert.ok(drive({}).some(action => action.type === "seek"), "by default a steady lag is corrected with a seek");
    assert.ok(drive({ canAdjustRate: true }).every(action => action.type !== "seek"), "a local video eases it out with its speed");
    assert.ok(drive({ allowSoftSeek: false }).every(action => action.type === "none"), "a reloading player only gets hard seeks");
    // Hard drift is still corrected at once, with the learned lead.
    const state = createVideoDriftState();
    state.leadSeconds = 0.4;
    assert.deepEqual({ ...planVideoDriftCorrection(state, { currentTime: 5, targetTime: 20, now: 0, isPlaying: true, allowSoftSeek: false }) },
        { type: "seek", time: 20.4 });
});
