/*
 * Analysis-driven CD visualizer. This is not a live audio capture or PCM FFT.
 * Loudness envelopes and pitch interpolation are adapted from
 * Konsl/spicetify-visualizer, commit 12cb2a9066690b4e023bccc9466ae784ebb62364
 * (src/loaders.ts, SpectrumVisualizer.tsx, NCSVisualizer.tsx, src/math.ts).
 * The radial renderer and lifecycle are specific to ivLyrics.
 *
 * MIT License
 * Copyright (c) 2026 Konsl
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
(function initializeCdVisualizer(root, factory) {
    "use strict";
    const api = factory(root);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.ivLyricsCdVisualizer = api;
})(typeof window !== "undefined" ? window : globalThis, function createCdVisualizerApi(root) {
    "use strict";

    const DEFAULTS = Object.freeze({
        style: "bars", colorMode: "album", customColor: "#ffffff",
        sensitivity: 100, density: 64, thickness: 2, mirror: false, albumGradient: true
    });
    const STYLES = Object.freeze(["bars", "line", "dots", "wave", "blocks", "spikes", "aura", "pulse", "particles"]);
    const COLOR_MODES = Object.freeze(["album", "white", "custom", "rainbow"]);
    const MAX_SEGMENTS = 20000;
    const MAX_DURATION_SECONDS = 12 * 60 * 60;
    const FRAME_INTERVAL_MS = 1000 / 30;
    const TWO_PI = Math.PI * 2;
    // Beat-driven styles only animate for a short time after a real analysed
    // beat. Blocks quantize to LED-like levels with briefly held peak caps.
    const PULSE_SECONDS = 0.9;
    const PARTICLE_SECONDS = 1.1;
    const BLOCK_LEVELS = 5;
    const PEAK_HOLD_MS = 320;
    const PEAK_FALL_PER_SECOND = 0.9;
    const NO_DASH = [];
    const RAINBOW_HUES = Object.freeze([330, 20, 48, 140, 188, 228, 276, 330]);
    const ANALYSIS_DB_NAME = "ivLyricsCdAnalysis";
    const ANALYSIS_CACHE_VERSION = 1;
    const ANALYSIS_FIELDS = Object.freeze([
        "start", "end", "peak", "amplitudeStart", "amplitudeMax", "amplitudeEnd", "rise", "loudest"
    ]);
    const PACKED_SEGMENT_SIZE = ANALYSIS_FIELDS.length + 12;
    const CACHE_RECORD_OVERHEAD = 256;
    const MAX_ANALYSIS_RECORD_BYTES = MAX_SEGMENTS * (PACKED_SEGMENT_SIZE + 2) * 8 + CACHE_RECORD_OVERHEAD;

    const finite = (value, fallback) => (
        typeof value === "number" && Number.isFinite(value) ? value : fallback
    );
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const settingNumber = (value, fallback, min, max) => {
        const number = typeof value === "string" && value.trim() ? Number(value) : value;
        return clamp(finite(number, fallback), min, max);
    };
    const smoothstep = value => {
        const t = clamp(value, 0, 1);
        return t * t * (3 - 2 * t);
    };
    const lerp = (from, to, amount) => from + (to - from) * amount;
    const trackIdFromUri = uri => (
        typeof uri === "string" ? /^spotify:track:([A-Za-z0-9]{22})$/.exec(uri)?.[1] || null : null
    );

    function normalizeColor(value, fallback = "#ffffff") {
        if (typeof value !== "string" || value.length > 96) return fallback;
        const color = value.trim();
        if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
        if (/^#[0-9a-f]{3}$/i.test(color)) {
            return `#${[...color.slice(1)].map(digit => digit + digit).join("")}`.toLowerCase();
        }
        const rgb = /^rgba?\(\s*(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)(?:\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/i.exec(color);
        return rgb ? `rgb(${rgb.slice(1, 4).map(channel => clamp(Math.round(Number(channel)), 0, 255)).join(", ")})` : fallback;
    }

    function normalizeSettings(settings = {}) {
        const value = settings && typeof settings === "object" ? settings : {};
        return {
            style: STYLES.includes(value.style) ? value.style : DEFAULTS.style,
            colorMode: COLOR_MODES.includes(value.colorMode) ? value.colorMode : DEFAULTS.colorMode,
            customColor: normalizeColor(value.customColor, DEFAULTS.customColor),
            sensitivity: settingNumber(value.sensitivity, DEFAULTS.sensitivity, 25, 200),
            density: Math.round(settingNumber(value.density, DEFAULTS.density, 24, 128)),
            thickness: settingNumber(value.thickness, DEFAULTS.thickness, 1, 6),
            mirror: value.mirror === true || value.mirror === "true",
            albumGradient: value.albumGradient !== false && value.albumGradient !== "false"
        };
    }

    function resolveColor(settings, accent) {
        if (settings.colorMode === "white") return "#ffffff";
        if (settings.colorMode === "custom") return normalizeColor(settings.customColor);
        // Rainbow is a canvas gradient; the album colour is its solid fallback.
        return normalizeColor(accent);
    }

    // Amplitude conversion and smoothstep follow the MIT-licensed reference.
    const decibelsToAmplitude = decibels => (
        Number.isFinite(decibels) ? clamp(Math.pow(10, clamp(decibels, -160, 0) / 20), 0, 1) : 0
    );

    function normalizeAnalysis(raw) {
        const data = raw && typeof raw === "object" && !Array.isArray(raw)
            ? (Array.isArray(raw.segments) ? raw : raw.body) : null;
        if (!data || !Array.isArray(data.segments) || !data.segments.length || data.segments.length > MAX_SEGMENTS) return null;
        if (data.track?.duration != null && !Number.isFinite(data.track.duration)) return null;
        const declaredDuration = finite(data.track?.duration, 0);
        if (declaredDuration < 0 || declaredDuration > MAX_DURATION_SECONDS) return null;
        const segments = [];
        for (const rawSegment of data.segments) {
            if (!rawSegment || typeof rawSegment !== "object") continue;
            const start = finite(rawSegment.start, -1);
            const duration = finite(rawSegment.duration, -1);
            const peakTime = finite(rawSegment.loudness_max_time, -1);
            const pitches = rawSegment.pitches;
            if (start < 0 || duration <= 0 || start + duration > MAX_DURATION_SECONDS || peakTime < 0 || peakTime > duration
                || !Number.isFinite(rawSegment.loudness_start) || !Number.isFinite(rawSegment.loudness_max)
                || !(Array.isArray(pitches) || ArrayBuffer.isView(pitches)) || pitches.length !== 12
                || (segments.length && start <= segments[segments.length - 1].start)) continue;
            const normalizedPitches = new Float32Array(12);
            let valid = true;
            for (let index = 0; index < 12; index++) {
                if (!Number.isFinite(pitches[index])) { valid = false; break; }
                normalizedPitches[index] = clamp(pitches[index], 0, 1);
            }
            if (!valid) continue;
            segments.push({
                start, end: start + duration, peak: start + peakTime,
                amplitudeStart: decibelsToAmplitude(rawSegment.loudness_start),
                amplitudeMax: decibelsToAmplitude(rawSegment.loudness_max),
                amplitudeEnd: decibelsToAmplitude(finite(rawSegment.loudness_end, -160)),
                rise: rawSegment.loudness_max - rawSegment.loudness_start,
                loudest: rawSegment.loudness_max,
                pitches: normalizedPitches,
                pitchMean: normalizedPitches.reduce((sum, pitch) => sum + pitch, 0) / 12
            });
        }
        if (!segments.length) return null;
        for (let index = 0; index < segments.length - 1; index++) {
            const current = segments[index], next = segments[index + 1];
            // A corrupt overlapping segment must not extend over a later song section.
            current.end = Math.min(current.end, next.start);
            current.peak = Math.min(current.peak, current.end);
            if (Math.abs(current.end - next.start) < 0.001) current.amplitudeEnd = next.amplitudeStart;
        }
        return {
            segments,
            duration: Math.max(declaredDuration, segments[segments.length - 1].end),
            pulses: normalizePulses(data.beats, segments)
        };
    }

    function findSegmentIndex(segments, position) {
        let low = 0, high = segments.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (segments[middle].start <= position) low = middle + 1;
            else high = middle;
        }
        return low - 1;
    }

    function strengthAt(segments, time) {
        const segment = segments[findSegmentIndex(segments, time)];
        return segment && time <= segment.end ? Math.sqrt(segment.amplitudeMax) : 0;
    }

    // Ripples and particles start only on analysed beats, or on loud segment
    // attacks when a payload has no usable beat grid. Strength follows the real
    // loudness at that moment, so silence and gaps never emit decorative events.
    function normalizePulses(beats, segments) {
        const times = [], strengths = [];
        let usableBeats = false;
        if (Array.isArray(beats) && beats.length <= MAX_SEGMENTS) {
            let last = -Infinity;
            for (const beat of beats) {
                const start = finite(beat?.start, -1);
                if (start < 0 || start > MAX_DURATION_SECONDS || start <= last) continue;
                last = start;
                usableBeats = true;
                const confidence = clamp(finite(beat.confidence, 0.5), 0, 1);
                const strength = strengthAt(segments, start + 0.05) * (0.55 + 0.45 * confidence);
                if (strength < 0.12) continue;
                times.push(start);
                strengths.push(Math.min(1, strength));
            }
        }
        if (!usableBeats) {
            for (const segment of segments) {
                if (!(segment.rise >= 6) || !(segment.loudest >= -28)) continue;
                const strength = Math.min(1, Math.sqrt(segment.amplitudeMax) * clamp(segment.rise / 15, 0.5, 1));
                if (strength < 0.12) continue;
                const last = times.length - 1;
                if (last >= 0 && segment.peak - times[last] < 0.18) {
                    if (strength > strengths[last]) { times[last] = segment.peak; strengths[last] = strength; }
                    continue;
                }
                times.push(segment.peak);
                strengths.push(strength);
            }
        }
        return times.length ? { times: Float64Array.from(times), strengths: Float32Array.from(strengths) } : null;
    }

    function firstPulseAfter(times, time) {
        let low = 0, high = times?.length || 0;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (times[middle] <= time) low = middle + 1;
            else high = middle;
        }
        return low;
    }

    function sampleLoudness(segment, position) {
        if (position < segment.start || position > segment.end) return 0;
        if (position < segment.peak && segment.peak > segment.start) {
            return lerp(segment.amplitudeStart, segment.amplitudeMax, (position - segment.start) / (segment.peak - segment.start));
        }
        return segment.end > segment.peak
            ? lerp(segment.amplitudeMax, segment.amplitudeEnd, (position - segment.peak) / (segment.end - segment.peak))
            : segment.amplitudeMax;
    }

    // These are twelve pitch-class channels spread around a circle, not FFT bins.
    // Interpolation uses only real adjacent segment values; there is no random,
    // oscillator, timer-based, or fabricated fallback "audio" in the renderer.
    // Mirroring lays the twelve channels from top to bottom on both sides.
    function sampleSpectrum(analysis, position, density = DEFAULTS.density, sensitivity = DEFAULTS.sensitivity, output, mirror = false) {
        const count = Math.round(settingNumber(density, DEFAULTS.density, 24, 128));
        const values = output?.length === count ? output : new Float32Array(count);
        values.fill(0);
        if (!analysis?.segments?.length || !Number.isFinite(position) || position < 0) return values;
        const index = findSegmentIndex(analysis.segments, position);
        if (index < 0) return values;
        const segment = analysis.segments[index];
        const amplitude = sampleLoudness(segment, position);
        if (amplitude <= 0) return values;
        const next = analysis.segments[index + 1];
        const blend = next && Math.abs(next.start - segment.end) < 0.001 && segment.end > segment.peak
            ? smoothstep((position - segment.peak) / (segment.end - segment.peak)) : 0;
        const mean = next ? lerp(segment.pitchMean, next.pitchMean, blend) : segment.pitchMean;
        const gain = settingNumber(sensitivity, DEFAULTS.sensitivity, 25, 200) / 100;
        const half = count / 2;
        for (let band = 0; band < count; band++) {
            const pitchPosition = mirror ? (Math.min(band, count - band) / half * 12) % 12 : (band / count) * 12;
            const left = Math.floor(pitchPosition), right = (left + 1) % 12;
            const fraction = smoothstep(pitchPosition - left);
            const leftPitch = next ? lerp(segment.pitches[left], next.pitches[left], blend) : segment.pitches[left];
            const rightPitch = next ? lerp(segment.pitches[right], next.pitches[right], blend) : segment.pitches[right];
            const pitch = lerp(leftPitch, rightPitch, fraction) * 0.65 + mean * 0.35;
            // Perceptual compression keeps quiet, valid segments legible without
            // replacing missing analysis with decorative fake activity.
            values[band] = clamp(Math.sqrt(Math.max(0, amplitude * pitch)) * gain, 0, 1);
        }
        return values;
    }

    // Persist only the bounded rendering data, never the API response's extra
    // metadata. Packed arrays also give the disk budget a predictable size.
    function packAnalysis(uri, data) {
        const segments = new Float64Array(data.segments.length * PACKED_SEGMENT_SIZE);
        data.segments.forEach((segment, index) => {
            const offset = index * PACKED_SEGMENT_SIZE;
            ANALYSIS_FIELDS.forEach((field, fieldIndex) => { segments[offset + fieldIndex] = segment[field]; });
            segments.set(segment.pitches, offset + ANALYSIS_FIELDS.length);
        });
        const pulses = data.pulses ? new Float64Array(data.pulses.times.length * 2) : null;
        if (pulses) data.pulses.times.forEach((time, index) => {
            pulses[index * 2] = time;
            pulses[index * 2 + 1] = data.pulses.strengths[index];
        });
        return { cacheVersion: ANALYSIS_CACHE_VERSION, uri, data: { duration: data.duration, segments, pulses } };
    }

    const packedArray = value => ArrayBuffer.isView(value)
        && Object.prototype.toString.call(value) === "[object Float64Array]";
    const analysisRecordBytes = record => CACHE_RECORD_OVERHEAD
        + record.data.segments.byteLength + (record.data.pulses?.byteLength || 0);

    function unpackAnalysis(record, uri) {
        const data = record?.data, packed = data?.segments, events = data?.pulses;
        if (record?.cacheVersion !== ANALYSIS_CACHE_VERSION || record.uri !== uri
            || !Number.isFinite(data?.duration) || data.duration <= 0 || data.duration > MAX_DURATION_SECONDS
            || !packedArray(packed) || !packed.length || packed.length % PACKED_SEGMENT_SIZE
            || packed.length > MAX_SEGMENTS * PACKED_SEGMENT_SIZE
            || (events !== null && (!packedArray(events) || !events.length || events.length % 2 || events.length > MAX_SEGMENTS * 2))) return null;
        const segments = [];
        for (let offset = 0; offset < packed.length; offset += PACKED_SEGMENT_SIZE) {
            for (let index = 0; index < PACKED_SEGMENT_SIZE; index++) {
                if (!Number.isFinite(packed[offset + index])) return null;
            }
            const [start, end, peak, amplitudeStart, amplitudeMax, amplitudeEnd, rise, loudest] = packed.subarray(offset, offset + 8);
            const previous = segments[segments.length - 1];
            if (start < 0 || end <= start || end > data.duration || peak < start || peak > end
                || (previous && (start <= previous.start || start < previous.end))
                || [amplitudeStart, amplitudeMax, amplitudeEnd].some(value => value < 0 || value > 1)) return null;
            const pitches = new Float32Array(12);
            for (let index = 0; index < 12; index++) {
                const value = packed[offset + ANALYSIS_FIELDS.length + index];
                if (value < 0 || value > 1) return null;
                pitches[index] = value;
            }
            segments.push({ start, end, peak, amplitudeStart, amplitudeMax, amplitudeEnd, rise, loudest,
                pitches, pitchMean: pitches.reduce((sum, pitch) => sum + pitch, 0) / 12 });
        }
        let pulses = null;
        if (events) {
            const times = new Float64Array(events.length / 2), strengths = new Float32Array(events.length / 2);
            for (let index = 0; index < times.length; index++) {
                const time = events[index * 2], strength = events[index * 2 + 1];
                if (!Number.isFinite(time) || time < 0 || time > data.duration || (index && time <= times[index - 1])
                    || !Number.isFinite(strength) || strength <= 0 || strength > 1) return null;
                times[index] = time;
                strengths[index] = strength;
            }
            pulses = { times, strengths };
        }
        return { duration: data.duration, segments, pulses };
    }

    function createAnalysisLoader(options = {}) {
        const getSpicetify = options.getSpicetify || (() => root?.Spicetify);
        const now = options.now || Date.now;
        const schedule = options.setTimeout || ((callback, ms) => root.setTimeout(callback, ms));
        const cancel = options.clearTimeout || (id => root.clearTimeout(id));
        const timeoutMs = settingNumber(options.timeoutMs, 5000, 100, 10000);
        const negativeTtlMs = settingNumber(options.negativeTtlMs, 60000, 1000, 10 * 60000);
        const capacity = Math.round(settingNumber(options.capacity, 8, 1, 16));
        const maxInflight = Math.round(settingNumber(options.maxInflight, 4, 1, 8));
        const persistentCapacity = Math.round(settingNumber(options.persistentCapacity, 64, 1, 128));
        const maxPersistentBytes = settingNumber(options.maxPersistentBytes, 32 * 1024 * 1024, 1024, 64 * 1024 * 1024);
        const storageTimeoutMs = settingNumber(options.storageTimeoutMs, 1000, 50, 5000);
        const cache = new Map(), inflight = new Map();
        let waiting = null, database = null, databasePromise = null, storageRetryAfter = 0;

        function storageFailed(db) {
            storageRetryAfter = now() + negativeTtlMs;
            if (database === db) { database = null; databasePromise = null; }
            try { db?.close(); } catch (_) { /* Storage is optional. */ }
        }

        function getDatabase() {
            if (storageRetryAfter > now()) return Promise.resolve(null);
            if (databasePromise) return databasePromise;
            let factory;
            try {
                factory = Object.prototype.hasOwnProperty.call(options, "indexedDB") ? options.indexedDB : root?.indexedDB;
                if (typeof factory?.open !== "function") return Promise.resolve(null);
            } catch (_) { storageFailed(null); return Promise.resolve(null); }
            const opening = new Promise(resolve => {
                let finished = false, request;
                const finish = db => {
                    if (finished) return;
                    finished = true;
                    cancel(timer);
                    if (!db) storageFailed(null);
                    resolve(db);
                };
                const timer = schedule(() => finish(null), storageTimeoutMs);
                try {
                    request = factory.open(ANALYSIS_DB_NAME, 1);
                    request.onupgradeneeded = () => {
                        if (finished) { try { request.transaction?.abort(); } catch (_) { /* Late open. */ } return; }
                        try {
                            const db = request.result;
                            if (!db.objectStoreNames.contains("analysis")) db.createObjectStore("analysis", { keyPath: "uri" });
                            // Keep LRU metadata separate: pruning must not clone all
                            // cached multi-megabyte analyses on every song change.
                            if (!db.objectStoreNames.contains("entries")) db.createObjectStore("entries", { keyPath: "uri" });
                        } catch (_) {
                            try { request.transaction?.abort(); } catch (_) { /* Failed upgrade. */ }
                            finish(null);
                        }
                    };
                    request.onerror = request.onblocked = () => finish(null);
                    request.onsuccess = () => {
                        const db = request.result;
                        if (finished) { db.close(); return; }
                        database = db;
                        const reset = () => {
                            if (database === db) { database = null; databasePromise = null; }
                        };
                        db.onversionchange = () => { db.close(); reset(); };
                        db.onclose = reset;
                        finish(db);
                    };
                } catch (_) { finish(null); }
            });
            databasePromise = opening;
            opening.then(db => { if (!db && databasePromise === opening) databasePromise = null; });
            return opening;
        }

        async function persistentAccess(uri, data) {
            let record = null;
            if (data) {
                record = packAnalysis(uri, data);
                if (analysisRecordBytes(record) > maxPersistentBytes || !unpackAnalysis(record, uri)) return null;
            }
            const db = await getDatabase();
            if (!db) return null;
            return new Promise(resolve => {
                let transaction, result = null, finished = false;
                const finish = failed => {
                    if (finished) return;
                    finished = true;
                    cancel(timer);
                    if (failed) {
                        try { transaction?.abort(); } catch (_) { /* Already aborted/committed. */ }
                        storageFailed(db);
                    }
                    // A failed LRU touch must not discard valid data already
                    // read from disk and trigger a needless Spotify request.
                    resolve(result);
                };
                const timer = schedule(() => finish(true), storageTimeoutMs);
                try {
                    transaction = db.transaction(["analysis", "entries"], "readwrite");
                    transaction.oncomplete = () => finish(false);
                    transaction.onabort = transaction.onerror = () => finish(true);
                    const store = transaction.objectStore("analysis"), entries = transaction.objectStore("entries");
                    const touch = stored => {
                        const request = entries.getAll();
                        request.onsuccess = () => {
                            if (finished) return;
                            try {
                                let accessedAt = Math.max(0, Math.floor(finite(now(), 0)));
                                const retained = [];
                                for (const entry of request.result) {
                                    const valid = trackIdFromUri(entry.uri) && entry.cacheVersion === ANALYSIS_CACHE_VERSION
                                        && Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= CACHE_RECORD_OVERHEAD
                                        && entry.sizeBytes <= MAX_ANALYSIS_RECORD_BYTES
                                        && Number.isSafeInteger(entry.accessedAt) && entry.accessedAt >= 0
                                        && entry.accessedAt < Number.MAX_SAFE_INTEGER;
                                    if (entry.uri === uri) {
                                        if (valid) accessedAt = Math.max(accessedAt, entry.accessedAt + 1);
                                    } else if (valid) {
                                        retained.push(entry);
                                        accessedAt = Math.max(accessedAt, entry.accessedAt + 1);
                                    } else { entries.delete(entry.uri); store.delete(entry.uri); }
                                }
                                const entry = { uri, cacheVersion: ANALYSIS_CACHE_VERSION,
                                    accessedAt, sizeBytes: analysisRecordBytes(stored) };
                                entries.put(entry);
                                retained.sort((a, b) => a.accessedAt - b.accessedAt);
                                let bytes = entry.sizeBytes + retained.reduce((sum, item) => sum + item.sizeBytes, 0);
                                while (retained.length && (retained.length + 1 > persistentCapacity || bytes > maxPersistentBytes)) {
                                    const removed = retained.shift();
                                    bytes -= removed.sizeBytes;
                                    entries.delete(removed.uri);
                                    store.delete(removed.uri);
                                }
                            } catch (_) { finish(true); }
                        };
                    };
                    if (record) { store.put(record); touch(record); }
                    else {
                        const request = store.get(uri);
                        request.onsuccess = () => {
                            if (finished) return;
                            try {
                                result = unpackAnalysis(request.result, uri);
                                if (result && analysisRecordBytes(request.result) <= maxPersistentBytes) touch(request.result);
                                else { result = null; store.delete(uri); entries.delete(uri); }
                            } catch (_) { finish(true); }
                        };
                    }
                } catch (_) { finish(true); }
            });
        }

        function boundedRequest(request) {
            return new Promise(resolve => {
                let finished = false, timer;
                const finish = value => {
                    if (finished) return;
                    finished = true;
                    if (timer !== undefined) cancel(timer);
                    resolve(value);
                };
                timer = schedule(() => finish(null), timeoutMs);
                Promise.resolve().then(request).then(finish, () => finish(null));
            });
        }

        async function fetchAnalysis(uri, id) {
            const spicetify = getSpicetify();
            if (typeof spicetify?.getAudioData === "function") {
                // Spicetify's implementation calls this very same Cosmos URL.
                // Retrying it directly after a 403/404, bad payload, rejection,
                // or timeout only duplicates the failure and doubles the wait.
                return normalizeAnalysis(await boundedRequest(() => spicetify.getAudioData(uri)));
            }
            if (typeof spicetify?.CosmosAsync?.get === "function") {
                return normalizeAnalysis(await boundedRequest(() => spicetify.CosmosAsync.get(
                    `https://spclient.wg.spotify.com/audio-attributes/v1/audio-analysis/${id}?format=json`
                )));
            }
            return null;
        }

        function start(job) {
            inflight.set(job.uri, job.promise);
            Promise.resolve().then(async () => {
                const stored = await persistentAccess(job.uri).catch(() => null);
                if (stored) return stored;
                const data = await fetchAnalysis(job.uri, job.id);
                // Complete the bounded write before releasing deduplication:
                // a re-mounted/reloaded renderer can immediately reuse it.
                if (data) await persistentAccess(job.uri, data).catch(() => null);
                return data;
            }).catch(() => null).then(data => {
                cache.delete(job.uri);
                cache.set(job.uri, { data, expires: data ? Infinity : now() + negativeTtlMs });
                while (cache.size > capacity) cache.delete(cache.keys().next().value);
                inflight.delete(job.uri);
                job.resolve(data);
                if (waiting) {
                    const next = waiting;
                    waiting = null;
                    start(next);
                }
            });
        }

        function load(uri) {
            const id = trackIdFromUri(uri);
            if (!id) return Promise.resolve(null);
            const cached = cache.get(uri);
            if (cached && cached.expires > now()) {
                cache.delete(uri);
                cache.set(uri, cached);
                return Promise.resolve(cached.data);
            }
            cache.delete(uri);
            if (inflight.has(uri)) return inflight.get(uri);
            if (waiting?.uri === uri) return waiting.promise;
            const job = { uri, id };
            job.promise = new Promise(resolve => { job.resolve = resolve; });
            if (inflight.size < maxInflight) start(job);
            else {
                // Rapid skips cannot create an unbounded network queue. Retain
                // the newest waiting track, rather than making it permanently
                // unavailable simply because stale requests occupy the slots.
                waiting?.resolve(null);
                waiting = job;
            }
            return job.promise;
        }

        load.getStats = () => ({ cached: cache.size, inflight: inflight.size, waiting: waiting ? 1 : 0 });
        return load;
    }

    const loadAnalysis = createAnalysisLoader();

    // Pick representative pixels from populated colour buckets. Dark/neutral
    // backgrounds and JPEG speckles must not crowd out the artwork's colours;
    // a monochrome cover deliberately has no multicolour fallback palette.
    function extractAlbumPalette(pixels, maxColors = 6) {
        if (!pixels || !Number.isInteger(pixels.length) || !pixels.length || pixels.length % 4 || pixels.length > 64 * 64 * 4) return null;
        const buckets = new Map();
        let opaque = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
            const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2], alpha = pixels[offset + 3];
            if (![r, g, b, alpha].every(value => Number.isFinite(value) && value >= 0 && value <= 255) || alpha < 192) continue;
            opaque++;
            const high = Math.max(r, g, b), low = Math.min(r, g, b);
            if (high < 40 || high - low < 32 || (high - low) / high < 0.16) continue;
            const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
            const bucket = buckets.get(key);
            if (bucket) bucket.count++;
            else buckets.set(key, { r, g, b, count: 1, saturation: (high - low) / high });
        }
        const candidates = [...buckets.values()].filter(color => color.count >= Math.max(2, opaque * 0.003));
        candidates.forEach(color => { color.score = Math.sqrt(color.count) * (0.3 + color.saturation * 0.7); });
        const selected = [], limit = Math.round(settingNumber(maxColors, 6, 2, 8));
        while (selected.length < limit && candidates.length) {
            let best = -1, score = -1;
            for (let index = 0; index < candidates.length; index++) {
                const color = candidates[index];
                const distance = selected.length ? Math.min(...selected.map(other => Math.hypot(color.r - other.r, color.g - other.g, color.b - other.b))) : 255;
                if (distance < 60) continue;
                const distinctScore = color.score * Math.min(1, distance / 160);
                if (distinctScore > score) { best = index; score = distinctScore; }
            }
            if (best < 0) break;
            selected.push(candidates.splice(best, 1)[0]);
        }
        return selected.length >= 2 ? Object.freeze(selected.map(({ r, g, b }) =>
            `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`)) : null;
    }

    function normalizeArtworkUrl(value) {
        if (typeof value !== "string" || !value || value.length > 4096) return null;
        const spotifyImage = /^spotify:image:([a-f0-9]{40})$/i.exec(value);
        if (spotifyImage) return `https://i.scdn.co/image/${spotifyImage[1]}`;
        return /^https?:\/\/[^\s]+$/i.test(value) || /^blob:https?:\/\/[^\s]+$/i.test(value) ? value : null;
    }

    function detachedCanvas(host, width, height) {
        let canvas;
        if (typeof host?.OffscreenCanvas === "function") canvas = new host.OffscreenCanvas(width, height);
        else canvas = host?.document?.createElement?.("canvas");
        if (canvas) { canvas.width = width; canvas.height = height; }
        return canvas;
    }

    function createPaletteLoader(options = {}) {
        const host = options.root || root;
        const schedule = options.setTimeout || ((callback, ms) => host.setTimeout(callback, ms));
        const cancel = options.clearTimeout || (id => host.clearTimeout(id));
        const now = options.now || Date.now;
        const timeoutMs = settingNumber(options.timeoutMs, 3000, 50, 5000);
        const negativeTtlMs = settingNumber(options.negativeTtlMs, 60000, 1000, 10 * 60000);
        const capacity = Math.round(settingNumber(options.capacity, 12, 1, 32));
        const maxInflight = Math.round(settingNumber(options.maxInflight, 2, 1, 4));
        const makeImage = options.createImage || (() => new host.Image());
        const makeCanvas = options.createCanvas || ((width, height) => detachedCanvas(host, width, height));
        const cache = new Map(), jobs = new Map();
        let active = 0, waiting = null;

        function finish(job, palette = null, remember = true) {
            if (job.done) return;
            job.done = true;
            if (job.timer !== undefined) cancel(job.timer);
            if (job.image) {
                job.image.onload = job.image.onerror = null;
                if (!palette) {
                    try { job.image.src = ""; } catch (_) { /* Cancel a timed-out/unobserved image. */ }
                }
            }
            if (job.started) active--;
            if (waiting === job) waiting = null;
            jobs.delete(job.url);
            if (remember) {
                cache.delete(job.url);
                cache.set(job.url, { palette, expires: palette ? Infinity : now() + negativeTtlMs });
                while (cache.size > capacity) cache.delete(cache.keys().next().value);
            }
            for (const subscriber of [...job.subscribers]) subscriber(palette);
            if (waiting && active < maxInflight) {
                const next = waiting;
                waiting = null;
                start(next);
            }
        }

        function start(job) {
            if (job.done) return;
            job.started = true;
            active++;
            job.timer = schedule(() => finish(job), timeoutMs);
            try {
                const image = job.image = makeImage();
                image.crossOrigin = "anonymous";
                image.onload = () => {
                    if (job.done) return;
                    try {
                        if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) { finish(job); return; }
                        const canvas = makeCanvas(48, 48), context = canvas?.getContext?.("2d", { willReadFrequently: true });
                        if (!context) { finish(job); return; }
                        context.drawImage(image, 0, 0, 48, 48);
                        finish(job, extractAlbumPalette(context.getImageData(0, 0, 48, 48).data));
                    } catch (_) { finish(job); /* CORS/tainted canvases retain the real accent. */ }
                };
                image.onerror = () => finish(job);
                image.src = job.url;
            } catch (_) { finish(job); }
        }

        function load(value, signal) {
            const url = normalizeArtworkUrl(value);
            if (!url || signal?.aborted) return Promise.resolve(null);
            const cached = cache.get(url);
            if (cached && cached.expires > now()) {
                cache.delete(url); cache.set(url, cached);
                return Promise.resolve(cached.palette);
            }
            cache.delete(url);
            let job = jobs.get(url);
            const created = !job;
            if (!job) {
                job = { url, subscribers: new Set(), done: false, started: false };
                jobs.set(url, job);
            }
            const promise = new Promise(resolve => {
                const settle = palette => {
                    signal?.removeEventListener?.("abort", abort);
                    job.subscribers.delete(settle);
                    resolve(palette);
                };
                const abort = () => {
                    settle(null);
                    if (!job.subscribers.size) finish(job, null, false);
                };
                job.subscribers.add(settle);
                signal?.addEventListener?.("abort", abort, { once: true });
            });
            if (created) {
                if (active < maxInflight) start(job);
                else {
                    const displaced = waiting;
                    waiting = job;
                    if (displaced) finish(displaced, null, false);
                }
            }
            return promise;
        }
        load.getStats = () => ({ cached: cache.size, inflight: active, waiting: waiting ? 1 : 0 });
        return load;
    }

    const loadPalette = createPaletteLoader();

    function normalizedPalette(palette) {
        if (!Array.isArray(palette) || palette.length < 2 || palette.length > 8
            || !palette.every(color => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))) return null;
        const colors = [...new Set(palette.map(color => color.toLowerCase()))];
        return colors.length >= 2 ? colors : null;
    }

    // A mesh of circular Gaussian colour sources, not a directional gradient
    // or a hue wheel. Blend in linear light so adjacent artwork colours remain
    // bright. Only an annulus has ink; the centre and exterior stay transparent.
    function blendAlbumTexture(palette, resolution = 128) {
        const colors = normalizedPalette(palette);
        if (!colors) return null;
        const size = Math.round(settingNumber(resolution, 128, 32, 192));
        const sources = colors.map((color, index) => {
            const angle = index / colors.length * TWO_PI - Math.PI / 2;
            return { x: 0.5 + Math.cos(angle) * 0.42, y: 0.5 + Math.sin(angle) * 0.42,
                channels: [1, 3, 5].map(offset => Math.pow(parseInt(color.slice(offset, offset + 2), 16) / 255, 2.2)) };
        });
        const pixels = new Uint8ClampedArray(size * size * 4);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const u = (x + 0.5) / size, v = (y + 0.5) / size, radius = Math.hypot(u - 0.5, v - 0.5);
            const alpha = smoothstep((radius - 0.36) / 0.02) * (1 - smoothstep((radius - 0.485) / 0.01));
            if (alpha <= 0) continue;
            let red = 0, green = 0, blue = 0, total = 0;
            for (const source of sources) {
                const weight = Math.exp(-((u - source.x) ** 2 + (v - source.y) ** 2) / (2 * 0.18 ** 2));
                red += source.channels[0] * weight;
                green += source.channels[1] * weight;
                blue += source.channels[2] * weight;
                total += weight;
            }
            const offset = (y * size + x) * 4;
            pixels[offset] = Math.pow(red / total, 1 / 2.2) * 255;
            pixels[offset + 1] = Math.pow(green / total, 1 / 2.2) * 255;
            pixels[offset + 2] = Math.pow(blue / total, 1 / 2.2) * 255;
            pixels[offset + 3] = alpha * 255;
        }
        return { width: size, height: size, data: pixels };
    }

    const albumPaintCache = new WeakMap();

    function prepareAlbumPaint(context, metrics, palette, environment = null) {
        if (!context || !palette) return null;
        let cache = albumPaintCache.get(context);
        const { width, height } = metrics;
        if (cache?.palette === palette && cache.width === width && cache.height === height) return cache.paint;
        if (!cache) { cache = { entries: new Map() }; albumPaintCache.set(context, cache); }
        const colors = normalizedPalette(palette);
        const key = colors && `${width}:${height}:${colors.join(":")}`;
        let paint = cache.entries.get(key) || null;
        if (key && !cache.entries.has(key) && width > 0 && height > 0) {
            try {
                if (typeof context.createPattern === "function") {
                    const texture = blendAlbumTexture(colors);
                    const canvas = environment?.createCanvas
                        ? environment.createCanvas(texture.width, texture.height)
                        : detachedCanvas(environment?.root || root, texture.width, texture.height);
                    const layer = canvas?.getContext?.("2d", { alpha: true });
                    if (layer) {
                        const image = layer.createImageData(texture.width, texture.height);
                        image.data.set(texture.data);
                        layer.putImageData(image, 0, 0);
                        paint = context.createPattern(canvas, "no-repeat");
                        if (typeof paint?.setTransform === "function") {
                            const size = Math.min(width, height);
                            paint.setTransform({ a: size / texture.width, b: 0, c: 0, d: size / texture.height,
                                e: (width - size) / 2, f: (height - size) / 2 });
                        } else paint = null;
                    }
                }
            } catch (_) { paint = null; }
            cache.entries.set(key, paint);
            while (cache.entries.size > 4) cache.entries.delete(cache.entries.keys().next().value);
        }
        Object.assign(cache, { palette, width, height, paint });
        return paint;
    }

    function getCanvasMetrics(width, height, devicePixelRatio = 1) {
        const cssWidth = clamp(finite(width, 0), 0, 2048);
        const cssHeight = clamp(finite(height, 0), 0, 2048);
        const dpr = clamp(finite(devicePixelRatio, 1), 1, 2);
        const pixelWidth = Math.max(1, Math.min(1536, Math.round(cssWidth * dpr)));
        const pixelHeight = Math.max(1, Math.min(1536, Math.round(cssHeight * dpr)));
        return {
            width: cssWidth, height: cssHeight, pixelWidth, pixelHeight,
            scaleX: cssWidth ? pixelWidth / cssWidth : 1,
            scaleY: cssHeight ? pixelHeight / cssHeight : 1
        };
    }

    function createRadialGeometry(density) {
        const count = Math.round(settingNumber(density, DEFAULTS.density, 24, 128));
        const directions = new Float32Array(count * 2);
        for (let index = 0; index < count; index++) {
            const angle = index / count * TWO_PI - Math.PI / 2;
            directions[index * 2] = Math.cos(angle);
            directions[index * 2 + 1] = Math.sin(angle);
        }
        return directions;
    }

    const rainbowColor = hue => `hsl(${hue}, 82%, 68%)`;
    const rainbowCache = typeof WeakMap === "function" ? new WeakMap() : null;

    // A conic hue wheel that starts at the top like the bands. Mirrored spectra
    // run top-to-bottom on both sides, so their colours mirror as well.
    function getRainbowPaint(context, cx, cy, mirror) {
        if (typeof context?.createConicGradient !== "function") return null;
        const key = `${cx}:${cy}:${mirror ? 1 : 0}`;
        const cached = rainbowCache?.get(context);
        if (cached?.key === key) return cached.gradient;
        let gradient;
        try { gradient = context.createConicGradient(-Math.PI / 2, cx, cy); } catch (_) { return null; }
        if (!gradient || typeof gradient.addColorStop !== "function") return null;
        if (mirror) {
            const last = RAINBOW_HUES.length - 2;
            for (let index = 0; index <= last; index++) {
                const offset = index / last / 2;
                gradient.addColorStop(offset, rainbowColor(RAINBOW_HUES[index]));
                gradient.addColorStop(1 - offset, rainbowColor(RAINBOW_HUES[index]));
            }
        } else {
            const last = RAINBOW_HUES.length - 1;
            for (let index = 0; index <= last; index++) gradient.addColorStop(index / last, rainbowColor(RAINBOW_HUES[index]));
        }
        rainbowCache?.set(context, { key, gradient });
        return gradient;
    }

    // A smooth closed contour through the band tips. The quadratic B-spline
    // stays inside the convex hull of its points, so it never overshoots.
    function traceContour(context, directions, count, cx, cy, radiusAt) {
        const curve = typeof context.quadraticCurveTo === "function";
        const lastRadius = radiusAt(count - 1), firstRadius = radiusAt(0);
        const px = cx + directions[(count - 1) * 2] * lastRadius, py = cy + directions[(count - 1) * 2 + 1] * lastRadius;
        let qx = cx + directions[0] * firstRadius, qy = cy + directions[1] * firstRadius;
        context.moveTo((px + qx) / 2, (py + qy) / 2);
        for (let index = 0; index < count; index++) {
            const next = (index + 1) % count, radius = radiusAt(next);
            const nx = cx + directions[next * 2] * radius, ny = cy + directions[next * 2 + 1] * radius;
            if (curve) context.quadraticCurveTo(qx, qy, (qx + nx) / 2, (qy + ny) / 2);
            else { context.lineTo(qx, qy); context.lineTo((qx + nx) / 2, (qy + ny) / 2); }
            qx = nx; qy = ny;
        }
        context.closePath();
    }

    // Radial erase ramps soften fills: glow fades outward, wave fades toward the
    // CD. The canvas holds only the visualizer, so this never touches the CD,
    // lyrics or page behind it. Ramps are cached per canvas size like the wheel.
    const GLOW_RAMP = Object.freeze([[0, "rgba(0, 0, 0, 0)"], [0.4, "rgba(0, 0, 0, 0.2)"], [1, "rgba(0, 0, 0, 0.75)"]]);
    const WAVE_RAMP = Object.freeze([[0, "rgba(0, 0, 0, 0.8)"], [1, "rgba(0, 0, 0, 0)"]]);
    // [outer contour scale, inner contour scale (0 = CD edge), stacked alpha]
    // equal to layers of 0.16, 0.2 and 0.28 painted over one another.
    const AURA_BANDS = Object.freeze([[1, 0.66, 0.16], [0.66, 0.36, 1 - 0.84 * 0.8], [0.36, 0, 1 - 0.84 * 0.8 * 0.72]]);
    const rampCache = typeof WeakMap === "function" ? new WeakMap() : null;

    function eraseRadially(context, cx, cy, inner, outer, stops, keepInside = 0) {
        if (typeof context.createRadialGradient !== "function" || !(outer > inner)) return;
        const key = `${cx}:${cy}:${inner}:${outer}`;
        let ramps = rampCache?.get(context);
        if (!ramps) { ramps = new Map(); rampCache?.set(context, ramps); }
        let ramp = ramps.get(stops)?.key === key ? ramps.get(stops).ramp : null;
        if (!ramp) {
            try { ramp = context.createRadialGradient(cx, cy, inner, cx, cy, outer); } catch (_) { return; }
            if (!ramp || typeof ramp.addColorStop !== "function") return;
            for (const [offset, colour] of stops) ramp.addColorStop(offset, colour);
            ramps.set(stops, { key, ramp });
        }
        context.globalCompositeOperation = "destination-out";
        context.globalAlpha = 1;
        context.fillStyle = ramp;
        context.beginPath();
        context.arc(cx, cy, outer + 2, 0, TWO_PI);
        if (keepInside > 0) {
            context.moveTo(cx + keepInside, cy);
            context.arc(cx, cy, keepInside, 0, TWO_PI, true);
        }
        context.fill("evenodd");
        context.globalCompositeOperation = "source-over";
    }

    let particleSpectrum = null;

    // extras carries the frame's real playback position, analysis (for beat
    // events) and held peaks. Without them every style degrades to its spectrum
    // or the static ring; nothing is synthesized.
    function drawSpectrum(context, metrics, values, settings = DEFAULTS, color = "#ffffff", geometry, extras = null) {
        const { width, height, scaleX = 1, scaleY = 1 } = metrics;
        if (!context || width <= 0 || height <= 0) return;
        const style = STYLES.includes(settings.style) ? settings.style : DEFAULTS.style;
        const size = Math.min(width, height), cx = width / 2, cy = height / 2;
        const lineWidth = Math.min(settings.thickness, size * 0.025);
        const baseRadius = size * 0.4, outerRadius = size * 0.48;
        const count = values?.length || settings.density;
        const dotRadius = Math.max(0.5, Math.min(lineWidth * 0.7, baseRadius * Math.PI / count * 0.6));
        const particleMax = Math.max(1.2, lineWidth * 1.5);
        const inkRadius = style === "dots" ? dotRadius
            : style === "particles" ? particleMax
            : style === "pulse" ? lineWidth * 0.8
            : style === "spikes" || style === "blocks" ? 0.5
            : lineWidth / 2;
        const extent = Math.max(0, outerRadius - baseRadius - inkRadius - 1);
        const paint = settings.colorMode === "rainbow" ? getRainbowPaint(context, cx, cy, settings.mirror) || color
            : settings.colorMode === "album" && settings.albumGradient && extras?.palette
                ? prepareAlbumPaint(context, metrics, extras.palette) || color : color;
        context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
        context.clearRect(0, 0, width, height);
        context.setLineDash?.(NO_DASH);
        context.globalCompositeOperation = "source-over";
        context.strokeStyle = paint;
        context.fillStyle = paint;
        context.lineWidth = Math.max(0.5, lineWidth);
        context.lineCap = "round";
        context.lineJoin = "round";
        context.globalAlpha = 0.2;
        context.beginPath();
        context.arc(cx, cy, baseRadius, 0, TWO_PI);
        context.stroke();
        context.globalAlpha = 0.9;
        if (!values?.length) { context.globalAlpha = 1; return; }
        const directions = geometry?.length === count * 2 ? geometry : createRadialGeometry(count);
        const level = index => clamp(finite(values[index], 0), 0, 1);
        const radiusAt = index => baseRadius + level(index) * extent;
        const gain = settingNumber(settings.sensitivity, DEFAULTS.sensitivity, 25, 200) / 100;
        const pulses = extras?.analysis?.pulses;
        const position = extras?.position;
        const timed = !!pulses?.times?.length && Number.isFinite(position);
        if (style === "line") {
            context.beginPath();
            for (let index = 0; index < count; index++) {
                const radius = radiusAt(index);
                const x = cx + directions[index * 2] * radius;
                const y = cy + directions[index * 2 + 1] * radius;
                if (index === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }
            context.closePath();
            context.stroke();
        } else if (style === "dots") {
            context.beginPath();
            for (let index = 0; index < count; index++) {
                const radius = radiusAt(index);
                const x = cx + directions[index * 2] * radius;
                const y = cy + directions[index * 2 + 1] * radius;
                context.moveTo(x + dotRadius, y);
                context.arc(x, y, dotRadius, 0, TWO_PI);
            }
            context.fill();
        } else if (style === "wave") {
            // Start where two neighbouring floor points meet the ring exactly.
            const floor = baseRadius / Math.cos(Math.PI / count);
            const span = Math.max(0, baseRadius + extent - floor);
            const contourRadius = index => floor + level(index) * span;
            context.beginPath();
            traceContour(context, directions, count, cx, cy, contourRadius);
            context.moveTo(cx + baseRadius, cy);
            context.arc(cx, cy, baseRadius, 0, TWO_PI, true);
            context.globalAlpha = 0.34;
            context.fill("evenodd");
            // Brightest at the crest, clear near the CD: the shape reads as liquid.
            eraseRadially(context, cx, cy, baseRadius, baseRadius + extent, WAVE_RAMP, baseRadius + lineWidth / 2);
            context.fillStyle = paint;
            context.beginPath();
            traceContour(context, directions, count, cx, cy, contourRadius);
            context.globalAlpha = 0.9;
            context.stroke();
        } else if (style === "aura") {
            // Three nested copies of the contour build a soft falloff that keeps
            // the spectrum's shape; a radial ramp then blends the steps away.
            // Each band is filled once between neighbouring contours (with the
            // stacked opacity precomputed), so no pixel is painted twice.
            const inner = size * 0.38;
            const floor = baseRadius / Math.cos(Math.PI / count);
            const span = Math.max(0, baseRadius + extent - floor);
            for (const [outerScale, innerScale, alpha] of AURA_BANDS) {
                context.beginPath();
                traceContour(context, directions, count, cx, cy, index => floor + level(index) * span * outerScale);
                if (innerScale > 0) traceContour(context, directions, count, cx, cy, index => floor + level(index) * span * innerScale);
                else {
                    context.moveTo(cx + inner, cy);
                    context.arc(cx, cy, inner, 0, TWO_PI, true);
                }
                context.globalAlpha = alpha;
                context.fill("evenodd");
            }
            eraseRadially(context, cx, cy, inner, outerRadius, GLOW_RAMP, inner);
            context.fillStyle = paint;
        } else if (style === "blocks") {
            const start = baseRadius + Math.max(1, lineWidth * 0.5 + 0.5);
            // The last lit block ends exactly at the shared outer limit.
            const pitch = Math.max(0, baseRadius + extent - start) / (BLOCK_LEVELS - 0.3);
            const blockLength = pitch * 0.7;
            const gap = pitch - blockLength;
            const levels = index => Math.round(level(index) * BLOCK_LEVELS);
            context.lineCap = "butt";
            context.lineWidth = Math.max(0.75, Math.min(lineWidth * 2.2 + 1, baseRadius * TWO_PI / count * 0.72));
            if (pitch > 0) context.setLineDash?.([blockLength, gap]);
            context.beginPath();
            for (let index = 0; index < count; index++) {
                const lit = levels(index);
                if (!lit || !(pitch > 0)) continue;
                const x = directions[index * 2], y = directions[index * 2 + 1];
                const end = start + lit * pitch - gap;
                context.moveTo(cx + x * start, cy + y * start);
                context.lineTo(cx + x * end, cy + y * end);
            }
            context.stroke();
            const peaks = extras?.peaks;
            if (peaks?.length === count) {
                let capped = 0;
                for (let index = 0; index < count; index++) {
                    const peak = Math.round(clamp(finite(peaks[index], 0), 0, 1) * BLOCK_LEVELS);
                    if (peak <= levels(index)) continue;
                    const x = directions[index * 2], y = directions[index * 2 + 1];
                    const from = start + (peak - 1) * pitch;
                    if (!capped++) context.beginPath();
                    context.moveTo(cx + x * from, cy + y * from);
                    context.lineTo(cx + x * (from + blockLength), cy + y * (from + blockLength));
                }
                if (capped) {
                    context.globalAlpha = 0.55;
                    context.stroke();
                }
            }
            context.setLineDash?.(NO_DASH);
            context.lineCap = "round";
        } else if (style === "spikes") {
            const halfWidth = Math.PI / count * Math.min(1, 0.55 + settings.thickness * 0.075);
            const cosine = Math.cos(halfWidth), sine = Math.sin(halfWidth);
            const footing = baseRadius + 0.5;
            context.beginPath();
            for (let index = 0; index < count; index++) {
                const value = level(index);
                if (value <= 0.002) continue;
                const x = directions[index * 2], y = directions[index * 2 + 1];
                const tip = baseRadius + value * extent;
                context.moveTo(cx + (x * cosine - y * sine) * footing, cy + (y * cosine + x * sine) * footing);
                context.lineTo(cx + x * tip, cy + y * tip);
                context.lineTo(cx + (x * cosine + y * sine) * footing, cy + (y * cosine - x * sine) * footing);
                context.closePath();
            }
            context.globalAlpha = 0.88;
            context.fill();
        } else if (style === "pulse") {
            // The ring breathes with the overall level; ripples mark real beats.
            let sum = 0;
            for (let index = 0; index < count; index++) sum += level(index);
            const energy = sum / count;
            context.globalAlpha = 0.3 + 0.6 * energy;
            context.lineWidth = Math.max(0.5, lineWidth * (1 + energy * 1.4));
            context.beginPath();
            context.arc(cx, cy, baseRadius + energy * extent * 0.18, 0, TWO_PI);
            context.stroke();
            if (timed) {
                for (let event = firstPulseAfter(pulses.times, position - PULSE_SECONDS); event < pulses.times.length; event++) {
                    const elapsed = position - pulses.times[event];
                    if (elapsed < 0) break;
                    const progress = elapsed / PULSE_SECONDS;
                    const alpha = 0.9 * Math.min(1, pulses.strengths[event] * gain) * Math.pow(1 - progress, 1.6);
                    if (alpha < 0.02) continue;
                    const eased = 1 - (1 - progress) * (1 - progress);
                    context.globalAlpha = alpha;
                    context.lineWidth = Math.max(0.5, lineWidth * (1.6 - progress));
                    context.beginPath();
                    context.arc(cx, cy, baseRadius + eased * extent, 0, TWO_PI);
                    context.stroke();
                }
            }
        } else if (style === "particles") {
            // Each beat bursts from the bands that were loud at that moment.
            if (timed) {
                if (particleSpectrum?.length !== count) particleSpectrum = new Float32Array(count);
                const stride = Math.max(1, Math.round(count / 28));
                const half = Math.floor(count / 2);
                for (let event = firstPulseAfter(pulses.times, position - PARTICLE_SECONDS); event < pulses.times.length; event++) {
                    const time = pulses.times[event], elapsed = position - time;
                    if (elapsed < 0) break;
                    const progress = elapsed / PARTICLE_SECONDS;
                    const alpha = Math.min(1, pulses.strengths[event] * gain * 1.3) * Math.pow(1 - progress, 0.9);
                    if (alpha < 0.02) continue;
                    const burst = sampleSpectrum(extras.analysis, time + 0.05, count, settings.sensitivity, particleSpectrum, settings.mirror);
                    const eased = 1 - Math.pow(1 - progress, 2.2);
                    let emitted = 0;
                    const emit = band => {
                        const value = burst[band];
                        if (!(value >= 0.2)) return;
                        const distance = baseRadius + lineWidth + eased * Math.max(0, extent - lineWidth) * (0.3 + 0.7 * Math.pow(value, 1.5));
                        const radius = Math.max(0.8, particleMax * (0.5 + 0.5 * value) * (1 - 0.4 * progress));
                        const x = cx + directions[band * 2] * distance, y = cy + directions[band * 2 + 1] * distance;
                        if (!emitted) context.beginPath();
                        context.moveTo(x + radius, y);
                        context.arc(x, y, radius, 0, TWO_PI);
                        emitted++;
                    };
                    if (settings.mirror) {
                        for (let band = event % stride; band <= half; band += stride) {
                            emit(band);
                            const twin = (count - band) % count;
                            if (twin !== band) emit(twin);
                        }
                    } else {
                        for (let band = event % stride; band < count; band += stride) emit(band);
                    }
                    if (emitted) {
                        context.globalAlpha = alpha;
                        context.fill();
                    }
                }
            }
        } else {
            context.lineWidth = Math.max(0.5, Math.min(lineWidth, baseRadius * TWO_PI / count * 0.65));
            context.beginPath();
            for (let index = 0; index < count; index++) {
                const x = directions[index * 2], y = directions[index * 2 + 1];
                const radius = radiusAt(index);
                context.moveTo(cx + x * baseRadius, cy + y * baseRadius);
                context.lineTo(cx + x * radius, cy + y * radius);
            }
            context.stroke();
        }
        context.globalAlpha = 1;
    }

    function readPlayback(trackUri, host = root) {
        const spicetify = host?.Spicetify;
        let snapshot = null;
        try {
            // ivLyricsPlaybackClock is a factory API, not a singleton clock.
            // Reuse the service's existing guarded clock; do not create a new
            // background poller for each CD/crossfade canvas.
            snapshot = host?.Utils?.getPlayerPlaybackSnapshot?.()
                || host?.__ivLyricsPlaybackProgressGuard?.getSnapshot?.()
                || host?.ivLyricsPlaybackClock?.getSnapshot?.() || null;
        } catch (_) { /* A public progress reading remains available below. */ }
        const item = snapshot?.item || spicetify?.Platform?.PlayerAPI?._state?.item || spicetify?.Player?.data?.item;
        const currentUri = snapshot?.uri || item?.uri;
        const metadata = item?.metadata || {};
        const ad = spicetify?.Player?.data?.isAd === true || item?.is_ad === true
            || metadata.is_ad === true || metadata.is_ad === "true";
        if ((currentUri && currentUri !== trackUri) || ad || snapshot?.djNarration === true) {
            return { matches: false, position: 0, playing: false };
        }
        let milliseconds = snapshot?.position;
        if (!Number.isFinite(milliseconds)) {
            try {
                milliseconds = host?.Utils?.getSafePlayerProgress?.() ?? spicetify?.Player?.getProgress?.();
            } catch (_) { milliseconds = Number.NaN; }
        }
        let playing = snapshot?.isPlaying;
        if (typeof playing !== "boolean") {
            try { playing = spicetify?.Player?.isPlaying?.(); } catch (_) { playing = false; }
        }
        return {
            matches: true,
            position: Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds / 1000 : null,
            playing: playing !== false
        };
    }

    // Standalone imperative renderer: no React updates, allocations of band
    // buffers, layout reads, or network requests occur inside the frame loop.
    function createRenderer(canvas, initialOptions = {}, environment = {}) {
        const host = environment.root || root;
        const document = environment.document || host?.document;
        const player = environment.player || host?.Spicetify?.Player;
        const requestFrame = environment.requestAnimationFrame || (callback => host.requestAnimationFrame(callback));
        const cancelFrame = environment.cancelAnimationFrame || (id => host.cancelAnimationFrame(id));
        const now = environment.now || (() => host?.performance?.now?.() ?? Date.now());
        const loader = environment.loadAnalysis || loadAnalysis;
        const paletteLoader = environment.loadPalette || loadPalette;
        const textureEnvironment = { root: host, createCanvas: environment.createCanvas };
        const Controller = host?.AbortController || root?.AbortController;
        const playback = environment.readPlayback || (uri => readPlayback(uri, host));
        let context;
        try { context = canvas?.getContext?.("2d", { alpha: true }); } catch (_) { context = null; }
        let options = {}, settings = normalizeSettings(), color = "#ffffff";
        let metrics = getCanvasMetrics(0, 0), status = null;
        let analysis = null, generation = 0, pending = null, attempted = false, destroyed = false;
        let palette = null, paletteGeneration = 0, palettePending = null, paletteAttempted = false, paletteAbort = null;
        let frame = null, lastFrameAt = -Infinity, lastPosition = null;
        let values = new Float32Array(settings.density), targets = new Float32Array(settings.density);
        let peaks = new Float32Array(settings.density), peakTimes = new Float64Array(settings.density);
        let geometry = createRadialGeometry(settings.density);
        const frameExtras = { analysis: null, position: null, peaks: null, palette: null };
        const removers = [];

        function report(nextStatus) {
            if (destroyed || status === nextStatus) return;
            status = nextStatus;
            canvas?.setAttribute?.("data-state", nextStatus);
            try { options.onStatusChange?.(nextStatus); } catch (_) { /* Consumer feedback cannot break playback. */ }
        }

        function measure() {
            const rect = canvas?.getBoundingClientRect?.() || { width: 0, height: 0 };
            metrics = getCanvasMetrics(rect.width, rect.height, host?.devicePixelRatio);
            if (canvas && canvas.width !== metrics.pixelWidth) canvas.width = metrics.pixelWidth;
            if (canvas && canvas.height !== metrics.pixelHeight) canvas.height = metrics.pixelHeight;
            preparePalette();
        }

        function preparePalette() {
            if (palette && settings.colorMode === "album" && settings.albumGradient) {
                prepareAlbumPaint(context, metrics, palette, textureEnvironment);
            }
        }

        function clearPalette() {
            paletteGeneration++;
            paletteAbort?.abort();
            paletteAbort = null;
            palettePending = null;
            paletteAttempted = false;
            palette = null;
            frameExtras.palette = null;
        }

        function requestPalette() {
            if (destroyed || palettePending || paletteAttempted || !context || !options.enabled
                || settings.colorMode !== "album" || !settings.albumGradient || !trackIdFromUri(options.trackUri)
                || !normalizeArtworkUrl(options.artworkUrl) || !playback(options.trackUri).matches) return;
            const token = ++paletteGeneration, uri = options.trackUri, artwork = options.artworkUrl;
            palettePending = token;
            paletteAttempted = true;
            paletteAbort = Controller ? new Controller() : null;
            const signal = paletteAbort?.signal;
            Promise.resolve().then(() => {
                if (destroyed || token !== paletteGeneration) return null;
                return paletteLoader(artwork, signal);
            }).catch(() => null).then(colors => {
                if (destroyed || token !== paletteGeneration) return;
                palettePending = null;
                paletteAbort = null;
                if (!options.enabled || options.trackUri !== uri || options.artworkUrl !== artwork
                    || settings.colorMode !== "album" || !settings.albumGradient) return;
                if (!playback(uri).matches) { paletteAttempted = false; return; }
                palette = colors;
                // Image reads, pixel blending and pattern allocation all happen
                // here (or on resize/update), never in an animation callback.
                preparePalette();
                synchronize();
            });
        }

        function stop() {
            if (frame !== null) cancelFrame(frame);
            frame = null;
        }

        function visible() { return document?.hidden !== true; }

        function canAnimate(state) {
            return !destroyed && context && options.enabled && options.playing && !options.reducedMotion
                && analysis && visible() && metrics.width > 0 && metrics.height > 0
                && state.matches && state.position !== null && state.playing;
        }

        function paint(timestamp = now(), reset = false) {
            if (destroyed || !context || !visible()) return false;
            if (!options.enabled) {
                context.setTransform(metrics.scaleX, 0, 0, metrics.scaleY, 0, 0);
                context.clearRect(0, 0, metrics.width, metrics.height);
                lastPosition = null;
                lastFrameAt = timestamp;
                return false;
            }
            const state = playback(options.trackUri);
            const active = canAnimate(state);
            if (active) {
                sampleSpectrum(analysis, state.position, settings.density, settings.sensitivity, targets, settings.mirror);
                const delta = clamp(timestamp - lastFrameAt, 0, 200);
                const jumped = lastPosition !== null && Math.abs(state.position - lastPosition) > 0.35;
                const snap = reset || jumped || lastPosition === null;
                for (let index = 0; index < values.length; index++) {
                    const tau = targets[index] > values[index] ? 45 : 140;
                    values[index] = snap ? targets[index] : lerp(values[index], targets[index], 1 - Math.exp(-delta / tau));
                    // Peak caps follow the drawn level, hold briefly, then fall.
                    if (snap || values[index] >= peaks[index]) {
                        peaks[index] = values[index];
                        peakTimes[index] = timestamp;
                    } else if (timestamp - peakTimes[index] > PEAK_HOLD_MS) {
                        peaks[index] = Math.max(values[index], peaks[index] - PEAK_FALL_PER_SECOND * delta / 1000);
                    }
                }
                lastPosition = state.position;
            } else {
                values.fill(0);
                peaks.fill(0);
                lastPosition = null;
            }
            frameExtras.analysis = active ? analysis : null;
            frameExtras.position = active ? state.position : null;
            frameExtras.peaks = active ? peaks : null;
            frameExtras.palette = state.matches ? palette : null;
            drawSpectrum(context, metrics, active ? values : null, settings, color, geometry, frameExtras);
            lastFrameAt = timestamp;
            return !!active;
        }

        function synchronize(reset = false) {
            stop();
            if (destroyed) return;
            const active = paint(now(), reset);
            if (active) frame = requestFrame(tick);
        }

        function tick(timestamp) {
            frame = null;
            if (destroyed) return;
            if (!canAnimate(playback(options.trackUri))) {
                // A player-state change can precede both its event and React
                // props. Do not freeze the outgoing song's last animated frame.
                paint(timestamp, true);
                return;
            }
            if (timestamp - lastFrameAt + 0.01 >= FRAME_INTERVAL_MS) {
                if (!paint(timestamp)) return;
            }
            frame = requestFrame(tick);
        }

        function requestAnalysis(retry = false) {
            if (destroyed || pending || analysis || !context || !options.enabled || !trackIdFromUri(options.trackUri)
                || (attempted && !retry) || !playback(options.trackUri).matches) return;
            const token = ++generation;
            const uri = options.trackUri;
            pending = token;
            attempted = true;
            report("loading");
            Promise.resolve().then(() => loader(uri)).catch(() => null).then(data => {
                if (destroyed || token !== generation) return;
                pending = null;
                if (!options.enabled || options.trackUri !== uri) return;
                if (!playback(uri).matches) {
                    attempted = false;
                    report("unavailable");
                    synchronize(true);
                    return;
                }
                analysis = data;
                report(data ? "ready" : "unavailable");
                synchronize(true);
            });
        }

        function update(nextOptions = {}) {
            if (destroyed) return;
            const previous = options;
            const previousSettings = settings;
            options = {
                trackUri: typeof nextOptions.trackUri === "string" ? nextOptions.trackUri : "",
                artworkUrl: typeof nextOptions.artworkUrl === "string" ? nextOptions.artworkUrl : "",
                accent: nextOptions.accent, enabled: nextOptions.enabled !== false,
                playing: nextOptions.playing === true, reducedMotion: nextOptions.reducedMotion === true,
                onStatusChange: nextOptions.onStatusChange
            };
            settings = normalizeSettings(nextOptions.settings);
            color = resolveColor(settings, options.accent);
            if (previous.trackUri !== options.trackUri || previous.artworkUrl !== options.artworkUrl
                || previous.enabled !== options.enabled || previousSettings.colorMode !== settings.colorMode
                || previousSettings.albumGradient !== settings.albumGradient) clearPalette();
            if (values.length !== settings.density) {
                values = new Float32Array(settings.density);
                targets = new Float32Array(settings.density);
                peaks = new Float32Array(settings.density);
                peakTimes = new Float64Array(settings.density);
                geometry = createRadialGeometry(settings.density);
            }
            if (previous.trackUri !== options.trackUri || previous.enabled !== options.enabled) {
                generation++;
                pending = null;
                analysis = null;
                attempted = false;
                values.fill(0);
                targets.fill(0);
                peaks.fill(0);
                lastPosition = null;
            }
            const validTrack = trackIdFromUri(options.trackUri);
            if (!options.enabled) report("disabled");
            else if (!context || !validTrack || !playback(options.trackUri).matches) report("unavailable");
            else if (analysis) report("ready");
            else if (!pending) requestAnalysis();
            requestPalette();
            preparePalette();
            synchronize(previous.trackUri !== options.trackUri);
        }

        function wake() {
            if (destroyed) return;
            if (!visible()) { stop(); lastPosition = null; return; }
            measure();
            if (options.enabled && !playback(options.trackUri).matches) {
                generation++;
                pending = null;
                analysis = null;
                attempted = false;
                clearPalette();
                report("unavailable");
            } else if (analysis) report("ready");
            else requestAnalysis(true);
            requestPalette();
            synchronize(true);
        }

        function listen(target, event, callback) {
            if (typeof target?.addEventListener !== "function") return;
            target.addEventListener(event, callback);
            removers.push(() => target.removeEventListener?.(event, callback));
        }

        listen(document, "visibilitychange", wake);
        listen(host, "pageshow", wake);
        listen(host, "focus", wake);
        listen(player, "songchange", wake);
        listen(player, "onplaypause", wake);
        listen(player, "onseek", () => synchronize(true));
        const Resize = environment.ResizeObserver || host?.ResizeObserver;
        let observer;
        if (Resize && canvas) {
            observer = new Resize(() => {
                if (destroyed) return;
                measure();
                synchronize();
            });
            observer.observe(canvas);
        } else listen(host, "resize", () => { measure(); synchronize(); });
        measure();
        update(initialOptions);

        return {
            update, redraw: wake,
            getStatus: () => status,
            getState: () => ({ status, trackUri: options.trackUri, hasAnalysis: !!analysis, framePending: frame !== null }),
            destroy() {
                if (destroyed) return;
                destroyed = true;
                generation++;
                clearPalette();
                pending = null;
                stop();
                observer?.disconnect?.();
                removers.forEach(remove => remove());
                analysis = null;
                frameExtras.analysis = null;
                if (context) albumPaintCache.delete(context);
                values.fill(0);
                targets.fill(0);
                peaks.fill(0);
            }
        };
    }

    function Visualizer(props = {}) {
        const react = root?.Spicetify?.React;
        if (!react) return null;
        const { useRef, useState, useEffect } = react;
        const canvasRef = useRef(null), rendererRef = useRef(null), latest = useRef(props);
        latest.current = props;
        const [status, setStatus] = useState(props.enabled === false ? "disabled" : "loading");
        const reportRef = useRef(null);
        if (!reportRef.current) reportRef.current = next => {
            setStatus(current => current === next ? current : next);
            latest.current.onStatusChange?.(next);
        };
        useEffect(() => {
            const renderer = createRenderer(canvasRef.current, { ...latest.current, onStatusChange: reportRef.current });
            rendererRef.current = renderer;
            return () => { rendererRef.current = null; renderer.destroy(); };
        }, []);
        const settings = normalizeSettings(props.settings);
        useEffect(() => {
            rendererRef.current?.update({ ...latest.current, onStatusChange: reportRef.current });
        }, [props.trackUri, props.artworkUrl, props.accent, props.enabled, props.playing, props.reducedMotion,
            settings.style, settings.colorMode, settings.customColor, settings.sensitivity, settings.density, settings.thickness,
            settings.mirror, settings.albumGradient]);
        return react.createElement("canvas", {
            ref: canvasRef,
            className: `ivlyrics-cd-visualizer${props.className ? ` ${props.className}` : ""}`,
            "aria-hidden": true, role: "presentation", "data-state": status,
            style: { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }
        });
    }

    return {
        Visualizer, DEFAULTS, STYLES, COLOR_MODES, PULSE_SECONDS, PARTICLE_SECONDS, BLOCK_LEVELS, RAINBOW_HUES,
        normalizeSettings, normalizeColor, resolveColor, trackIdFromUri, normalizeAnalysis, normalizePulses, firstPulseAfter,
        decibelsToAmplitude, findSegmentIndex, sampleLoudness, sampleSpectrum, createAnalysisLoader, loadAnalysis,
        extractAlbumPalette, normalizeArtworkUrl, createPaletteLoader, loadPalette, blendAlbumTexture, prepareAlbumPaint,
        getCanvasMetrics, createRadialGeometry, drawSpectrum, readPlayback, createRenderer
    };
});
