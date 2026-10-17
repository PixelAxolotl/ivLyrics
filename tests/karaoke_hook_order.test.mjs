import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// React error #300 regression: KaraokeLine (Pages.js) must call the same hooks
// in the same order on every render. It used to return early on `!line`, on
// `vocalRows` and on `glyphUpdates`, so a line whose vocal rows appear or
// disappear changed the hook count and React threw
// "Rendered fewer hooks than expected".
const pages = readFileSync(new URL('../Pages.js', import.meta.url), 'utf8');
const segmenter = readFileSync(new URL('../LyricsWordSegmenter.js', import.meta.url), 'utf8');
const service = readFileSync(new URL('../LyricsService.js', import.meta.url), 'utf8');

const slice = (s, from, to) => {
    const start = s.indexOf(from);
    const end = s.indexOf(to, start + from.length);
    assert.ok(start >= 0 && end > start, `missing production section: ${from}`);
    return s.slice(start, end);
};

// A React stand-in that enforces the rule React itself enforces: one component
// instance must run the same number of hooks on every render.
const createHookOrderHarness = () => {
    const instances = new Map();
    let active = null;
    const bump = () => {
        const index = active.index++;
        const record = active.record;
        if (record.lastCount !== undefined && active.index > record.lastCount) {
            throw new Error(`Rendered more hooks than expected: previous render used ${record.lastCount}, this render reached ${active.index}.`);
        }
        return index;
    };
    const useMemo = (build, dependencies) => {
        const index = bump();
        const prior = active.hooks[index];
        if (prior && dependencies.length === prior.dependencies.length
            && dependencies.every((d, i) => Object.is(d, prior.dependencies[i]))) return prior.value;
        const value = build();
        active.hooks[index] = { value, dependencies };
        return value;
    };
    const window = {
        locale: 'en', furiganaReady: false, reducedMotion: false,
        Utils: { getDetectedLanguage: () => 'en' },
        matchMedia: () => ({ get matches() { return window.reducedMotion; } }),
        FuriganaConverter: { isAvailable: () => false },
    };
    const serviceContext = { module: { exports: {} } };
    vm.runInNewContext(service, serviceContext);
    window.LyricsService = { buildKaraokeWordSegments: (...args) =>
        serviceContext.module.exports.KaraokeWordTiming.buildTimedSegments(...args) };
    const context = vm.createContext({
        CONFIG: { visual: { 'karaoke-bounce': false, 'karaoke-text-effects': false,
            'sync-data-custom-speaker-colors-enabled': true, 'furigana-enabled': false } },
        window, console, navigator: { language: 'en' },
        Utils: { applyFuriganaIfEnabled: text => text },
        getCopyableText: value => Array.isArray(value) ? value.join('') : String(value ?? ''),
        toFiniteTime: value => Number.isFinite(Number(value)) ? Number(value) : null,
        KARAOKE_RELEASE_WINDOW_MS: 820, KARAOKE_COMPLETION_POSITION_OFFSET_MS: 900,
        useRef: initial => { const i = bump(); return active.hooks[i]?.current ?? (active.hooks[i] = { current: initial }); },
        useMemo,
        useState: initial => { bump(); return [initial, () => {}]; },
        useEffect: () => { bump(); },
        useCallback: callback => { bump(); return callback; },
        react: { Fragment: 'fragment', memo: component => component,
            createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }) },
    });
    vm.runInContext(segmenter, context);
    window.LyricsWordSegmenter = { ...context.LyricsWordSegmenter };
    vm.runInContext([
        slice(pages, 'const prefersReducedLyricsMotion =', '\nconst '),
        slice(pages, 'const getTimedSyllablesFromLine', 'const getInterludeInfo'),
        slice(pages, 'const KARAOKE_PRE_SPACE_MIN_DURATION_MS', 'const getSyncedAnimationIndex'),
        slice(pages, 'const getKaraokeLineBounds', 'const SyncedLyricsPage = react.memo'),
        'globalThis.api = { KaraokeLine, getKaraokeVocalRows, hasKaraokeVocalRows };',
    ].join('\n'), context);

    const resolve = (node, path) => {
        if (Array.isArray(node)) return node.map((child, i) => resolve(child, `${path}/${i}`));
        if (!node || typeof node !== 'object') return node;
        if (typeof node.tag === 'function') return renderComponent(node.tag, node.props, `${path}/c`);
        return { ...node, children: resolve(node.children, path) };
    };
    // React keys hook state by component identity, not by position: swapping one
    // component for another at the same place remounts instead of re-running a
    // different number of hooks. Mirror that or the harness reports false alarms.
    const componentIds = new WeakMap();
    let nextComponentId = 0;
    const idOf = component => {
        if (!componentIds.has(component)) componentIds.set(component, ++nextComponentId);
        return componentIds.get(component);
    };

    function renderComponent(component, props, path) {
        const key = `${idOf(component)}@${path}`;
        if (!instances.has(key)) instances.set(key, { hooks: [], record: { lastCount: undefined } });
        // A nested component must not steal the parent's hook cursor.
        const previous = active;
        active = instances.get(key);
        active.index = 0;
        try {
            return resolve(component(props), path);
        } finally {
            const record = active.record;
            if (record.lastCount !== undefined && active.index !== record.lastCount) {
                throw new Error(`Rendered ${active.index < record.lastCount ? 'fewer' : 'more'} hooks than expected: previous render used ${record.lastCount}, this render used ${active.index}.`);
            }
            record.lastCount = active.index;
            active = previous;
        }
    }
    return {
        hooksUsed: () => [...instances.values()].map(i => i.record.lastCount),
        render: (line, position = 1200, props = {}) => renderComponent(context.api.KaraokeLine, {
            line, position, isActive: true, renderGranularity: 'character', ...props,
        }, 'root'),
    };
};

