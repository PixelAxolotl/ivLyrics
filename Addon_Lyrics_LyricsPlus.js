/**
 * LyricsPlus Lyrics Provider Addon
 *
 * The API origins are stored as double-Base64 literals and decoded only when
 * a request is built. The provider consumes LyricsPlus v2 JSON converted from
 * source TTML and exposes karaoke, line-synced, and plain lyrics to ivLyrics.
 *
 * @addon-type lyrics
 * @id lyricsplus
 * @name LyricsPlus
 * @version 1.0.0
 * @author default
 * @supports karaoke: true
 * @supports synced: true
 * @supports unsynced: true
 */

(() => {
    'use strict';

    const ENCODED_API_BASES = Object.freeze([
        'YUhSMGNITTZMeTlzZVhKcFkzTndiSFZ6TG5CeWFtdDBiR0V1YlhrdWFXUT0=',
        'YUhSMGNITTZMeTlzZVhKcFkzTXVaMlZsYTJWa0xuZDBaZz09'
    ]);
    const API_PATH = '/v2/lyrics/get';
    const REQUEST_TIMEOUT_MS = 10000;
    const SYLLABLE_TIMING_TOLERANCE_MS = 1500;
    const PARALLEL_VOCAL_MIN_OVERLAP_MS = 30;
    const PARALLEL_VOCAL_MAX_SOURCE_LINES = 4;
    const PARALLEL_VOCAL_MAX_SEGMENT_DELAY_MS = 16;
    const SOLO_LINE_SPLIT_TRIGGER_WIDTH = 22;
    const SOLO_LINE_SPLIT_HARD_WIDTH = 26;
    const SOLO_LINE_SPLIT_MIN_WIDTH = 6;
    const SOLO_LINE_SPLIT_MIN_DURATION_MS = 500;
    const SOLO_LINE_SPLIT_MAX_SEGMENTS = 4;
    const DISPLAY_MARK_PATTERN = /\p{Mark}/u;
    const DISPLAY_WHITESPACE_PATTERN = /\s/u;
    const DISPLAY_FULL_WIDTH_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}]/u;
    const DISPLAY_UPPERCASE_PATTERN = /[A-Z]/u;
    const DISPLAY_LOWERCASE_PATTERN = /[a-z]/u;
    const DISPLAY_NUMBER_PATTERN = /\p{Number}/u;
    const DISPLAY_PUNCTUATION_PATTERN = /[.,'’!?;:()\-]/u;
    const OBJECT_PROPERTY_IS_ENUMERABLE = Object.prototype.propertyIsEnumerable;
    const CACHE_VERSION = '2026-07-13-lyricsplus-10';
    const ATTRIBUTION = 'Lyrics from LyricsPlus.';
    let nextApiBaseIndex = 0;

    const SPEAKER_PALETTE = [
        { color: '#a8ccff', fallback: 'MALE 1' },
        { color: '#ffb8c7', fallback: 'FEMALE 1' },
        { color: '#e4d8ff', fallback: 'DUET 1' },
        { color: '#9ae8d4', fallback: 'MALE 2' },
        { color: '#ffd6b3', fallback: 'FEMALE 2' },
        { color: '#d6e4ff', fallback: 'DUET 2' },
        { color: '#bfe8ff', fallback: 'MALE 3' },
        { color: '#f6c8ff', fallback: 'FEMALE 3' },
        { color: '#ffddf2', fallback: 'DUET 3' }
    ];
    const GROUP_SPEAKER_PALETTE = SPEAKER_PALETTE.filter(item => item.fallback.startsWith('DUET'));

    const ADDON_INFO = {
        id: 'lyricsplus',
        name: 'LyricsPlus',
        author: 'default',
        version: '1.0.0',
        cacheVersion: CACHE_VERSION,
        description: {
            en: 'Word-synced lyrics from the LyricsPlus community API',
            ko: 'LyricsPlus 커뮤니티 API에서 단어 단위 싱크 가사를 가져옵니다'
        },
        supports: {
            karaoke: true,
            synced: true,
            unsynced: true
        },
        supportsLocalTracks: true,
        useIvLyricsSync: false,
        icon: 'M9 3v10.55A4 4 0 1 0 11 17V7h6V3H9v10a4 4 0 1 0 2 3.45V7h4v6a4 4 0 1 0 2 3.45V3H9z'
    };

    function decodeBase64Twice(value) {
        return globalThis.atob(globalThis.atob(String(value || '')));
    }

    function getApiBases() {
        return ENCODED_API_BASES.map(decodeBase64Twice);
    }

    function reserveApiAttemptOrder(apiBases = getApiBases()) {
        if (!Array.isArray(apiBases) || apiBases.length === 0) return [];
        const startIndex = nextApiBaseIndex % apiBases.length;
        nextApiBaseIndex = (startIndex + 1) % apiBases.length;

        return apiBases.map((_apiBase, offset) => {
            const mirrorIndex = (startIndex + offset) % apiBases.length;
            return { apiBase: apiBases[mirrorIndex], mirrorIndex };
        });
    }

    function normalizeInlineText(value) {
        return String(value ?? '').replace(/[\r\n\t\f\v ]+/g, ' ');
    }

    function normalizeDisplayText(value) {
        return normalizeInlineText(value).trim();
    }

    function normalizeMetadataText(value) {
        if (Array.isArray(value)) {
            return value
                .map(item => normalizeMetadataText(item))
                .filter(Boolean)
                .join(', ');
        }
        if (value && typeof value === 'object') {
            return normalizeDisplayText(value.name || value.title || '');
        }
        return normalizeDisplayText(value);
    }

    function toFiniteMilliseconds(value) {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
    }

    function toPositiveMilliseconds(value) {
        const number = toFiniteMilliseconds(value);
        return Number.isFinite(number) && number > 0 ? number : null;
    }

    function normalizeDurationMs(info) {
        const duration = Number(info?.durationMs ?? info?.duration_ms ?? info?.duration ?? 0);
        if (!Number.isFinite(duration) || duration <= 0) return 0;
        return duration > 10000 ? Math.round(duration) : Math.round(duration * 1000);
    }

    function normalizeDurationSeconds(info) {
        const durationMs = normalizeDurationMs(info);
        if (!durationMs) return '';
        return String(Math.round(durationMs) / 1000);
    }

    function normalizeIsrc(value) {
        const serviceValue = window.SyncDataService?.normalizeSyncDataIsrc?.(value);
        const normalized = String(serviceValue || value || '')
            .replace(/[^A-Za-z0-9]/g, '')
            .toUpperCase();
        return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalized) ? normalized : '';
    }

    function extractTrackId(uri) {
        return window.LyricsService?.extractTrackId?.(uri)
            || window.ivLyricsTrackIdentity?.extractTrackId?.(uri)
            || String(uri || '').match(/^spotify:track:([^:]+)$/)?.[1]
            || '';
    }

    async function resolveTrackIsrc(info) {
        const directCandidates = [
            info?.isrc,
            info?.external_ids?.isrc,
            info?.externalIds?.isrc,
            info?.metadata?.isrc,
            info?.track?.external_ids?.isrc
        ];
        for (const candidate of directCandidates) {
            const isrc = normalizeIsrc(candidate);
            if (isrc) return isrc;
        }

        const trackId = extractTrackId(info?.uri);
        if (!trackId || !window.SyncDataService) return '';

        const cached = normalizeIsrc(window.SyncDataService.getTrackIsrc?.(trackId, info));
        if (cached) return cached;

        try {
            return normalizeIsrc(await window.SyncDataService.resolveTrackIsrc?.(trackId, info));
        } catch (error) {
            console.warn('[LyricsPlus Lyrics Addon] ISRC lookup failed:', error);
            return '';
        }
    }

    function buildLyricsUrl(apiBase, info, isrc) {
        const url = new URL(API_PATH, apiBase);
        const title = normalizeMetadataText(info?.title || info?.name);
        const artist = normalizeMetadataText(info?.artist || info?.artists);
        const album = normalizeMetadataText(info?.album || info?.albumName);
        const duration = normalizeDurationSeconds(info);

        if (isrc) {
            url.searchParams.set('isrc', isrc);
        } else if (title && artist) {
            url.searchParams.set('title', title);
            url.searchParams.set('artist', artist);
            if (album && album !== 'undefined') url.searchParams.set('album', album);
            if (duration) url.searchParams.set('duration', duration);
        }

        return url;
    }

    function isUsablePayload(payload) {
        return payload
            && !payload.error
            && Array.isArray(payload.lyrics)
            && payload.lyrics.some(line => normalizeDisplayText(line?.text)
                || (Array.isArray(line?.syllabus) && line.syllabus.some(item => normalizeDisplayText(item?.text))));
    }

    async function fetchJson(url, mirrorIndex) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;

        try {
            const response = await fetch(url.toString(), {
                headers: { Accept: 'application/json' },
                signal: controller?.signal
            });
            const body = await response.json().catch(() => null);

            if (!response.ok || !isUsablePayload(body)) {
                const message = body?.error?.message
                    || body?.error?.details?.message
                    || (typeof body?.error === 'string' ? body.error : '')
                    || `request failed (${response.status})`;
                const error = new Error(`LyricsPlus mirror ${mirrorIndex + 1}: ${message}`);
                error.status = response.status;
                error.notFound = response.status === 404
                    || (response.ok
                        && body
                        && !body.error
                        && Array.isArray(body.lyrics));
                throw error;
            }

            return body;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function fetchLyricsData(info) {
        const isrc = await resolveTrackIsrc(info);
        const title = normalizeMetadataText(info?.title || info?.name);
        const artist = normalizeMetadataText(info?.artist || info?.artists);
        if (!isrc && (!title || !artist)) {
            throw new Error('Missing ISRC or track metadata');
        }

        const errors = [];
        const apiAttempts = reserveApiAttemptOrder();
        for (const { apiBase, mirrorIndex } of apiAttempts) {
            try {
                const data = await fetchJson(buildLyricsUrl(apiBase, info, isrc), mirrorIndex);
                return { data, isrc, mirror: mirrorIndex + 1 };
            } catch (error) {
                errors.push(error);
                window.__ivLyricsDebugLog?.(`[LyricsPlus Lyrics Addon] Mirror ${mirrorIndex + 1} failed`, {
                    status: error?.status || null,
                    error: error?.name || 'Error'
                });
            }
        }

        if (errors.length > 0 && errors.every(error => error?.notFound === true)) return null;
        throw [...errors].reverse().find(error => error?.notFound !== true)
            || errors[errors.length - 1]
            || new Error('LyricsPlus request failed');
    }

    function getAgentMetadata(singer, agents = {}) {
        const singerId = String(singer || '').trim();
        if (!singerId) return null;

        const agentSource = agents || {};
        if (OBJECT_PROPERTY_IS_ENUMERABLE.call(agentSource, singerId)) {
            const agent = agentSource[singerId];
            return {
                id: singerId,
                type: normalizeDisplayText(agent?.type).toLowerCase(),
                name: normalizeDisplayText(agent?.name),
                alias: normalizeDisplayText(agent?.alias)
            };
        }

        const entries = Object.entries(agentSource);
        const normalizedSingerId = normalizeDisplayText(singerId).toLocaleLowerCase();
        const match = entries.find(([id]) => normalizeDisplayText(id).toLocaleLowerCase() === normalizedSingerId)
            || entries.find(([_id, agent]) => (
                normalizeDisplayText(agent?.alias).toLocaleLowerCase() === normalizedSingerId
            ));
        if (!match) return null;

        const [id, agent] = match;
        return {
            id,
            type: normalizeDisplayText(agent?.type).toLowerCase(),
            name: normalizeDisplayText(agent?.name),
            alias: normalizeDisplayText(agent?.alias)
        };
    }

    function getSpeakerPresentation(singer, singerOrder, agents = {}, cache = null) {
        const rawSingerId = String(singer || '').trim();
        if (cache?.has(rawSingerId)) return cache.get(rawSingerId);
        if (!rawSingerId) {
            const presentation = { speaker: 'NORMAL', lyricsPlusSinger: '' };
            cache?.set(rawSingerId, presentation);
            return presentation;
        }

        const agent = getAgentMetadata(rawSingerId, agents);
        const singerId = agent?.id || rawSingerId;
        if (!singerOrder.has(singerId)) singerOrder.set(singerId, singerOrder.size);
        const index = singerOrder.get(singerId) || 0;
        const agentFields = {
            lyricsPlusSinger: singerId,
            lyricsPlusAgentType: agent?.type || '',
            lyricsPlusAgentName: agent?.name || '',
            lyricsPlusAgentAlias: agent?.alias || ''
        };
        if (index === 0) {
            const presentation = { speaker: 'NORMAL', ...agentFields };
            cache?.set(rawSingerId, presentation);
            return presentation;
        }

        let palette = SPEAKER_PALETTE[(index - 1) % SPEAKER_PALETTE.length];
        if (agent?.type === 'group' && GROUP_SPEAKER_PALETTE.length > 0) {
            const priorGroupCount = Array.from(singerOrder.entries())
                .filter(([candidate, candidateIndex]) => (
                    candidateIndex < index && getAgentMetadata(candidate, agents)?.type === 'group'
                ))
                .length;
            palette = GROUP_SPEAKER_PALETTE[priorGroupCount % GROUP_SPEAKER_PALETTE.length];
        }

        const presentation = {
            speaker: 'CUSTOM',
            'speaker-color': palette.color,
            'speaker-fallback': palette.fallback,
            ...agentFields
        };
        cache?.set(rawSingerId, presentation);
        return presentation;
    }

    function parseSyllable(item) {
        const startTime = toFiniteMilliseconds(item?.time);
        if (!Number.isFinite(startTime)) return null;
        const duration = toPositiveMilliseconds(item?.duration) || 1;
        const text = normalizeInlineText(item?.text);
        if (!text) return null;

        return {
            text,
            startTime,
            endTime: startTime + duration,
            isBackground: item?.isBackground === true
        };
    }

    function isSyllableWithinLine(syllable, lineStart, lineEnd) {
        if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) return true;
        return syllable.startTime >= lineStart - SYLLABLE_TIMING_TOLERANCE_MS
            && syllable.endTime <= lineEnd + SYLLABLE_TIMING_TOLERANCE_MS;
    }

    function joinSyllableText(syllables) {
        return normalizeDisplayText((syllables || []).map(syllable => syllable?.text || '').join(''));
    }

    function measureLyricsDisplayWidth(value) {
        let width = 0;
        for (const character of String(value || '')) {
            if (DISPLAY_MARK_PATTERN.test(character)) continue;
            if (DISPLAY_WHITESPACE_PATTERN.test(character)) {
                width += 0.33;
            } else if (DISPLAY_FULL_WIDTH_PATTERN.test(character)) {
                width += 1;
            } else if (DISPLAY_UPPERCASE_PATTERN.test(character)) {
                width += 0.72;
            } else if (DISPLAY_LOWERCASE_PATTERN.test(character)) {
                width += 0.58;
            } else if (DISPLAY_NUMBER_PATTERN.test(character)) {
                width += 0.62;
            } else if (DISPLAY_PUNCTUATION_PATTERN.test(character)) {
                width += 0.38;
            } else {
                width += 0.8;
            }
        }
        return width;
    }

    function getBoundaryCharacter(value, fromEnd = false) {
        const characters = Array.from(String(value || ''))
            .filter(character => !/[\s\p{Mark}]/u.test(character));
        return (fromEnd ? characters[characters.length - 1] : characters[0]) || '';
    }

    function isLatinOrNumber(character) {
        return /[\p{Script=Latin}\p{Number}]/u.test(character || '');
    }

    function isCjkCharacter(character) {
        return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character || '');
    }

    function isNoSpaceLineBreakCharacter(character) {
        return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character || '');
    }

    function getSafeSoloLineBoundary(leftSyllable, rightSyllable) {
        const leftText = String(leftSyllable?.text || '');
        const rightText = String(rightSyllable?.text || '');
        const leftCharacter = getBoundaryCharacter(leftText, true);
        const rightCharacter = getBoundaryCharacter(rightText, false);
        if (!leftCharacter || !rightCharacter) return null;
        if (/[\(\[\{（「『【〈《]/u.test(leftCharacter)) return null;
        if (/[\)\]\}）」』】〉》、。，．！？?!]/u.test(rightCharacter)) return null;
        if (/[ゃゅょっぁぃぅぇぉゎャュョッァィゥェォヮー々]/u.test(rightCharacter)) return null;

        const leftEndTime = Number(leftSyllable?.endTime);
        const rightStartTime = Number(rightSyllable?.startTime);
        if (!Number.isFinite(leftEndTime)
            || !Number.isFinite(rightStartTime)
            || leftEndTime > rightStartTime) {
            return null;
        }

        const hasWhitespace = /\s$/u.test(leftText) || /^\s/u.test(rightText);
        const followsPunctuation = /[。！？?!…；;：:、，,.]/u.test(leftCharacter);
        const changesBetweenCjkAndLatin = (
            isCjkCharacter(leftCharacter) && isLatinOrNumber(rightCharacter)
        ) || (
            isLatinOrNumber(leftCharacter) && isCjkCharacter(rightCharacter)
        );
        const isNoSpaceScriptBoundary = isNoSpaceLineBreakCharacter(leftCharacter)
            && isNoSpaceLineBreakCharacter(rightCharacter);

        // Some TTML sources split one English word into multiple timed spans
        // (for example, "Wond" + "er"). Never treat that as a line boundary.
        if (isLatinOrNumber(leftCharacter)
            && isLatinOrNumber(rightCharacter)
            && !hasWhitespace
            && !followsPunctuation) {
            return null;
        }
        if (!hasWhitespace
            && !followsPunctuation
            && !changesBetweenCjkAndLatin
            && !isNoSpaceScriptBoundary) {
            return null;
        }

        return {
            penalty: hasWhitespace
                ? 0
                : (followsPunctuation ? 0.25 : (isNoSpaceScriptBoundary ? 1 : 2.5)),
            gapMs: Math.max(0, rightStartTime - leftEndTime)
        };
    }

    function getSoloLineSplitPlan(syllables, totalWidth) {
        const candidateBoundaries = new Map();
        for (let index = 1; index < syllables.length; index++) {
            const boundary = getSafeSoloLineBoundary(syllables[index - 1], syllables[index]);
            if (boundary) candidateBoundaries.set(index, boundary);
        }
        if (candidateBoundaries.size === 0) return null;

        const rawTexts = syllables.map(syllable => String(syllable.text || ''));
        const maximumSegmentCount = Math.min(
            SOLO_LINE_SPLIT_MAX_SEGMENTS,
            candidateBoundaries.size + 1,
            syllables.length
        );
        const minimumSegmentCount = Math.max(
            2,
            Math.ceil(totalWidth / SOLO_LINE_SPLIT_HARD_WIDTH)
        );

        const findPlanForCount = segmentCount => {
            const targetWidth = totalWidth / segmentCount;
            const memo = new Map();

            const search = (startIndex, remainingSegments) => {
                const memoKey = `${startIndex}:${remainingSegments}`;
                if (memo.has(memoKey)) return memo.get(memoKey);

                if (remainingSegments === 1) {
                    const width = measureLyricsDisplayWidth(rawTexts.slice(startIndex).join(''));
                    const first = syllables[startIndex];
                    const last = syllables[syllables.length - 1];
                    const duration = last.endTime - first.startTime;
                    const result = width >= SOLO_LINE_SPLIT_MIN_WIDTH
                        && width <= SOLO_LINE_SPLIT_HARD_WIDTH
                        && duration >= SOLO_LINE_SPLIT_MIN_DURATION_MS
                        ? { cost: Math.pow(width - targetWidth, 2), boundaries: [] }
                        : null;
                    memo.set(memoKey, result);
                    return result;
                }

                let best = null;
                const maximumEndIndex = syllables.length - (remainingSegments - 1);
                for (let endIndex = startIndex + 1; endIndex <= maximumEndIndex; endIndex++) {
                    const boundary = candidateBoundaries.get(endIndex);
                    if (!boundary) continue;

                    const width = measureLyricsDisplayWidth(rawTexts.slice(startIndex, endIndex).join(''));
                    const first = syllables[startIndex];
                    const last = syllables[endIndex - 1];
                    const duration = last.endTime - first.startTime;
                    if (width < SOLO_LINE_SPLIT_MIN_WIDTH
                        || width > SOLO_LINE_SPLIT_HARD_WIDTH
                        || duration < SOLO_LINE_SPLIT_MIN_DURATION_MS) {
                        continue;
                    }

                    const remaining = search(endIndex, remainingSegments - 1);
                    if (!remaining) continue;
                    const timingGapBonus = Math.min(boundary.gapMs / 200, 1);
                    const cost = Math.pow(width - targetWidth, 2)
                        + (boundary.penalty * 4)
                        - timingGapBonus
                        + remaining.cost;
                    if (!best || cost < best.cost) {
                        best = {
                            cost,
                            boundaries: [endIndex, ...remaining.boundaries]
                        };
                    }
                }

                memo.set(memoKey, best);
                return best;
            };

            return search(0, segmentCount);
        };

        for (let segmentCount = minimumSegmentCount;
            segmentCount <= maximumSegmentCount;
            segmentCount++) {
            const plan = findPlanForCount(segmentCount);
            if (plan) return [0, ...plan.boundaries, syllables.length];
        }
        return null;
    }

    function splitLongSoloVocalLine(line, previousLine = null, nextLine = null) {
        const syllables = Array.isArray(line?.syllables) ? line.syllables : [];
        if (syllables.length < 2
            || line?.vocals
            || line?.lyricsPlusParallelVocal
            || line?.lyricsPlusFragment
            || line?.lyricsPlusSoloSegment
            || line?.lyricsPlusPromotedBackgroundFragment
            || line?.lyricsPlusSegmentCount) {
            return [line];
        }

        for (let index = 0; index < syllables.length; index++) {
            const syllable = syllables[index];
            const previous = syllables[index - 1];
            if (!normalizeInlineText(syllable?.text)
                || !Number.isFinite(syllable?.startTime)
                || !Number.isFinite(syllable?.endTime)
                || syllable.endTime < syllable.startTime
                || syllable.lyricsPlusSeparator
                || (previous && (
                    syllable.startTime <= previous.startTime
                    || syllable.startTime < previous.endTime
                ))) {
                return [line];
            }
        }

        const firstSyllable = syllables[0];
        const lastSyllable = syllables[syllables.length - 1];
        if ((Number.isFinite(previousLine?.endTime) && previousLine.endTime > firstSyllable.startTime)
            || (Number.isFinite(nextLine?.startTime) && nextLine.startTime < lastSyllable.endTime)) {
            return [line];
        }

        const lineText = normalizeDisplayText(line?.originalText || line?.text);
        const syllableText = joinSyllableText(syllables);
        if (!lineText || lineText !== syllableText) return [line];

        const totalWidth = measureLyricsDisplayWidth(lineText);
        if (totalWidth <= SOLO_LINE_SPLIT_TRIGGER_WIDTH
            || syllables.some(syllable => (
                measureLyricsDisplayWidth(syllable.text) > SOLO_LINE_SPLIT_HARD_WIDTH
            ))) {
            return [line];
        }

        const plan = getSoloLineSplitPlan(syllables, totalWidth);
        if (!plan || plan.length < 3) return [line];

        const sourceLineKey = String(
            line.lyricsPlusSourceLineKey || line.lyricsPlusLineKey || `line-${line.sourceIndex ?? 0}`
        );
        const fragmentCount = plan.length - 1;
        const fragments = plan.slice(0, -1).map((startIndex, fragmentIndex) => {
            const endIndex = plan[fragmentIndex + 1];
            const fragmentSyllables = syllables.slice(startIndex, endIndex);
            const first = fragmentSyllables[0];
            const last = fragmentSyllables[fragmentSyllables.length - 1];
            const text = joinSyllableText(fragmentSyllables);
            const fragmentKey = `${sourceLineKey}-solo-segment-${fragmentIndex + 1}`;
            return {
                ...line,
                startTime: fragmentIndex === 0
                    ? Math.min(line.startTime, first.startTime)
                    : first.startTime,
                endTime: fragmentIndex === fragmentCount - 1
                    ? Math.max(line.endTime, last.endTime)
                    : last.endTime,
                text,
                originalText: text,
                syllables: fragmentSyllables,
                lyricsPlusLineKey: fragmentKey,
                lyricsPlusSourceLineKey: sourceLineKey,
                lyricsPlusSourceLineKeys: Array.from(new Set([
                    ...(Array.isArray(line.lyricsPlusSourceLineKeys)
                        ? line.lyricsPlusSourceLineKeys
                        : []),
                    sourceLineKey
                ])),
                lyricsPlusSoloSegment: true,
                lyricsPlusFragmentIndex: fragmentIndex,
                lyricsPlusFragmentCount: fragmentCount
            };
        });

        const flattenedSyllables = fragments.flatMap(fragment => fragment.syllables);
        const preservesSyllables = flattenedSyllables.length === syllables.length
            && flattenedSyllables.every((syllable, index) => syllable === syllables[index]);
        const preservesText = normalizeDisplayText(
            fragments.flatMap(fragment => fragment.syllables).map(syllable => syllable.text).join('')
        ) === lineText;
        const hasSafeFragmentTiming = fragments.every((fragment, index) => (
            index === 0
            || (
                fragment.startTime > fragments[index - 1].startTime
                && fragments[index - 1].syllables.at(-1).endTime
                    <= fragment.syllables[0].startTime
            )
        ));
        return preservesSyllables && preservesText && hasSafeFragmentTiming
            ? fragments
            : [line];
    }

    function splitLongSoloVocalLines(lines) {
        return (lines || []).flatMap((line, index, allLines) => (
            splitLongSoloVocalLine(line, allLines[index - 1], allLines[index + 1])
        ));
    }

    function stripBackgroundParentheses(value) {
        return normalizeDisplayText(String(value || '').replace(/[()（）]/g, ''));
    }

    function stripBackgroundSyllableParentheses(syllables) {
        return (syllables || [])
            .map(syllable => ({
                ...syllable,
                text: String(syllable?.text || '').replace(/[()（）]/g, '')
            }))
            .filter(syllable => syllable.text.length > 0);
    }

    function createVocalPart(id, role, syllables, presentation, textOverride = '') {
        if (!Array.isArray(syllables) || syllables.length === 0) return null;
        const text = normalizeDisplayText(textOverride) || joinSyllableText(syllables);
        if (!text) return null;

        const starts = syllables.map(item => item.startTime).filter(Number.isFinite);
        const ends = syllables.map(item => item.endTime).filter(Number.isFinite);
        if (!starts.length || !ends.length) return null;

        return {
            id,
            role,
            ...presentation,
            kind: 'vocal',
            text,
            syllables: syllables.map(({ isBackground: _isBackground, ...syllable }) => syllable),
            startTime: Math.min(...starts),
            endTime: Math.max(...ends)
        };
    }

    function cloneVocalPart(part, role = '') {
        const syllables = Array.isArray(part?.syllables)
            ? part.syllables
                .filter(syllable => Number.isFinite(syllable?.startTime)
                    && Number.isFinite(syllable?.endTime)
                    && syllable.endTime >= syllable.startTime
                    && normalizeInlineText(syllable?.text))
                .map(syllable => ({
                    ...syllable,
                    text: normalizeInlineText(syllable.text),
                    startTime: syllable.startTime,
                    endTime: syllable.endTime
                }))
            : [];
        if (syllables.length === 0) return null;

        const starts = syllables.map(syllable => syllable.startTime);
        const ends = syllables.map(syllable => syllable.endTime);
        const text = normalizeDisplayText(part?.text) || joinSyllableText(syllables);
        if (!text) return null;

        return {
            id: String(part?.id || ''),
            role: role || String(part?.role || 'background'),
            speaker: String(part?.speaker || ''),
            'speaker-color': String(part?.['speaker-color'] || ''),
            'speaker-fallback': String(part?.['speaker-fallback'] || ''),
            lyricsPlusSinger: String(part?.lyricsPlusSinger || ''),
            lyricsPlusAgentType: String(part?.lyricsPlusAgentType || ''),
            lyricsPlusAgentName: String(part?.lyricsPlusAgentName || ''),
            lyricsPlusAgentAlias: String(part?.lyricsPlusAgentAlias || ''),
            kind: String(part?.kind || 'vocal'),
            text,
            syllables,
            startTime: Math.min(...starts),
            endTime: Math.max(...ends)
        };
    }

    function getLineLeadVocalPart(line) {
        const existingLead = cloneVocalPart(line?.vocals?.lead, 'lead');
        if (existingLead) return existingLead;

        return cloneVocalPart({
            id: `${line?.lyricsPlusLineKey || 'line'}-lead`,
            role: 'lead',
            speaker: line?.speaker,
            'speaker-color': line?.['speaker-color'],
            'speaker-fallback': line?.['speaker-fallback'],
            lyricsPlusSinger: line?.lyricsPlusSinger,
            lyricsPlusAgentType: line?.lyricsPlusAgentType,
            lyricsPlusAgentName: line?.lyricsPlusAgentName,
            lyricsPlusAgentAlias: line?.lyricsPlusAgentAlias,
            kind: line?.kind,
            text: line?.originalText || line?.text,
            syllables: line?.syllables
        }, 'lead');
    }

    function getCanonicalSingerId(line, agents) {
        const singer = String(line?.lyricsPlusSinger || '').trim();
        if (!singer) return '';
        return getAgentMetadata(singer, agents)?.id || singer;
    }

    function getVocalPartOverlapMs(left, right) {
        if (!left || !right) return 0;
        return Math.max(0, Math.min(left.endTime, right.endTime) - Math.max(left.startTime, right.startTime));
    }

    function mergeVocalParts(parts, role) {
        const normalizedParts = (parts || [])
            .map(part => cloneVocalPart(part, role))
            .filter(Boolean)
            .sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime);
        if (normalizedParts.length === 0) return null;

        const syllables = [];
        normalizedParts.forEach((part, index) => {
            if (index > 0) {
                const previous = syllables[syllables.length - 1];
                const next = part.syllables[0];
                if (previous
                    && next
                    && !/\s$/u.test(previous.text || '')
                    && !/^\s/u.test(next.text || '')) {
                    syllables.push({
                        text: ' ',
                        startTime: next.startTime,
                        endTime: next.startTime,
                        lyricsPlusSeparator: true
                    });
                }
            }
            syllables.push(...part.syllables);
        });

        const first = normalizedParts[0];
        return {
            ...first,
            id: normalizedParts.map(part => part.id).filter(Boolean).join('+') || first.id,
            role,
            text: normalizedParts.map(part => part.text).filter(Boolean).join(' / '),
            syllables,
            startTime: Math.min(...normalizedParts.map(part => part.startTime)),
            endTime: Math.max(...normalizedParts.map(part => part.endTime))
        };
    }

    function buildSingerVocalLanes(lines, agents) {
        const singerParts = new Map();

        lines.forEach(line => {
            const singerId = getCanonicalSingerId(line, agents) || '__default__';
            const part = getLineLeadVocalPart(line);
            if (!part) return;
            const entries = singerParts.get(singerId) || [];
            entries.push({ part, sourceIndex: line.sourceIndex });
            singerParts.set(singerId, entries);
        });

        const lanes = [];
        singerParts.forEach((entries, singerId) => {
            const singerLanes = [];
            // Fold consecutive source lines by the same singer into one visual row.
            // A second lane is created only when that singer overlaps themself.
            entries
                .sort((left, right) => left.part.startTime - right.part.startTime || left.sourceIndex - right.sourceIndex)
                .forEach(entry => {
                    let lane = singerLanes.find(candidate => candidate.endTime <= entry.part.startTime);
                    if (!lane) {
                        lane = { singerId, parts: [], sourceIndexes: [], endTime: -Infinity };
                        singerLanes.push(lane);
                    }
                    lane.parts.push(entry.part);
                    lane.sourceIndexes.push(entry.sourceIndex);
                    lane.endTime = Math.max(lane.endTime, entry.part.endTime);
                });
            lanes.push(...singerLanes);
        });

        return lanes.map(lane => ({
            ...lane,
            duration: lane.parts.reduce((total, part) => total + Math.max(0, part.endTime - part.startTime), 0),
            startTime: Math.min(...lane.parts.map(part => part.startTime)),
            part: mergeVocalParts(lane.parts, 'background')
        })).filter(lane => lane.part);
    }

    function chooseLeadVocalLane(lanes, preferredSingerId = '') {
        const rankLanes = candidates => [...candidates].sort((left, right) => (
            right.duration - left.duration
            || right.parts.length - left.parts.length
            || left.startTime - right.startTime
            || Math.min(...left.sourceIndexes) - Math.min(...right.sourceIndexes)
        ));
        const ranked = rankLanes(lanes);
        const strongestLane = ranked[0] || null;
        if (!strongestLane || !preferredSingerId) return strongestLane;

        const preferredLane = rankLanes(lanes.filter(lane => lane.singerId === preferredSingerId))[0] || null;
        return preferredLane && preferredLane.duration >= strongestLane.duration * 0.5
            ? preferredLane
            : strongestLane;
    }

    function createParallelVocalLine(lines, agents, preferredLeadSingerId = '') {
        const orderedLines = [...lines]
            .sort((left, right) => left.startTime - right.startTime || left.sourceIndex - right.sourceIndex);
        const lanes = buildSingerVocalLanes(orderedLines, agents);
        const leadLane = chooseLeadVocalLane(lanes, preferredLeadSingerId);
        if (!leadLane) return orderedLines[0];

        const leadLine = orderedLines.find(line => getCanonicalSingerId(line, agents) === leadLane.singerId)
            || orderedLines[0];
        const leadPart = { ...leadLane.part, role: 'lead' };
        const singerBackgroundParts = lanes
            .filter(lane => lane !== leadLane)
            .sort((left, right) => left.startTime - right.startTime || Math.min(...left.sourceIndexes) - Math.min(...right.sourceIndexes))
            .map(lane => ({ ...lane.part, role: 'background' }));
        const explicitBackgroundParts = orderedLines.flatMap(line => (
            Array.isArray(line?.vocals?.background)
                ? line.vocals.background
                    .map(part => cloneVocalPart(part, 'background'))
                    .filter(Boolean)
                : []
        ));
        const backgroundParts = [...singerBackgroundParts, ...explicitBackgroundParts];
        if (backgroundParts.length === 0) return leadLine;

        const allParts = [leadPart, ...backgroundParts];
        const text = allParts.map(part => part.text).filter(Boolean).join(' / ');
        const songPartIndices = [...new Set(orderedLines
            .map(line => line.lyricsPlusSongPartIndex)
            .filter(Number.isInteger))];
        const songParts = [...new Set(orderedLines
            .map(line => line.lyricsPlusSongPart)
            .filter(Boolean))];

        return {
            sourceIndex: Math.min(...orderedLines.map(line => line.sourceIndex)),
            startTime: Math.min(...allParts.map(part => part.startTime)),
            endTime: Math.max(...allParts.map(part => part.endTime)),
            text,
            originalText: text,
            speaker: leadLine.speaker,
            'speaker-color': leadLine['speaker-color'],
            'speaker-fallback': leadLine['speaker-fallback'],
            lyricsPlusSinger: leadLine.lyricsPlusSinger,
            lyricsPlusAgentType: leadLine.lyricsPlusAgentType,
            lyricsPlusAgentName: leadLine.lyricsPlusAgentName,
            lyricsPlusAgentAlias: leadLine.lyricsPlusAgentAlias,
            kind: leadLine.kind,
            lyricsPlusLineKey: leadLine.lyricsPlusLineKey,
            lyricsPlusLineKeys: orderedLines.map(line => line.lyricsPlusLineKey),
            lyricsPlusSingers: [...new Set(orderedLines.map(line => line.lyricsPlusSinger).filter(Boolean))],
            lyricsPlusSongPartIndex: leadLine.lyricsPlusSongPartIndex,
            lyricsPlusSongPart: leadLine.lyricsPlusSongPart,
            lyricsPlusSongPartIndices: songPartIndices,
            lyricsPlusSongParts: songParts,
            lyricsPlusParallelVocal: true,
            hasWordTiming: true,
            vocals: {
                lead: leadPart,
                background: backgroundParts
            }
        };
    }

    function getLineSegmentationParts(line, partsCache = null) {
        const cached = partsCache?.get(line);
        if (cached) return cached;

        const lead = getLineLeadVocalPart(line);
        const background = Array.isArray(line?.vocals?.background)
            ? line.vocals.background
                .map(part => cloneVocalPart(part, 'background'))
                .filter(Boolean)
            : [];
        const result = { lead, background };
        partsCache?.set(line, result);
        return result;
    }

    function rebuildSegmentLine(line, leadPart, backgroundParts = []) {
        let lead = leadPart ? { ...leadPart, role: 'lead' } : null;
        const background = backgroundParts.map(part => ({ ...part, role: 'background' }));
        let promotedBackgroundFragment = false;
        if (!lead && background.length > 0) {
            lead = { ...background.shift(), role: 'lead' };
            promotedBackgroundFragment = true;
        }
        if (!lead) return null;

        const allParts = [lead, ...background];
        const text = allParts.map(part => part.text).filter(Boolean).join(' ');
        const result = {
            ...line,
            startTime: Math.min(...allParts.map(part => part.startTime)),
            endTime: Math.max(...allParts.map(part => part.endTime)),
            text,
            originalText: text,
            lyricsPlusFragment: true,
            lyricsPlusPromotedBackgroundFragment: promotedBackgroundFragment
        };
        delete result.syllables;
        delete result.vocals;

        if (background.length > 0) {
            result.vocals = { lead, background };
        } else {
            result.syllables = lead.syllables;
        }
        return result;
    }

    function annotateParallelComponentLines(lines, partsCache = null) {
        return lines.map(line => {
            const lineKey = String(line?.lyricsPlusLineKey || `line-${line?.sourceIndex ?? 0}`);
            const { lead, background } = getLineSegmentationParts(line, partsCache);
            const annotatePart = (part, role, partIndex) => {
                if (!part) return null;
                const syllables = part.syllables.map((syllable, syllableIndex) => ({
                    ...syllable,
                    lyricsPlusSourceLineKey: syllable.lyricsPlusSourceLineKey || lineKey,
                    lyricsPlusSourceSyllableId: syllable.lyricsPlusSourceSyllableId
                        || `${lineKey}:${role}:${partIndex}:${syllableIndex}`
                }));
                return {
                    ...part,
                    syllables,
                    startTime: Math.min(...syllables.map(syllable => syllable.startTime)),
                    endTime: Math.max(...syllables.map(syllable => syllable.endTime))
                };
            };

            return rebuildSegmentLine(
                line,
                annotatePart(lead, 'lead', 0),
                background.map((part, index) => annotatePart(part, 'background', index)).filter(Boolean)
            ) || line;
        });
    }

    function sliceVocalPartBySyllableIds(part, allowedIds) {
        const normalized = cloneVocalPart(part, part?.role || 'background');
        if (!normalized) return null;
        const syllables = normalized.syllables
            .filter(syllable => allowedIds.has(syllable.lyricsPlusSourceSyllableId));
        if (syllables.length === 0) return null;

        return {
            ...normalized,
            text: joinSyllableText(syllables),
            syllables,
            startTime: Math.min(...syllables.map(syllable => syllable.startTime)),
            endTime: Math.max(...syllables.map(syllable => syllable.endTime))
        };
    }

    function sliceLineBySyllableIds(line, allowedIds, partsCache = null) {
        const { lead, background } = getLineSegmentationParts(line, partsCache);
        return rebuildSegmentLine(
            line,
            sliceVocalPartBySyllableIds(lead, allowedIds),
            background
                .map(part => sliceVocalPartBySyllableIds(part, allowedIds))
                .filter(Boolean)
        );
    }

    function getLineSourceSyllables(line, partsCache = null) {
        const { lead, background } = getLineSegmentationParts(line, partsCache);
        return [lead, ...background]
            .filter(Boolean)
            .flatMap(part => part.syllables)
            .filter(syllable => syllable?.lyricsPlusSourceSyllableId);
    }

    function countSegmentSourceLines(lines) {
        return new Set(lines.map(line => line.lyricsPlusLineKey).filter(Boolean)).size;
    }

    function countSegmentVocalRows(lines, agents) {
        const leadLaneCount = buildSingerVocalLanes(lines, agents).length;
        const explicitBackgroundCount = lines.reduce((count, line) => (
            count + (Array.isArray(line?.vocals?.background)
                ? line.vocals.background.filter(part => cloneVocalPart(part, 'background')).length
                : 0)
        ), 0);
        return leadLaneCount + explicitBackgroundCount;
    }

    function partitionParallelComponent(lines, candidateTime, partsCache = null) {
        const leftIds = new Set();
        const rightIds = new Set();

        lines.forEach(line => {
            getLineSourceSyllables(line, partsCache).forEach(syllable => {
                const midpoint = syllable.startTime + ((syllable.endTime - syllable.startTime) / 2);
                const target = midpoint <= candidateTime ? leftIds : rightIds;
                target.add(syllable.lyricsPlusSourceSyllableId);
            });
        });

        return {
            left: lines.map(line => sliceLineBySyllableIds(line, leftIds, partsCache)).filter(Boolean),
            right: lines.map(line => sliceLineBySyllableIds(line, rightIds, partsCache)).filter(Boolean)
        };
    }

    function findParallelSegmentSplit(lines, agents, currentStartTime, partsCache = null) {
        const orderedLines = [...lines]
            .sort((left, right) => left.startTime - right.startTime || left.sourceIndex - right.sourceIndex);
        if (countSegmentSourceLines(orderedLines) <= PARALLEL_VOCAL_MAX_SOURCE_LINES) return null;

        const overflowLine = orderedLines[PARALLEL_VOCAL_MAX_SOURCE_LINES];
        const nominalBoundary = overflowLine?.startTime;
        if (!Number.isFinite(nominalBoundary)) return null;

        const candidateTimes = new Set([nominalBoundary]);
        orderedLines.slice(0, PARALLEL_VOCAL_MAX_SOURCE_LINES).forEach(line => {
            getLineSourceSyllables(line, partsCache).forEach(syllable => {
                if (syllable.startTime > currentStartTime && syllable.startTime <= nominalBoundary) {
                    candidateTimes.add(syllable.startTime);
                }
                if (syllable.endTime > currentStartTime && syllable.endTime <= nominalBoundary) {
                    candidateTimes.add(syllable.endTime);
                }
            });
        });

        const candidates = [...candidateTimes].map(candidateTime => {
            const partition = partitionParallelComponent(orderedLines, candidateTime, partsCache);
            const leftKeyCount = countSegmentSourceLines(partition.left);
            if ([...partition.left, ...partition.right]
                .some(line => line.lyricsPlusPromotedBackgroundFragment)
                || leftKeyCount < 2
                || leftKeyCount > PARALLEL_VOCAL_MAX_SOURCE_LINES
                || partition.right.length === 0
                || countSegmentVocalRows(partition.left, agents) < 2) {
                return null;
            }

            const leftSyllables = partition.left.flatMap(line => getLineSourceSyllables(line, partsCache));
            const rightSyllables = partition.right.flatMap(line => getLineSourceSyllables(line, partsCache));
            if (leftSyllables.length === 0 || rightSyllables.length === 0) return null;

            const leftEndTime = Math.max(...leftSyllables.map(syllable => syllable.endTime));
            const rightStartTime = Math.min(...rightSyllables.map(syllable => syllable.startTime));
            const nextStartTime = Math.max(leftEndTime, rightStartTime);
            const delayedRightSyllables = rightSyllables.filter(syllable => syllable.startTime < nextStartTime);
            if (delayedRightSyllables.some(syllable => syllable.endTime <= nextStartTime)) return null;
            const maxDelay = delayedRightSyllables.reduce(
                (maximum, syllable) => Math.max(maximum, nextStartTime - syllable.startTime),
                0
            );
            if (maxDelay > PARALLEL_VOCAL_MAX_SEGMENT_DELAY_MS) return null;

            return {
                ...partition,
                leftEndTime,
                nextStartTime,
                leftKeyCount,
                maxDelay,
                distance: Math.abs(candidateTime - nominalBoundary)
            };
        }).filter(Boolean);

        return candidates.sort((left, right) => (
            (PARALLEL_VOCAL_MAX_SOURCE_LINES - left.leftKeyCount)
                - (PARALLEL_VOCAL_MAX_SOURCE_LINES - right.leftKeyCount)
            || left.maxDelay - right.maxDelay
            || left.distance - right.distance
            || right.leftEndTime - left.leftEndTime
        ))[0] || null;
    }

    function createParallelVocalSegments(lines, agents, partsCache = null) {
        const preparedLines = annotateParallelComponentLines(lines, partsCache)
            .sort((left, right) => left.startTime - right.startTime || left.sourceIndex - right.sourceIndex);
        const componentLeadLane = chooseLeadVocalLane(buildSingerVocalLanes(preparedLines, agents));
        const preferredLeadSingerId = componentLeadLane?.singerId || '';
        if (countSegmentSourceLines(preparedLines) <= PARALLEL_VOCAL_MAX_SOURCE_LINES) {
            return [createParallelVocalLine(preparedLines, agents, preferredLeadSingerId)];
        }

        const segments = [];
        let remainingLines = preparedLines;
        let forcedStartTime = preparedLines[0]?.startTime;
        let guard = 0;

        while (countSegmentSourceLines(remainingLines) > PARALLEL_VOCAL_MAX_SOURCE_LINES && guard < lines.length) {
            guard++;
            const split = findParallelSegmentSplit(remainingLines, agents, forcedStartTime, partsCache);
            if (!split) {
                return [createParallelVocalLine(preparedLines, agents, preferredLeadSingerId)];
            }

            const segment = createParallelVocalLine(split.left, agents, preferredLeadSingerId);
            if (!segment?.lyricsPlusParallelVocal || forcedStartTime > split.leftEndTime) {
                return [createParallelVocalLine(preparedLines, agents, preferredLeadSingerId)];
            }
            segment.startTime = forcedStartTime;
            segment.endTime = split.leftEndTime;
            segments.push(segment);
            remainingLines = split.right;
            forcedStartTime = split.nextStartTime;
        }

        const finalSegment = createParallelVocalLine(remainingLines, agents, preferredLeadSingerId);
        if (!finalSegment?.lyricsPlusParallelVocal) {
            return [createParallelVocalLine(preparedLines, agents, preferredLeadSingerId)];
        }
        finalSegment.startTime = forcedStartTime;
        segments.push(finalSegment);

        return segments.map((segment, index) => {
            const segmentSuffix = `segment-${index + 1}`;
            return {
                ...segment,
                lyricsPlusLineKeys: [...new Set(segment.lyricsPlusLineKeys || [])],
                lyricsPlusSourceLineKeys: [...new Set(segment.lyricsPlusLineKeys || [])],
                lyricsPlusSegmentIndex: index,
                lyricsPlusSegmentCount: segments.length,
                vocals: {
                    lead: { ...segment.vocals.lead, id: `${segment.vocals.lead.id}-${segmentSuffix}` },
                    background: segment.vocals.background.map(part => ({
                        ...part,
                        id: `${part.id}-${segmentSuffix}`
                    }))
                }
            };
        });
    }

    function groupParallelVocalLines(lines, agents, parsedLeadParts = null) {
        // Pages activates only the latest top-level startTime. Grouping just one
        // overlapping pair would therefore cut a vocal that crosses the next line.
        // Build the full overlap component first, then fold it into singer lanes.
        const canReuseParsedLeadParts = Array.isArray(parsedLeadParts)
            && parsedLeadParts.length === lines.length;
        const segmentationPartsCache = new WeakMap();
        const lineParts = lines.map((line, index) => {
            const lead = canReuseParsedLeadParts
                ? parsedLeadParts[index]
                : getLineLeadVocalPart(line);
            const background = Array.isArray(line?.vocals?.background)
                ? line.vocals.background
                    .map(part => cloneVocalPart(part, 'background'))
                    .filter(Boolean)
                : [];
            const parts = { lead, background };
            segmentationPartsCache.set(line, parts);
            return [lead, ...background].filter(Boolean);
        });
        const parents = lines.map((_line, index) => index);
        const findRoot = index => {
            let root = index;
            while (parents[root] !== root) root = parents[root];
            while (parents[index] !== index) {
                const parent = parents[index];
                parents[index] = root;
                index = parent;
            }
            return root;
        };
        const joinRoots = (left, right) => {
            const leftRoot = findRoot(left);
            const rightRoot = findRoot(right);
            if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
        };

        const parallelSeeds = new Set();
        for (let leftIndex = 0; leftIndex < lines.length; leftIndex++) {
            const left = lines[leftIndex];
            const leftParts = lineParts[leftIndex];
            if (!left?.hasWordTiming || leftParts.length === 0) continue;
            const leftEndTime = Math.max(...leftParts.map(part => part.endTime));

            for (let rightIndex = leftIndex + 1; rightIndex < lines.length; rightIndex++) {
                const right = lines[rightIndex];
                const rightParts = lineParts[rightIndex];
                if (!right?.hasWordTiming || rightParts.length === 0) continue;
                const rightStartTime = Math.min(...rightParts.map(part => part.startTime));
                if (rightStartTime >= leftEndTime) break;

                const hasMeaningfulOverlap = leftParts.some(leftPart => (
                    rightParts.some(rightPart => (
                        getVocalPartOverlapMs(leftPart, rightPart) >= PARALLEL_VOCAL_MIN_OVERLAP_MS
                    ))
                ));
                if (!hasMeaningfulOverlap) continue;

                joinRoots(leftIndex, rightIndex);
                parallelSeeds.add(leftIndex);
            }
        }

        const parallelRoots = new Set([...parallelSeeds].map(findRoot));
        const components = new Map();
        lines.forEach((line, index) => {
            const root = findRoot(index);
            const component = components.get(root) || [];
            component.push(line);
            components.set(root, component);
        });

        const emittedRoots = new Set();
        const grouped = [];
        lines.forEach((line, index) => {
            const root = findRoot(index);
            if (!parallelRoots.has(root)) {
                grouped.push(line);
                return;
            }
            if (emittedRoots.has(root)) return;
            emittedRoots.add(root);

            const component = components.get(root) || [line];
            if (component.length > 1) {
                grouped.push(...createParallelVocalSegments(component, agents, segmentationPartsCache));
            } else {
                grouped.push(line);
            }
        });

        return grouped.sort((left, right) => left.startTime - right.startTime || left.sourceIndex - right.sourceIndex);
    }

    function parseLyricsPayload(payload, durationMs = 0) {
        if (!isUsablePayload(payload)) {
            return { karaoke: null, synced: null, unsynced: null };
        }

        const singerOrder = new Map();
        const speakerPresentations = new Map();
        const agents = payload?.metadata?.agents || {};
        const songParts = Array.isArray(payload?.metadata?.songParts) ? payload.metadata.songParts : [];

        const parsedLines = payload.lyrics.map((sourceLine, lineIndex) => {
            const rawStart = toFiniteMilliseconds(sourceLine?.time);
            const rawDuration = toPositiveMilliseconds(sourceLine?.duration);
            const rawEnd = Number.isFinite(rawStart) && Number.isFinite(rawDuration)
                ? rawStart + rawDuration
                : null;
            const rawSyllables = (Array.isArray(sourceLine?.syllabus)
                ? sourceLine.syllabus.map(parseSyllable).filter(Boolean)
                : [])
                .filter(syllable => isSyllableWithinLine(syllable, rawStart, rawEnd));
            const leadSyllables = rawSyllables.filter(item => !item.isBackground);
            const backgroundSyllables = stripBackgroundSyllableParentheses(
                rawSyllables.filter(item => item.isBackground)
            );
            const sourceText = normalizeDisplayText(sourceLine?.text);
            const leadText = joinSyllableText(leadSyllables);
            const backgroundText = stripBackgroundParentheses(joinSyllableText(backgroundSyllables));
            const text = backgroundSyllables.length > 0
                ? [leadText, backgroundText].filter(Boolean).join(' ')
                : sourceText || joinSyllableText(rawSyllables);
            if (!text) return null;

            const syllableStarts = rawSyllables.map(item => item.startTime).filter(Number.isFinite);
            const syllableEnds = rawSyllables.map(item => item.endTime).filter(Number.isFinite);
            const startCandidates = [rawStart, ...syllableStarts].filter(Number.isFinite);
            const endCandidates = [
                Number.isFinite(rawStart) && Number.isFinite(rawDuration) ? rawStart + rawDuration : null,
                ...syllableEnds
            ].filter(Number.isFinite);
            const startTime = startCandidates.length ? Math.min(...startCandidates) : null;
            const endTime = endCandidates.length ? Math.max(...endCandidates) : null;
            const lineKey = String(sourceLine?.element?.key || `line-${lineIndex + 1}`);
            const singer = String(sourceLine?.element?.singer || '');
            const rawSongPartIndex = sourceLine?.element?.songPartIndex;
            const songPartIndex = rawSongPartIndex !== null
                && rawSongPartIndex !== undefined
                && rawSongPartIndex !== ''
                && Number.isInteger(Number(rawSongPartIndex))
                ? Number(rawSongPartIndex)
                : null;
            const songPart = Number.isInteger(songPartIndex) ? songParts[songPartIndex] : null;
            const presentation = getSpeakerPresentation(
                singer,
                singerOrder,
                agents,
                speakerPresentations
            );

            let leadPart = createVocalPart(`${lineKey}-lead`, 'lead', leadSyllables, presentation);
            let backgroundParts = [];
            if (backgroundSyllables.length > 0) {
                const backgroundPart = createVocalPart(
                    `${lineKey}-background-1`,
                    'background',
                    backgroundSyllables,
                    presentation,
                    backgroundText
                );
                if (backgroundPart) backgroundParts.push(backgroundPart);
            }

            if (!leadPart && backgroundParts.length > 0) {
                const promoted = backgroundParts.shift();
                leadPart = { ...promoted, id: `${lineKey}-lead`, role: 'lead' };
            }

            const line = {
                sourceIndex: lineIndex,
                startTime,
                endTime,
                text,
                originalText: text,
                ...presentation,
                kind: 'vocal',
                lyricsPlusLineKey: lineKey,
                lyricsPlusSongPartIndex: songPartIndex,
                lyricsPlusSongPart: normalizeDisplayText(songPart?.name),
                hasWordTiming: rawSyllables.length > 0
            };

            if (leadPart && backgroundParts.length > 0) {
                line.vocals = { lead: leadPart, background: backgroundParts };
            } else if (leadPart) {
                line.syllables = leadPart.syllables;
            } else if (rawSyllables.length > 0) {
                line.syllables = rawSyllables.map(({ isBackground: _isBackground, ...syllable }) => syllable);
            }

            return line;
        }).filter(Boolean);

        const timedLines = parsedLines
            .filter(line => Number.isFinite(line.startTime))
            .sort((left, right) => left.startTime - right.startTime || left.sourceIndex - right.sourceIndex);

        timedLines.forEach((line, index) => {
            const nextStart = timedLines[index + 1]?.startTime;
            if (!Number.isFinite(line.endTime) || line.endTime <= line.startTime) {
                line.endTime = Number.isFinite(nextStart)
                    ? Math.max(line.startTime + 1, nextStart)
                    : Math.max(line.startTime + 1, durationMs || line.startTime + 3000);
            }
        });

        const payloadType = normalizeDisplayText(payload?.type).toLowerCase();
        const isWordType = payloadType === 'word';
        const isLineType = payloadType === 'line';
        const isPlainType = payloadType === 'none'
            || payloadType === 'plain'
            || payloadType === 'unsynced';
        const inferTypeFromContent = !isWordType && !isLineType && !isPlainType;
        const hasCompleteTiming = timedLines.length === parsedLines.length;
        const hasCompleteWordTiming = hasCompleteTiming
            && (isWordType || inferTypeFromContent)
            && timedLines.every(line => line.hasWordTiming);
        const parsedLeadParts = hasCompleteWordTiming
            ? timedLines.map(getLineLeadVocalPart)
            : null;
        const groupedKaraokeLines = hasCompleteWordTiming
            ? groupParallelVocalLines(timedLines, agents, parsedLeadParts)
            : [];
        const karaokeLines = hasCompleteWordTiming
            ? splitLongSoloVocalLines(groupedKaraokeLines)
            : [];
        const karaoke = hasCompleteWordTiming
            ? karaokeLines.map(line => {
                const karaokeLine = { ...line };
                delete karaokeLine.sourceIndex;
                delete karaokeLine.hasWordTiming;
                if (!karaokeLine.vocals && !karaokeLine.syllables?.length) {
                    karaokeLine.syllables = [{
                        text: karaokeLine.text,
                        startTime: karaokeLine.startTime,
                        endTime: karaokeLine.endTime
                    }];
                }
                return karaokeLine;
            })
            : null;

        const synced = hasCompleteTiming && !isPlainType ? timedLines.map(line => ({
            startTime: line.startTime,
            endTime: line.endTime,
            text: line.text,
            originalText: line.originalText,
            speaker: line.speaker,
            'speaker-color': line['speaker-color'],
            'speaker-fallback': line['speaker-fallback'],
            kind: line.kind,
            lyricsPlusLineKey: line.lyricsPlusLineKey,
            lyricsPlusSinger: line.lyricsPlusSinger,
            lyricsPlusAgentType: line.lyricsPlusAgentType,
            lyricsPlusAgentName: line.lyricsPlusAgentName,
            lyricsPlusAgentAlias: line.lyricsPlusAgentAlias,
            lyricsPlusSongPartIndex: line.lyricsPlusSongPartIndex,
            lyricsPlusSongPart: line.lyricsPlusSongPart
        })) : [];
        const unsynced = parsedLines
            .sort((left, right) => left.sourceIndex - right.sourceIndex)
            .map(line => ({
                text: line.text,
                originalText: line.originalText,
                lyricsPlusLineKey: line.lyricsPlusLineKey,
                lyricsPlusSinger: line.lyricsPlusSinger,
                lyricsPlusAgentType: line.lyricsPlusAgentType,
                lyricsPlusAgentName: line.lyricsPlusAgentName,
                lyricsPlusAgentAlias: line.lyricsPlusAgentAlias,
                lyricsPlusSongPartIndex: line.lyricsPlusSongPartIndex,
                lyricsPlusSongPart: line.lyricsPlusSongPart
            }));

        return {
            karaoke: karaoke?.length ? karaoke : null,
            synced: synced.length ? synced : null,
            unsynced: unsynced.length ? unsynced : null
        };
    }

    const LyricsPlusLyricsAddon = {
        ...ADDON_INFO,

        async init() {
            window.__ivLyricsDebugLog?.(`[LyricsPlus Lyrics Addon] Initialized (v${ADDON_INFO.version})`);
        },

        getSettingsUI() {
            const React = Spicetify.React;
            return function LyricsPlusLyricsSettings() {
                return React.createElement('div', { className: 'ai-addon-settings lyricsplus-settings' },
                    React.createElement('div', { className: 'ai-addon-setting', style: { marginTop: '16px' } },
                        React.createElement('div', { className: 'ai-addon-info-box' },
                            React.createElement('p', { style: { fontWeight: 700, marginBottom: '8px' } }, 'LyricsPlus'),
                            React.createElement('p', { style: { marginBottom: '8px' } }, ATTRIBUTION),
                            React.createElement('a', {
                                href: 'https://github.com/ibratabian17/lyricsplus',
                                target: '_blank',
                                rel: 'noreferrer'
                            }, 'github.com/ibratabian17/lyricsplus')
                        )
                    )
                );
            };
        },

        async getLyrics(info) {
            const result = {
                uri: info?.uri || '',
                provider: ADDON_INFO.id,
                cacheVersion: CACHE_VERSION,
                karaoke: null,
                synced: null,
                unsynced: null,
                karaokeSource: null,
                copyright: ATTRIBUTION,
                error: null
            };

            try {
                const fetched = await fetchLyricsData(info);
                if (!fetched) {
                    result.error = 'No lyrics';
                    return result;
                }

                const parsed = parseLyricsPayload(fetched.data, normalizeDurationMs(info));
                result.karaoke = parsed.karaoke;
                result.synced = parsed.synced;
                result.unsynced = parsed.unsynced;
                result.karaokeSource = result.karaoke ? ADDON_INFO.id : null;
                result.isrc = fetched.isrc || null;
                result.lyricsPlus = {
                    mirror: fetched.mirror,
                    type: fetched.data?.type || null,
                    source: fetched.data?.metadata?.source || null,
                    language: fetched.data?.metadata?.language || null,
                    cached: fetched.data?.cached ?? null,
                    title: fetched.data?.metadata?.title || null,
                    songWriters: Array.isArray(fetched.data?.metadata?.songWriters)
                        ? fetched.data.metadata.songWriters
                        : [],
                    agents: fetched.data?.metadata?.agents || {},
                    songParts: Array.isArray(fetched.data?.metadata?.songParts)
                        ? fetched.data.metadata.songParts
                        : [],
                    totalDuration: fetched.data?.metadata?.totalDuration || null
                };

                if (!result.karaoke && !result.synced && !result.unsynced) {
                    result.error = 'No usable lyrics';
                }

                window.__ivLyricsDebugLog?.('[LyricsPlus Lyrics Addon] Loaded lyrics', {
                    mirror: result.lyricsPlus.mirror,
                    type: result.lyricsPlus.type,
                    source: result.lyricsPlus.source,
                    karaokeLines: result.karaoke?.length || 0,
                    syncedLines: result.synced?.length || 0,
                    unsyncedLines: result.unsynced?.length || 0
                });
                return result;
            } catch (error) {
                result.error = error?.name === 'AbortError'
                    ? 'Request timed out'
                    : (error?.message || 'Request error');
                console.warn('[LyricsPlus Lyrics Addon] Failed to load lyrics:', error);
                return result;
            }
        }
    };

    const registerAddon = () => {
        if (window.LyricsAddonManager) {
            window.LyricsAddonManager.register(LyricsPlusLyricsAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    window.LyricsPlusLyricsAddon = LyricsPlusLyricsAddon;
    window.__ivLyricsPlusDebug = Object.freeze({
        decodeBase64Twice,
        getApiBases,
        buildLyricsUrl,
        normalizeIsrc,
        resolveTrackIsrc,
        getSpeakerPresentation,
        groupParallelVocalLines,
        measureLyricsDisplayWidth,
        splitLongSoloVocalLine,
        splitLongSoloVocalLines,
        parseLyricsPayload,
        fetchLyricsData
    });

    registerAddon();
    window.__ivLyricsDebugLog?.('[LyricsPlus Lyrics Addon] Module loaded');
})();
