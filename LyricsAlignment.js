(function ivLyricsAlignmentModule() {
    'use strict';

    const VERSION = 'semantic-alignment-v1';
    const STORAGE_KEY = 'ivLyrics:visual:semantic-alignment-cache';
    const KIND_KEYS = Object.freeze({
        phonetic: 'phonetic-semantic-highlight',
        translation: 'translation-semantic-highlight',
    });
    const MAX_LINES = 8;
    const MAX_TEXT = 12_000;
    const memory = new Map();
    const pending = new Map();
    const listeners = new Set();

    const emit = (detail = {}) => {
        listeners.forEach(listener => {
            try { listener(detail); } catch (_) { /* observers are optional */ }
        });
        try { window.dispatchEvent(new CustomEvent('ivlyrics-alignment-state', { detail })); } catch (_) { }
    };

    const storage = () => window.ivLyricsStoragePersistence || window.Spicetify?.LocalStorage;
    const readStorage = (key) => {
        try { return storage()?.getItem ? storage().getItem(key) : storage()?.get(key); } catch (_) { return null; }
    };
    const writeStorage = (key, value) => {
        try {
            if (storage()?.setItem) storage().setItem(key, value);
            else storage()?.set(key, value);
        } catch (_) { }
    };

    const boolSetting = (kind) => {
        const key = `ivLyrics:visual:${KIND_KEYS[kind]}`;
        const value = readStorage(key);
        return value === true || value === 'true' || value === '1';
    };

    const graphemes = (value) => {
        const text = String(value ?? '');
        try {
            if (typeof Intl !== 'undefined' && Intl.Segmenter) {
                return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
            }
        } catch (_) { }
        return Array.from(text);
    };
    const unitText = (unit) => typeof unit === 'object' && unit !== null ? String(unit.text ?? '') : String(unit ?? '');
    const unitCount = (units, fallbackText) => Array.isArray(units) && units.length ? units.length : graphemes(fallbackText).length;
    const range = (value, count) => {
        if (!Array.isArray(value) || value.length !== 2) return null;
        const start = Number(value[0]);
        const end = Number(value[1]);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > count) return null;
        return [start, end];
    };
    const validRanges = (value, count) => Array.isArray(value) ? value.map(item => range(item, count)).filter(Boolean) : [];

    const hash = (value) => {
        let result = 2166136261;
        for (const character of String(value)) {
            result ^= character.codePointAt(0);
            result = Math.imul(result, 16777619);
        }
        return (result >>> 0).toString(36);
    };
    const normalizeLine = (line, index) => {
        if (!line || typeof line !== 'object') return null;
        const kind = line.kind === 'phonetic' ? 'phonetic' : line.kind === 'translation' ? 'translation' : null;
        if (!kind) return null;
        const sourceText = String(line.sourceText ?? '');
        const targetText = String(line.targetText ?? '');
        const sourceUnits = (Array.isArray(line.sourceUnits) && line.sourceUnits.length ? line.sourceUnits : graphemes(sourceText)).map(unitText);
        const targetUnits = (Array.isArray(line.targetUnits) && line.targetUnits.length ? line.targetUnits : graphemes(targetText)).map(unitText);
        if (!sourceText || !targetText || sourceText.length > MAX_TEXT || targetText.length > MAX_TEXT || !sourceUnits.length || !targetUnits.length) return null;
        return {
            id: String(line.id ?? `line-${index}`), kind, sourceText, targetText, sourceUnits, targetUnits,
            sourceLang: String(line.sourceLang ?? ''), targetLang: String(line.targetLang ?? ''),
            sourceTimes: Array.isArray(line.sourceTimes) ? line.sourceTimes.map(time => ({ start: Number(time?.start), end: Number(time?.end) })) : [],
        };
    };

    const availability = (kind) => {
        const manager = window.AIAddonManager;
        const providers = typeof manager?.getEnabledProvidersFor === 'function'
            ? manager.getEnabledProvidersFor('lyricsAlignment').filter(provider => typeof provider?.generateLyricsAlignment === 'function')
            : [];
        const enabled = kind === 'phonetic' || kind === 'translation' ? boolSetting(kind) : false;
        if (!enabled) return { available: false, reason: 'disabled', providers: [] };
        if (!providers.length) return { available: false, reason: 'no-provider', providers: [] };
        return { available: true, reason: 'available', providers: providers.map(provider => provider.id) };
    };

    const getCachedStore = () => {
        if (memory.size) return memory;
        try {
            const parsed = JSON.parse(readStorage(STORAGE_KEY) || '{}');
            Object.entries(parsed).forEach(([key, value]) => memory.set(key, value));
        } catch (_) { }
        return memory;
    };
    const persist = () => {
        const entries = Array.from(memory.entries()).slice(-120);
        writeStorage(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    };

    const keyFor = (line) => hash(JSON.stringify([VERSION, line.kind, line.sourceLang, line.targetLang, line.sourceText, line.targetText, line.sourceUnits, line.targetUnits]));
    const normalizeResult = (line, result) => {
        const root = result && typeof result === 'object' ? result : {};
        const rows = Array.isArray(root.lines) ? root.lines : [];
        const row = rows.find(candidate => String(candidate?.id) === line.id) || rows[0];
        const sourceCount = line.sourceUnits.length;
        const targetCount = line.targetUnits.length;
        if (!row || !Array.isArray(row.groups)) return { id: line.id, kind: line.kind, groups: [], status: 'fallback' };
        const occupiedTarget = new Set();
        const groups = [];
        row.groups.forEach(group => {
            const source = validRanges(group?.source, sourceCount);
            const target = validRanges(group?.target, targetCount);
            if (!source.length || !target.length) return;
            if (target.some(item => Array.from({ length: item[1] - item[0] }, (_, offset) => item[0] + offset).some(index => occupiedTarget.has(index)))) return;
            target.forEach(item => { for (let index = item[0]; index < item[1]; index += 1) occupiedTarget.add(index); });
            groups.push({ source, target });
        });
        return { id: line.id, kind: line.kind, groups, status: groups.length ? 'ready' : 'fallback' };
    };

    const buildRequest = (lines) => ({
        lines: lines.map(line => ({
            id: line.id, kind: line.kind, sourceText: line.sourceText, targetText: line.targetText,
            sourceUnits: line.sourceUnits, targetUnits: line.targetUnits,
            sourceLang: line.sourceLang, targetLang: line.targetLang,
        })),
        schemaVersion: VERSION,
    });

    const request = async (input, options = {}) => {
        const lines = (Array.isArray(input) ? input : [input]).map(normalizeLine).filter(Boolean).slice(0, MAX_LINES);
        if (!lines.length) return [];
        const allowed = lines.filter(line => availability(line.kind).available);
        const results = lines.map(line => availability(line.kind).available
            ? (getCachedStore().get(keyFor(line)) || { id: line.id, kind: line.kind, groups: [], status: 'fallback' })
            : { id: line.id, kind: line.kind, groups: [], status: 'fallback' });
        if (!allowed.length) return results;
        const uncached = allowed.filter(line => !getCachedStore().has(keyFor(line)));
        if (!uncached.length) return results.map(line => getCachedStore().get(keyFor(line)) || line);
        const requestKey = hash(JSON.stringify(uncached.map(keyFor)));
        if (!pending.has(requestKey)) {
            const manager = window.AIAddonManager;
            pending.set(requestKey, Promise.resolve().then(() => manager.generateLyricsAlignment({
                lines: buildRequest(uncached).lines,
                lyricsAlignmentPrompt: options.prompt,
                sourceLang: options.sourceLang,
                targetLang: options.targetLang,
            })).then(raw => {
                uncached.forEach(line => getCachedStore().set(keyFor(line), normalizeResult(line, raw)));
                persist();
                emit({ type: 'alignment:updated', keys: uncached.map(keyFor) });
                return true;
            }).catch(error => {
                emit({ type: 'alignment:error', error });
                return false;
            }).finally(() => pending.delete(requestKey)));
        }
        await pending.get(requestKey);
        return lines.map(line => getCachedStore().get(keyFor(line)) || { id: line.id, kind: line.kind, groups: [], status: 'fallback' });
    };

    const get = (line) => {
        const normalized = normalizeLine(line, 0);
        return normalized ? getCachedStore().get(keyFor(normalized)) || null : null;
    };
    const onChange = listener => { if (typeof listener === 'function') { listeners.add(listener); return () => listeners.delete(listener); } return () => {}; };

    window.LyricsAlignment = Object.freeze({
        VERSION, KIND_KEYS, graphemes, keyFor, normalizeLine, normalizeResult,
        getAvailability: availability, isEnabled: kind => boolSetting(kind), request, ensure: request, get, onChange,
        clearCache() { memory.clear(); writeStorage(STORAGE_KEY, '{}'); emit({ type: 'alignment:cache-cleared' }); },
    });
})();
