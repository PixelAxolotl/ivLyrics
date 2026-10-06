import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../OptionsMenu.js', import.meta.url), 'utf8');

const section = (text, startMarker, endMarker) => {
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `missing source section: ${startMarker}`);
    return text.slice(start, end);
};

// Pure video-sync helpers live next to clampSyncOffset so they stay unit-testable.
const helperSource = section(
    source,
    'const COMMUNITY_VIDEO_SYNC_MAX_SECONDS = 3600;',
    '\nconst pendingTrackSyncOffsetWrites'
);
const context = vm.createContext({});
vm.runInContext(
    `${helperSource}\nglobalThis.__communityVideoSyncTest = { normalizeCommunityVideoSyncSeconds, clampCommunityVideoSyncSeconds, formatCommunityVideoSyncSeconds };`,
    context
);
const {
    normalizeCommunityVideoSyncSeconds,
    clampCommunityVideoSyncSeconds,
    formatCommunityVideoSyncSeconds,
} = context.__communityVideoSyncTest;

test('normalizes video sync to 3 decimal places', () => {
    assert.equal(normalizeCommunityVideoSyncSeconds('7.123456'), 7.123);
    assert.equal(normalizeCommunityVideoSyncSeconds('7,1234'), 7.123);
    assert.equal(normalizeCommunityVideoSyncSeconds('abc'), 0);
    assert.equal(normalizeCommunityVideoSyncSeconds('-5'), 0);
    assert.equal(normalizeCommunityVideoSyncSeconds('4000'), 3600);
});

test('clamps video sync to zero and video duration', () => {
    assert.equal(clampCommunityVideoSyncSeconds(-1, 120), 0);
    assert.equal(clampCommunityVideoSyncSeconds(130, 120), 120);
    assert.equal(clampCommunityVideoSyncSeconds(7.123456, 120), 7.123);
    // Unknown duration falls back to the 1h community cap.
    assert.equal(clampCommunityVideoSyncSeconds(4000, null), 3600);
    assert.equal(clampCommunityVideoSyncSeconds(4000, 0), 3600);
    assert.equal(clampCommunityVideoSyncSeconds(3599.9999, 5000), 3600);
});

test('formats video sync to 3 decimal places with s suffix', () => {
    assert.equal(formatCommunityVideoSyncSeconds(7.123456), '7.123s');
    assert.equal(formatCommunityVideoSyncSeconds(0), '0.000s');
});

const videoSource = readFileSync(new URL('../VideoBackground.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('video background exposes duration-clamped start helpers and live sync events', () => {
    assert.ok(
        videoSource.includes('const normalizeCommunityVideoStartSeconds'),
        'VideoBackground must normalize starts to 3 decimals'
    );
    assert.ok(
        videoSource.includes('const clampCommunityVideoStartSeconds'),
        'VideoBackground must clamp starts to video duration'
    );
    assert.ok(
        videoSource.includes('ivLyrics:community-video-start-changed'),
        'VideoBackground must listen for adjust-tab start changes'
    );
    assert.ok(
        videoSource.includes('ivLyrics:communityVideoChanged'),
        'VideoBackground must publish active video + duration changes'
    );
    assert.ok(
        videoSource.includes('videoDurationSeconds'),
        'active video info must carry duration for clamping'
    );
});

test('adjust tab renders a current-video section with millisecond steps', () => {
    assert.ok(
        source.includes('CurrentVideoSyncPill'),
        'OptionsMenu must define the current-video pill'
    );
    assert.ok(
        source.includes('data-section'),
        'video section must be marked in the modal'
    );
    for (const step of ['-1000', '-100', '-10', '1000']) {
        assert.ok(
            source.includes(step),
            `video pill must include step ${step}`
        );
    }
    assert.ok(
        source.includes('queueCommunityVideoSyncWrite'),
        'video steps must queue the fix for later server update'
    );
});

test('video server update waits for song finish or skip', () => {
    assert.ok(
        source.includes('ensureCommunityVideoSyncFlushOnSongChange'),
        'server flush must be registered for track change'
    );
    const queueBlock = section(source, 'const queueCommunityVideoSyncWrite', '\nconst readActiveCommunityVideoInfo');
    assert.ok(
        !queueBlock.includes('setTimeout'),
        'queueing must not schedule a timed server submit'
    );
});

test('video pill center has no reset hover state', () => {
    assert.ok(
        source.includes('lyrics-track-sync-value-static'),
        'video center must opt out of the reset hover swap'
    );
    assert.ok(
        styleSource.includes('.lyrics-track-sync-value-static'),
        'CSS must neutralize the red hover for the static video value'
    );
});

test('quick sync controls stack lyrics and video pills', () => {
    assert.ok(
        source.includes('hideWhenEmpty'),
        'video pill must support hiding when no video is active'
    );
    assert.ok(
        indexSource.includes('lyrics-quick-sync-stack'),
        'quick controls must render a stacking wrapper'
    );
    assert.ok(
        indexSource.includes('CurrentVideoSyncPill'),
        'quick controls must include the video pill'
    );
    assert.ok(
        styleSource.includes('.lyrics-quick-sync-stack'),
        'stack wrapper must be positioned by CSS'
    );
});