const syllablesFor = (text, startTime) => Array.from(text, (char, i) => ({
    text: char, startTime: startTime + i * 110, endTime: startTime + (i + 1) * 110,
}));
const plainLine = () => {
    const text = 'Hello long words here';
    return { text, startTime: 1000, endTime: 5000, syllables: syllablesFor(text, 1000) };
};
const vocalLine = () => {
    const lead = { id: 'lead', text: 'Lead row text', speaker: 'CUSTOM', startTime: 1000,
        endTime: 3000, syllables: syllablesFor('Lead row text', 1000) };
    const background = { id: 'bg', text: 'Back row text', speaker: 'CUSTOM', startTime: 1000,
        endTime: 3000, syllables: syllablesFor('Back row text', 1000) };
    return { text: 'Lead row text / Back row text', startTime: 1000, endTime: 3000,
        vocals: { lead, background: [background] } };
};

test('KaraokeLine runs the same hooks whether or not the line has vocal rows', () => {
    const harness = createHookOrderHarness();
    harness.render(plainLine());
    assert.ok(harness.hooksUsed()[0] > 1, 'the plain line registered its hooks');
    assert.doesNotThrow(() => harness.render(vocalLine()), 'adding vocal rows must not change the hook count');
    assert.doesNotThrow(() => harness.render(plainLine()), 'dropping vocal rows must not change the hook count');
});

test('KaraokeLine runs the same hooks when the line briefly disappears', () => {
    const harness = createHookOrderHarness();
    harness.render(plainLine());
    assert.doesNotThrow(() => harness.render(null), 'a missing line must not change the hook count');
    assert.doesNotThrow(() => harness.render(plainLine()), 'and the next real line must line up again');
});

test('KaraokeLine renders nothing for a missing line and the full row otherwise', () => {
    const harness = createHookOrderHarness();
    assert.equal(JSON.stringify(harness.render(null)), '""', 'no line renders nothing');
    assert.ok(JSON.stringify(harness.render(plainLine())).length > 0, 'a real line renders its glyphs');
});