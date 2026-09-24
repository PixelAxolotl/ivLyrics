/**
 * ChatGPT AI Addon for ivLyrics
 * OpenAI ChatGPT를 사용한 번역, 발음, Research 생성
 * 
 * @author default
 * @version 1.0.1
 */

(() => {
    'use strict';

    function createOpenAICompatibleAddon(config = {}) {
    // ============================================
    // Addon Metadata
    // ============================================

    const ADDON_INFO = {
        id: 'chatgpt',
        name: 'OpenAI ChatGPT',
        author: 'default',
        description: {
            ko: 'OpenAI ChatGPT를 사용한 번역, 발음, 음악 리서치 (OpenAI 호환 API 지원)',
            en: 'Translation, pronunciation, and music research using OpenAI ChatGPT (supports OpenAI-compatible APIs)',
            ja: 'OpenAI ChatGPTを使用した翻訳、発音、音楽リサーチ（OpenAI互換API対応）',
            'zh-CN': '使用 OpenAI ChatGPT 进行翻译、发音和音乐深度研究（支持 OpenAI 兼容 API）',
        },
        version: '1.0.1',
        apiKeyUrl: 'https://platform.openai.com/api-keys',
        // 지원 기능
        supports: {
            translate: true,    // 가사 번역/발음
            metadata: true,     // 메타데이터 번역
            tmi: true,          // TMI 생성
            researchWebSearch: true,
            lyricsStudy: true,  // 학습 모드 생성
            characterPronunciation: true,
            culturalAnnotations: true
        },
        // 하드코딩된 모델 목록 (fallback용)
        // models: [
        //     { id: 'gpt-5.2-2025-12-11', name: 'GPT-5.2', default: true },
        //     { id: 'gpt-5-mini-2025-08-07', name: 'GPT-5 Mini' },
        //     { id: 'gpt-5-nano-2025-08-07', name: 'GPT-5 Nano' }
        // ]
        models: [] // API에서 동적으로 로드
    };

    Object.assign(ADDON_INFO, config.info || {});
    const DEFAULT_OPENAI_BASE_URL = config.baseUrl || 'https://api.openai.com/v1';

    /**
     * OpenAI API에서 사용 가능한 모델 목록을 가져옴 (채팅/텍스트 생성용 모델만)
     */
    async function fetchAvailableModels(apiKey, baseUrl) {
        if (!apiKey) return [];

        const normalizedBaseUrl = (baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, '');
        const isOpenAIBaseUrl = normalizedBaseUrl === 'https://api.openai.com/v1';

        // 제외할 모델 패턴 (이미지 생성, 음성, 임베딩 등)
        const excludePatterns = [
            'dall-e',        // 이미지 생성
            'whisper',       // 음성 인식
            'tts',           // 텍스트 음성 변환
            'embedding',     // 임베딩
            'text-embedding',// 임베딩
            'davinci',       // 레거시 completion 모델
            'curie',         // 레거시
            'babbage',       // 레거시
            'ada',           // 레거시 (ada만, 단독으로)
            'audio',         // 오디오 관련
            'moderation',    // 콘텐츠 모더레이션
            'search',        // 검색
            'similarity',    // 유사도
            'code-',         // 레거시 코드 모델
            'text-davinci',  // 레거시
            'gpt-3.5-turbo-instruct', // instruct 모델
            'image',         // 이미지 관련
        ];

        try {
            const endpoint = `${normalizedBaseUrl}/models`;
            const response = await window.ivLyricsFetch(endpoint, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (!response.ok) {
                window.__ivLyricsDebugLog?.('[ChatGPT Addon] Failed to fetch models:', response.status);
                return [];
            }

            const data = await response.json();
            let models = (data.data || [])
                .filter(m => m.id)
                .map(m => ({
                    id: m.id,
                    name: m.id,
                    owned_by: m.owned_by || ''
                }));

            // OpenAI 기본 API에서는 기존처럼 채팅용 모델만 추려서 노출한다.
            // 사용자가 Base URL을 바꾼 OpenAI 호환 서버는 임의 모델명을 쓸 수 있으므로 이름 검사를 건너뛴다.
            if (isOpenAIBaseUrl) {
                models = models
                    .filter(m => {
                        const id = m.id.toLowerCase();
                        // GPT 또는 chat 모델만 포함
                        if (!id.startsWith('gpt') && !id.includes('chat') && !id.includes('o1') && !id.includes('o3')) return false;
                        // 제외 패턴 체크
                        for (const pattern of excludePatterns) {
                            if (id.includes(pattern.toLowerCase())) return false;
                        }
                        // realtime 모델 제외
                        if (id.includes('realtime')) return false;
                        return true;
                    })
                    // 정렬: gpt-5 > gpt-4 > o3 > o1 순서
                    .sort((a, b) => {
                        // GPT 모델과 o-시리즈 구분
                        const aIsGpt = a.id.startsWith('gpt-');
                        const bIsGpt = b.id.startsWith('gpt-');
                        const aIsO = a.id.match(/^o(\d)/);
                        const bIsO = b.id.match(/^o(\d)/);

                        // GPT 모델이 o-시리즈보다 먼저
                        if (aIsGpt && !bIsGpt) return -1;
                        if (!aIsGpt && bIsGpt) return 1;

                        // 둘 다 GPT 모델인 경우: gpt-5 > gpt-4 > gpt-3.5
                        if (aIsGpt && bIsGpt) {
                            const aMatch = a.id.match(/gpt-(\d+(?:\.\d+)?)/);
                            const bMatch = b.id.match(/gpt-(\d+(?:\.\d+)?)/);
                            const aNum = aMatch ? parseFloat(aMatch[1]) : 0;
                            const bNum = bMatch ? parseFloat(bMatch[1]) : 0;
                            if (bNum !== aNum) return bNum - aNum;

                            // 같은 버전이면 turbo, mini 순서
                            if (a.id.includes('turbo') && !b.id.includes('turbo')) return -1;
                            if (!a.id.includes('turbo') && b.id.includes('turbo')) return 1;
                        }

                        // 둘 다 o-시리즈인 경우: o3 > o1
                        if (aIsO && bIsO) {
                            return parseInt(bIsO[1]) - parseInt(aIsO[1]);
                        }

                        return a.id.localeCompare(b.id);
                    });
            } else {
                models.sort((a, b) => a.id.localeCompare(b.id));
            }

            // 첫 번째 모델을 기본값으로 설정
            if (models.length > 0) {
                models[0].default = true;
            }

            return models;
        } catch (e) {
            window.__ivLyricsDebugLog?.('[ChatGPT Addon] Error fetching models:', e.message);
            return [];
        }
    }

    /**
     * 모델 목록 가져오기 (매번 API에서 로드)
     */
    async function getModels() {
        const apiKeys = getApiKeys();
        const baseUrl = getSetting('base-url', DEFAULT_OPENAI_BASE_URL);
        if (apiKeys.length === 0) return [];
        return await fetchAvailableModels(apiKeys[0], baseUrl);
    }

    // ============================================
    // Helper Functions
    // ============================================

    function getLocalizedText(textObj, lang) {
        if (typeof textObj === 'string') return textObj;
        return textObj[lang] || textObj['en'] || Object.values(textObj)[0] || '';
    }

    function getSetting(key, defaultValue = null) {
        return window.AIAddonManager?.getAddonSetting(ADDON_INFO.id, key, defaultValue) ?? defaultValue;
    }

    function setSetting(key, value) {
        window.AIAddonManager?.setAddonSetting(ADDON_INFO.id, key, value);
    }

    function t(key, fallback) {
        const value = window.I18n?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    const aiText = (key, fallback) => t(`settings.aiProviders.${key}`, fallback);

    function getApiKeys(connection = null) {
        if (connection) return parseConnectionKeys(connection.apiKeys);
        return parseConnectionKeys(getSetting('api-keys', '') || getSetting('api-key', ''));
    }

    function normalizeBaseUrl(value) {
        return String(value || '').trim().replace(/\/+$/, '');
    }

    function getBaseUrl(connection = null) {
        if (connection) return normalizeBaseUrl(connection.baseUrl) || DEFAULT_OPENAI_BASE_URL;
        return getSetting('base-url', DEFAULT_OPENAI_BASE_URL) || DEFAULT_OPENAI_BASE_URL;
    }

    function getSelectedModel(connection = null) {
        if (connection) return String(connection.model || '').trim();
        return getSetting('model', null);
    }


    function parseConnectionKeys(raw) {
        if (Array.isArray(raw)) return raw.filter(key => typeof key === 'string').map(key => key.trim()).filter(Boolean);
        if (typeof raw !== 'string') return [];
        try { if (raw.trim().startsWith('[')) return parseConnectionKeys(JSON.parse(raw)); } catch { }
        return raw.split(/[\n,]/).map(key => key.trim()).filter(Boolean);
    }

    function getFallbackProviders() {
        let value = getSetting('fallback-providers', []);
        if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
        return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : [];
    }

    function getProviderConnections() {
        return [{ id: 'primary', name: 'Primary', apiKeys: getApiKeys(), baseUrl: getBaseUrl(), model: getSelectedModel() },
            ...getFallbackProviders().filter(connection => connection.enabled !== false).map(connection => ({ ...connection }))];
    }

    async function withProviderConnections(request) {
        let lastError;
        for (const connection of getProviderConnections()) {
            try { return await request(connection); }
            catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('[ChatGPT] No OpenAI-compatible provider is configured.');
    }

    function getDefaultRequestBodyMergePatch() {
        return config.requestDefaults ? { ...config.requestDefaults } : {
            max_completion_tokens: 16000,
            temperature: 0.3
        };
    }

    function getDefaultRequestBodyMergeJson() {
        return JSON.stringify(getDefaultRequestBodyMergePatch(), null, 2);
    }

    function normalizeRequestBodyMergeJson(rawValue) {
        if (rawValue === null || rawValue === undefined || rawValue === '') {
            return '';
        }

        if (typeof rawValue === 'string') {
            return rawValue;
        }

        if (isPlainObject(rawValue) || Array.isArray(rawValue)) {
            return JSON.stringify(rawValue, null, 2);
        }

        return String(rawValue);
    }

    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function mergeRequestBody(base, patch) {
        const result = { ...base };

        for (const [key, value] of Object.entries(patch)) {
            if (value === null) {
                delete result[key];
                continue;
            }

            if (isPlainObject(value) && isPlainObject(result[key])) {
                result[key] = mergeRequestBody(result[key], value);
                continue;
            }

            result[key] = value;
        }

        return result;
    }

    function getRequestBodyMergeValidationError(rawValue) {
        const raw = normalizeRequestBodyMergeJson(rawValue).trim();
        if (!raw) return '';

        try {
            const parsed = JSON.parse(raw);
            if (!isPlainObject(parsed)) {
                return 'Request Body Merge JSON must be a JSON object.';
            }
            return '';
        } catch (e) {
            return e.message || 'Invalid JSON.';
        }
    }

    function getRequestBodyMergePatch() {
        const raw = normalizeRequestBodyMergeJson(getSetting('adv-requestBodyMergeJson', '')).trim();
        if (!raw) return getDefaultRequestBodyMergePatch();

        const validationError = getRequestBodyMergeValidationError(raw);
        if (validationError) {
            throw new Error(`[ChatGPT] Invalid Request Body Merge JSON: ${validationError}`);
        }

        return JSON.parse(raw);
    }

    function normalizePromptRequest(prompt) {
        if (prompt && typeof prompt === 'object' && !Array.isArray(prompt)) {
            return {
                systemPrompt: String(prompt.systemPrompt || '').trim(),
                userPrompt: String(prompt.userPrompt ?? prompt.prompt ?? '')
            };
        }
        return { systemPrompt: '', userPrompt: String(prompt ?? '') };
    }

    function buildChatGPTRequestBody(model, prompt, { stream = false } = {}) {
        const { systemPrompt, userPrompt } = normalizePromptRequest(prompt);
        const requestBody = {
            model: model,
            messages: [
                ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                { role: 'user', content: userPrompt }
            ]
        };

        const mergedBody = mergeRequestBody(requestBody, getRequestBodyMergePatch());

        // Streaming callers rely on receiving an early response byte so long
        // generations are not dropped by an upstream proxy while it waits for
        // the complete JSON document. Do not let an advanced merge patch turn
        // streaming back off for those calls.
        if (stream) mergedBody.stream = true;

        return mergedBody;
    }

    function buildResponsesRequestBody(model, prompt) {
        const { systemPrompt, userPrompt } = normalizePromptRequest(prompt);
        const patch = { ...getRequestBodyMergePatch() };

        if (patch.max_output_tokens === undefined) {
            patch.max_output_tokens = patch.max_completion_tokens ?? patch.max_tokens ?? 16000;
        }
        delete patch.max_completion_tokens;
        delete patch.max_tokens;
        delete patch.messages;
        delete patch.input;
        delete patch.instructions;
        delete patch.model;
        delete patch.stream;
        delete patch.tools;

        return mergeRequestBody({
            model,
            ...(systemPrompt ? { instructions: systemPrompt } : {}),
            input: userPrompt,
            tools: [{ type: 'web_search' }],
            // Research explicitly starts with a live search attempt. If the
            // selected model cannot call the tool, the manager retries without it.
            tool_choice: 'required',
            stream: true,
            store: false
        }, patch);
    }

    // ============================================
    // API Call Functions
    // ============================================

    /**
     * Call ChatGPT API and return raw text response
     */
    function normalizeFinishReason(reason) {
        return reason === null || reason === undefined
            ? ''
            : String(reason).trim().toLowerCase();
    }

    function createChatGPTResponseError(reason, detail = '') {
        const normalizedReason = normalizeFinishReason(reason) || 'missing_finish_reason';
        const message = String(detail || '').trim();
        const error = new Error(`[ChatGPT] Response rejected (${normalizedReason})${message ? `: ${message}` : ''}`);
        error.code = 'CHATGPT_RESPONSE_REJECTED';
        error.reason = normalizedReason;
        return error;
    }

    function readChatGPTResponseText(data) {
        if (data?.error) {
            throw new Error(`[ChatGPT] ${data.error.message || data.error.code || 'API response error'}`);
        }

        const choice = data?.choices?.[0];
        if (!choice) {
            throw createChatGPTResponseError('missing_choice');
        }
        if (choice.error) {
            const detail = typeof choice.error === 'string'
                ? choice.error
                : choice.error.message || choice.error.code || 'Choice response error';
            throw new Error(`[ChatGPT] ${detail}`);
        }

        const refusal = choice.message?.refusal;
        if ((typeof refusal === 'string' && refusal.trim()) || (refusal && typeof refusal !== 'string')) {
            throw createChatGPTResponseError('refusal', typeof refusal === 'string' ? refusal : 'Request refused');
        }

        const finishReason = normalizeFinishReason(choice.finish_reason);
        if (finishReason !== 'stop') {
            throw createChatGPTResponseError(finishReason, choice.finish_details?.message);
        }

        const content = choice.message?.content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .map(part => typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : ''))
                .join('');
        }
        return '';
    }

    function readChatGPTStreamChunk(data) {
        if (data?.error) {
            throw new Error(`[ChatGPT] ${data.error.message || data.error.code || 'API response error'}`);
        }

        const choice = data?.choices?.[0];
        if (!choice) return { text: '', finishReason: '' };
        if (choice.error) {
            const detail = typeof choice.error === 'string'
                ? choice.error
                : choice.error.message || choice.error.code || 'Choice response error';
            throw new Error(`[ChatGPT] ${detail}`);
        }

        const refusal = choice.delta?.refusal;
        if ((typeof refusal === 'string' && refusal.trim()) || (refusal && typeof refusal !== 'string')) {
            throw createChatGPTResponseError('refusal', typeof refusal === 'string' ? refusal : 'Request refused');
        }

        const finishReason = normalizeFinishReason(choice.finish_reason);
        if (finishReason && finishReason !== 'stop') {
            throw createChatGPTResponseError(finishReason, choice.finish_details?.message);
        }

        const content = choice.delta?.content;
        const text = typeof content === 'string'
            ? content
            : Array.isArray(content)
                ? content.map(part => typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : '')).join('')
                : '';
        return { text, finishReason };
    }

    async function callChatGPTAPIRaw(
        prompt,
        maxRetries = window.AIAddonManager?.getProviderRequestAttempts?.() ?? 3,
        transformResult = null,
        requestTimeoutMs = window.ivLyricsFetch?.DEFAULT_TIMEOUT_MS || 90_000,
        connection = null
    ) {
        if (!connection) return withProviderConnections(provider => callChatGPTAPIRaw(prompt, maxRetries, transformResult, requestTimeoutMs, provider));
        const apiKeys = getApiKeys(connection);
        if (apiKeys.length === 0) {
            throw new Error('[ChatGPT] API key is required. Please configure your API key in settings.');
        }

        const baseUrl = getBaseUrl(connection);
        const model = getSelectedModel(connection);
        if (!model) {
            throw new Error('[ChatGPT] Model is not selected. Please select a model in settings.');
        }
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

                    const response = await window.ivLyricsFetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(buildChatGPTRequestBody(model, prompt))
                    }, requestTimeoutMs);

                    if (response.status === 429 || response.status === 403) {
                        window.__ivLyricsDebugLog?.(`[ChatGPT Addon] API key ${keyIndex + 1} failed (${response.status}), trying next...`);
                        break; // Try next key
                    }

                    if (response.status === 401) {
                        let errorMessage = 'Invalid API key or permission denied.';
                        try {
                            const errorData = await response.json();
                            if (errorData.error?.message) {
                                errorMessage = errorData.error.message;
                            }
                        } catch (parseError) { }
                        throw new Error(`[ChatGPT] ${errorMessage}`);
                    }

                    if (!response.ok) {
                        let errorMessage = `HTTP ${response.status}`;
                        try {
                            const errorData = await response.json();
                            if (errorData.error?.message) {
                                errorMessage = errorData.error.message;
                            }
                        } catch (parseError) { }
                        throw new Error(`[ChatGPT] ${errorMessage}`);
                    }

                    const data = await response.json();
                    const rawText = readChatGPTResponseText(data);

                    if (!rawText.trim()) {
                        throw new Error('[ChatGPT] Empty response from API');
                    }

                    return typeof transformResult === 'function'
                        ? transformResult(rawText)
                        : rawText;

                } catch (e) {
                    lastError = e;
                    window.__ivLyricsDebugLog?.(`[ChatGPT Addon] Attempt ${attempt + 1} failed:`, e.message);

                    if (e.message.includes('Invalid API key') || e.message.includes('permission denied')) {
                        throw e;
                    }

                    if (attempt < maxRetries - 1) {
                        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
            }
        }

        throw lastError || new Error('[ChatGPT] All API keys and retries exhausted');
    }

    function emitStreamingLines(accumulated, onLine, state, flush = false) {
        if (!onLine) return;

        if (flush) {
            if (state.offset >= accumulated.length) return;
            const finalLine = accumulated.slice(state.offset);
            onLine(state.index, finalLine);
            state.index += 1;
            state.offset = accumulated.length;
            return;
        }

        let newlineIndex = accumulated.indexOf('\n', state.offset);
        if (newlineIndex === -1) return;

        const completedLines = [];
        let lineStart = state.offset;
        while (newlineIndex !== -1) {
            completedLines.push(accumulated.slice(lineStart, newlineIndex));
            lineStart = newlineIndex + 1;
            newlineIndex = accumulated.indexOf('\n', lineStart);
        }

        for (const line of completedLines) {
            onLine(state.index, line);
            state.index += 1;
            state.offset += line.length + 1;
        }
    }

    function createResponsesAPIError(data, fallback = 'Responses API request failed') {
        const response = data?.response || data;
        const error = response?.error || data?.error;
        const reason = response?.incomplete_details?.reason || response?.status || data?.type || '';
        const message = error?.message || error?.code || reason || fallback;
        return new Error(`[ChatGPT Web Search] ${message}`);
    }

    function readResponsesOutputText(data) {
        if (data?.error || data?.status === 'failed' || data?.status === 'incomplete') {
            throw createResponsesAPIError(data);
        }
        return (Array.isArray(data?.output) ? data.output : [])
            .flatMap(item => Array.isArray(item?.content) ? item.content : [])
            .filter(part => part?.type === 'output_text' && typeof part.text === 'string')
            .map(part => part.text)
            .join('');
    }

    async function callResponsesAPIStream(
        prompt,
        onLine,
        onStreamReset,
        maxRetries = window.AIAddonManager?.getProviderRequestAttempts?.() ?? 3,
        transformResult = null,
        requestTimeoutMs = window.ivLyricsFetch?.DEFAULT_TIMEOUT_MS || 90_000,
        onRawChunk = null,
        connection = null
    ) {
        if (!connection) return withProviderConnections(provider => callResponsesAPIStream(prompt, onLine, onStreamReset, maxRetries, transformResult, requestTimeoutMs, onRawChunk, provider));
        const apiKeys = getApiKeys(connection);
        if (apiKeys.length === 0) {
            throw new Error('[ChatGPT] API key is required. Please configure your API key in settings.');
        }

        const baseUrl = getBaseUrl(connection);
        const model = getSelectedModel(connection);
        if (!model) {
            throw new Error('[ChatGPT] Model is not selected. Please select a model in settings.');
        }
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                let emittedLineCount = 0;
                let emittedProvisionalOutput = false;
                let receivedStreamText = false;
                const resetProvisionalOutput = (reason, error = null) => {
                    if (!emittedProvisionalOutput && !receivedStreamText) return;
                    try {
                        if (typeof onStreamReset === 'function') {
                            onStreamReset({ reason, error: error?.message || null });
                        } else if (typeof onLine === 'function') {
                            for (let index = 0; index < emittedLineCount; index++) onLine(index, '');
                        }
                    } catch (resetError) {
                        window.__ivLyricsDebugLog?.('[ChatGPT Addon] Failed to reset Responses API stream:', resetError?.message);
                    }
                    emittedLineCount = 0;
                    emittedProvisionalOutput = false;
                    receivedStreamText = false;
                };

                try {
                    const endpoint = `${normalizeBaseUrl(baseUrl)}/responses`;
                    const response = await window.ivLyricsFetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(buildResponsesRequestBody(model, prompt))
                    }, requestTimeoutMs);

                    if (response.status === 429 || response.status === 403) break;
                    if (!response.ok) {
                        let errorData = null;
                        try { errorData = await response.json(); } catch { }
                        throw createResponsesAPIError(errorData, `HTTP ${response.status}`);
                    }

                    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
                    if (!response.body || !contentType.includes('text/event-stream')) {
                        const data = await response.json();
                        const rawText = readResponsesOutputText(data);
                        if (!rawText.trim()) throw new Error('[ChatGPT Web Search] Empty response from API');
                        if (typeof onRawChunk === 'function') {
                            receivedStreamText = true;
                            onRawChunk(rawText);
                        }
                        const transformed = typeof transformResult === 'function'
                            ? transformResult(rawText)
                            : rawText;
                        if (Array.isArray(transformed) && typeof onLine === 'function') {
                            transformed.forEach((line, index) => onLine(index, line));
                        }
                        return transformed;
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let sseBuffer = '';
                    let accumulated = '';
                    let completed = false;
                    const lineState = { index: 0, offset: 0 };

                    const appendText = (text) => {
                        if (!text) return;
                        accumulated += text;
                        receivedStreamText = true;
                        if (typeof onRawChunk === 'function') onRawChunk(text);
                    };

                    const processSseLine = (line) => {
                        const trimmedLine = String(line || '').trim();
                        if (!trimmedLine.startsWith('data:')) return;
                        const payload = trimmedLine.slice(5).trimStart();
                        if (!payload || payload === '[DONE]') return;

                        const event = JSON.parse(payload);
                        if (event.type === 'response.output_text.delta') {
                            appendText(typeof event.delta === 'string' ? event.delta : '');
                            return;
                        }
                        if (event.type === 'response.output_text.done') {
                            if (!accumulated && typeof event.text === 'string') appendText(event.text);
                            return;
                        }
                        if (event.type === 'response.refusal.done' || event.type === 'response.refusal.delta') {
                            throw new Error(`[ChatGPT Web Search] ${event.refusal || event.delta || 'Request refused'}`);
                        }
                        if (event.type === 'response.failed' || event.type === 'response.incomplete' || event.type === 'error') {
                            throw createResponsesAPIError(event);
                        }
                        if (event.type === 'response.completed') {
                            completed = true;
                            if (!accumulated) appendText(readResponsesOutputText(event.response));
                        }
                    };

                    const drainSseBuffer = (flush = false) => {
                        const lines = sseBuffer.split(/\r?\n/);
                        if (flush) sseBuffer = '';
                        else sseBuffer = lines.pop() || '';
                        for (const line of lines) processSseLine(line);
                    };

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        sseBuffer += decoder.decode(value, { stream: true });
                        drainSseBuffer();

                        const beforeEmitCount = lineState.index;
                        emitStreamingLines(accumulated, onLine, lineState);
                        if (lineState.index > beforeEmitCount) {
                            emittedProvisionalOutput = true;
                            emittedLineCount = Math.max(emittedLineCount, lineState.index);
                        }
                    }

                    sseBuffer += decoder.decode();
                    drainSseBuffer(true);
                    const beforeFlushCount = lineState.index;
                    emitStreamingLines(accumulated, onLine, lineState, true);
                    if (lineState.index > beforeFlushCount) {
                        emittedProvisionalOutput = true;
                        emittedLineCount = Math.max(emittedLineCount, lineState.index);
                    }

                    if (!completed) throw new Error('[ChatGPT Web Search] Responses API stream ended before completion');
                    if (!accumulated.trim()) throw new Error('[ChatGPT Web Search] Empty response from streaming API');

                    const transformed = typeof transformResult === 'function'
                        ? transformResult(accumulated)
                        : accumulated;
                    if (Array.isArray(transformed) && typeof onLine === 'function') {
                        transformed.forEach((line, index) => onLine(index, line));
                    }
                    return transformed;
                } catch (error) {
                    lastError = error;
                    window.__ivLyricsDebugLog?.(`[ChatGPT Addon] Responses API attempt ${attempt + 1} failed:`, error.message);
                    resetProvisionalOutput(attempt < maxRetries - 1 ? 'retry' : 'failed', error);
                    if (/invalid api key|permission denied/i.test(error.message)) throw error;
                    if (attempt < maxRetries - 1) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                }
            }
        }

        throw lastError || new Error('[ChatGPT Web Search] All API keys and retries exhausted');
    }

    async function callChatGPTAPIStream(
        prompt,
        onLine,
        onStreamReset,
        maxRetries = window.AIAddonManager?.getProviderRequestAttempts?.() ?? 3,
        transformResult = null,
        requestTimeoutMs = window.ivLyricsFetch?.DEFAULT_TIMEOUT_MS || 90_000,
        onRawChunk = null,
        connection = null
    ) {
        if (!connection) return withProviderConnections(provider => callChatGPTAPIStream(prompt, onLine, onStreamReset, maxRetries, transformResult, requestTimeoutMs, onRawChunk, provider));
        const apiKeys = getApiKeys(connection);
        if (apiKeys.length === 0) {
            throw new Error('[ChatGPT] API key is required. Please configure your API key in settings.');
        }

        const baseUrl = getBaseUrl(connection);
        const model = getSelectedModel(connection);
        if (!model) {
            throw new Error('[ChatGPT] Model is not selected. Please select a model in settings.');
        }
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                let emittedLineCount = 0;
                let emittedProvisionalOutput = false;
                let receivedStreamText = false;
                const resetProvisionalOutput = (reason, error = null) => {
                    if (!emittedProvisionalOutput && !receivedStreamText) return;

                    try {
                        if (typeof onStreamReset === 'function') {
                            onStreamReset({ reason, error: error?.message || null });
                        } else if (typeof onLine === 'function') {
                            for (let index = 0; index < emittedLineCount; index++) {
                                onLine(index, '');
                            }
                        }
                    } catch (resetError) {
                        window.__ivLyricsDebugLog?.('[ChatGPT Addon] Failed to reset provisional stream:', resetError?.message);
                    }

                    emittedProvisionalOutput = false;
                    emittedLineCount = 0;
                    receivedStreamText = false;
                };

                try {
                    const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

                    const response = await window.ivLyricsFetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(buildChatGPTRequestBody(model, prompt, { stream: true }))
                    }, requestTimeoutMs);

                    if (response.status === 429 || response.status === 403) {
                        window.__ivLyricsDebugLog?.(`[ChatGPT Addon] Stream: API key ${keyIndex + 1} failed (${response.status}), trying next...`);
                        break;
                    }

                    if (response.status === 401) {
                        let errorMessage = 'Invalid API key or permission denied.';
                        try { const d = await response.json(); if (d.error?.message) errorMessage = d.error.message; } catch (e) { }
                        throw new Error(`[ChatGPT] ${errorMessage}`);
                    }

                    if (!response.ok) {
                        let errorMessage = `HTTP ${response.status}`;
                        try { const d = await response.json(); if (d.error?.message) errorMessage = d.error.message; } catch (e) { }
                        throw new Error(`[ChatGPT] ${errorMessage}`);
                    }

                    // Some compatible APIs accept `stream: true` but still
                    // return a regular JSON completion. Preserve compatibility
                    // with those servers while preferring SSE for long requests.
                    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
                    if (!response.body || !contentType.includes('text/event-stream')) {
                        const data = await response.json();
                        const rawText = readChatGPTResponseText(data);
                        if (!rawText.trim()) throw new Error('[ChatGPT] Empty response from API');
                        if (typeof onRawChunk === 'function') {
                            receivedStreamText = true;
                            onRawChunk(rawText);
                        }

                        const transformed = typeof transformResult === 'function'
                            ? transformResult(rawText)
                            : rawText;
                        if (Array.isArray(transformed) && typeof onLine === 'function') {
                            transformed.forEach((line, index) => onLine(index, line));
                        }
                        return transformed;
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let sseBuffer = '';
                    let accumulated = '';
                    let finalFinishReason = '';
                    const lineState = { index: 0, offset: 0 };

                    const processSseLine = (line) => {
                        const trimmedLine = String(line || '').trim();
                        if (!trimmedLine.startsWith('data:')) return;

                        const payload = trimmedLine.slice(5).trimStart();
                        if (!payload || payload === '[DONE]') return;

                        const parsed = JSON.parse(payload);
                        const chunk = readChatGPTStreamChunk(parsed);
                        if (chunk.text) {
                            accumulated += chunk.text;
                            receivedStreamText = true;
                            if (typeof onRawChunk === 'function') onRawChunk(chunk.text);
                        }
                        if (chunk.finishReason) finalFinishReason = chunk.finishReason;
                    };

                    const drainSseBuffer = (flush = false) => {
                        const parts = sseBuffer.split(/\r?\n/);
                        if (flush) {
                            sseBuffer = '';
                        } else {
                            sseBuffer = parts.pop() || '';
                        }
                        for (const line of parts) processSseLine(line);
                    };

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;

                        sseBuffer += decoder.decode(value, { stream: true });
                        drainSseBuffer();

                        const beforeEmitCount = lineState.index;
                        emitStreamingLines(accumulated, onLine, lineState);
                        if (lineState.index > beforeEmitCount) {
                            emittedProvisionalOutput = true;
                            emittedLineCount = Math.max(emittedLineCount, lineState.index);
                        }
                    }

                    sseBuffer += decoder.decode();
                    drainSseBuffer(true);

                    const beforeFlushCount = lineState.index;
                    emitStreamingLines(accumulated, onLine, lineState, true);
                    if (lineState.index > beforeFlushCount) {
                        emittedProvisionalOutput = true;
                        emittedLineCount = Math.max(emittedLineCount, lineState.index);
                    }

                    if (finalFinishReason !== 'stop') {
                        throw createChatGPTResponseError(finalFinishReason);
                    }
                    if (!accumulated.trim()) throw new Error('[ChatGPT] Empty response from streaming API');

                    const transformed = typeof transformResult === 'function'
                        ? transformResult(accumulated)
                        : accumulated;

                    if (Array.isArray(transformed) && typeof onLine === 'function') {
                        const provisionalLines = accumulated.split('\n');
                        transformed.forEach((line, index) => {
                            if (index >= emittedLineCount || provisionalLines[index] !== line) {
                                onLine(index, line);
                            }
                        });
                        for (let index = transformed.length; index < emittedLineCount; index++) {
                            if (provisionalLines[index] !== '') onLine(index, '');
                        }
                    }

                    return transformed;

                } catch (e) {
                    lastError = e;
                    window.__ivLyricsDebugLog?.(`[ChatGPT Addon] Stream attempt ${attempt + 1} failed:`, e.message);
                    resetProvisionalOutput(attempt < maxRetries - 1 ? 'retry' : 'failed', e);
                    if (e.message.includes('Invalid API key') || e.message.includes('permission denied')) throw e;
                    if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }

        throw lastError || new Error('[ChatGPT] All API keys and retries exhausted');
    }

    /**
     * Call ChatGPT API and parse JSON response (for metadata, TMI, etc.)
     */
    async function callChatGPTAPI(
        prompt,
        maxRetries = window.AIAddonManager?.getProviderRequestAttempts?.() ?? 3,
        requestTimeoutMs = window.ivLyricsFetch?.DEFAULT_TIMEOUT_MS || 90_000
    ) {
        return await callChatGPTAPIRaw(prompt, maxRetries, extractJSON, requestTimeoutMs);
    }

    /**
     * Parse plain text lines from API response
     */
    function parseTextLines(text, expectedSourceLines) {
        if (text === null || text === undefined) {
            throw new Error('[ChatGPT] Empty response from API');
        }

        const sourceLines = Array.isArray(expectedSourceLines)
            ? expectedSourceLines.map(line => String(line ?? ''))
            : null;
        const expectedLineCount = sourceLines
            ? sourceLines.length
            : Number(expectedSourceLines);
        let lines = String(text).replace(/\r\n?/g, '\n').split('\n');

        let firstNonBlank = 0;
        let lastNonBlank = lines.length - 1;
        while (firstNonBlank <= lastNonBlank && !lines[firstNonBlank].trim()) firstNonBlank += 1;
        while (lastNonBlank >= firstNonBlank && !lines[lastNonBlank].trim()) lastNonBlank -= 1;

        const openingFence = lines[firstNonBlank]?.trim() || '';
        const closingFence = lines[lastNonBlank]?.trim() || '';
        if (/^```[a-z0-9_-]*$/i.test(openingFence) && closingFence === '```') {
            lines = lines.slice(firstNonBlank + 1, lastNonBlank);
        }

        const candidates = [lines];
        if (lines[0]?.trim() === '') candidates.push(lines.slice(1));
        if (lines[lines.length - 1]?.trim() === '') candidates.push(lines.slice(0, -1));
        if (lines[0]?.trim() === '' && lines[lines.length - 1]?.trim() === '') {
            candidates.push(lines.slice(1, -1));
        }

        const validLines = candidates.find(candidate => candidate.length === expectedLineCount);
        if (!validLines) {
            throw new Error(`[ChatGPT] Invalid response line count: expected ${expectedLineCount}, got ${lines.length}`);
        }
        if (validLines.every(line => !String(line).trim())) {
            throw new Error('[ChatGPT] Empty response from API');
        }
        if (sourceLines) {
            const missingLineIndex = validLines.findIndex((line, index) => sourceLines[index].trim() && !String(line).trim());
            if (missingLineIndex >= 0) {
                throw new Error(`[ChatGPT] Empty response line at index ${missingLineIndex + 1}`);
            }
        }

        return validLines;
    }

    function extractJSON(text) {
        const truncatedMessage = 'AI JSON response was truncated. The provider or model likely hit its output token limit. Try a higher max output token setting, a different provider, or shorter lyrics.';
        const isProbablyTruncatedJSON = (value, error) => {
            const trimmed = String(value || '').trim();
            if (/Unexpected end|unterminated/i.test(error?.message || '')) return true;
            if (!trimmed.includes('{')) return false;
            return !trimmed.endsWith('}') || trimmed.lastIndexOf('}') < trimmed.lastIndexOf('{');
        };
        let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

        try {
            return JSON.parse(cleaned);
        } catch (directError) {
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[0]);
                } catch (matchError) {
                    if (isProbablyTruncatedJSON(cleaned, matchError)) throw new Error(truncatedMessage);
                    throw new Error('Failed to parse JSON response');
                }
            }
            if (isProbablyTruncatedJSON(cleaned, directError)) throw new Error(truncatedMessage);
            throw new Error('No valid JSON found in response');
        }
    }

    // ============================================
    // Addon Implementation
    // ============================================

    const ChatGPTAddon = {
        ...ADDON_INFO,

        async init() {
            window.__ivLyricsDebugLog?.(`[ChatGPT Addon] Initialized (v${ADDON_INFO.version})`);
        },

        /**
         * 연결 테스트
         */
        async testConnection() {
            await callChatGPTAPIRaw('Reply with just "OK" if you receive this.');
        },

        getSettingsUI() {
            const React = Spicetify.React;
            const { useState, useCallback, useEffect } = React;

            return function ChatGPTSettings() {
                const initialApiKeys = getSetting('api-keys', '') || getSetting('api-key', '');
                const [apiKeys, setApiKeys] = useState(
                    Array.isArray(initialApiKeys) ? JSON.stringify(initialApiKeys) : initialApiKeys
                );
                const [baseUrl, setBaseUrl] = useState(getSetting('base-url', DEFAULT_OPENAI_BASE_URL));
                const [model, setModel] = useState(getSelectedModel());
                const [customModel, setCustomModel] = useState(getSetting('custom-model', ''));
                const [testStatus, setTestStatus] = useState('');
                const [availableModels, setAvailableModels] = useState([]);
                const [modelsLoading, setModelsLoading] = useState(false);

                // 모델 목록 로드
                const loadModels = useCallback(async () => {
                    const keys = getApiKeys();
                    if (keys.length === 0) {
                        setAvailableModels([]);
                        return;
                    }
                    setModelsLoading(true);
                    try {
                        const models = await getModels();
                        setAvailableModels(models);
                        ADDON_INFO.models = models;
                    } catch (e) {
                        window.__ivLyricsDebugLog?.('[ChatGPT Addon] Failed to load models:', e);
                        setAvailableModels([]);
                    } finally {
                        setModelsLoading(false);
                    }
                }, [apiKeys, baseUrl]);

                // API 키가 변경되면 모델 목록 다시 로드
                useEffect(() => {
                    const keys = getApiKeys();
                    if (keys.length > 0) {
                        loadModels();
                    } else {
                        setAvailableModels([]);
                    }
                }, [apiKeys, baseUrl]);

                const handleApiKeyChange = useCallback((e) => {
                    setApiKeys(e.target.value);
                    setSetting('api-keys', e.target.value);
                }, []);

                const handleBaseUrlChange = useCallback((e) => {
                    const value = e.target.value;
                    setBaseUrl(value);
                    setSetting('base-url', value);
                }, []);

                const handleModelChange = useCallback((e) => {
                    setModel(e.target.value);
                    setSetting('model', e.target.value);
                }, []);

                const handleCustomModelChange = useCallback((e) => {
                    const value = e.target.value;
                    setCustomModel(value);
                    setSetting('custom-model', value);
                    if (value) {
                        setSetting('model', value);
                        setModel(value);
                    }
                }, []);

                const handleRefreshModels = useCallback(() => {
                    loadModels();
                }, [loadModels]);

                const handleTest = useCallback(async () => {
                    setTestStatus(aiText('testingConnection', 'Testing...'));
                    try {
                        await callChatGPTAPIRaw('Reply with just "OK" if you receive this.');
                        setTestStatus('✓ ' + aiText('connectionSuccess', 'Connection successful.'));
                    } catch (e) {
                        setTestStatus(`✗ Error: ${e.message}`);
                    }
                }, []);



                // ... (existing code for models)

                // ... (existing code for test)

                const isModelInList = availableModels.find(m => m.id === model);
                const hasApiKey = getApiKeys().length > 0;

                return React.createElement('div', { className: 'ai-addon-settings chatgpt-settings' },
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, aiText('apiKey', 'API Key(s)')),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('input', { type: 'text', value: apiKeys, onChange: handleApiKeyChange, placeholder: 'sk-... (multiple: ["key1", "key2"])' }),
                            React.createElement('button', { onClick: () => window.open(ADDON_INFO.apiKeyUrl, '_blank'), className: 'ai-addon-btn-secondary' }, aiText('getApiKey', 'Get API Key'))
                        ),
                        React.createElement('small', null, aiText('apiKeyDesc', 'Enter an API key or JSON array.'))
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, aiText('baseUrl', 'Base URL')),
                        React.createElement('input', { type: 'text', value: baseUrl, onChange: handleBaseUrlChange, placeholder: DEFAULT_OPENAI_BASE_URL }),
                        React.createElement('small', null, 'Change this to use OpenAI-compatible APIs')
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, aiText('model', 'Model')),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('select', {
                                value: isModelInList ? model : '',
                                onChange: handleModelChange,
                                disabled: modelsLoading
                            },
                                modelsLoading
                                    ? React.createElement('option', { value: '' }, aiText('loadingModels', 'Loading models...'))
                                    : availableModels.length > 0
                                        ? [
                                            !model && React.createElement('option', { key: '__placeholder__', value: '' }, aiText('selectModel', 'Select a model')),
                                            ...availableModels.map(m => React.createElement('option', { key: m.id, value: m.id }, m.name)),
                                            React.createElement('option', { key: 'custom', value: '' }, aiText('modelId', 'Model ID'))
                                        ].filter(Boolean)
                                        : [
                                            React.createElement('option', { key: 'empty', value: '' }, hasApiKey ? aiText('noModels', 'No models found') : aiText('apiKey', 'API Key')),
                                            React.createElement('option', { key: 'custom', value: '' }, aiText('modelId', 'Model ID'))
                                        ]
                            ),
                            React.createElement('button', {
                                onClick: handleRefreshModels,
                                className: 'ai-addon-btn-secondary',
                                disabled: modelsLoading || !hasApiKey,
                                title: aiText('refreshModels', 'Refresh model list')
                            }, modelsLoading ? '...' : '↻')
                        ),
                        availableModels.length > 0 && React.createElement('small', null, `${aiText('model', 'Model')}: ${availableModels.length}`)
                    ),
                    (!isModelInList || customModel) &&
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, aiText('modelId', 'Custom Model ID')),
                        React.createElement('input', { type: 'text', value: customModel, onChange: handleCustomModelChange, placeholder: 'e.g., gpt-4-turbo' })
                    ),
                    React.createElement(FallbackProvidersSection),
                    // Advanced API Parameters
                    React.createElement(AdvancedParamsSection)
                    ,
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('button', { onClick: handleTest, className: 'ai-addon-btn-primary' }, aiText('testConnection', 'Test Connection')),
                        testStatus && React.createElement('span', {
                            className: `ai-addon-test-status ${testStatus.startsWith('✓') ? 'success' : testStatus.startsWith('✗') ? 'error' : ''}`
                        }, testStatus)
                    )
                );
            };

            function FallbackProvidersSection() {
                const [connections, setConnections] = useState(getFallbackProviders);
                const save = next => { setConnections(next); setSetting('fallback-providers', next); };
                const move = (index, delta) => {
                    const next = [...connections];
                    [next[index], next[index + delta]] = [next[index + delta], next[index]];
                    save(next);
                };
                return React.createElement('div', { className: 'ai-addon-setting' },
                    React.createElement('label', null, t('settings.aiProviders.openaiConnections', 'Additional OpenAI-compatible providers')),
                    React.createElement('small', null, t('settings.aiProviders.openaiConnectionsDesc', 'Try the primary connection first, then enabled connections below in order when a request fails.')),
                    connections.map((connection, index) => React.createElement(ConnectionEditor, {
                        key: connection.id,
                        connection, index, count: connections.length,
                        onChange: patch => save(connections.map(item => item.id === connection.id ? { ...item, ...patch } : item)),
                        onRemove: () => save(connections.filter(item => item.id !== connection.id)),
                        onMove: delta => move(index, delta)
                    })),
                    React.createElement('button', {
                        className: 'ai-addon-btn-secondary',
                        onClick: () => save([...connections, { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: `API ${connections.length + 1}`, baseUrl: DEFAULT_OPENAI_BASE_URL, apiKeys: '', model: '', enabled: true }])
                    }, t('settings.aiProviders.addOpenaiConnection', 'Add provider'))
                );
            }

            function ConnectionEditor({ connection, index, count, onChange, onRemove, onMove }) {
                const [models, setModels] = useState([]);
                const [loading, setLoading] = useState(false);
                const [revision, setRevision] = useState(0);
                const [status, setStatus] = useState('');
                useEffect(() => {
                    let active = true;
                    setModels([]);
                    const keys = parseConnectionKeys(connection.apiKeys);
                    if (!keys.length) { setLoading(false); return; }
                    setLoading(true);
                    const timer = setTimeout(() => {
                        fetchAvailableModels(keys[0], connection.baseUrl).then(values => {
                            if (active) setModels(values);
                        }).finally(() => { if (active) setLoading(false); });
                    }, 350);
                    return () => { active = false; clearTimeout(timer); };
                }, [connection.apiKeys, connection.baseUrl, revision]);
                const field = (label, key, type = 'text') => React.createElement('label', null, label,
                    React.createElement('input', { type, value: connection[key] || '', onChange: event => onChange({ [key]: event.target.value }), autoComplete: 'off' }));
                return React.createElement('div', { style: { padding: '12px', margin: '10px 0', border: '1px solid rgba(255,255,255,.15)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px' } },
                    React.createElement('div', { className: 'ai-addon-input-group' },
                        React.createElement('label', null,
                            React.createElement('input', { type: 'checkbox', checked: connection.enabled !== false, onChange: event => onChange({ enabled: event.target.checked }) }),
                            `${index + 2}. ${connection.name || 'API'}`),
                        React.createElement('button', { onClick: () => onMove(-1), disabled: index === 0, 'aria-label': aiText('moveUp', 'Move up') }, '↑'),
                        React.createElement('button', { onClick: () => onMove(1), disabled: index === count - 1, 'aria-label': aiText('moveDown', 'Move down') }, '↓'),
                        React.createElement('button', { onClick: onRemove, 'aria-label': aiText('removeConnection', 'Remove provider') }, '×')
                    ),
                    field(t('settings.aiProviders.connectionName', 'Name'), 'name'),
                    field(aiText('baseUrl', 'Base URL'), 'baseUrl'),
                    field(aiText('apiKey', 'API Key(s)'), 'apiKeys', 'password'),
                    React.createElement('div', { className: 'ai-addon-input-group' },
                        React.createElement('select', { value: connection.model || '', disabled: loading || !models.length, onChange: event => onChange({ model: event.target.value }) },
                            !models.some(model => model.id === connection.model) && React.createElement('option', { value: connection.model || '' }, connection.model || aiText('selectModel', 'Select a model')),
                            models.map(model => React.createElement('option', { key: model.id, value: model.id }, model.name))),
                        React.createElement('button', { onClick: () => setRevision(value => value + 1), disabled: loading, title: aiText('refreshModels', 'Refresh model list') }, loading ? '...' : '↻')
                    ),
                    field(aiText('modelId', 'Model ID'), 'model'),
                    React.createElement('button', { className: 'ai-addon-btn-secondary', onClick: async () => {
                        setStatus(aiText('testingConnection', 'Testing...'));
                        try { await callChatGPTAPIRaw('Reply with just "OK".', 1, null, undefined, { ...connection }); setStatus('✓ ' + aiText('connectionSuccess', 'Connection successful.')); }
                        catch (error) { setStatus(`✗ ${error.message}`); }
                    } }, aiText('testThisConnection', 'Test this provider')),
                    status && React.createElement('small', null, status)
                );
            }

            function AdvancedParamsSection() {
                const [expanded, setExpanded] = useState(getSetting('adv-expanded', false));
                const [requestBodyMergeJson, setRequestBodyMergeJson] = useState(() => {
                    const savedValue = normalizeRequestBodyMergeJson(getSetting('adv-requestBodyMergeJson', ''));
                    return savedValue || getDefaultRequestBodyMergeJson();
                });
                const requestBodyMergeError = getRequestBodyMergeValidationError(requestBodyMergeJson);

                useEffect(() => {
                    if (!normalizeRequestBodyMergeJson(getSetting('adv-requestBodyMergeJson', ''))) {
                        setSetting('adv-requestBodyMergeJson', getDefaultRequestBodyMergeJson());
                    }
                }, []);

                const toggleExpanded = useCallback(() => {
                    const next = !expanded;
                    setExpanded(next);
                    setSetting('adv-expanded', next);
                }, [expanded]);

                return React.createElement('div', { className: 'ai-addon-setting ai-addon-advanced-params' },
                    React.createElement('div', {
                        style: { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', userSelect: 'none', marginBottom: expanded ? '8px' : '0' },
                        onClick: toggleExpanded
                    },
                        React.createElement('span', { style: { fontSize: '10px', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' } }, '▶'),
                        React.createElement('label', { style: { cursor: 'pointer', margin: 0, fontSize: '12px', opacity: 0.8 } }, 'Advanced API Parameters')
                    ),
                    expanded && React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '8px', borderLeft: '2px solid rgba(255,255,255,0.1)' } },
                        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                            React.createElement('span', { style: { fontSize: '12px' } }, 'Request Body Merge JSON'),
                            React.createElement('textarea', {
                                value: requestBodyMergeJson,
                                rows: 7,
                                spellCheck: false,
                                style: { width: '100%', fontSize: '12px', fontFamily: 'monospace', resize: 'vertical' },
                                placeholder: '{\n  "max_completion_tokens": 16000,\n  "max_tokens": null\n}',
                                onChange: (e) => {
                                    const value = e.target.value;
                                    setRequestBodyMergeJson(value);
                                    setSetting('adv-requestBodyMergeJson', value);
                                }
                            }),
                            requestBodyMergeError
                                ? React.createElement('small', { style: { color: '#ff9b9b', fontSize: '11px' } }, requestBodyMergeError)
                                : React.createElement('small', { style: { opacity: 0.65, fontSize: '11px' } }, 'Merged into the default request body. max_completion_tokens and temperature are filled in by default. Set a key to null to remove it.')
                        )
                    )
                );
            }
        },

        async translateLyrics({ text, lang, wantSmartPhonetic, translationPrompt, phoneticPrompt, onLine, onStreamReset }) {
            if (!text?.trim()) {
                throw new Error('No text provided');
            }

            const sourceLines = String(text).replace(/\r\n?/g, '\n').split('\n');
            const prompt = wantSmartPhonetic ? phoneticPrompt : translationPrompt;
            if (!prompt) {
                throw new Error('[OpenAI ChatGPT] Central lyrics prompt is unavailable.');
            }
            const parseLines = rawResponse => parseTextLines(rawResponse, sourceLines);

            // Validate inside the provider retry loop so partial/blocked output can retry safely.
            const lines = onLine
                ? await callChatGPTAPIStream(prompt, onLine, onStreamReset, undefined, parseLines)
                : await callChatGPTAPIRaw(prompt, undefined, parseLines);

            // Return in the format expected by LyricsService
            if (wantSmartPhonetic) {
                return { phonetic: lines };
            } else {
                return { translation: lines };
            }
        },

        async generateCharacterPronunciation({ lines, characterPronunciationPrompt }) {
            if (!Array.isArray(lines) || lines.length === 0) {
                throw new Error('No lines provided');
            }

            const prompt = characterPronunciationPrompt;
            if (!prompt) {
                throw new Error('[OpenAI ChatGPT] Central character pronunciation prompt is unavailable.');
            }
            const result = await callChatGPTAPI(prompt);
            if (!result || !(Array.isArray(result.l) || Array.isArray(result.lines))) {
                throw new Error('Invalid character pronunciation response');
            }
            return result;
        },

        async translateMetadata({ title, artist, metadataPrompt }) {
            if (!title || !artist) {
                throw new Error('Title and artist are required');
            }

            const prompt = metadataPrompt;
            if (!prompt) {
                throw new Error('[OpenAI ChatGPT] Central metadata translation prompt is unavailable.');
            }
            const result = await callChatGPTAPI(prompt);

            // Normalize result to match expected format in FullscreenOverlay.js
            return {
                translated: {
                    title: result.translatedTitle || result.title || title,
                    artist: result.translatedArtist || result.artist || artist
                },
                romanized: {
                    title: result.romanizedTitle || title,
                    artist: result.romanizedArtist || artist
                }
            };
        },

        async generateTMI({ title, artist, tmiPrompt, requestTimeoutMs, onResearchProgress, webSearch = true }) {
            if (!title || !artist) {
                throw new Error('Title and artist are required');
            }

            const prompt = tmiPrompt;
            if (!prompt) {
                throw new Error('[OpenAI ChatGPT] Central TMI prompt is unavailable.');
            }
            // Research uses SSE so an upstream proxy receives response bytes
            // while the long document is generated instead of closing an idle
            // non-streaming request before the client-side timeout expires.
            let progressParser = window.AIAddonManager?.createResearchStreamProgressParser?.(onResearchProgress);
            progressParser = progressParser || null;
            const resetProgress = progressParser
                ? (details) => {
                    progressParser = window.AIAddonManager.createResearchStreamProgressParser(onResearchProgress);
                    onResearchProgress(null, { ...details, reset: true });
                }
                : null;
            const request = ADDON_INFO.supports.researchWebSearch && webSearch !== false
                ? callResponsesAPIStream
                : callChatGPTAPIStream;
            return await request(
                prompt,
                null,
                resetProgress,
                1,
                extractJSON,
                requestTimeoutMs,
                progressParser ? chunk => progressParser.push(chunk) : null
            );
        },

        async generateLyricsStudy(params) {
            if (!Array.isArray(params?.lines) || params.lines.length === 0) {
                throw new Error('No lyrics lines provided');
            }

            const prompt = params.lyricsStudyPrompt;
            if (!prompt) {
                throw new Error('[OpenAI ChatGPT] Central lyrics study prompt is unavailable.');
            }
            return await callChatGPTAPI(prompt);
        },

        async generateCulturalAnnotations(params) {
            if (!Array.isArray(params?.lines) || params.lines.length === 0) {
                throw new Error('No lyrics lines provided');
            }
            const prompt = params.culturalAnnotationsPrompt;
            if (!prompt) {
                throw new Error('[OpenAI ChatGPT] Central cultural annotations prompt is unavailable.');
            }
            return await callChatGPTAPI(prompt);
        }
    };

    // ============================================
    // Registration
    // ============================================

    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(ChatGPTAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();

    return ChatGPTAddon;
    }

    // Share request validation, streaming and settings without sharing credentials.
    window.createOpenAICompatibleAddon = createOpenAICompatibleAddon;
    createOpenAICompatibleAddon();
})();
