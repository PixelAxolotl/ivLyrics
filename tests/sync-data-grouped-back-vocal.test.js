const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lyricsServiceSource = fs.readFileSync(
    path.join(__dirname, '..', 'LyricsService.js'),
    'utf8'
);
const syncCreatorSource = fs.readFileSync(
    path.join(__dirname, '..', 'SyncDataCreator.js'),
    'utf8'
);

function createSyncDataServiceHarness() {
    const start = lyricsServiceSource.indexOf('    const SyncDataService = (() => {');
    const end = lyricsServiceSource.indexOf('\n    window.SyncDataService = SyncDataService;', start);
    assert.ok(start >= 0 && end > start, 'SyncDataService source block not found');

    const sandbox = {
        window: {},
        Spicetify: {},
        URL,
        fetch: async () => {
            throw new Error('Unexpected network request');
        },
        console: { log() {}, info() {}, warn() {}, error() {} }
    };
    vm.createContext(sandbox);
    vm.runInContext(
        `${lyricsServiceSource.slice(start, end)}\nthis.service = SyncDataService;`,
        sandbox,
        { filename: 'LyricsService.sync-data.js' }
    );
    return sandbox.service;
}

function createSyncCreatorHelperHarness() {
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(syncCreatorSource, sandbox, { filename: 'SyncDataCreator.js' });
    return {
        selectParallelTemplate: vm.runInContext('selectSyncCreatorParallelTemplate', sandbox),
        hasReusablePartChars: vm.runInContext('hasReusableSyncCreatorParallelChars', sandbox)
    };
}

function createGroupedFixture() {
    const text = 'A(пол)B(да)C';
    const backgroundPart = {
        id: 'b',
        role: 'background',
        ranges: [{ start: 2, end: 4 }, { start: 8, end: 9 }],
        join: [2],
        chars: [0.2, 0.4, 0.6, 2.5, 2.7]
    };
    const parallel = {
        layout: 'stack',
        hiddenRanges: [
            { start: 1, end: 1 },
            { start: 5, end: 5 },
            { start: 7, end: 7 },
            { start: 10, end: 10 }
        ],
        parts: [
            {
                id: 'a',
                role: 'lead',
                ranges: [{ start: 0, end: 0 }, { start: 6, end: 6 }, { start: 11, end: 11 }],
                join: [1, 1],
                chars: [0, 1, 3.1]
            },
            backgroundPart
        ]
    };
    return { text, parallel, backgroundPart };
}

function renderBackgroundSyllables(joinMode = 2) {
    const service = createSyncDataServiceHarness();
    const { text, parallel } = createGroupedFixture();
    const lineChars = [0, 0.1, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 2.5, 2.7, 2.9, 3.1];
    const fixtureParallel = {
        ...parallel,
        hiddenRanges: joinMode === 2 ? parallel.hiddenRanges : [],
        parts: parallel.parts.map(part => part.role === 'background'
            ? { ...part, join: [joinMode] }
            : part)
    };
    const karaoke = service.applySyncDataToLyrics(
        [{ text }],
        {
            provider: 'lrclib',
            syncData: {
                version: 3,
                lines: [{
                    start: 0,
                    end: Array.from(text).length - 1,
                    chars: lineChars,
                    parallel: fixtureParallel
                }]
            }
        }
    );
    return karaoke[0].vocals.background[0].syllables;
}

test('grouped background ranges use a timed whitespace for a delayed second vocal', () => {
    const syllables = renderBackgroundSyllables(2);
    assert.equal(syllables.map(item => item.text).join(''), 'пол да');

    const lastFirstRange = syllables[2];
    const gap = syllables[3];
    const firstSecondRange = syllables[4];
    assert.equal(gap.text, ' ');
    assert.equal(gap.startTime, lastFirstRange.endTime);
    assert.equal(gap.endTime, firstSecondRange.startTime);
    assert.ok(gap.endTime > gap.startTime);
    assert.ok(lastFirstRange.endTime < firstSecondRange.startTime);
    assert.ok(lastFirstRange.endTime - lastFirstRange.startTime <= 1500);
});

test('legacy range joins cap boundary animation and only spaced joins emit a gap syllable', () => {
    const spaced = renderBackgroundSyllables(1);
    assert.equal(spaced.map(item => item.text).join(''), 'пол да');
    assert.equal(spaced[3].text, ' ');
    assert.equal(spaced[3].startTime, spaced[2].endTime);
    assert.equal(spaced[3].endTime, spaced[4].startTime);
    assert.ok(spaced[3].endTime > spaced[3].startTime);

    const concatenated = renderBackgroundSyllables(0);
    assert.equal(concatenated.map(item => item.text).join(''), 'полда');
    assert.equal(concatenated.some(item => item.text === ' '), false);
    assert.ok(concatenated[2].endTime < concatenated[3].startTime);
});

test('explicit grouped parallel data wins over a larger regenerated separate template', () => {
    const { selectParallelTemplate } = createSyncCreatorHelperHarness();
    const { parallel: persisted } = createGroupedFixture();
    const regeneratedSeparate = {
        layout: 'stack',
        parts: [
            { id: 'a', role: 'lead', ranges: [{ start: 0, end: 0 }], join: [] },
            { id: 'b', role: 'background', ranges: [{ start: 2, end: 4 }], join: [] },
            { id: 'c', role: 'background', ranges: [{ start: 8, end: 9 }], join: [] }
        ]
    };

    assert.equal(
        selectParallelTemplate(persisted, regeneratedSeparate, { hasManualDraft: false }),
        persisted
    );

    const legacySeparate = {
        ...persisted,
        parts: persisted.parts.map(part => part.id === 'b' ? { ...part, join: [1] } : part)
    };
    assert.equal(
        selectParallelTemplate(legacySeparate, regeneratedSeparate, { hasManualDraft: false }),
        regeneratedSeparate
    );
    assert.equal(
        selectParallelTemplate(persisted, regeneratedSeparate, { hasManualDraft: true }),
        regeneratedSeparate
    );
});

test('parallel timing reuse requires an exact range shape and character count', () => {
    const { hasReusablePartChars } = createSyncCreatorHelperHarness();
    const { backgroundPart } = createGroupedFixture();

    assert.equal(hasReusablePartChars(backgroundPart, backgroundPart), true);
    assert.equal(hasReusablePartChars(
        { ...backgroundPart, ranges: [{ start: 2, end: 4 }, { start: 9, end: 10 }] },
        backgroundPart
    ), false);
    assert.equal(hasReusablePartChars(
        backgroundPart,
        { ...backgroundPart, chars: backgroundPart.chars.slice(0, -1) }
    ), false);
});
