/**
 * ChatGPT AI Addon for ivLyrics
 * OpenAI ChatGPT를 사용한 번역, 발음, TMI 생성
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
        id: 'chatgpt',
        name: 'OpenAI ChatGPT',
        author: 'ivLis STUDIO',
        description: {
            ko: 'OpenAI ChatGPT를 사용한 번역, 발음, TMI 생성 (OpenAI 호환 API 지원)',
            en: 'Translation, pronunciation, and TMI generation using OpenAI ChatGPT (supports OpenAI-compatible APIs)',
            ja: 'OpenAI ChatGPTを使用した翻訳、発音、TMI生成（OpenAI互換API対応）',
            'zh-CN': '使用 OpenAI ChatGPT 进行翻译、发音和 TMI 生成（支持 OpenAI 兼容 API）',
        },
        version: '1.0.0',
        apiKeyUrl: 'https://platform.openai.com/api-keys',
        // 지원 기능
        supports: {
            translate: true,    // 가사 번역/발음
            metadata: true,     // 메타데이터 번역
            tmi: true           // TMI 생성
        },
        // 하드코딩된 모델 목록 (fallback용)
        // models: [
        //     { id: 'gpt-5.2-2025-12-11', name: 'GPT-5.2', default: true },
        //     { id: 'gpt-5-mini-2025-08-07', name: 'GPT-5 Mini' },
        //     { id: 'gpt-5-nano-2025-08-07', name: 'GPT-5 Nano' }
        // ]
        models: [] // API에서 동적으로 로드
    };

    /**
     * OpenAI API에서 사용 가능한 모델 목록을 가져옴 (채팅/텍스트 생성용 모델만)
     */
    async function fetchAvailableModels(apiKey, baseUrl) {
        if (!apiKey) return [];

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
            const endpoint = `${(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/models`;
            const response = await fetch(endpoint, {
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
            const models = (data.data || [])
                .filter(m => {
                    if (!m.id) return false;
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
                .map(m => ({
                    id: m.id,
                    name: m.id,
                    owned_by: m.owned_by || ''
                }))
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
        const baseUrl = getSetting('base-url', 'https://api.openai.com/v1');
        if (apiKeys.length === 0) return [];
        return await fetchAvailableModels(apiKeys[0], baseUrl);
    }

    // ============================================
    // Language Data
    // ============================================

    const LANGUAGE_DATA = {
        'ko': { name: 'Korean', native: '한국어', phoneticDesc: 'Korean Hangul pronunciation (e.g., こんにちは → 콘니치와)' },
        'en': { name: 'English', native: 'English', phoneticDesc: 'English romanization (e.g., こんにちは → konnichiwa)' },
        'zh-CN': { name: 'Simplified Chinese', native: '简体中文', phoneticDesc: 'Chinese characters for pronunciation' },
        'zh-TW': { name: 'Traditional Chinese', native: '繁體中文', phoneticDesc: 'Chinese characters for pronunciation' },
        'ja': { name: 'Japanese', native: '日本語', phoneticDesc: 'Japanese Katakana pronunciation' },
        'hi': { name: 'Hindi', native: 'हिन्दी', phoneticDesc: 'Hindi Devanagari pronunciation' },
        'es': { name: 'Spanish', native: 'Español', phoneticDesc: 'Spanish phonetic spelling' },
        'fr': { name: 'French', native: 'Français', phoneticDesc: 'French phonetic spelling' },
        'ar': { name: 'Arabic', native: 'العربية', phoneticDesc: 'Arabic script pronunciation' },
        'fa': { name: 'Persian', native: 'فارسی', phoneticDesc: 'Persian script pronunciation' },
        'de': { name: 'German', native: 'Deutsch', phoneticDesc: 'German phonetic spelling' },
        'ru': { name: 'Russian', native: 'Русский', phoneticDesc: 'Russian Cyrillic pronunciation' },
        'pt': { name: 'Portuguese', native: 'Português', phoneticDesc: 'Portuguese phonetic spelling' },
        'bn': { name: 'Bengali', native: 'বাংলা', phoneticDesc: 'Bengali script pronunciation' },
        'it': { name: 'Italian', native: 'Italiano', phoneticDesc: 'Italian phonetic spelling' },
        'th': { name: 'Thai', native: 'ไทย', phoneticDesc: 'Thai script pronunciation' },
        'vi': { name: 'Vietnamese', native: 'Tiếng Việt', phoneticDesc: 'Vietnamese phonetic spelling' },
        'id': { name: 'Indonesian', native: 'Bahasa Indonesia', phoneticDesc: 'Indonesian phonetic spelling' }
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

        // 이미 배열인 경우 (getAddonSetting이 JSON 파싱함)
        if (Array.isArray(raw)) {
            return raw
                .map(k => typeof k === 'string' ? k.trim() : '')
                .filter(k => k);
        }

        // 문자열이 아닌 경우
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

    function getBaseUrl() {
        return getSetting('base-url', 'https://api.openai.com/v1') || 'https://api.openai.com/v1';
    }

    function getSelectedModel() {
        return getSetting('model', null);
    }

    function getLangInfo(lang) {
        if (!lang) return LANGUAGE_DATA['en'];
        const shortLang = lang.split('-')[0].toLowerCase();
        return LANGUAGE_DATA[lang] || LANGUAGE_DATA[shortLang] || LANGUAGE_DATA['en'];
    }

    function getDefaultRequestBodyMergePatch() {
        return {
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

    function buildChatGPTRequestBody(model, prompt, { stream = false } = {}) {
        const requestBody = {
            model: model,
            messages: [
                { role: 'user', content: prompt }
            ]
        };

        if (stream) {
            requestBody.stream = true;
        }

        return mergeRequestBody(requestBody, getRequestBodyMergePatch());
    }

    // ============================================
    // Prompt Builders (Plain Text Output - Simplified)
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

    /**
     * Call ChatGPT API and return raw text response
     */
    async function callChatGPTAPIRaw(prompt, maxRetries = 3) {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) {
            throw new Error('[ChatGPT] API key is required. Please configure your API key in settings.');
        }

        const baseUrl = getBaseUrl();
        const model = getSelectedModel();
        if (!model) {
            throw new Error('[ChatGPT] Model is not selected. Please select a model in settings.');
        }
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(buildChatGPTRequestBody(model, prompt))
                    });

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
                    const rawText = data.choices?.[0]?.message?.content || '';

                    if (!rawText) {
                        throw new Error('[ChatGPT] Empty response from API');
                    }

                    return rawText;

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

    async function callChatGPTAPIStream(prompt, onLine, maxRetries = 3) {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) {
            throw new Error('[ChatGPT] API key is required. Please configure your API key in settings.');
        }

        const baseUrl = getBaseUrl();
        const model = getSelectedModel();
        if (!model) {
            throw new Error('[ChatGPT] Model is not selected. Please select a model in settings.');
        }
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(buildChatGPTRequestBody(model, prompt, { stream: true }))
                    });

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

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let sseBuffer = '';
                    let accumulated = '';
                    let emittedLines = 0;

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;

                        sseBuffer += decoder.decode(value, { stream: true });
                        const parts = sseBuffer.split('\n');
                        sseBuffer = parts.pop() || '';

                        for (const line of parts) {
                            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                            try {
                                const parsed = JSON.parse(line.slice(6));
                                const text = parsed.choices?.[0]?.delta?.content || '';
                                if (text) accumulated += text;
                            } catch (e) { }
                        }

                        if (onLine) {
                            const currentLines = accumulated.split('\n');
                            for (let i = emittedLines; i < currentLines.length - 1; i++) {
                                onLine(i, currentLines[i]);
                                emittedLines = i + 1;
                            }
                        }
                    }

                    if (onLine) {
                        const finalLines = accumulated.split('\n');
                        if (finalLines.length > emittedLines) {
                            onLine(emittedLines, finalLines[emittedLines]);
                        }
                    }

                    if (!accumulated) throw new Error('[ChatGPT] Empty response from streaming API');
                    return accumulated;

                } catch (e) {
                    lastError = e;
                    window.__ivLyricsDebugLog?.(`[ChatGPT Addon] Stream attempt ${attempt + 1} failed:`, e.message);
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
    async function callChatGPTAPI(prompt, maxRetries = 3) {
        const rawText = await callChatGPTAPIRaw(prompt, maxRetries);
        return extractJSON(rawText);
    }

    /**
     * Parse plain text lines from API response
     */
    function parseTextLines(text, expectedLineCount) {
        // Remove markdown code blocks if present
        let cleaned = text.replace(/```[a-z]*\s*/gi, '').replace(/```\s*/g, '').trim();

        // Split by newlines
        const lines = cleaned.split('\n');

        // If line count matches, return as-is
        if (lines.length === expectedLineCount) {
            return lines;
        }

        // If we have more lines, try to find the correct block
        if (lines.length > expectedLineCount) {
            window.__ivLyricsDebugLog?.(`[ChatGPT Addon] Got ${lines.length} lines, expected ${expectedLineCount}. Trimming...`);
            return lines.slice(-expectedLineCount);
        }

        // If we have fewer lines, pad with empty strings
        window.__ivLyricsDebugLog?.(`[ChatGPT Addon] Got ${lines.length} lines, expected ${expectedLineCount}. Padding...`);
        while (lines.length < expectedLineCount) {
            lines.push('');
        }

        return lines;
    }

    function extractJSON(text) {
        // Remove markdown code blocks
        let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

        // Try direct parse
        try {
            return JSON.parse(cleaned);
        } catch {
            // Find JSON object in text
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[0]);
                } catch {
                    throw new Error('Failed to parse JSON response');
                }
            }
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
                const [baseUrl, setBaseUrl] = useState(getSetting('base-url', 'https://api.openai.com/v1'));
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
                    setBaseUrl(e.target.value);
                    setSetting('base-url', e.target.value);
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
                    setTestStatus('Testing...');
                    try {
                        await callChatGPTAPIRaw('Reply with just "OK" if you receive this.');
                        setTestStatus('✓ Connection successful!');
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
                        React.createElement('label', null, 'API Key(s)'),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('input', { type: 'text', value: apiKeys, onChange: handleApiKeyChange, placeholder: 'sk-... (multiple: ["key1", "key2"])' }),
                            React.createElement('button', { onClick: () => window.open(ADDON_INFO.apiKeyUrl, '_blank'), className: 'ai-addon-btn-secondary' }, 'Get API Key')
                        ),
                        React.createElement('small', null, 'Enter a single key or JSON array for rotation')
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'Base URL'),
                        React.createElement('input', { type: 'text', value: baseUrl, onChange: handleBaseUrlChange, placeholder: 'https://api.openai.com/v1' }),
                        React.createElement('small', null, 'Change this to use OpenAI-compatible APIs')
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'Model'),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('select', {
                                value: isModelInList ? model : '',
                                onChange: handleModelChange,
                                disabled: modelsLoading
                            },
                                modelsLoading
                                    ? React.createElement('option', { value: '' }, 'Loading models...')
                                    : availableModels.length > 0
                                        ? [
                                            !model && React.createElement('option', { key: '__placeholder__', value: '' }, '-- Select a model --'),
                                            ...availableModels.map(m => React.createElement('option', { key: m.id, value: m.id }, m.name)),
                                            React.createElement('option', { key: 'custom', value: '' }, 'Custom...')
                                        ].filter(Boolean)
                                        : [
                                            React.createElement('option', { key: 'empty', value: '' }, hasApiKey ? 'No models found' : 'Enter API key first'),
                                            React.createElement('option', { key: 'custom', value: '' }, 'Custom...')
                                        ]
                            ),
                            React.createElement('button', {
                                onClick: handleRefreshModels,
                                className: 'ai-addon-btn-secondary',
                                disabled: modelsLoading || !hasApiKey,
                                title: 'Refresh model list'
                            }, modelsLoading ? '...' : '↻')
                        ),
                        availableModels.length > 0 && React.createElement('small', null, `${availableModels.length} models available`)
                    ),
                    (!isModelInList || customModel) &&
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'Custom Model ID'),
                        React.createElement('input', { type: 'text', value: customModel, onChange: handleCustomModelChange, placeholder: 'e.g., gpt-4-turbo' })
                    ),
                    // Advanced API Parameters
                    React.createElement(AdvancedParamsSection)
                    ,
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

        async translateLyrics({ text, lang, wantSmartPhonetic, onLine }) {
            if (!text?.trim()) {
                throw new Error('No text provided');
            }

            const expectedLineCount = text.split('\n').length;
            const prompt = wantSmartPhonetic
                ? buildPhoneticPrompt(text, lang)
                : buildTranslationPrompt(text, lang);

            // Get raw text response and parse lines
            const rawResponse = onLine
                ? await callChatGPTAPIStream(prompt, onLine)
                : await callChatGPTAPIRaw(prompt);
            const lines = parseTextLines(rawResponse, expectedLineCount);

            // Return in the format expected by LyricsService
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

        async generateTMI({ title, artist, lang }) {
            if (!title || !artist) {
                throw new Error('Title and artist are required');
            }

            const prompt = buildTMIPrompt(title, artist, lang);
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

    window.__ivLyricsDebugLog?.('[ChatGPT Addon] Module loaded');
})();
