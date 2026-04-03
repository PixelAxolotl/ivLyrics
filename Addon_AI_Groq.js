/**
 * Groq AI Addon for ivLyrics
 * Groq의 초고속 추론을 사용한 번역, 발음, TMI 생성
 * 
 * @author ivLis STUDIO
 * @version 1.0.0
 */

(() => {
    'use strict';

    // ============================================
    // Addon Metadata
    // ============================================

    const ADDON_INFO = {
        id: 'groq',
        name: 'Groq',
        author: 'ivLis STUDIO',
        description: {
            ko: 'Groq의 초고속 AI 추론을 사용한 번역, 발음, TMI 생성 (Llama, Mixtral 등)',
            en: 'Ultra-fast AI inference with Groq for translation, pronunciation, and TMI (Llama, Mixtral, etc.)',
            ja: 'Groqの超高速AI推論を使用した翻訳、発音、TMI生成（Llama、Mixtralなど）',
            'zh-CN': '使用 Groq 超快速 AI 推理进行翻译、发音和 TMI 生成（Llama、Mixtral 等）',
        },
        version: '1.0.0',
        apiKeyUrl: 'https://console.groq.com/keys',
        supports: {
            translate: true,
            metadata: true,
            tmi: true
        },
        models: []
    };

    const BASE_URL = 'https://api.groq.com/openai/v1';

    /**
     * Groq API에서 사용 가능한 모델 목록을 가져옴
     */
    async function fetchAvailableModels(apiKey) {
        if (!apiKey) return [];

        try {
            const response = await fetch(`${BASE_URL}/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (!response.ok) {
                window.__ivLyricsDebugLog?.('[Groq Addon] Failed to fetch models:', response.status);
                return [];
            }

            const data = await response.json();
            const models = (data.data || [])
                .filter(m => m.id && !m.id.includes('whisper') && !m.id.includes('vision'))
                .map(m => ({
                    id: m.id,
                    name: m.id,
                    context_length: m.context_window
                }))
                .sort((a, b) => {
                    // 인기 모델 우선
                    const priority = ['llama-3.3', 'llama-3.2', 'llama-3.1', 'llama3', 'mixtral', 'gemma2'];
                    const aIdx = priority.findIndex(p => a.id.includes(p));
                    const bIdx = priority.findIndex(p => b.id.includes(p));
                    const aPri = aIdx === -1 ? 999 : aIdx;
                    const bPri = bIdx === -1 ? 999 : bIdx;
                    if (aPri !== bPri) return aPri - bPri;
                    return a.id.localeCompare(b.id);
                });

            if (models.length > 0) {
                models[0].default = true;
            }

            return models;
        } catch (e) {
            window.__ivLyricsDebugLog?.('[Groq Addon] Error fetching models:', e.message);
            return [];
        }
    }

    async function getModels() {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) return [];
        return await fetchAvailableModels(apiKeys[0]);
    }

    // ============================================
    // Language Data
    // ============================================

    const LANGUAGE_DATA = {
        'ko': { name: 'Korean', native: '한국어' },
        'en': { name: 'English', native: 'English' },
        'zh-CN': { name: 'Simplified Chinese', native: '简体中文' },
        'zh-TW': { name: 'Traditional Chinese', native: '繁體中文' },
        'ja': { name: 'Japanese', native: '日本語' },
        'hi': { name: 'Hindi', native: 'हिन्दी' },
        'es': { name: 'Spanish', native: 'Español' },
        'fr': { name: 'French', native: 'Français' },
        'ar': { name: 'Arabic', native: 'العربية' },
        'fa': { name: 'Persian', native: 'فارسی' },
        'de': { name: 'German', native: 'Deutsch' },
        'ru': { name: 'Russian', native: 'Русский' },
        'pt': { name: 'Portuguese', native: 'Português' },
        'bn': { name: 'Bengali', native: 'বাংলা' },
        'it': { name: 'Italian', native: 'Italiano' },
        'th': { name: 'Thai', native: 'ไทย' },
        'vi': { name: 'Vietnamese', native: 'Tiếng Việt' },
        'id': { name: 'Indonesian', native: 'Bahasa Indonesia' }
    };

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
        return getSetting('model', 'llama-3.3-70b-versatile');
    }

    function getLangInfo(lang) {
        if (!lang) return LANGUAGE_DATA['en'];
        const shortLang = lang.split('-')[0].toLowerCase();
        return LANGUAGE_DATA[lang] || LANGUAGE_DATA[shortLang] || LANGUAGE_DATA['en'];
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

    // ============================================
    // Prompt Builders
    // ============================================

    function buildTranslationPrompt(text, lang) {
        const langInfo = getLangInfo(lang);
        const lineCount = text.split('\n').length;

        return `You are a lyrics translator. Translate these ${lineCount} lines of song lyrics into ${langInfo.name} (${langInfo.native}).

CRITICAL RULES:
- This is a TRANSLATION task - translate the MEANING of each line
- Output must be written in ${langInfo.name} (${langInfo.native}) only
- Do NOT output the original lyrics unchanged
- Do NOT output romanization or pronunciation instead of translation
- Output EXACTLY ${lineCount} lines, one translation per line
- Preserve the original line breaks exactly
- Never merge multiple input lines into a single output line
- Never split a single input line into multiple output lines
- Line N in the output must translate only line N from the input
- Keep empty lines as empty
- Keep ♪ symbols and markers like [Chorus], (Yeah) as-is
- Do NOT add line numbers, prefixes, or explanations
- Do NOT use JSON or code blocks
- Just output the translated lines, nothing else

INPUT:
${text}

Example:
Input:
Hello mr my
yesterday

Correct output:
안녕 나의
어제여

Wrong output:
안녕 나의 어제여

OUTPUT (${lineCount} lines in ${langInfo.native}):`;
    }

    function buildPhoneticPrompt(text, lang) {
        const langInfo = getLangInfo(lang);
        const lineCount = text.split('\n').length;
        const isEnglish = lang === 'en';
        const scriptInstruction = isEnglish
            ? 'Use Latin alphabet only (romanization). Example: こんにちは → konnichiwa, 안녕하세요 → annyeonghaseyo'
            : `Write pronunciation in ${langInfo.native} script. ${langInfo.phoneticDesc || ''}`;

        return `You are a pronunciation converter. Convert these ${lineCount} lines of lyrics into how they SOUND (pronunciation) for ${langInfo.name} speakers.
${scriptInstruction}

CRITICAL RULES:
- This is a PRONUNCIATION task, NOT a translation task
- Output how each line SOUNDS when spoken aloud, written in ${isEnglish ? 'Latin alphabet' : langInfo.native + ' script'}
- Do NOT translate the meaning of the lyrics
- Do NOT output the original lyrics unchanged
- Output EXACTLY ${lineCount} lines, one pronunciation per line
- Keep empty lines as empty
- Keep ♪ symbols and markers like [Chorus], (Yeah) as-is
- Do NOT add line numbers, prefixes, or explanations
- Do NOT use JSON or code blocks
- Just output the pronunciations, nothing else

INPUT:
${text}

OUTPUT (${lineCount} lines of pronunciation only):`;
    }

    function buildMetadataPrompt(title, artist, lang) {
        const langInfo = getLangInfo(lang);

        return `Translate the song title and artist name to ${langInfo.name} (${langInfo.native}).

**Input**:
- Title: ${title}
- Artist: ${artist}

**Output valid JSON**:
{
  "translatedTitle": "translated title",
  "translatedArtist": "translated artist",
  "romanizedTitle": "romanized in Latin alphabet",
  "romanizedArtist": "romanized in Latin alphabet"
}`;
    }

    function buildTMIPrompt(title, artist, lang) {
        const langInfo = getLangInfo(lang);

        return `You are a music knowledge expert. Generate interesting facts and trivia about the song "${title}" by "${artist}".

IMPORTANT: The output MUST be in ${langInfo.name} (${langInfo.native}).
Even if the song is English, the description and trivia MUST be written in ${langInfo.native}.

**Output conditions**:
1. Language: STRICTLY ${langInfo.name} (${langInfo.native})
2. Format: JSON

**Output JSON Structure**:
{
  "track": {
    "description": "2-3 sentence description in ${langInfo.native}",
    "trivia": [
      "Fact 1 in ${langInfo.native}",
      "Fact 2 in ${langInfo.native}",
      "Fact 3 in ${langInfo.native}"
    ],
    "sources": {
      "verified": [],
      "related": [],
      "other": []
    },
    "reliability": {
      "confidence": "medium",
      "has_verified_sources": false,
      "verified_source_count": 0,
      "related_source_count": 0,
      "total_source_count": 0
    }
  }
}

**Rules**:
1. Write in ${langInfo.native}
2. Include 3-5 interesting facts in the trivia array
3. Be accurate - if you're not sure about a fact, mark confidence as "low"
4. Do NOT use markdown code blocks`;
    }

    // ============================================
    // API Call Functions
    // ============================================

    async function callGroqAPIRaw(prompt, maxRetries = 3) {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) {
            throw new Error('[Groq] API key is required. Please configure your API key in settings.');
        }

        const model = getSelectedModel();
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const response = await fetch(`${BASE_URL}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({
                            model: model,
                            messages: [
                                { role: 'user', content: prompt }
                            ],
                            ...getAdvancedRequestParams()
                        })
                    });

                    if (response.status === 429 || response.status === 403) {
                        window.__ivLyricsDebugLog?.(`[Groq Addon] API key ${keyIndex + 1} failed (${response.status}), trying next...`);
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
                        throw new Error(`[Groq] ${errorMessage}`);
                    }

                    if (!response.ok) {
                        let errorMessage = `HTTP ${response.status}`;
                        try {
                            const errorData = await response.json();
                            if (errorData.error?.message) {
                                errorMessage = errorData.error.message;
                            }
                        } catch (parseError) { }
                        throw new Error(`[Groq] ${errorMessage}`);
                    }

                    const data = await response.json();
                    const rawText = data.choices?.[0]?.message?.content || '';

                    if (!rawText) {
                        throw new Error('[Groq] Empty response from API');
                    }

                    return rawText;

                } catch (e) {
                    lastError = e;
                    window.__ivLyricsDebugLog?.(`[Groq Addon] Attempt ${attempt + 1} failed:`, e.message);

                    if (e.message.includes('Invalid API key') || e.message.includes('permission denied')) {
                        throw e;
                    }

                    if (attempt < maxRetries - 1) {
                        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
            }
        }

        throw lastError || new Error('[Groq] All API keys and retries exhausted');
    }

    async function callGroqAPIStream(prompt, onLine, maxRetries = 3) {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) throw new Error('[Groq] API key is required.');
        const model = getSelectedModel();
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const response = await fetch(`${BASE_URL}/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], ...getAdvancedRequestParams(), stream: true })
                    });
                    if (response.status === 429 || response.status === 403) { break; }
                    if (!response.ok) {
                        let msg = `HTTP ${response.status}`;
                        try { const d = await response.json(); if (d.error?.message) msg = d.error.message; } catch (e) { }
                        throw new Error(`[Groq] ${msg}`);
                    }
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let sseBuffer = '', accumulated = '', emittedLines = 0;
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        sseBuffer += decoder.decode(value, { stream: true });
                        const parts = sseBuffer.split('\n');
                        sseBuffer = parts.pop() || '';
                        for (const line of parts) {
                            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                            try { const p = JSON.parse(line.slice(6)); const t = p.choices?.[0]?.delta?.content || ''; if (t) accumulated += t; } catch (e) { }
                        }
                        if (onLine) { const cl = accumulated.split('\n'); for (let i = emittedLines; i < cl.length - 1; i++) { onLine(i, cl[i]); emittedLines = i + 1; } }
                    }
                    if (onLine) { const fl = accumulated.split('\n'); if (fl.length > emittedLines) onLine(emittedLines, fl[emittedLines]); }
                    if (!accumulated) throw new Error('[Groq] Empty response from streaming API');
                    return accumulated;
                } catch (e) {
                    lastError = e;
                    if (e.message.includes('Invalid API key') || e.message.includes('permission denied')) throw e;
                    if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }
        throw lastError || new Error('[Groq] All API keys and retries exhausted');
    }

    async function callGroqAPI(prompt, maxRetries = 3) {
        const rawText = await callGroqAPIRaw(prompt, maxRetries);
        return extractJSON(rawText);
    }

    function parseTextLines(text, expectedLineCount) {
        let cleaned = text.replace(/```[a-z]*\s*/gi, '').replace(/```\s*/g, '').trim();
        const lines = cleaned.split('\n');

        if (lines.length === expectedLineCount) {
            return lines;
        }

        if (lines.length > expectedLineCount) {
            return lines.slice(-expectedLineCount);
        }

        while (lines.length < expectedLineCount) {
            lines.push('');
        }

        return lines;
    }

    function extractJSON(text) {
        let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

        try {
            return JSON.parse(cleaned);
        } catch {
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[0]);
                } catch { }
            }
        }
        return null;
    }

    // ============================================
    // Main Addon Object
    // ============================================

    const GroqAddon = {
        ...ADDON_INFO,

        getSettingsUI() {
            const React = Spicetify.React;
            const { useState, useEffect, useCallback } = React;

            return function GroqSettings() {
                const initialApiKeys = getSetting('api-keys', '') || getSetting('api-key', '');
                const [apiKeys, setApiKeys] = useState(
                    Array.isArray(initialApiKeys) ? JSON.stringify(initialApiKeys) : initialApiKeys
                );
                const [selectedModel, setSelectedModel] = useState(getSetting('model', 'llama-3.3-70b-versatile'));
                const [availableModels, setAvailableModels] = useState([]);
                const [modelsLoading, setModelsLoading] = useState(false);
                const [testStatus, setTestStatus] = useState('');

                const loadModels = useCallback(async () => {
                    const keys = getApiKeys();
                    if (keys.length === 0) {
                        setAvailableModels([]);
                        return;
                    }
                    setModelsLoading(true);
                    try {
                        const models = await fetchAvailableModels(keys[0]);
                        setAvailableModels(models);
                    } catch (e) {
                        console.error('[Groq Addon] Failed to load models:', e);
                    }
                    setModelsLoading(false);
                }, [apiKeys]);

                useEffect(() => {
                    const keys = getApiKeys();
                    if (keys.length > 0) {
                        loadModels();
                    } else {
                        setAvailableModels([]);
                    }
                }, [apiKeys]);

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
                        const result = await callGroqAPIRaw('Say "Hello" in one word.');
                        setTestStatus(result ? '✓ Connection successful' : '✗ Empty response');
                    } catch (e) {
                        setTestStatus(`✗ ${e.message}`);
                    }
                };



                const hasApiKey = getApiKeys().length > 0;

                return React.createElement('div', { className: 'ai-addon-settings groq-settings' },
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'API Key(s)'),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('input', {
                                type: 'text',
                                value: apiKeys,
                                onChange: handleApiKeyChange,
                                placeholder: 'gsk_... (multiple: ["key1", "key2"])'
                            }),
                            React.createElement('button', {
                                onClick: () => window.open(ADDON_INFO.apiKeyUrl, '_blank'),
                                className: 'ai-addon-btn-secondary'
                            }, 'Get API Key (Free)')
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
                        React.createElement('small', null, 'Groq provides free, ultra-fast inference')
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

        async translateLyrics({ text, lang, wantSmartPhonetic, onLine }) {
            if (!text?.trim()) {
                throw new Error('No text provided');
            }

            const expectedLineCount = text.split('\n').length;
            const prompt = wantSmartPhonetic
                ? buildPhoneticPrompt(text, lang)
                : buildTranslationPrompt(text, lang);

            const rawResponse = onLine
                ? await callGroqAPIStream(prompt, onLine)
                : await callGroqAPIRaw(prompt);
            const lines = parseTextLines(rawResponse, expectedLineCount);

            if (wantSmartPhonetic) {
                return { phonetic: lines };
            } else {
                return { translation: lines };
            }
        },

        async translateMetadata({ title, artist, lang }) {
            if (!title || !artist) {
                throw new Error('Title and artist are required');
            }

            const prompt = buildMetadataPrompt(title, artist, lang);
            const result = await callGroqAPI(prompt);

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

        async generateTMI({ title, artist, lang }) {
            if (!title || !artist) {
                throw new Error('Title and artist are required');
            }

            const prompt = buildTMIPrompt(title, artist, lang);
            return await callGroqAPI(prompt);
        }
    };

    // ============================================
    // Registration
    // ============================================

    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(GroqAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();

    window.__ivLyricsDebugLog?.('[Groq Addon] Module loaded');
})();
