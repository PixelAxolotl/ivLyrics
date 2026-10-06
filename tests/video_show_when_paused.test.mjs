import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const videoSource = readFileSync(new URL('../VideoBackground.js', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../Settings.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8');

const section = (text, startMarker, endMarker) => {
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `missing source section: ${startMarker}`);
    return text.slice(start, end);
};

// Pure paused-visibility helpers live next to the other sync helpers so they stay unit-testable.
const helperSource = section(
    videoSource,
    'const resolveVideoShowWhenPaused',
    '\nconst disableYouTubeCaptions'
);
const context = vm.createContext({});
vm.runInContext(
    `${helperSource}\nglobalThis.__pausedVideoTest = { resolveVideoShowWhenPaused, resolveVideoBackgroundOpacity };`,
    context
);
const { resolveVideoShowWhenPaused, resolveVideoBackgroundOpacity } = context.__pausedVideoTest;

test('paused video stays visible by default', () => {
    assert.equal(resolveVideoShowWhenPaused(undefined), true);
    assert.equal(resolveVideoShowWhenPaused({}), true);
    assert.equal(resolveVideoShowWhenPaused({ 'video-show-when-paused': true }), true);
});

test('paused video hides when the setting is off or reduce motion is on', () => {
    assert.equal(resolveVideoShowWhenPaused({ 'video-show-when-paused': false }), false);
    assert.equal(resolveVideoShowWhenPaused({ 'reduce-motion': true }), false);
    assert.equal(
        resolveVideoShowWhenPaused({ 'video-show-when-paused': true, 'reduce-motion': true }),
        false
    );
});

test('opacity keeps the frozen frame while paused but hides when not ready', () => {
    assert.equal(
        resolveVideoBackgroundOpacity({ isPlayerReady: true, isPlaying: false, showWhenPaused: true }),
        1
    );
    assert.equal(
        resolveVideoBackgroundOpacity({ isPlayerReady: true, isPlaying: true, showWhenPaused: false }),
        1
    );
    assert.equal(
        resolveVideoBackgroundOpacity({ isPlayerReady: true, isPlaying: false, showWhenPaused: false }),
        0
    );
    assert.equal(
        resolveVideoBackgroundOpacity({ isPlayerReady: false, isPlaying: true, showWhenPaused: true }),
        0
    );
});

test('paused-video setting is wired through background details and defaults', () => {
    assert.ok(
        settingsSource.includes('"video-show-when-paused"'),
        'Settings background details must include the toggle'
    );
    assert.ok(
        indexSource.includes('"video-show-when-paused"'),
        'index.js must provide the stored default'
    );
    const opacityVarUses = videoSource.split('opacity: videoBackgroundOpacity').length - 1;
    assert.ok(
        opacityVarUses >= 2,
        `both video render paths must use the shared opacity value (found ${opacityVarUses})`
    );
    assert.ok(
        !videoSource.includes('isPlayerReady && isPlaying ? 1 : 0'),
        'hard-coded hide-on-pause opacity must be gone'
    );
});
