/**
 * Perplexity AI Addon for ivLyrics
 * Perplexity AI를 사용한 번역, 발음, Research 생성
 * 
 * @author default
 * @version 1.0.1
 */

(() => {
    'use strict';

    // ============================================
    // Addon Metadata
    // ============================================

    const ADDON_INFO = {
        id: 'perplexity',
        name: 'Perplexity',
        author: 'default',
        description: {
            ko: 'Perplexity AI를 사용한 번역, 발음, 음악 리서치 (실시간 웹 검색 지원)',
            en: 'Translation, pronunciation, and music research using Perplexity AI (with real-time web search)',
            ja: 'Perplexity AIを使用した翻訳、発音、音楽リサーチ（リアルタイムウェブ検索対応）',
            'zh-CN': '使用 Perplexity AI 进行翻译、发音和音乐深度研究（支持实时网络搜索）',
        },
        version: '1.0.1',
        apiKeyUrl: 'https://www.perplexity.ai/settings/api',
        supports: {
            translate: true,
            metadata: true,
            tmi: true,
            researchWebSearch: true,
            lyricsStudy: true,
            characterPronunciation: true,
            culturalAnnotations: true
        },
        models: [] // Dynamic from API
    };

    const BASE_URL = 'https://api.perplexity.ai';

    /**
     * Fetch available models from Perplexity API
     */
    async function fetchAvailableModels(apiKey) {
        if (!apiKey) return [];

        try {
            const response = await window.ivLyricsFetch(`${BASE_URL}/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                window.__ivLyricsDebugLog?.('[Perplexity Addon] Failed to fetch models:', response.status);
                return [];
            }

            const data = await response.json();
            const models = (data.data || [])
                .map(m => ({
                    id: m.id,
                    name: m.name || m.id,
                    context_window: m.context_window
                }))
                // Sort by preference
                .sort((a, b) => {
                    const priority = ['start-pro', 'sonar-reasoning-pro', 'sonar-pro', 'sonar-reasoning', 'sonar'];
                    const aIdx = priority.findIndex(p => a.id.includes(p));
                    const bIdx = priority.findIndex(p => b.id.includes(p));

                    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                    if (aIdx !== -1) return -1;
                    if (bIdx !== -1) return 1;

                    return a.id.localeCompare(b.id);
                });

            if (models.length > 0) {
                models[0].default = true;
            }

            return models;
        } catch (e) {
            window.__ivLyricsDebugLog?.('[Perplexity Addon] Error fetching models:', e.message);
            return [];
        }
    }

    async function getModels() {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) return [];
        return await fetchAvailableModels(apiKeys[0]);
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

    function getApiKeys() {
        // 새 키 먼저 확인, 없으면 기존 키 fallback
        let raw = getSetting('api-keys', '');
        if (!raw) {
            raw = getSetting('api-key', '');
        }
        if (!raw) return [];

        if (Array.isArray(raw)) {
            return raw
                .map(k => typeof k === 'string' ? k.trim() : '')
                .filter(k => k);
        }

        if (typeof raw !== 'string') return [];

        try {
            if (raw.startsWith('[')) {
                return JSON.parse(raw)
                    .map(k => typeof k === 'string' ? k.trim() : '')
                    .filter(k => k);
            }
            return [raw.trim()].filter(k => k);
        } catch {
            return [raw.trim()].filter(k => k);
        }
    }

    function getSelectedModel() {
        return getSetting('model', 'sonar-pro');
    }


    function getAdvancedRequestParams() {
        const params = {};
        const useMaxTokens = getSetting('adv-maxTokens-enabled', true);
        if (useMaxTokens) {
            params.max_tokens = parseInt(getSetting('adv-maxTokens-value', 16000)) || 16000;
        }
        const useTemperature = getSetting('adv-temperature-enabled', true);
        if (useTemperature) {
            params.temperature = parseFloat(getSetting('adv-temperature-value', 0.3)) || 0.3;
        }
        return params;
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

    function buildPromptMessages(prompt) {
        const { systemPrompt, userPrompt } = normalizePromptRequest(prompt);
        return [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: userPrompt }
        ];
    }

    // ============================================
    // API Call Functions
    // ============================================

    function createPerplexityResponseError(reason, message = '') {
        const normalizedReason = String(reason ?? '').trim().toLowerCase() || 'unknown';
        const detail = String(message || '').trim();
        const error = new Error(`[Perplexity] Response rejected (${normalizedReason})${detail ? `: ${detail}` : ''}`);
        error.code = 'PERPLEXITY_RESPONSE_REJECTED';
        error.reason = normalizedReason;
        return error;
    }

    function readPerplexityResponseText(data, streaming = false, requireStop = false) {
        const choice = data?.choices?.[0];
        const responseError = data?.error || choice?.error;
        if (responseError) {
            const message = typeof responseError === 'string'
                ? responseError
                : responseError.message || responseError.type || data?.message || 'API response error';
            throw new Error(`[Perplexity] ${message}`);
        }

        const finishReason = String(choice?.finish_reason ?? '').trim().toLowerCase();
        if (finishReason && finishReason !== 'stop') {
            throw createPerplexityResponseError(finishReason);
        }
        if (requireStop && finishReason !== 'stop') {
            throw createPerplexityResponseError('missing_finish_reason');
        }

        const responsePart = streaming ? choice?.delta : choice?.message;
        const refusal = responsePart?.refusal;
        if ((typeof refusal === 'string' && refusal.trim()) || (refusal && typeof refusal !== 'string')) {
            throw createPerplexityResponseError('refusal', typeof refusal === 'string' ? refusal : 'Request refused');
        }

        const content = responsePart?.content;
        return typeof content === 'string' ? content : '';
    }

    async function callPerplexityAPIRaw(prompt, maxRetries = window.AIAddonManager?.getProviderRequestAttempts?.() ?? 3, transformResult = null) {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) {
            throw new Error('[Perplexity] API key is required. Please configure your API key in settings.');
        }

        const model = getSelectedModel();
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const response = await window.ivLyricsFetch(`${BASE_URL}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({
                            model: model,
                            messages: buildPromptMessages(prompt),
                            ...getAdvancedRequestParams()
                        })
                    });

                    if (response.status === 429 || response.status === 403) {
                        window.__ivLyricsDebugLog?.(`[Perplexity Addon] API key ${keyIndex + 1} failed (${response.status}), trying next...`);
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
                        throw new Error(`[Perplexity] ${errorMessage}`);
                    }

                    if (!response.ok) {
                        let errorMessage = `HTTP ${response.status}`;
                        try {
                            const errorData = await response.json();
                            if (errorData.error?.message) {
                                errorMessage = errorData.error.message;
                            }
                        } catch (parseError) { }
                        throw new Error(`[Perplexity] ${errorMessage}`);
                    }

                    const data = await response.json();
                    const rawText = readPerplexityResponseText(data, false, true);

                    if (!rawText.trim()) {
                        throw new Error('[Perplexity] Empty response from API');
                    }

                    return typeof transformResult === 'function'
                        ? transformResult(rawText)
                        : rawText;

                } catch (e) {
                    lastError = e;
                    window.__ivLyricsDebugLog?.(`[Perplexity Addon] Attempt ${attempt + 1} failed:`, e.message);

                    if (e.message.includes('Invalid API key') || e.message.includes('permission denied')) {
                        throw e;
                    }

                    if (attempt < maxRetries - 1) {
                        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
            }
        }

        throw lastError || new Error('[Perplexity] All API keys and retries exhausted');
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

    async function callPerplexityAPIStream(
        prompt,
        onLine,
        onStreamReset,
        maxRetries = window.AIAddonManager?.getProviderRequestAttempts?.() ?? 3,
        transformResult = null,
        requestTimeoutMs = window.ivLyricsFetch?.DEFAULT_TIMEOUT_MS || 90_000,
        onRawChunk = null,
        requestOverrides = {}
    ) {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) throw new Error('[Perplexity] API key is required.');
        const model = getSelectedModel();
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
                        window.__ivLyricsDebugLog?.('[Perplexity Addon] Failed to reset provisional stream:', resetError?.message);
                    }

                    emittedProvisionalOutput = false;
                    emittedLineCount = 0;
                    receivedStreamText = false;
                };

                try {
                    const response = await window.ivLyricsFetch(`${BASE_URL}/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                        body: JSON.stringify({ model, messages: buildPromptMessages(prompt), ...getAdvancedRequestParams(), ...requestOverrides, stream: true })
                    }, requestTimeoutMs);
                    if (response.status === 429 || response.status === 403) { break; }
                    if (!response.ok) {
                        let msg = `HTTP ${response.status}`;
                        try { const d = await response.json(); if (d.error?.message) msg = d.error.message; } catch (e) { }
                        throw new Error(`[Perplexity] ${msg}`);
                    }
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let sseBuffer = '', accumulated = '';
                    let sawStop = false;
                    const lineState = { index: 0, offset: 0 };
                    const consumeSSELine = (rawLine) => {
                        const line = String(rawLine || '').trim();
                        if (!line.startsWith('data:')) return;

                        const payload = line.slice(5).trimStart();
                        if (!payload || payload === '[DONE]') return;

                        const parsed = JSON.parse(payload);
                        const chunk = readPerplexityResponseText(parsed, true);
                        if (String(parsed?.choices?.[0]?.finish_reason ?? '').trim().toLowerCase() === 'stop') {
                            sawStop = true;
                        }
                        if (chunk) {
                            accumulated += chunk;
                            receivedStreamText = true;
                            if (typeof onRawChunk === 'function') onRawChunk(chunk);
                        }
                    };

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        sseBuffer += decoder.decode(value, { stream: true });
                        const parts = sseBuffer.split(/\r?\n/);
                        sseBuffer = parts.pop() || '';
                        for (const line of parts) consumeSSELine(line);

                        const beforeEmitCount = lineState.index;
                        emitStreamingLines(accumulated, onLine, lineState);
                        if (lineState.index > beforeEmitCount) {
                            emittedProvisionalOutput = true;
                            emittedLineCount = Math.max(emittedLineCount, lineState.index);
                        }
                    }

                    sseBuffer += decoder.decode();
                    if (sseBuffer.trim()) consumeSSELine(sseBuffer);
                    if (!sawStop) throw createPerplexityResponseError('missing_finish_reason');

                    const beforeFlushCount = lineState.index;
                    emitStreamingLines(accumulated, onLine, lineState, true);
                    if (lineState.index > beforeFlushCount) {
                        emittedProvisionalOutput = true;
                        emittedLineCount = Math.max(emittedLineCount, lineState.index);
                    }

                    if (!accumulated.trim()) throw new Error('[Perplexity] Empty response from streaming API');

                    const transformed = typeof transformResult === 'function'
                        ? transformResult(accumulated)
                        : accumulated;

                    if (Array.isArray(transformed) && typeof onLine === 'function') {
                        const provisionalLines = accumulated.split('\n');
                        transformed.forEach((line, index) => {
                            if (index >= emittedLineCount || provisionalLines[index] !== line) onLine(index, line);
                        });
                        for (let index = transformed.length; index < emittedLineCount; index++) {
                            onLine(index, '');
                        }
                    }

                    return transformed;
                } catch (e) {
                    lastError = e;
                    const isPermanentError = /invalid api key|permission denied/i.test(e.message);
                    resetProvisionalOutput(isPermanentError || attempt >= maxRetries - 1 ? 'failed' : 'retry', e);
                    if (isPermanentError) throw e;
                    if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }
        throw lastError || new Error('[Perplexity] All API keys and retries exhausted');
    }

    async function callPerplexityAPI(prompt, maxRetries = window.AIAddonManager?.getProviderRequestAttempts?.() ?? 3) {
        const rawText = await callPerplexityAPIRaw(prompt, maxRetries);
        return extractJSON(rawText);
    }

    function parseTextLines(text, expectedSourceLines) {
        if (text === null || text === undefined) {
            throw new Error('[Perplexity] Empty response from API');
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
            throw new Error(`[Perplexity] Invalid response line count: expected ${expectedLineCount}, got ${lines.length}`);
        }
        if (validLines.every(line => !String(line).trim())) {
            throw new Error('[Perplexity] Empty response from API');
        }
        if (sourceLines) {
            const missingLineIndex = validLines.findIndex((line, index) => sourceLines[index].trim() && !String(line).trim());
            if (missingLineIndex >= 0) {
                throw new Error(`[Perplexity] Empty response line at index ${missingLineIndex + 1}`);
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
    // Main Addon Object
    // ============================================

    const PerplexityAddon = {
        ...ADDON_INFO,

        getSettingsUI() {
            const React = Spicetify.React;
            const { useState, useCallback } = React;

            return function PerplexitySettings() {
                const initialApiKeys = getSetting('api-keys', '') || getSetting('api-key', '');
                const [apiKeys, setApiKeys] = useState(
                    Array.isArray(initialApiKeys) ? JSON.stringify(initialApiKeys) : initialApiKeys
                );
                const [selectedModel, setSelectedModel] = useState(getSetting('model', 'sonar-pro'));
                const [testStatus, setTestStatus] = useState('');

                const handleApiKeyChange = (e) => {
                    const val = e.target.value;
                    setApiKeys(val);
                    setSetting('api-keys', val);
                };

                const handleModelChange = (e) => {
                    const val = e.target.value;
                    setSelectedModel(val);
                    setSetting('model', val);
                };

                const handleTest = async () => {
                    setTestStatus('Testing...');
                    try {
                        const result = await callPerplexityAPIRaw('Say "Hello" in one word.');
                        setTestStatus(result ? '✓ Connection successful' : '✗ Empty response');
                    } catch (e) {
                        setTestStatus(`✗ ${e.message}`);
                    }
                };

                const [availableModels, setAvailableModels] = useState([]);
                const [modelsLoading, setModelsLoading] = useState(false);

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
                        if (models.length > 0) {
                            ADDON_INFO.models = models;
                        }
                    } catch (e) {
                        console.error('[Perplexity Addon] Failed to load models:', e);
                    }
                    setModelsLoading(false);
                }, [apiKeys]);

                React.useEffect(() => {
                    const keys = getApiKeys();
                    if (keys.length > 0) {
                        loadModels();
                    } else {
                        setAvailableModels([]);
                    }
                }, [apiKeys]);




                const hasApiKey = getApiKeys().length > 0;

                return React.createElement('div', { className: 'ai-addon-settings perplexity-settings' },
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'API Key(s)'),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('input', {
                                type: 'text',
                                value: apiKeys,
                                onChange: handleApiKeyChange,
                                placeholder: 'pplx-... (multiple: ["key1", "key2"])'
                            }),
                            React.createElement('button', {
                                onClick: () => window.open(ADDON_INFO.apiKeyUrl, '_blank'),
                                className: 'ai-addon-btn-secondary'
                            }, 'Get API Key')
                        ),
                        React.createElement('small', null, 'Enter a single key or JSON array for rotation')
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'Model'),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('select', {
                                value: selectedModel,
                                onChange: handleModelChange,
                                disabled: modelsLoading
                            },
                                modelsLoading
                                    ? React.createElement('option', { value: '' }, 'Loading models...')
                                    : availableModels.length > 0
                                        ? availableModels.map(m => React.createElement('option', { key: m.id, value: m.id }, m.name))
                                        : React.createElement('option', { value: selectedModel }, selectedModel || (hasApiKey ? 'No models found' : 'Enter API key first'))
                            ),
                            React.createElement('button', {
                                onClick: loadModels,
                                className: 'ai-addon-btn-secondary',
                                disabled: modelsLoading || !hasApiKey,
                                title: 'Refresh model list'
                            }, modelsLoading ? '...' : '↻')
                        ),
                        React.createElement('small', null, 'Sonar models include real-time web search')
                    ),
                    React.createElement(AdvancedParamsSection),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('button', { onClick: handleTest, className: 'ai-addon-btn-primary' }, 'Test Connection'),
                        testStatus && React.createElement('span', {
                            className: `ai-addon-test-status ${testStatus.startsWith('✓') ? 'success' : testStatus.startsWith('✗') ? 'error' : ''}`
                        }, testStatus)
                    )
                );
            };

            function AdvancedParamsSection() {
                const [expanded, setExpanded] = useState(getSetting('adv-expanded', false));
                const [maxTokensEnabled, setMaxTokensEnabled] = useState(getSetting('adv-maxTokens-enabled', true));
                const [maxTokensValue, setMaxTokensValue] = useState(getSetting('adv-maxTokens-value', 16000));
                const [temperatureEnabled, setTemperatureEnabled] = useState(getSetting('adv-temperature-enabled', true));
                const [temperatureValue, setTemperatureValue] = useState(getSetting('adv-temperature-value', 0.3));

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
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                            React.createElement('input', { type: 'checkbox', checked: maxTokensEnabled, onChange: (e) => { setMaxTokensEnabled(e.target.checked); setSetting('adv-maxTokens-enabled', e.target.checked); } }),
                            React.createElement('span', { style: { fontSize: '12px', minWidth: '110px' } }, 'Max Tokens'),
                            React.createElement('input', { type: 'number', value: maxTokensValue, disabled: !maxTokensEnabled, style: { width: '80px', fontSize: '12px' }, onChange: (e) => { const v = parseInt(e.target.value) || 16000; setMaxTokensValue(v); setSetting('adv-maxTokens-value', v); } })
                        ),
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                            React.createElement('input', { type: 'checkbox', checked: temperatureEnabled, onChange: (e) => { setTemperatureEnabled(e.target.checked); setSetting('adv-temperature-enabled', e.target.checked); } }),
                            React.createElement('span', { style: { fontSize: '12px', minWidth: '110px' } }, 'Temperature'),
                            React.createElement('input', { type: 'number', value: temperatureValue, disabled: !temperatureEnabled, style: { width: '80px', fontSize: '12px' }, step: '0.1', min: '0', max: '2', onChange: (e) => { const v = parseFloat(e.target.value) || 0.3; setTemperatureValue(v); setSetting('adv-temperature-value', v); } })
                        ),
                        React.createElement('small', { style: { opacity: 0.5, fontSize: '11px' } }, 'Uncheck to exclude parameter from API request.')
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
                throw new Error('[Perplexity] Central lyrics prompt is unavailable.');
            }
            const parseLines = rawResponse => parseTextLines(rawResponse, sourceLines);

            const lines = onLine
                ? await callPerplexityAPIStream(prompt, onLine, onStreamReset, undefined, parseLines)
                : await callPerplexityAPIRaw(prompt, undefined, parseLines);

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
                throw new Error('[Perplexity] Central character pronunciation prompt is unavailable.');
            }
            const result = await callPerplexityAPI(prompt);
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
                throw new Error('[Perplexity] Central metadata translation prompt is unavailable.');
            }
            const result = await callPerplexityAPI(prompt);

            return {
                translated: {
                    title: result?.translatedTitle || result?.title || title,
                    artist: result?.translatedArtist || result?.artist || artist
                },
                romanized: {
                    title: result?.romanizedTitle || title,
                    artist: result?.romanizedArtist || artist
                }
            };
        },

        async generateTMI({ title, artist, tmiPrompt, requestTimeoutMs, onResearchProgress, webSearch = true }) {
            if (!title || !artist) {
                throw new Error('Title and artist are required');
            }

            const prompt = tmiPrompt;
            if (!prompt) {
                throw new Error('[Perplexity] Central TMI prompt is unavailable.');
            }
            let progressParser = window.AIAddonManager?.createResearchStreamProgressParser?.(onResearchProgress) || null;
            const resetProgress = progressParser
                ? (details) => {
                    progressParser = window.AIAddonManager.createResearchStreamProgressParser(onResearchProgress);
                    onResearchProgress(null, { ...details, reset: true });
                }
                : null;
            return await callPerplexityAPIStream(
                prompt,
                null,
                resetProgress,
                1,
                extractJSON,
                requestTimeoutMs,
                progressParser ? chunk => progressParser.push(chunk) : null,
                webSearch === false
                    ? { disable_search: true, return_images: false }
                    : {
                        disable_search: false,
                        search_mode: 'web',
                        return_images: true,
                        web_search_options: { search_context_size: 'high' }
                    }
            );
        },

        async generateLyricsStudy(params) {
            if (!Array.isArray(params?.lines) || params.lines.length === 0) {
                throw new Error('No lyrics lines provided');
            }

            const prompt = params.lyricsStudyPrompt;
            if (!prompt) {
                throw new Error('[Perplexity] Central lyrics study prompt is unavailable.');
            }
            return await callPerplexityAPI(prompt);
        },

        async generateCulturalAnnotations(params) {
            if (!Array.isArray(params?.lines) || params.lines.length === 0) {
                throw new Error('No lyrics lines provided');
            }
            const prompt = params.culturalAnnotationsPrompt;
            if (!prompt) {
                throw new Error('[Perplexity] Central cultural annotations prompt is unavailable.');
            }
            return await callPerplexityAPI(prompt);
        }
    };

    // ============================================
    // Registration
    // ============================================

    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(PerplexityAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();

    window.__ivLyricsDebugLog?.('[Perplexity Addon] Module loaded');
})();
