/**
 * Pollinations.ai AI Addon for ivLyrics
 * Pollinations.ai를 사용한 번역, 발음, TMI 생성 (무료 API)
 * 
 * @author ivLis STUDIO
 * @version 1.1.0
 */

(() => {
    'use strict';

    // ============================================
    // Addon Metadata
    // ============================================

    const ADDON_INFO = {
        id: 'pollinations',
        name: 'Pollinations.ai',
        author: 'ivLis STUDIO',
        description: {
            ko: 'Pollinations.ai를 사용한 번역, 발음, TMI 생성 (API 키 필요)',
            en: 'Translation, pronunciation, and TMI generation using Pollinations.ai (API Key Required)',
            ja: 'Pollinations.aiを使用した翻訳、発音、TMI生成（APIキー必要）',
            'zh-CN': '使用 Pollinations.ai 进行翻译、发音和 TMI 生成（需要 API 密钥）',
        },
        version: '1.1.0',
        apiKeyUrl: 'https://enter.pollinations.ai',
        // 지원 기능
        supports: {
            translate: true,    // 가사 번역/발음
            metadata: true,     // 메타데이터 번역
            tmi: true,
            characterPronunciation: true
        },
        models: [] // API에서 동적으로 로드
    };

    // API 기본 URL
    const BASE_URL = 'https://gen.pollinations.ai';
    const AUTH_BASE_URL = 'https://enter.pollinations.ai';

    // Publishable Pollinations App Key (pk_...) for BYOP.
    // Keep this empty for marketplace/user-added builds; it can be configured in the addon settings.
    const DEFAULT_CLIENT_ID = 'pk_r7hWynUBrOgSV9SJ';
    const DEFAULT_AUTH_SCOPE = 'generate';
    const FIXED_MODEL = 'gemini-fast';
    const DEFAULT_AUTH_BUDGET = 999;
    const DEFAULT_AUTH_EXPIRY_DAYS = 365;
    const DEVICE_POLL_INTERVAL_MS = 5000;

    /**
     * Pollinations.ai API에서 사용 가능한 모델 목록을 가져옴 (텍스트 생성용 모델만)
     */
    async function fetchAvailableModels(apiKey = getPrimaryApiKey()) {
        try {
            const response = await fetch(`${BASE_URL}/v1/models`, {
                headers: buildAuthHeaders(apiKey)
            });

            if (!response.ok) {
                window.__ivLyricsDebugLog?.('[Pollinations Addon] Failed to fetch models:', response.status);
                return [];
            }

            const data = await response.json();

            // 오디오 전용 모델 제외
            const excludePatterns = ['audio', 'midijourney'];

            const models = (data.data || [])
                .filter(m => {
                    if (!m.id) return false;
                    const id = m.id.toLowerCase();
                    // 제외 패턴 체크
                    for (const pattern of excludePatterns) {
                        if (id.includes(pattern)) return false;
                    }
                    return true;
                })
                .map(m => ({
                    id: m.id,
                    name: m.id,
                }))
                // 인기 모델 우선 정렬
                .sort((a, b) => {
                    const priority = ['openai', 'gemini', 'claude', 'deepseek', 'mistral', 'grok', 'qwen', 'perplexity'];
                    const aIdx = priority.findIndex(p => a.id.includes(p));
                    const bIdx = priority.findIndex(p => b.id.includes(p));
                    const aPri = aIdx === -1 ? 999 : aIdx;
                    const bPri = bIdx === -1 ? 999 : bIdx;
                    if (aPri !== bPri) return aPri - bPri;
                    return a.id.localeCompare(b.id);
                });

            // 첫 번째 모델을 기본값으로 설정
            if (models.length > 0) {
                models[0].default = true;
            }

            return models;
        } catch (e) {
            window.__ivLyricsDebugLog?.('[Pollinations Addon] Error fetching models:', e.message);
            return [];
        }
    }

    /**
     * 모델 목록 가져오기 (매번 API에서 로드)
     */
    async function getModels() {
        return await fetchAvailableModels(getPrimaryApiKey());
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
        'sv': { name: 'Swedish', native: 'Svenska', phoneticDesc: 'Swedish phonetic spelling' },
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
        // Pollinations.ai는 API 키가 선택적 (무료 사용 가능)
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

    function getPrimaryApiKey() {
        return getApiKeys()[0] || '';
    }

    function buildAuthHeaders(apiKey = getPrimaryApiKey()) {
        return apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
    }

    function getClientId() {
        return DEFAULT_CLIENT_ID;
    }

    function maskKey(key) {
        if (!key) return '';
        if (key.length <= 12) return 'configured';
        return `${key.slice(0, 5)}...${key.slice(-4)}`;
    }

    function validateClientId() {
        const clientId = getClientId();
        if (clientId && !clientId.startsWith('pk_')) {
            throw new Error('[Pollinations.ai] App Key must be a publishable pk_ key. Never use sk_ as client_id.');
        }
        return clientId;
    }

    function normalizePollinationsUrl(url) {
        if (!url) return `${AUTH_BASE_URL}/device`;
        if (/^https?:\/\//i.test(url)) return url;
        return `${AUTH_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
    }

    async function requestDeviceCode() {
        const body = {
            client_id: validateClientId()
        };

        const response = await fetch(`${AUTH_BASE_URL}/api/device/code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(`[Pollinations.ai] ${data.error_description || data.error || data.message || `HTTP ${response.status}`}`);
        }

        if (!data.device_code || !data.user_code) {
            throw new Error('[Pollinations.ai] Device authorization response is missing a code.');
        }

        const verificationUrl = buildDeviceAuthorizeUrl(data.user_code);

        return { ...data, verificationUrl };
    }

    function buildDeviceAuthorizeUrl(userCode) {
        const appKey = validateClientId();
        const params = new URLSearchParams({
            user_code: userCode,
            app_key: appKey,
            scope: DEFAULT_AUTH_SCOPE,
            models: FIXED_MODEL,
            budget: String(DEFAULT_AUTH_BUDGET),
            expiry: String(DEFAULT_AUTH_EXPIRY_DAYS)
        });
        return `${AUTH_BASE_URL}/authorize?${params.toString()}`;
    }

    async function pollDeviceToken(deviceCode) {
        const response = await fetch(`${AUTH_BASE_URL}/api/device/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code: deviceCode })
        });

        const data = await response.json().catch(() => ({}));

        if (data.error === 'authorization_pending' || data.error === 'slow_down') {
            return { pending: true, slowDown: data.error === 'slow_down' };
        }

        if (!response.ok || data.error) {
            throw new Error(`[Pollinations.ai] ${data.error_description || data.error || data.message || `HTTP ${response.status}`}`);
        }

        if (!data.access_token) {
            throw new Error('[Pollinations.ai] Device authorization completed without an access token.');
        }

        return data;
    }

    function storePollinationsAccessToken(accessToken) {
        setSetting('api-keys', accessToken);
        setSetting('api-key', '');
        setSetting('auth-status', 'Connected through Pollinations device login.');
    }

    function disconnectPollinationsAuth() {
        setSetting('api-keys', '');
        setSetting('api-key', '');
        setSetting('auth-status', 'Disconnected.');
    }

    async function fetchApiKeyInfo(apiKey = getPrimaryApiKey()) {
        if (!apiKey) return null;

        const response = await fetch(`${BASE_URL}/account/key`, {
            headers: buildAuthHeaders(apiKey)
        });

        if (!response.ok) {
            let message = `HTTP ${response.status}`;
            try {
                const data = await response.json();
                message = data.error?.message || data.message || message;
            } catch (e) { }
            throw new Error(`[Pollinations.ai] ${message}`);
        }

        return await response.json();
    }

    function getSelectedModel() {
        return FIXED_MODEL;
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

    function buildCharacterPronunciationPrompt(lines, lang = 'ko', sourceLang = 'auto', unitMode = 'char') {
        const safeLines = (Array.isArray(lines) ? lines : []).map(line => String(line ?? ''));
        const langInfo = getLangInfo(lang);
        const isWordMode = unitMode === 'word';
        const payload = safeLines.map((text, index) => {
            const chars = Array.from(text);
            return isWordMode
                ? { i: index, t: text, n: chars.length }
                : { i: index, a: chars, n: chars.length };
        });
        const outputRules = isWordMode
            ? `- Output compact JSON only: top key l; each line has i and u; each pronunciation item has s=start character index, e=end character index, and p=whole word pronunciation.
- Split each line by whitespace into word/token ranges. Do not split alphabetic words into letters.
- Omit whitespace and punctuation-only tokens from u to save tokens.
- p must be one natural spoken pronunciation for the whole word/token in ${langInfo.native}.`
            : `- Output compact JSON only: top key l; each line has i and p.
- p must be an array of exactly n strings, one per input character a[index].
- If n is 12, p must contain exactly 12 strings. An array with 11 or 13 strings is invalid even if the pronunciation sounds correct.
- Use an empty string for characters with no separate pronunciation. Do not omit array slots.
- Each p[index] must be short and readable in ${langInfo.native}.`;
        const alignmentRules = isWordMode
            ? `- For alphabetic and whitespace-separated languages, convert each whole word to spoken pronunciation once. Do not assign syllables to individual letters.
- Example: English "hello" should be one unit like {"s":0,"e":4,"p":"??"}, not h=?/e=?/l=?.
- For contractions, liaison, vowel reduction, doubled consonants, and connected-speech effects, prefer natural sung pronunciation over literal spelling.`
            : `- For alphabetic languages, do not spell letters one by one. Convert words to spoken pronunciation first, then place that sound into the matching source character slots.
- For digraphs or combined letters (sh, ch, th, ph, qu, ll, etc.), put the combined sound in one source character slot and leave helper slots empty if needed.
- For silent letters, use an empty string in that source character slot.
- For contractions, liaison, vowel reduction, doubled consonants, and other connected-speech effects, prefer natural sung pronunciation over literal spelling.`;
        const outputShape = isWordMode
            ? '{"l":[{"i":0,"u":[{"s":0,"e":4,"p":"??"}]}]}'
            : '{"l":[{"i":0,"p":["?"]}]}';

        return `You are a multilingual lyrics pronunciation aligner for karaoke sync editing.

Task:
- Read each full lyric line first, infer the natural pronunciation in context for the input source language (${sourceLang}), then align that sound back onto the original lyric text for karaoke timing.
- Return ${isWordMode ? 'word-level' : 'character-level'} pronunciation hints in ${langInfo.name} (${langInfo.native}), not a meaning translation.
- Do NOT pronounce each character in isolation. The output must sound natural when the character hints are read in sequence.

Rules:
- Return ONLY valid JSON. No markdown, no code fences, no explanations.
- The first response character must be { and the last response character must be }. Never wrap JSON in markdown fences.
- Preserve every line index.
- Input uses compact keys: i=line index and n=character count. In character mode, a is the exact source character array and output p must align to a by array position. In word mode, t is the line text.
- In character mode, never output c or index-numbered pronunciation items. Output p as exactly n strings. p[k] is the pronunciation for source character a[k], and may contain multiple target syllables or be empty.
${outputRules}
${alignmentRules}
- For syllabic scripts, align by natural syllable sound while keeping exactly one p array slot per source character.
- For logographic scripts such as hanzi/kanji/hanja, infer the common reading from the word and put each source character's reading in that character's p slot. If a character has no separate sound, use an empty string.
- For mixed writing systems, keep pronounced suffix/helper characters aligned to their own source characters. Do not hide a following character's sound inside the previous base character.
- For Japanese specifically, handle kanji, okurigana, small kana, and sound changes naturally:
  - Never shift readings after small kana or ん. Each p array slot is tied to the exact original source character at the same array position.
  - In character mode, keep timing alignment per source character. Do not merge ordinary kana/okurigana into the previous kanji.
  - For okurigana, put its spoken sound on that kana. Example: 高く => 高=타카, く=쿠; 急ぎ => 急=이소, ぎ=기; 懐かしい => 懐=나츠, か=카, し=시, い=이.
  - Do not compress several source characters into one p slot. Example for a=["耐","え","難","い"]: p=["타","에","가타","이"], not ["타에","","가","타이"].
  - small っ should be a geminated consonant or brief stop, not つ. Example: のって => の=노, っ=ㅅ, て=데.
  - small ゃ/ゅ/ょ should combine with the previous kana; leave the small kana itself empty/omitted unless the target writing system truly needs a separate mark.
  - ん should use the context-sensitive nasal sound at the ん character itself. Do not put the next character's pronunciation on ん.
  - Correct Korean-target p array example for a=["爺","ち","ゃ","ん","婆","ち","ゃ","ん","久","し","ぶ","り"]: p=["지이","챠","","안","바","챠","","안","히","사","부","리"].
  - long vowels and vowel sequences such as ー, おう, えい, ああ should preserve length naturally.
  - particles は, へ, を should use the particle pronunciation when clearly used as particles.
Korean target examples:
${isWordMode ? '- In word mode, return English examples as whole u items per word, never as character-level p arrays.' : ''}
- English "night" should sound like "나이트", not "엔 아이 지 에이치 티". Example split: n=나, i=이, t=트; omit silent g/h.
- English "the" should sound like "더", not "티 에이치 이". Example split: t=더; omit helper h/e.
- のって should be close to "노ㅅ데" or "노옷데", not "노 츠 테". Example split: の=노, っ=ㅅ, て=데.
- 爺ちゃん should be close to "지이챠안", not "지 치 야 응". Example split: 爺=지이, ち=챠, ん=안; omit helper ゃ.

Return this compact JSON shape:
${outputShape}

Input source language: ${sourceLang}
Pronunciation unit mode: ${unitMode}
Input lines:
${JSON.stringify(payload)}`;
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

LANGUAGE REQUIREMENT - FOLLOW STRICTLY:
- Write ALL human-readable content in ${langInfo.name} (${langInfo.native})
- This includes track.description and every string inside track.trivia
- Do NOT write explanatory sentences in English unless the target language itself is English
- Even if the song title, artist name, album, or source pages are English, your explanation sentences must still be in ${langInfo.native}
- The only text that may remain non-${langInfo.native} is:
  1. JSON keys
  2. URLs
  3. Proper nouns, official song titles, artist names, album names, and short quoted lyric fragments
  4. reliability.confidence enum values: "very_high", "high", "medium", "low", "none"

Before returning, silently verify:
- track.description is fully written in ${langInfo.native}
- every item in track.trivia is fully written in ${langInfo.native}
- if any sentence is mostly English, rewrite it into natural ${langInfo.native} before returning

Return ONLY valid JSON. Do not add any text before or after the JSON.

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
1. description: write 2-3 natural sentences in ${langInfo.native}
2. trivia: include 3-5 concise facts, each written in ${langInfo.native}
3. Prefer natural ${langInfo.native} wording, not mixed-language fragments
4. Be accurate - if you're not sure about a fact, mark confidence as "low"
5. Do NOT use markdown code blocks
6. Do NOT add any explanation outside the JSON`;
    }

    // ============================================
    // API Call Functions
    // ============================================

    /**
     * Call Pollinations.ai API and return raw text response
     */
    async function callPollinationsAPIRaw(prompt, maxRetries = 3) {
        const model = getSelectedModel();
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) {
            throw new Error('[Pollinations.ai] Connect your Pollinations account in settings first.');
        }
        let lastError = null;

        // API 키가 없으면 키 없이 시도
        const keysToTry = apiKeys;

        for (let keyIndex = 0; keyIndex < keysToTry.length; keyIndex++) {
            const apiKey = keysToTry[keyIndex];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const endpoint = `${BASE_URL}/v1/chat/completions`;

                    const headers = {
                        'Content-Type': 'application/json',
                    };

                    // API 키가 있으면 추가 (선택적)
                    if (apiKey) {
                        headers['Authorization'] = `Bearer ${apiKey}`;
                    }

                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            model: model,
                            messages: [
                                { role: 'user', content: prompt }
                            ],
                            ...getAdvancedRequestParams()
                        })
                    });

                    if (response.status === 429 || response.status === 403) {
                        if (apiKey) {
                            window.__ivLyricsDebugLog?.(`[Pollinations Addon] API key ${keyIndex + 1} failed (${response.status}), trying next...`);
                        }
                        break; // Try next key
                    }

                    if (!response.ok) {
                        let errorMessage = `HTTP ${response.status}`;
                        try {
                            const errorData = await response.json();
                            if (errorData.error?.message) {
                                errorMessage = errorData.error.message;
                            } else if (errorData.message) {
                                errorMessage = errorData.message;
                            }
                        } catch (parseError) { }
                        throw new Error(`[Pollinations.ai] ${errorMessage}`);
                    }

                    const data = await response.json();
                    const rawText = data.choices?.[0]?.message?.content || '';

                    if (!rawText) {
                        throw new Error('[Pollinations.ai] Empty response from API');
                    }

                    return rawText;

                } catch (e) {
                    lastError = e;
                    window.__ivLyricsDebugLog?.(`[Pollinations Addon] Attempt ${attempt + 1} failed:`, e.message);

                    if (attempt < maxRetries - 1) {
                        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
            }
        }

        throw lastError || new Error('[Pollinations.ai] All API keys and retries exhausted');
    }

    async function callPollinationsAPIStream(prompt, onLine, maxRetries = 3) {
        const model = getSelectedModel();
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) {
            throw new Error('[Pollinations.ai] Connect your Pollinations account in settings first.');
        }
        let lastError = null;
        const keysToTry = apiKeys;

        for (let keyIndex = 0; keyIndex < keysToTry.length; keyIndex++) {
            const apiKey = keysToTry[keyIndex];
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const endpoint = `${BASE_URL}/v1/chat/completions`;
                    const headers = { 'Content-Type': 'application/json' };
                    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], ...getAdvancedRequestParams(), stream: true })
                    });
                    if (response.status === 429 || response.status === 403) { break; }
                    if (!response.ok) {
                        let msg = `HTTP ${response.status}`;
                        try { const d = await response.json(); if (d.error?.message) msg = d.error.message; else if (d.message) msg = d.message; } catch (e) { }
                        throw new Error(`[Pollinations.ai] ${msg}`);
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
                    if (!accumulated) throw new Error('[Pollinations.ai] Empty response from streaming API');
                    return accumulated;
                } catch (e) {
                    lastError = e;
                    if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }
        throw lastError || new Error('[Pollinations.ai] All retries exhausted');
    }

    /**
     * Call Pollinations.ai API and parse JSON response (for metadata, TMI, etc.)
     */
    async function callPollinationsAPI(prompt, maxRetries = 3) {
        const rawText = await callPollinationsAPIRaw(prompt, maxRetries);
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
            window.__ivLyricsDebugLog?.(`[Pollinations Addon] Got ${lines.length} lines, expected ${expectedLineCount}. Trimming...`);
            return lines.slice(-expectedLineCount);
        }

        // If we have fewer lines, pad with empty strings
        window.__ivLyricsDebugLog?.(`[Pollinations Addon] Got ${lines.length} lines, expected ${expectedLineCount}. Padding...`);
        while (lines.length < expectedLineCount) {
            lines.push('');
        }

        return lines;
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

    const PollinationsAddon = {
        ...ADDON_INFO,

        async init() {
            window.__ivLyricsDebugLog?.(`[Pollinations Addon] Initialized (v${ADDON_INFO.version})`);
        },

        /**
         * 연결 테스트
         */
        async testConnection() {
            await callPollinationsAPIRaw('Reply with just "OK" if you receive this.');
        },

        getSettingsUI() {
            const React = Spicetify.React;
            const { useState, useCallback, useEffect } = React;

            return function PollinationsSettings() {
                const initialApiKeys = getSetting('api-keys', '') || getSetting('api-key', '');
                const [apiKeys, setApiKeys] = useState(
                    Array.isArray(initialApiKeys) ? JSON.stringify(initialApiKeys) : initialApiKeys
                );
                const [authStatus, setAuthStatus] = useState(getSetting('auth-status', ''));
                const [testStatus, setTestStatus] = useState('');
                const [keyInfo, setKeyInfo] = useState(null);
                const [keyInfoLoading, setKeyInfoLoading] = useState(false);
                const [deviceAuth, setDeviceAuth] = useState(null);
                const [isConnecting, setIsConnecting] = useState(false);
                const [manualExpanded, setManualExpanded] = useState(false);
                const hasApiKey = getApiKeys().length > 0;

                // 모델 목록 로드
                const loadKeyInfo = useCallback(async () => {
                    const apiKey = getPrimaryApiKey();
                    if (!apiKey) {
                        setKeyInfo(null);
                        return;
                    }

                    setKeyInfoLoading(true);
                    try {
                        const info = await fetchApiKeyInfo(apiKey);
                        setKeyInfo(info);
                    } catch (e) {
                        window.__ivLyricsDebugLog?.('[Pollinations Addon] Failed to load key info:', e.message);
                        setKeyInfo(null);
                    } finally {
                        setKeyInfoLoading(false);
                    }
                }, [apiKeys]);

                // 컴포넌트 마운트시 모델 목록 로드
                useEffect(() => {
                    loadKeyInfo();
                }, [apiKeys]);

                const handleApiKeyChange = useCallback((e) => {
                    const value = e.target.value;
                    setApiKeys(value);
                    setSetting('api-keys', value);
                    setSetting('api-key', '');
                    setAuthStatus(value ? 'Manual access key configured.' : 'Manual access key cleared.');
                }, []);

                const handleConnect = useCallback(async () => {
                    let authWindow = null;
                    try {
                        setIsConnecting(true);
                        setDeviceAuth(null);
                        setAuthStatus('Requesting Pollinations login code...');

                        try {
                            authWindow = window.open('about:blank', '_blank');
                        } catch (e) { }

                        const device = await requestDeviceCode();
                        const pollInterval = Math.max(
                            DEVICE_POLL_INTERVAL_MS,
                            Number(device.interval || 0) * 1000
                        );
                        const expiresAt = Date.now() + (Number(device.expires_in || 600) * 1000);

                        setDeviceAuth(device);
                        setAuthStatus(`Open Pollinations and enter code ${device.user_code}. Only ${FIXED_MODEL} is requested; clear Budget and Expiry there for unlimited access.`);

                        if (authWindow) {
                            authWindow.location.href = device.verificationUrl;
                        } else {
                            window.open(device.verificationUrl, '_blank');
                        }

                        while (Date.now() < expiresAt) {
                            await new Promise(resolve => setTimeout(resolve, pollInterval));
                            const tokenData = await pollDeviceToken(device.device_code);
                            if (tokenData.pending) continue;

                            storePollinationsAccessToken(tokenData.access_token);
                            setApiKeys(tokenData.access_token);
                            setAuthStatus('Connected through Pollinations login.');
                            setDeviceAuth(null);
                            await loadKeyInfo();
                            return;
                        }

                        throw new Error('[Pollinations.ai] Login timed out. Please try again.');
                    } catch (e) {
                        if (authWindow && !authWindow.closed) {
                            try { authWindow.close(); } catch (closeError) { }
                        }
                        setAuthStatus(e.message);
                    } finally {
                        setIsConnecting(false);
                    }
                }, [loadKeyInfo]);

                const handleDisconnect = useCallback(() => {
                    disconnectPollinationsAuth();
                    setApiKeys('');
                    setAuthStatus('Disconnected.');
                    setKeyInfo(null);
                    setTestStatus('');
                }, []);

                const handleTest = useCallback(async () => {
                    setTestStatus('Testing...');
                    try {
                        await callPollinationsAPIRaw('Reply with just "OK" if you receive this.');
                        setTestStatus('Connection successful.');
                        loadKeyInfo();
                    } catch (e) {
                        setTestStatus(`Error: ${e.message}`);
                    }
                }, [loadKeyInfo]);



                const keyStatusText = hasApiKey
                    ? `Connected key: ${maskKey(getPrimaryApiKey())}`
                    : 'Not connected. Sign in to Pollinations to create a scoped user key.';
                const keyInfoText = keyInfo
                    ? `${keyInfo.valid ? 'Valid' : 'Invalid'} ${keyInfo.type || 'API'} key${keyInfo.expiresIn ? `, expires in ${Math.ceil(keyInfo.expiresIn / 86400)} day(s)` : ''}`
                    : keyInfoLoading ? 'Checking key...' : '';
                const baseButtonStyle = {
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '36px',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                    cursor: isConnecting ? 'default' : 'pointer',
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease'
                };
                const primaryButtonStyle = {
                    ...baseButtonStyle,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: isConnecting ? 'rgba(255,255,255,0.16)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                    color: '#07130a',
                    boxShadow: isConnecting ? 'none' : '0 8px 18px rgba(34,197,94,0.24)',
                    opacity: isConnecting ? 0.7 : 1
                };
                const secondaryButtonStyle = {
                    ...baseButtonStyle,
                    border: '1px solid rgba(255,255,255,0.22)',
                    background: 'rgba(255,255,255,0.08)',
                    color: 'var(--spice-text, #fff)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)'
                };

                return React.createElement('div', { className: 'ai-addon-settings pollinations-settings' },
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'Pollinations Account'),
                        React.createElement('div', { className: 'ai-addon-input-group', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' } },
                            React.createElement('button', {
                                onClick: handleConnect,
                                className: 'ai-addon-btn-primary',
                                disabled: isConnecting,
                                style: primaryButtonStyle
                            }, isConnecting ? 'Waiting for Login...' : hasApiKey ? 'Reconnect Pollinations' : 'Connect Pollinations'),
                            hasApiKey && React.createElement('button', {
                                onClick: handleDisconnect,
                                className: 'ai-addon-btn-secondary',
                                disabled: isConnecting,
                                style: secondaryButtonStyle
                            }, 'Disconnect')
                        ),
                        React.createElement('small', null, authStatus || keyStatusText),
                        deviceAuth && React.createElement('div', { style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                            React.createElement('code', { style: { fontSize: '13px', padding: '7px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.16)' } }, deviceAuth.user_code),
                            React.createElement('button', {
                                onClick: () => window.open(deviceAuth.verificationUrl, '_blank'),
                                className: 'ai-addon-btn-secondary',
                                style: secondaryButtonStyle
                            }, 'Open Login Page')
                        ),
                        keyInfoText && React.createElement('small', { style: { display: 'block', opacity: 0.65 } }, keyInfoText)
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('div', {
                            style: { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', userSelect: 'none' },
                            onClick: () => setManualExpanded(!manualExpanded)
                        },
                            React.createElement('span', { style: { fontSize: '10px', transition: 'transform 0.2s', transform: manualExpanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' } }, '>'),
                            React.createElement('label', { style: { cursor: 'pointer', margin: 0 } }, 'Manual Access Key')
                        ),
                        manualExpanded && React.createElement('div', { style: { marginTop: '8px' } },
                            React.createElement('input', {
                                type: 'password',
                                value: apiKeys,
                                onChange: handleApiKeyChange,
                                placeholder: 'sk_... or ["sk_...", "sk_..."]',
                                autoComplete: 'off'
                            }),
                            React.createElement('small', null, 'Fallback for legacy/manual keys. Pollinations login is preferred.')
                        )
                    ),
                    React.createElement(AdvancedParamsSection),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('button', { onClick: handleTest, className: 'ai-addon-btn-primary', style: primaryButtonStyle }, 'Test Connection'),
                        testStatus && React.createElement('span', {
                            className: `ai-addon-test-status ${testStatus.startsWith('Connection successful') ? 'success' : testStatus.startsWith('Error') ? 'error' : ''}`
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

            // Get raw text response and parse lines
            const rawResponse = onLine
                ? await callPollinationsAPIStream(prompt, onLine)
                : await callPollinationsAPIRaw(prompt);
            const lines = parseTextLines(rawResponse, expectedLineCount);

            // Return in the format expected by LyricsService
            if (wantSmartPhonetic) {
                return { phonetic: lines };
            } else {
                return { translation: lines };
            }
        },

        async generateCharacterPronunciation({ lines, lang = 'ko', sourceLang = 'auto', unitMode = 'char' }) {
            if (!Array.isArray(lines) || lines.length === 0) {
                throw new Error('No lines provided');
            }

            const prompt = buildCharacterPronunciationPrompt(lines, lang, sourceLang, unitMode);
            const result = await callPollinationsAPI(prompt);
            if (!result || !(Array.isArray(result.l) || Array.isArray(result.lines))) {
                throw new Error('Invalid character pronunciation response');
            }
            return result;
        },

        async translateMetadata({ title, artist, lang }) {
            if (!title || !artist) {
                throw new Error('Title and artist are required');
            }

            const prompt = buildMetadataPrompt(title, artist, lang);
            const result = await callPollinationsAPI(prompt);

            // Normalize result to match expected format
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
            return await callPollinationsAPI(prompt);
        }
    };

    // ============================================
    // Registration
    // ============================================

    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(PollinationsAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();

    window.__ivLyricsDebugLog?.('[Pollinations Addon] Module loaded');
})();
