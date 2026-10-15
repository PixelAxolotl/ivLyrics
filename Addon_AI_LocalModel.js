/**
 * Local AI addon for ivLyrics
 * Runs a dedicated translation model (Tencent Hy-MT2 1.8B GGUF) on this device
 * through wllama (llama.cpp WebAssembly with WebGPU). The model only translates,
 * so this provider never generates pronunciation. The UI shows quality tiers
 * instead of model or file names.
 *
 * @author default
 * @version 1.0.0
 */

(() => {
    'use strict';

    const ADDON_ID = 'local-ai';
    const WLLAMA_VERSION = '3.8.1';
    const WLLAMA_CDN = `https://cdn.jsdelivr.net/npm/@wllama/wllama@${WLLAMA_VERSION}`;
    const MODEL_BASE_URL = 'https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/';
    // Quality tiers, lightest first; each maps to one quantization of the same model.
    const QUALITY_TIERS = Object.freeze([
        Object.freeze({ id: 'light', labelKey: 'tierLight', fallback: 'Local Light', file: 'Hy-MT2-1.8B-Q4_K_M.gguf', size: 1133080448 }),
        Object.freeze({ id: 'medium', labelKey: 'tierMedium', fallback: 'Local Medium', file: 'Hy-MT2-1.8B-Q6_K.gguf', size: 1474785120 }),
        Object.freeze({ id: 'high', labelKey: 'tierHigh', fallback: 'Local High', file: 'Hy-MT2-1.8B-Q8_0.gguf', size: 1908528192 }),
    ]);
    const DEFAULT_QUALITY = 'high';
    const IDLE_UNLOAD_OPTIONS = Object.freeze([10, 30, 60, 0]);
    const DEFAULT_IDLE_UNLOAD_MINUTES = 10;
    // Lines translated together keep their lyric context; small blocks keep the
    // first result quick and stay far below the 4096-token context.
    const BLOCK_MAX_LINES = 8;
    const BLOCK_MAX_CHARACTERS = 480;
    // The manager abandons a provider call after 95 s; stop starting new work
    // before that so an abandoned request never keeps the engine busy.
    const JOB_BUDGET_MS = 90_000;
    const LOAD_PARAMS = Object.freeze({ n_ctx: 4096, n_batch: 512, n_ubatch: 512, n_parallel: 1, jinja: true, ctx_shift: false });
    // Sampling recommended for Hy-MT2 1.8B by the model card.
    const SAMPLING = Object.freeze({ temperature: 0.7, top_p: 0.6, top_k: 20, penalty_repeat: 1.05 });
    const PROTECTED_PART_PATTERN = /^\s*\[.*\]\s*$/;
    // Hy-MT2 prompts use full English language names.
    const TARGET_LANGUAGE_NAMES = Object.freeze({
        ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese', 'zh-cn': 'Chinese', 'zh-hans': 'Chinese', 'zh-sg': 'Chinese',
        'zh-tw': 'Traditional Chinese', 'zh-hk': 'Traditional Chinese', 'zh-hant': 'Traditional Chinese',
        es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', ru: 'Russian', pt: 'Portuguese',
        hi: 'Hindi', ar: 'Arabic', fa: 'Persian', bn: 'Bengali', cs: 'Czech', th: 'Thai', tr: 'Turkish',
        vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', pl: 'Polish', nl: 'Dutch', uk: 'Ukrainian',
        he: 'Hebrew', tl: 'Filipino', fil: 'Filipino', km: 'Khmer', my: 'Burmese', gu: 'Gujarati',
        ur: 'Urdu', te: 'Telugu', mr: 'Marathi', ta: 'Tamil', bo: 'Tibetan', kk: 'Kazakh',
        mn: 'Mongolian', ug: 'Uyghur', yue: 'Cantonese',
    });

    const ADDON_INFO = {
        id: ADDON_ID,
        name: 'Local AI',
        author: 'default',
        description: {
            ko: '이 기기에서 직접 실행되는 번역 전용 로컬 AI입니다. API 키가 필요 없고 가사가 외부로 전송되지 않습니다.',
            en: 'Translation-only AI that runs locally on this device. No API key needed, and lyrics never leave your device.',
            ja: 'このデバイス上で動作する翻訳専用のローカルAIです。APIキーは不要で、歌詞がお使いのデバイスの外に送信されることはありません。',
            'zh-CN': '在此设备上运行的翻译专用本地 AI。无需 API 密钥，歌词绝不会离开您的设备。',
            'zh-TW': '在此裝置上執行的翻譯專用本機 AI。不需要 API 金鑰，歌詞絕不會離開您的裝置。',
            es: 'IA local solo para traducción que se ejecuta en este dispositivo. No necesita clave de API y las letras nunca salen de tu dispositivo.',
            fr: 'IA locale dédiée à la traduction, exécutée sur cet appareil. Aucune clé API requise, et les paroles ne quittent jamais votre appareil.',
            de: 'Lokale KI nur für Übersetzungen, die direkt auf diesem Gerät läuft. Kein API-Schlüssel nötig, und Songtexte verlassen nie Ihr Gerät.',
            it: 'AI locale solo per la traduzione, eseguita su questo dispositivo. Non serve alcuna chiave API e i testi non lasciano mai il tuo dispositivo.',
            ru: 'Локальный ИИ только для перевода, работающий прямо на этом устройстве. Ключ API не нужен, а тексты песен никогда не покидают ваше устройство.',
            sv: 'Lokal AI enbart för översättning som körs på den här enheten. Ingen API-nyckel behövs, och låttexterna lämnar aldrig din enhet.',
            pt: 'IA local só para tradução, executada neste dispositivo. Não precisa de chave de API, e as letras nunca saem do seu dispositivo.',
            hi: 'केवल अनुवाद के लिए बना स्थानीय AI, जो इसी डिवाइस पर चलता है। किसी API कुंजी की ज़रूरत नहीं, और लिरिक्स कभी आपके डिवाइस से बाहर नहीं जाते।',
            ar: 'ذكاء اصطناعي محلي للترجمة فقط يعمل على هذا الجهاز. لا يحتاج إلى مفتاح API، ولا تغادر كلمات الأغاني جهازك أبدًا.',
            fa: 'هوش مصنوعی محلی ویژهٔ ترجمه که روی همین دستگاه اجرا می‌شود. به کلید API نیازی نیست و متن ترانه‌ها هرگز از دستگاه شما خارج نمی‌شود.',
            bn: 'এই ডিভাইসে চলা, শুধু অনুবাদের জন্য তৈরি স্থানীয় এআই। কোনো API কী লাগে না, এবং লিরিক্স কখনও আপনার ডিভাইসের বাইরে যায় না।',
            cs: 'Místní AI pouze pro překlad, která běží přímo v tomto zařízení. Nepotřebuje klíč API a texty písní nikdy neopustí vaše zařízení.',
            th: 'AI ในเครื่องสำหรับการแปลโดยเฉพาะ ซึ่งทำงานบนอุปกรณ์นี้ ไม่ต้องใช้คีย์ API และเนื้อเพลงจะไม่ถูกส่งออกไปนอกอุปกรณ์ของคุณ',
            tr: 'Bu cihazda çalışan, yalnızca çeviri için yerel yapay zeka. API anahtarı gerekmez ve şarkı sözleri cihazınızdan asla çıkmaz.',
            vi: 'AI cục bộ chỉ dùng để dịch, chạy ngay trên thiết bị này. Không cần khóa API và lời bài hát không bao giờ rời khỏi thiết bị của bạn.',
            id: 'AI lokal khusus terjemahan yang berjalan di perangkat ini. Tanpa kunci API, dan lirik tidak pernah keluar dari perangkat Anda.',
            ms: 'AI setempat khusus untuk terjemahan yang berjalan pada peranti ini. Tiada kunci API diperlukan, dan lirik tidak pernah keluar dari peranti anda.'
        },
        version: '1.0.0',
        supports: {
            translate: true,
            pronunciation: false,
            metadata: false,
            tmi: false,
            lyricsStudy: false,
            characterPronunciation: false,
            culturalAnnotations: false,
            wordSupplements: false
        }
    };

    // ============================================
    // Helpers
    // ============================================

    const formatText = (value, params) => (params
        ? String(value).replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? String(params[name]) : match))
        : String(value));

    function t(key, fallback, params) {
        let value = '';
        try {
            value = window.I18n?.t?.(`settings.aiProviders.localModel.${key}`, params) || '';
        } catch {
            value = '';
        }
        return formatText(value || fallback, params);
    }

    const getSetting = (key, fallback) => {
        try {
            const value = window.AIAddonManager?.getAddonSetting?.(ADDON_ID, key, fallback);
            return value === undefined || value === null ? fallback : value;
        } catch {
            return fallback;
        }
    };
    const setSetting = (key, value) => window.AIAddonManager?.setAddonSetting?.(ADDON_ID, key, value);

    const getQualityTier = () => QUALITY_TIERS.find((tier) => tier.id === getSetting('quality', DEFAULT_QUALITY))
        || QUALITY_TIERS.find((tier) => tier.id === DEFAULT_QUALITY);
    const getModelUrl = (tier = getQualityTier()) => MODEL_BASE_URL + tier.file;
    const tierLabel = (tier) => t(tier.labelKey, tier.fallback);
    const getDevicePreference = () => (getSetting('device', 'auto') === 'cpu' ? 'cpu' : 'auto');
    const getIdleUnloadMinutes = () => {
        const minutes = Number(getSetting('idle-unload-minutes', DEFAULT_IDLE_UNLOAD_MINUTES));
        return IDLE_UNLOAD_OPTIONS.includes(minutes) ? minutes : DEFAULT_IDLE_UNLOAD_MINUTES;
    };
    const formatGigabytes = (bytes) => `${(bytes / 1e9).toFixed(2)}GB`;
    const errorMessage = (error) => String(error?.message || error || 'Unknown error');

    function resolveTargetLanguage(lang) {
        const code = String(lang || 'en').trim().replace(/_/g, '-').toLowerCase();
        const name = TARGET_LANGUAGE_NAMES[code] || TARGET_LANGUAGE_NAMES[code.split('-')[0]];
        if (!name) {
            let label = lang;
            try {
                label = new Intl.DisplayNames([window.I18n?.getCurrentLanguage?.() || 'en'], { type: 'language' }).of(lang) || lang;
            } catch {
                label = lang;
            }
            throw new Error(t('unsupportedLanguage', 'The local model cannot translate into {language}.', { language: label }));
        }
        return name;
    }

    // ============================================
    // Status shared by the settings card and the engine
    // ============================================

    const state = { phase: 'unknown', loadedBytes: 0, totalBytes: 0, device: null, error: null, downloadedTiers: [] };
    const listeners = new Set();
    function setState(patch) {
        Object.assign(state, patch);
        const snapshot = { ...state };
        for (const listener of listeners) {
            try { listener(snapshot); } catch { /* A closed settings card must not break the engine. */ }
        }
    }
    const subscribe = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };

    // ============================================
    // Engine
    // ============================================

    let wllamaModulePromise = null;
    let engine = null;
    let loadedModelUrl = null;
    let loadPromise = null;
    let downloadController = null;
    let webGpuAvailable = null;
    let idleTimer = null;

    const importModule = (url) => (typeof window.__ivLyricsLocalModelImport === 'function'
        ? window.__ivLyricsLocalModelImport(url)
        : import(url));

    function loadWllamaModule() {
        if (!wllamaModulePromise) {
            wllamaModulePromise = Promise.resolve()
                .then(() => importModule(`${WLLAMA_CDN}/esm/index.js`))
                .catch((error) => {
                    wllamaModulePromise = null;
                    throw error;
                });
        }
        return wllamaModulePromise;
    }

    // One Wllama instance manages the model cache (OPFS) and, once loaded, runs inference.
    async function getEngine() {
        if (engine) return engine;
        const { Wllama } = await loadWllamaModule();
        if (!engine) {
            engine = new Wllama({ default: `${WLLAMA_CDN}/src/wasm/wllama.wasm` }, {
                suppressNativeLog: true,
                logger: {
                    debug() {},
                    log() {},
                    warn: (...args) => console.warn('[Local AI]', ...args),
                    error: (...args) => console.error('[Local AI]', ...args)
                }
            });
        }
        return engine;
    }

    async function listCachedModels() {
        const instance = await getEngine();
        return instance.modelManager.getModels({ includeInvalid: true });
    }

    async function findCachedModel(url = getModelUrl()) {
        const models = await listCachedModels();
        return models.find((model) => model.url === url) || null;
    }

    const isValidModel = (model) => !!model && model.validate() === 'valid';

    async function refreshStatus() {
        if (state.phase === 'downloading' || state.phase === 'loading') return { ...state };
        const tier = getQualityTier();
        try {
            const models = await listCachedModels();
            const downloadedTiers = QUALITY_TIERS
                .filter((candidate) => isValidModel(models.find((model) => model.url === getModelUrl(candidate))))
                .map((candidate) => candidate.id);
            const loaded = engine?.isModelLoaded?.() && loadedModelUrl === getModelUrl(tier);
            setState({
                phase: loaded ? 'ready' : (downloadedTiers.includes(tier.id) ? 'downloaded' : 'missing'),
                totalBytes: tier.size,
                downloadedTiers,
                error: null,
                ...(loaded ? {} : { device: null })
            });
        } catch (error) {
            setState({ phase: 'error', error: errorMessage(error) });
        }
        return { ...state };
    }

    async function hasWebGpu() {
        if (webGpuAvailable !== null) return webGpuAvailable;
        try {
            webGpuAvailable = Boolean(await navigator.gpu?.requestAdapter?.({ powerPreference: 'high-performance' }));
        } catch {
            webGpuAvailable = false;
        }
        return webGpuAvailable;
    }

    async function exitEngine(instance) {
        if (!instance) return;
        let timer = null;
        try {
            await Promise.race([
                instance.exit(),
                new Promise((resolve) => { timer = setTimeout(resolve, 5000); })
            ]);
        } catch (error) {
            console.warn('[Local AI] Failed to release the engine:', errorMessage(error));
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
    }

    async function unloadModel() {
        clearIdleTimer();
        const instance = engine;
        engine = null;
        loadedModelUrl = null;
        await exitEngine(instance);
        if (state.phase === 'ready' || state.phase === 'loading') {
            setState({ phase: 'downloaded', device: null });
        }
    }

    function ensureLoaded() {
        const url = getModelUrl();
        if (engine?.isModelLoaded?.() && loadedModelUrl === url) return Promise.resolve(engine);
        if (state.phase === 'downloading') {
            // The download shares the engine instance; leave it and its status untouched.
            return Promise.reject(new Error(t('downloadBusy', 'Wait for the model download to finish, then try again.')));
        }
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            if (engine?.isModelLoaded?.()) await unloadModel();
            const model = await findCachedModel(url);
            if (!isValidModel(model)) {
                setState({ phase: 'missing', device: null });
                throw new Error(t('notReady', 'The local model is not ready yet. Download it first in Settings > AI Providers > Local AI.'));
            }
            setState({ phase: 'loading', error: null });
            const useGpu = getDevicePreference() === 'auto' && await hasWebGpu();
            let usedGpu = useGpu;
            try {
                await (await getEngine()).loadModel(model, { ...LOAD_PARAMS, n_gpu_layers: useGpu ? 99999 : 0 });
            } catch (error) {
                if (!useGpu) throw error;
                // A WebGPU failure on this adapter still leaves the slower CPU path.
                console.warn('[Local AI] WebGPU load failed; retrying on the CPU:', errorMessage(error));
                const failed = engine;
                engine = null;
                await exitEngine(failed);
                await (await getEngine()).loadModel(model, { ...LOAD_PARAMS, n_gpu_layers: 0 });
                usedGpu = false;
            }
            if (!engine.getChatTemplate?.()) {
                throw new Error('[Local AI] The model has no chat template.');
            }
            loadedModelUrl = url;
            setState({ phase: 'ready', device: usedGpu ? 'WebGPU' : 'CPU', error: null });
            return engine;
        })().catch(async (error) => {
            const keepPhase = state.phase === 'missing';
            const failed = engine;
            engine = null;
            loadedModelUrl = null;
            await exitEngine(failed);
            if (!keepPhase) setState({ phase: 'error', device: null, error: errorMessage(error) });
            throw error;
        }).finally(() => {
            loadPromise = null;
        });
        return loadPromise;
    }

    async function downloadModel() {
        if (state.phase === 'downloading') return;
        const tier = getQualityTier();
        const url = getModelUrl(tier);
        const controller = new AbortController();
        downloadController = controller;
        let lastUpdate = 0;
        setState({ phase: 'downloading', loadedBytes: 0, totalBytes: tier.size, error: null });
        try {
            const instance = await getEngine();
            const cached = await findCachedModel(url);
            if (!isValidModel(cached)) {
                await instance.modelManager.downloadModel({ url }, {
                    signal: controller.signal,
                    progressCallback: ({ loaded, total }) => {
                        const now = Date.now();
                        if (now - lastUpdate < 250 && loaded < total) return;
                        lastUpdate = now;
                        setState({ loadedBytes: loaded, totalBytes: total > 0 ? total : tier.size });
                    }
                });
            }
            setState({
                phase: 'downloaded', loadedBytes: tier.size, totalBytes: tier.size,
                downloadedTiers: QUALITY_TIERS.map((candidate) => candidate.id)
                    .filter((id) => id === tier.id || state.downloadedTiers.includes(id))
            });
        } catch (error) {
            if (controller.signal.aborted || error?.name === 'AbortError') {
                setState({ phase: 'missing', loadedBytes: 0 });
                return;
            }
            setState({ phase: 'error', error: errorMessage(error) });
            throw error;
        } finally {
            if (downloadController === controller) downloadController = null;
        }
    }

    const cancelDownload = () => downloadController?.abort();

    async function removeModel() {
        await unloadModel();
        const tier = getQualityTier();
        const model = await findCachedModel(getModelUrl(tier));
        if (model) await model.remove();
        setState({
            phase: 'missing', loadedBytes: 0, device: null, error: null,
            downloadedTiers: state.downloadedTiers.filter((id) => id !== tier.id)
        });
    }

    // ============================================
    // Scheduler: one model, so requests share it. Lyrics on screen (with a line
    // callback) run before prefetching for upcoming songs, one block at a time.
    // ============================================

    const queues = { interactive: [], background: [] };
    let pumping = false;

    function clearIdleTimer() {
        if (idleTimer !== null) clearTimeout(idleTimer);
        idleTimer = null;
    }

    function scheduleIdleUnload() {
        clearIdleTimer();
        const minutes = getIdleUnloadMinutes();
        if (!minutes || !engine?.isModelLoaded?.()) return;
        idleTimer = setTimeout(() => {
            idleTimer = null;
            if (!pumping && !queues.interactive.length && !queues.background.length) void unloadModel();
        }, minutes * 60_000);
    }

    function runTask(priority, task) {
        return new Promise((resolve, reject) => {
            queues[priority === 'interactive' ? 'interactive' : 'background'].push({ task, resolve, reject });
            void pump();
        });
    }

    async function pump() {
        if (pumping) return;
        pumping = true;
        clearIdleTimer();
        try {
            for (;;) {
                const next = queues.interactive.shift() || queues.background.shift();
                if (!next) break;
                try {
                    next.resolve(await next.task());
                } catch (error) {
                    next.reject(error);
                }
            }
        } finally {
            pumping = false;
            scheduleIdleUnload();
        }
    }

    // ============================================
    // Translation
    // ============================================

    const buildLinePrompt = (text, language) => `Translate the following text into ${language}. Note that you should only output the translated result without any additional explanation:\n\n${text}`;
    const buildBlockPrompt = (lines, language) => `Please accurately translate the following text into ${language}.\nYou must retain the exact same number of delimiters in the translation. Strictly do not omit, escape, or translate these symbols, and pay close attention to their placement.\n\n${lines.join('\n')}`;
    const outputBudget = (text) => Math.min(1536, 48 + Math.ceil(String(text).length * 3));

    async function complete(instance, prompt, maxTokens) {
        let text = '';
        let finishReason = null;
        await instance.createChatCompletion({
            messages: [{ role: 'user', content: prompt }],
            max_tokens: maxTokens,
            ...SAMPLING,
            stream: true,
            onData(chunk) {
                const choice = chunk?.choices?.[0];
                if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
                if (choice?.finish_reason) finishReason = choice.finish_reason;
            }
        });
        return { text, finishReason };
    }

    async function translateBlock(instance, parts, language) {
        if (parts.length > 1) {
            const { text, finishReason } = await complete(instance, buildBlockPrompt(parts, language), outputBudget(parts.join('\n')));
            const lines = text.replace(/\r\n?/g, '\n').trim().split('\n').map((line) => line.trim());
            if (finishReason !== 'length' && lines.length === parts.length && lines.every(Boolean)) return lines;
        }
        // The block lost or merged a line: translate each line on its own instead.
        const translated = [];
        for (const part of parts) {
            const { text } = await complete(instance, buildLinePrompt(part, language), outputBudget(part));
            const line = text.replace(/\s*\n+\s*/g, ' ').trim();
            if (!line) throw new Error('[Local AI] The model returned an empty line.');
            translated.push(line);
        }
        return translated;
    }

    function buildBlocks(parts) {
        const blocks = [];
        let block = [];
        let characters = 0;
        for (const part of parts) {
            if (block.length && (block.length >= BLOCK_MAX_LINES || characters + part.length > BLOCK_MAX_CHARACTERS)) {
                blocks.push(block);
                block = [];
                characters = 0;
            }
            block.push(part);
            characters += part.length + 1;
        }
        if (block.length) blocks.push(block);
        return blocks;
    }

    const isTranslatablePart = (part) => !!part.trim() && !PROTECTED_PART_PATTERN.test(part);

    async function translateLyricsLines(text, lang, onLine, priority) {
        const language = resolveTargetLanguage(lang);
        const deadline = Date.now() + JOB_BUDGET_MS;
        const sourceLines = String(text).replace(/\r\n?/g, '\n').split('\n');
        // Simultaneous vocal parts share a line as "a / b" and are translated separately.
        const rows = sourceLines.map((line) => line.split(' / '));
        const translations = new Map();
        const pending = [];
        for (const parts of rows) {
            for (const part of parts) {
                const key = part.trim();
                if (!isTranslatablePart(part) || translations.has(key)) continue;
                translations.set(key, null);
                pending.push(key);
            }
        }

        const rowText = (row) => rows[row].map((part) => {
            if (!part.trim()) return '';
            return isTranslatablePart(part) ? translations.get(part.trim()) : part;
        }).join(' / ');
        const emitted = new Array(rows.length).fill(false);
        const emitReadyRows = () => {
            if (typeof onLine !== 'function') return;
            rows.forEach((parts, row) => {
                if (emitted[row] || parts.some((part) => isTranslatablePart(part) && !translations.get(part.trim()))) return;
                emitted[row] = true;
                try {
                    onLine(row, rowText(row), { provider: ADDON_ID, final: true });
                } catch (error) {
                    console.warn('[Local AI] Line callback failed:', errorMessage(error));
                }
            });
        };

        emitReadyRows();
        for (const block of buildBlocks(pending)) {
            const translated = await runTask(priority, async () => {
                if (Date.now() > deadline) {
                    const error = new Error('[Local AI] Translation took too long and was stopped.');
                    error.name = 'TimeoutError';
                    throw error;
                }
                const instance = await ensureLoaded();
                try {
                    return await translateBlock(instance, block, language);
                } catch (error) {
                    // A crashed WASM runtime or lost GPU device needs a fresh engine next time.
                    if (error?.name === 'WllamaRuntimeError' || /out of memory|memory access|device (was )?lost/i.test(errorMessage(error))) {
                        await unloadModel();
                    }
                    throw error;
                }
            });
            block.forEach((part, index) => translations.set(part, translated[index]));
            emitReadyRows();
        }
        return sourceLines.map((_, row) => rowText(row));
    }

    function getCurrentTargetLanguage() {
        const configured = window.CONFIG?.visual?.['translate:target-language'];
        return configured && configured !== 'auto' ? configured : (window.I18n?.getCurrentLanguage?.() || 'en');
    }

    async function runTestTranslation() {
        const lang = getCurrentTargetLanguage();
        const sample = String(lang).toLowerCase().startsWith('ja') ? 'The night is still young.' : '今夜はまだ始まったばかり';
        const started = Date.now();
        const [line] = await translateLyricsLines(sample, lang, null, 'interactive');
        return { sample, line, seconds: (Date.now() - started) / 1000 };
    }

    // ============================================
    // Settings UI
    // ============================================

    function statusText(snapshot) {
        switch (snapshot.phase) {
            case 'downloading': {
                const total = snapshot.totalBytes || getQualityTier().size;
                return t('statusDownloading', 'Downloading {percent}% · {loaded} / {total} MB', {
                    percent: Math.floor(Math.min(1, snapshot.loadedBytes / total) * 100),
                    loaded: Math.round(snapshot.loadedBytes / 1e6),
                    total: Math.round(total / 1e6)
                });
            }
            case 'downloaded': return t('statusDownloaded', 'Downloaded · Loads into memory when it translates');
            case 'loading': return t('statusLoading', 'Loading into memory…');
            case 'ready': return t('statusReady', 'Ready · {device}', { device: snapshot.device || 'WebGPU' });
            case 'error': return t('statusError', 'Error: {error}', { error: snapshot.error || '' });
            case 'missing': return t('statusNotDownloaded', 'Not downloaded yet. Download the model once to translate on this device.');
            default: return '…';
        }
    }

    const idleLabel = (minutes) => {
        if (!minutes) return t('idleNever', 'Never');
        if (minutes % 60 === 0) return t('idleAfterHours', 'After {hours} hr', { hours: minutes / 60 });
        return t('idleAfter', 'After {minutes} min', { minutes });
    };

    function createSettingsUI() {
        const React = Spicetify.React;
        const { useState, useEffect } = React;
        const h = React.createElement;

        return function LocalModelSettings() {
            const [snapshot, setSnapshot] = useState(() => ({ ...state }));
            const [tierId, setTierId] = useState(() => getQualityTier().id);
            const [device, setDevice] = useState(getDevicePreference);
            const [idleMinutes, setIdleMinutes] = useState(getIdleUnloadMinutes);
            const [confirmRemove, setConfirmRemove] = useState(false);
            const [test, setTest] = useState(null);

            useEffect(() => subscribe(setSnapshot), []);
            useEffect(() => { void refreshStatus(); }, [tierId]);

            const busy = snapshot.phase === 'downloading' || snapshot.phase === 'loading';
            const hasModel = snapshot.phase === 'downloaded' || snapshot.phase === 'ready';
            const tierIndex = Math.max(0, QUALITY_TIERS.findIndex((candidate) => candidate.id === tierId));
            const tier = QUALITY_TIERS[tierIndex];
            const downloadedTiers = Array.isArray(snapshot.downloadedTiers) ? snapshot.downloadedTiers : [];
            const percent = snapshot.phase === 'downloading'
                ? Math.min(100, (snapshot.loadedBytes / (snapshot.totalBytes || tier.size)) * 100)
                : 0;

            const selectTier = (id) => {
                if (busy || id === tierId || !QUALITY_TIERS.some((candidate) => candidate.id === id)) return;
                setSetting('quality', id);
                setTierId(id);
                setConfirmRemove(false);
                setTest(null);
                void runTask('interactive', unloadModel);
            };
            const changeDevice = async (event) => {
                const next = event.target.value === 'cpu' ? 'cpu' : 'auto';
                setSetting('device', next);
                setDevice(next);
                await runTask('interactive', unloadModel);
            };
            const changeIdle = (event) => {
                const next = Number(event.target.value);
                setSetting('idle-unload-minutes', next);
                setIdleMinutes(next);
                if (!pumping) scheduleIdleUnload();
            };
            const startDownload = () => { setTest(null); void downloadModel().catch(() => {}); };
            const freeMemory = () => { void runTask('interactive', unloadModel); };
            const deleteModel = () => {
                if (!confirmRemove) {
                    setConfirmRemove(true);
                    return;
                }
                setConfirmRemove(false);
                setTest(null);
                void runTask('interactive', removeModel).catch((error) => setState({ phase: 'error', error: errorMessage(error) }));
            };
            const testTranslation = async () => {
                setTest({ running: true });
                try {
                    const result = await runTestTranslation();
                    setTest({ ok: true, text: `✓ ${result.sample} → ${result.line} (${result.seconds.toFixed(1)}s)` });
                } catch (error) {
                    setTest({ ok: false, text: `✗ ${errorMessage(error)}` });
                }
            };

            const lastTier = QUALITY_TIERS.length - 1;
            const qualityControl = h('div', { className: 'ai-addon-setting local-model-quality' },
                h('label', null, t('quality', 'Translation quality')),
                h('div', { className: `slider-container${busy ? ' disabled' : ''}`, style: { gridTemplateColumns: '1fr' } },
                    h('input', {
                        type: 'range', min: 0, max: lastTier, step: 1, value: tierIndex, disabled: busy,
                        className: 'config-slider',
                        'aria-label': t('quality', 'Translation quality'),
                        'aria-valuetext': tierLabel(tier),
                        style: { '--progress-percent': `${(tierIndex / lastTier) * 100}%` },
                        onChange: (event) => selectTier(QUALITY_TIERS[Number(event.target.value)]?.id)
                    })
                ),
                h('div', {
                    style: { display: 'grid', gridTemplateColumns: `repeat(${QUALITY_TIERS.length}, minmax(0, 1fr))`, gap: '6px', width: 'min(390px, 100%)', marginTop: '4px' }
                }, QUALITY_TIERS.map((candidate, index) => {
                    const selected = candidate.id === tier.id;
                    return h('div', {
                        key: candidate.id,
                        role: 'button',
                        tabIndex: busy ? -1 : 0,
                        'aria-pressed': selected,
                        'data-tier': candidate.id,
                        onClick: () => selectTier(candidate.id),
                        onKeyDown: (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                selectTier(candidate.id);
                            }
                        },
                        style: {
                            cursor: busy ? 'default' : 'pointer',
                            textAlign: index === 0 ? 'left' : (index === lastTier ? 'right' : 'center'),
                            opacity: busy && !selected ? 0.5 : 1
                        }
                    },
                    h('span', {
                        style: { display: 'block', fontSize: '12px', fontWeight: selected ? 700 : 500, color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }
                    }, tierLabel(candidate)),
                    h('span', { style: { display: 'block', fontSize: '11px', marginTop: '2px', color: 'var(--text-tertiary, var(--text-secondary))' } },
                        formatGigabytes(candidate.size) + (downloadedTiers.includes(candidate.id) ? ` · ${t('tierDownloaded', 'Downloaded')}` : '')));
                })),
                h('small', { style: { display: 'block', marginTop: '6px', opacity: 0.7 } },
                    t('tierHint', 'Higher quality translates more accurately but uses more storage and memory.'))
            );

            return h('div', { className: 'ai-addon-settings local-model-settings' },
                qualityControl,
                h('div', { className: 'ai-addon-setting' },
                    h('span', {
                        className: `ai-addon-test-status ${snapshot.phase === 'error' ? 'error' : snapshot.phase === 'ready' ? 'success' : ''}`,
                        role: 'status'
                    }, statusText(snapshot)),
                    snapshot.phase === 'downloading' && h('div', {
                        role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.floor(percent),
                        style: { height: '6px', marginTop: '8px', borderRadius: '3px', overflow: 'hidden', background: 'rgba(127, 127, 127, 0.25)' }
                    }, h('div', { style: { width: `${percent}%`, height: '100%', background: 'var(--accent-primary, #1db954)', transition: 'width 0.25s ease' } })),
                    h('div', { className: 'ai-addon-input-group', style: { marginTop: '10px', flexWrap: 'wrap' } },
                        snapshot.phase === 'downloading'
                            ? h('button', { type: 'button', className: 'ai-addon-btn ai-addon-btn-secondary', onClick: cancelDownload }, t('cancel', 'Cancel'))
                            : !hasModel && h('button', {
                                type: 'button', className: 'ai-addon-btn ai-addon-btn-primary', onClick: startDownload, disabled: busy
                            }, t('download', 'Download model ({size})', { size: formatGigabytes(tier.size) })),
                        hasModel && h('button', {
                            type: 'button', className: 'ai-addon-btn ai-addon-btn-primary', onClick: testTranslation, disabled: busy || test?.running
                        }, test?.running ? '…' : t('test', 'Test translation')),
                        snapshot.phase === 'ready' && h('button', {
                            type: 'button', className: 'ai-addon-btn ai-addon-btn-secondary', onClick: freeMemory
                        }, t('unload', 'Free memory')),
                        hasModel && h('button', {
                            type: 'button', className: 'ai-addon-btn ai-addon-btn-secondary', onClick: deleteModel, disabled: busy
                        }, confirmRemove ? t('confirmRemove', 'Click again to delete') : t('remove', 'Delete model'))
                    ),
                    test && !test.running && h('small', {
                        className: `ai-addon-test-status ${test.ok ? 'success' : 'error'}`,
                        style: { display: 'block', marginTop: '8px' }
                    }, test.text)
                ),
                h('div', { className: 'ai-addon-setting' },
                    h('label', null, t('device', 'Processor')),
                    h('select', { value: device, onChange: changeDevice, disabled: busy },
                        h('option', { value: 'auto' }, t('deviceAuto', 'Auto (WebGPU first)')),
                        h('option', { value: 'cpu' }, t('deviceCpu', 'CPU only (slower)')))
                ),
                h('div', { className: 'ai-addon-setting' },
                    h('label', null, t('idleUnload', 'Free memory when idle')),
                    h('select', { value: String(idleMinutes), onChange: changeIdle },
                        IDLE_UNLOAD_OPTIONS.map((minutes) => h('option', { key: minutes, value: String(minutes) },
                            idleLabel(minutes))))
                ),
                h('small', { style: { display: 'block', opacity: 0.7, lineHeight: 1.5 } },
                    t('privacy', 'Lyrics are translated on this device and are never sent anywhere. The engine (jsDelivr) and the model (Hugging Face) are downloaded only once.'))
            );
        };
    }

    // ============================================
    // Addon
    // ============================================

    const addon = {
        ...ADDON_INFO,

        async init() {
            window.__ivLyricsDebugLog?.(`[Local AI] Initialized (v${ADDON_INFO.version})`);
        },

        getSettingsUI() {
            return createSettingsUI();
        },

        async testConnection() {
            const result = await runTestTranslation();
            if (!result.line) throw new Error('[Local AI] The test translation was empty.');
            return true;
        },

        async translateLyrics({ text, lang, wantSmartPhonetic, onLine }) {
            if (wantSmartPhonetic) {
                throw new Error('[Local AI] Pronunciation generation is not supported');
            }
            if (!text?.trim()) {
                throw new Error('[Local AI] No text provided');
            }
            const priority = typeof onLine === 'function' ? 'interactive' : 'background';
            const translation = await translateLyricsLines(text, lang, onLine, priority);
            return { translation };
        }
    };

    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(addon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();
})();
