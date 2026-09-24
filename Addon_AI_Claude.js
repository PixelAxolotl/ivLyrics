/**
 * Claude AI Addon for ivLyrics
 * Anthropic Claude를 사용한 번역, 발음, Research 생성
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
        id: 'claude',
        name: 'Anthropic Claude',
        author: 'default',
        description: {
            ko: 'Anthropic Claude를 사용한 번역, 발음, 음악 리서치',
            en: 'Translation, pronunciation, and music research using Anthropic Claude',
            ja: 'Anthropic Claudeを使用した翻訳、発音、音楽リサーチ',
            'zh-CN': '使用 Anthropic Claude 进行翻译、发音和音乐深度研究',
        },
        version: '1.0.1',
        apiKeyUrl: 'https://console.anthropic.com/settings/keys',
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

    const BASE_URL = 'https://api.anthropic.com/v1';
    const DEFAULT_RESEARCH_MAX_TOKENS = 16_000;
    const claudeModelCapabilities = new Map();

    const asPositiveInteger = (value) => {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    /**
     * Fetch available models from Claude API
     */
    async function fetchAvailableModels(apiKey) {
        if (!apiKey) return [];

        try {
            const response = await window.ivLyricsFetch(`${BASE_URL}/models`, {
                method: 'GET',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                }
            });

            if (!response.ok) {
                window.__ivLyricsDebugLog?.('[Claude Addon] Failed to fetch models:', response.status);
                return [];
            }

            const data = await response.json();
            const models = (data.data || [])
                .filter(m => m.type === 'model') // Filter only models
                .map(m => ({
                    id: m.id,
                    name: m.display_name || m.id,
                    created_at: m.created_at,
                    max_input_tokens: asPositiveInteger(m.max_input_tokens),
                    max_tokens: asPositiveInteger(m.max_tokens)
                }))
                // Sort to put newest models first (approximate by ID versioning or just specific priority)
                .sort((a, b) => {
                    // specific priority
                    const priority = ['claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-opus', 'claude-3-haiku'];
                    const aIdx = priority.findIndex(p => a.id.includes(p));
                    const bIdx = priority.findIndex(p => b.id.includes(p));

                    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                    if (aIdx !== -1) return -1;
                    if (bIdx !== -1) return 1;

                    return b.created_at?.localeCompare(a.created_at || '') || 0;
                });

            if (models.length > 0) {
                models[0].default = true;
            }
            for (const model of models) {
                claudeModelCapabilities.set(model.id, model);
            }

            return models;
        } catch (e) {
            window.__ivLyricsDebugLog?.('[Claude Addon] Error fetching models:', e.message);
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
        return getSetting('model', 'claude-sonnet-4-20250514');
    }


    function getAdvancedRequestParams() {
        const params = {};
        const useMaxTokens = getSetting('adv-maxTokens-enabled', true);
        if (useMaxTokens) {
            params.max_tokens = parseInt(getSetting('adv-maxTokens-value', 16000)) || 16000;
        }
        return params;
    }

    async function getResearchMaxTokens() {
        const selectedModel = getSelectedModel();
        let capabilities = claudeModelCapabilities.get(selectedModel);
        if (!capabilities) {
            const models = await fetchAvailableModels(getApiKeys()[0]);
            capabilities = models.find(model => model.id === selectedModel);
        }

        return asPositiveInteger(capabilities?.max_tokens)
            || asPositiveInteger(getAdvancedRequestParams().max_tokens)
            || DEFAULT_RESEARCH_MAX_TOKENS;
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

    function getClaudeWebSearchTool(model) {
        const normalizedModel = String(model || '').toLowerCase();
        const supportsLatestSearch = /(?:claude-)?(?:opus-(?:4[-.]?[678]|5)|sonnet-(?:4[-.]?6|5)|fable-5|mythos(?:-preview|-5))/.test(normalizedModel);

        if (supportsLatestSearch) {
            return {
                type: 'web_search_20260318',
                name: 'web_search',
                max_uses: 5,
                allowed_callers: ['direct']
            };
        }

        return { type: 'web_search_20250305', name: 'web_search', max_uses: 5 };
    }

    // ============================================
    // API Call Functions
    // ============================================

    const normalizeClaudeStopReason = (value) => String(value ?? '').trim().toLowerCase();

    function createClaudeResponseError(reason, message = '') {
        const normalizedReason = normalizeClaudeStopReason(reason) || 'unknown';
        const detail = String(message || '').trim();
        const error = new Error(`[Claude] Response rejected (${normalizedReason})${detail ? `: ${detail}` : ''}`);
        error.code = 'CLAUDE_RESPONSE_REJECTED';
        error.reason = normalizedReason;
        return error;
    }

    function validateClaudeStopReason(reason, allowUnspecified = false) {
        const normalizedReason = normalizeClaudeStopReason(reason);
        if (!normalizedReason) {
            if (allowUnspecified) return '';
            throw createClaudeResponseError('missing_stop_reason');
        }
        if (normalizedReason !== 'end_turn' && normalizedReason !== 'stop_sequence') {
            throw createClaudeResponseError(normalizedReason);
        }
        return normalizedReason;
    }

    function readClaudeResponseText(data) {
        if (data?.type === 'error' || data?.error) {
            throw new Error(`[Claude] ${data?.error?.message || data?.error?.type || data?.message || 'API response error'}`);
        }

        validateClaudeStopReason(data?.stop_reason);

        return (Array.isArray(data?.content) ? data.content : [])
            .filter(block => block?.type === 'text' && typeof block?.text === 'string')
            .map(block => block.text)
            .join('');
    }

    async function callClaudeAPIRaw(prompt, maxRetries = window.AIAddonManager?.getProviderRequestAttempts?.() ?? 3, transformResult = null) {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) {
            throw new Error('[Claude] API key is required. Please configure your API key in settings.');
        }

        const model = getSelectedModel();
        const { systemPrompt, userPrompt } = normalizePromptRequest(prompt);
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const response = await window.ivLyricsFetch(`${BASE_URL}/messages`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': apiKey,
                            'anthropic-version': '2023-06-01',
                            'anthropic-dangerous-direct-browser-access': 'true'
                        },
                        body: JSON.stringify({
                            model: model,
                            ...getAdvancedRequestParams(),
                            ...(systemPrompt ? { system: systemPrompt } : {}),
                            messages: [
                                { role: 'user', content: userPrompt }
                            ]
                        })
                    });

                    if (response.status === 429 || response.status === 403) {
                        window.__ivLyricsDebugLog?.(`[Claude Addon] API key ${keyIndex + 1} failed (${response.status}), trying next...`);
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
                        throw new Error(`[Claude] ${errorMessage}`);
                    }

                    if (!response.ok) {
                        let errorMessage = `HTTP ${response.status}`;
                        try {
                            const errorData = await response.json();
                            if (errorData.error?.message) {
                                errorMessage = errorData.error.message;
                            }
                        } catch (parseError) { }
                        throw new Error(`[Claude] ${errorMessage}`);
                    }

                    const data = await response.json();
                    const rawText = readClaudeResponseText(data);

                    if (!rawText.trim()) {
                        throw new Error('[Claude] Empty response from API');
                    }

                    return typeof transformResult === 'function'
                        ? transformResult(rawText)
                        : rawText;

                } catch (e) {
                    lastError = e;
                    window.__ivLyricsDebugLog?.(`[Claude Addon] Attempt ${attempt + 1} failed:`, e.message);

                    if (e.message.includes('Invalid API key') || e.message.includes('permission denied')) {
                        throw e;
                    }

                    if (attempt < maxRetries - 1) {
                        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
            }
        }

        throw lastError || new Error('[Claude] All API keys and retries exhausted');
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

    async function callClaudeAPIStream(
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
        if (apiKeys.length === 0) {
            throw new Error('[Claude] API key is required. Please configure your API key in settings.');
        }

        const model = getSelectedModel();
        const { systemPrompt, userPrompt } = normalizePromptRequest(prompt);
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
                        window.__ivLyricsDebugLog?.('[Claude Addon] Failed to reset provisional stream:', resetError?.message);
                    }

                    emittedProvisionalOutput = false;
                    emittedLineCount = 0;
                    receivedStreamText = false;
                };

                try {
                    const response = await window.ivLyricsFetch(`${BASE_URL}/messages`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': apiKey,
                            'anthropic-version': '2023-06-01',
                            'anthropic-dangerous-direct-browser-access': 'true'
                        },
                        body: JSON.stringify({
                            model: model,
                            ...getAdvancedRequestParams(),
                            ...requestOverrides,
                            ...(systemPrompt ? { system: systemPrompt } : {}),
                            stream: true,
                            messages: [
                                { role: 'user', content: userPrompt }
                            ]
                        })
                    }, requestTimeoutMs);

                    if (response.status === 429 || response.status === 403) {
                        window.__ivLyricsDebugLog?.(`[Claude Addon] Stream: API key ${keyIndex + 1} failed (${response.status}), trying next...`);
                        break;
                    }

                    if (response.status === 401) {
                        let errorMessage = 'Invalid API key or permission denied.';
                        try {
                            const errorData = await response.json();
                            if (errorData.error?.message) errorMessage = errorData.error.message;
                        } catch (parseError) { }
                        throw new Error(`[Claude] ${errorMessage}`);
                    }

                    if (!response.ok) {
                        let errorMessage = `HTTP ${response.status}`;
                        try {
                            const errorData = await response.json();
                            if (errorData.error?.message) errorMessage = errorData.error.message;
                        } catch (parseError) { }
                        throw new Error(`[Claude] ${errorMessage}`);
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let sseBuffer = '';
                    let accumulated = '';
                    let finalStopReason = '';
                    const lineState = { index: 0, offset: 0 };

                    const processSseEvent = (event) => {
                        const lines = String(event || '').split(/\r?\n/);
                        let eventType = '';
                        const dataLines = [];

                        for (const line of lines) {
                            if (line.startsWith('event:')) {
                                eventType = line.slice(6).trim();
                            } else if (line.startsWith('data:')) {
                                dataLines.push(line.slice(5).trimStart());
                            }
                        }

                        const payload = dataLines.join('\n').trim();
                        if (!payload || payload === '[DONE]') return;

                        const parsed = JSON.parse(payload);
                        const parsedType = eventType || parsed?.type || '';
                        if (parsedType === 'error' || parsed?.error) {
                            throw new Error(`[Claude] ${parsed?.error?.message || parsed?.error?.type || 'Streaming API error'}`);
                        }

                        if (parsedType === 'message_start') {
                            validateClaudeStopReason(parsed?.message?.stop_reason, true);
                            return;
                        }

                        if (parsedType === 'content_block_start') {
                            const block = parsed?.content_block;
                            const toolError = block?.type === 'web_search_tool_result'
                                && block?.content?.type === 'web_search_tool_result_error'
                                ? block.content
                                : null;
                            if (toolError) {
                                throw new Error(`[Claude] Web search failed: ${toolError.error_code || 'unknown_error'}`);
                            }
                            return;
                        }

                        if (parsedType === 'content_block_delta') {
                            const text = parsed?.delta?.type === 'text_delta' && typeof parsed?.delta?.text === 'string'
                                ? parsed.delta.text
                                : '';
                            if (text) {
                                accumulated += text;
                                receivedStreamText = true;
                                if (typeof onRawChunk === 'function') onRawChunk(text);
                            }
                            return;
                        }

                        if (parsedType === 'message_delta') {
                            const stopReason = validateClaudeStopReason(parsed?.delta?.stop_reason, true);
                            if (stopReason) finalStopReason = stopReason;
                        }
                    };

                    const drainSseBuffer = (flush = false) => {
                        const events = sseBuffer.split(/\r?\n\r?\n/);
                        if (flush) {
                            sseBuffer = '';
                        } else {
                            sseBuffer = events.pop() || '';
                        }
                        for (const event of events) processSseEvent(event);
                    };

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;

                        sseBuffer += decoder.decode(value, { stream: true });
                        drainSseBuffer();

                        // Emit completed lines
                        const beforeEmitCount = lineState.index;
                        emitStreamingLines(accumulated, onLine, lineState);
                        if (lineState.index > beforeEmitCount) {
                            emittedProvisionalOutput = true;
                            emittedLineCount = Math.max(emittedLineCount, lineState.index);
                        }
                    }

                    sseBuffer += decoder.decode();
                    drainSseBuffer(true);

                    // Emit final line
                    const beforeFlushCount = lineState.index;
                    emitStreamingLines(accumulated, onLine, lineState, true);
                    if (lineState.index > beforeFlushCount) {
                        emittedProvisionalOutput = true;
                        emittedLineCount = Math.max(emittedLineCount, lineState.index);
                    }

                    validateClaudeStopReason(finalStopReason);

                    if (!accumulated.trim()) {
                        throw new Error('[Claude] Empty response from streaming API');
                    }

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
                    window.__ivLyricsDebugLog?.(`[Claude Addon] Stream attempt ${attempt + 1} failed:`, e.message);

                    const willRetry = attempt < maxRetries - 1 || keyIndex < apiKeys.length - 1;
                    resetProvisionalOutput(willRetry ? 'retry' : 'failed', e);

                    if (e.message.includes('Invalid API key') || e.message.includes('permission denied')) {
                        throw e;
                    }

                    if (attempt < maxRetries - 1) {
                        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
            }
        }

        throw lastError || new Error('[Claude] All API keys and retries exhausted');
    }

    async function callClaudeAPI(prompt, maxRetries = window.AIAddonManager?.getProviderRequestAttempts?.() ?? 3) {
        const rawText = await callClaudeAPIRaw(prompt, maxRetries);
        return extractJSON(rawText);
    }

    function parseTextLines(text, expectedSourceLines) {
        if (text === null || text === undefined) {
            throw new Error('[Claude] Empty response from API');
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
            throw new Error(`[Claude] Invalid response line count: expected ${expectedLineCount}, got ${lines.length}`);
        }
        if (validLines.every(line => !String(line).trim())) {
            throw new Error('[Claude] Empty response from API');
        }
        if (sourceLines) {
            const missingLineIndex = validLines.findIndex((line, index) => sourceLines[index].trim() && !String(line).trim());
            if (missingLineIndex >= 0) {
                throw new Error(`[Claude] Empty response line at index ${missingLineIndex + 1}`);
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

    const ClaudeAddon = {
        ...ADDON_INFO,

        getSettingsUI() {
            const React = Spicetify.React;
            const { useState, useCallback } = React;

            return function ClaudeSettings() {
                const initialApiKeys = getSetting('api-keys', '') || getSetting('api-key', '');
                const [apiKeys, setApiKeys] = useState(
                    Array.isArray(initialApiKeys) ? JSON.stringify(initialApiKeys) : initialApiKeys
                );
                const [selectedModel, setSelectedModel] = useState(getSetting('model', 'claude-sonnet-4-20250514'));
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
                        const result = await callClaudeAPIRaw('Say "Hello" in one word.');
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
                        console.error('[Claude Addon] Failed to load models:', e);
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

                return React.createElement('div', { className: 'ai-addon-settings claude-settings' },
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'API Key(s)'),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('input', {
                                type: 'text',
                                value: apiKeys,
                                onChange: handleApiKeyChange,
                                placeholder: 'sk-ant-... (multiple: ["key1", "key2"])'
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
                        )
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
                            React.createElement('input', {
                                type: 'checkbox', checked: maxTokensEnabled,
                                onChange: (e) => { setMaxTokensEnabled(e.target.checked); setSetting('adv-maxTokens-enabled', e.target.checked); }
                            }),
                            React.createElement('span', { style: { fontSize: '12px', minWidth: '110px' } }, 'Max Tokens'),
                            React.createElement('input', {
                                type: 'number', value: maxTokensValue, disabled: !maxTokensEnabled,
                                style: { width: '80px', fontSize: '12px' },
                                onChange: (e) => { const v = parseInt(e.target.value) || 16000; setMaxTokensValue(v); setSetting('adv-maxTokens-value', v); }
                            })
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
                throw new Error('[Anthropic Claude] Central lyrics prompt is unavailable.');
            }
            const parseLines = rawResponse => parseTextLines(rawResponse, sourceLines);

            const lines = onLine
                ? await callClaudeAPIStream(prompt, onLine, onStreamReset, undefined, parseLines)
                : await callClaudeAPIRaw(prompt, undefined, parseLines);

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
                throw new Error('[Anthropic Claude] Central character pronunciation prompt is unavailable.');
            }
            const result = await callClaudeAPI(prompt);
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
                throw new Error('[Anthropic Claude] Central metadata translation prompt is unavailable.');
            }
            const result = await callClaudeAPI(prompt);

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
                throw new Error('[Anthropic Claude] Central TMI prompt is unavailable.');
            }
            let progressParser = window.AIAddonManager?.createResearchStreamProgressParser?.(onResearchProgress) || null;
            const resetProgress = progressParser
                ? (details) => {
                    progressParser = window.AIAddonManager.createResearchStreamProgressParser(onResearchProgress);
                    onResearchProgress(null, { ...details, reset: true });
                }
                : null;
            const requestOverrides = {
                max_tokens: await getResearchMaxTokens(),
                ...(webSearch === false ? {} : {
                    tools: [getClaudeWebSearchTool(getSelectedModel())]
                })
            };
            return await callClaudeAPIStream(
                prompt,
                null,
                resetProgress,
                1,
                extractJSON,
                requestTimeoutMs,
                progressParser ? chunk => progressParser.push(chunk) : null,
                requestOverrides
            );
        },

        async generateLyricsStudy(params) {
            if (!Array.isArray(params?.lines) || params.lines.length === 0) {
                throw new Error('No lyrics lines provided');
            }

            const prompt = params.lyricsStudyPrompt;
            if (!prompt) {
                throw new Error('[Anthropic Claude] Central lyrics study prompt is unavailable.');
            }
            return await callClaudeAPI(prompt);
        },

        async generateCulturalAnnotations(params) {
            if (!Array.isArray(params?.lines) || params.lines.length === 0) {
                throw new Error('No lyrics lines provided');
            }
            const prompt = params.culturalAnnotationsPrompt;
            if (!prompt) {
                throw new Error('[Claude] Central cultural annotations prompt is unavailable.');
            }
            return await callClaudeAPI(prompt);
        }
    };

    // ============================================
    // Registration
    // ============================================

    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(ClaudeAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();

    window.__ivLyricsDebugLog?.('[Claude Addon] Module loaded');
})();
