/**
 * Gemini AI Addon for ivLyrics
 * Google Gemini AI를 사용한 번역, 발음, TMI 생성
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
        id: 'gemini',
        name: 'Google Gemini',
        author: 'ivLis STUDIO',
        description: {
            ko: 'Google Gemini AI를 사용한 번역, 발음, TMI 생성',
            en: 'Translation, pronunciation, and TMI generation using Google Gemini AI',
            ja: 'Google Gemini AIを使用した翻訳、発音、TMI生成',
            'zh-CN': '使用 Google Gemini AI 进行翻译、发音和 TMI 生成',
        },
        version: '1.0.0',
        apiKeyUrl: 'https://aistudio.google.com/apikey',
        // 지원 기능
        supports: {
            translate: true,    // 가사 번역/발음
            metadata: true,     // 메타데이터 번역
            tmi: true,          // TMI 생성
            characterPronunciation: true
        },
        // 하드코딩된 모델 목록 (fallback용)
        // models: [
        //     { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', default: true },
        //     { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
        //     { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
        //     { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        //     { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
        // ]
        models: [] // API에서 동적으로 로드
    };

    /**
     * Gemini API에서 사용 가능한 모델 목록을 가져옴 (텍스트 생성용 모델만)
     */
    async function fetchAvailableModels(apiKey, baseUrl) {
        if (!apiKey) return [];

        try {
            const endpoint = `${(baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')}/models?key=${encodeURIComponent(apiKey)}`;
            const response = await fetch(endpoint);

            if (!response.ok) {
                window.__ivLyricsDebugLog?.('[Gemini Addon] Failed to fetch models:', response.status);
                return [];
            }

            const data = await response.json();
            const models = (data.models || [])
                // 텍스트 생성 지원 모델만 필터링
                .filter(m => {
                    if (!m.name) return false;
                    // generateContent 지원 필수
                    if (!m.supportedGenerationMethods?.includes('generateContent')) return false;
                    // gemini 모델만
                    const id = m.name.replace('models/', '');
                    if (!id.startsWith('gemini')) return false;
                    // 이미지/비전 전용 모델 제외
                    if (id.includes('vision') && !id.includes('pro')) return false;
                    // embedding 모델 제외
                    if (id.includes('embedding')) return false;
                    // imagen 모델 제외
                    if (id.includes('imagen')) return false;
                    if (id.includes('image')) return false;
                    // AQA 모델 제외 (질문응답 전용)
                    if (id.includes('aqa')) return false;
                    // robotics 모델 제외
                    if (id.includes('robotics')) return false;
                    // tts 모델 제외
                    if (id.includes('tts')) return false;
                    // exp 모델 제외
                    if (id.includes('exp')) return false;
                    // computer 모델 제외
                    if (id.includes('computer')) return false;
                    return true;
                })
                .map(m => {
                    const id = m.name.replace('models/', '');
                    return {
                        id: id,
                        name: m.displayName || id,
                        description: m.description || ''
                    };
                })
                .sort((a, b) => {
                    // 최신 버전 우선 정렬
                    const aNum = parseFloat(a.id.match(/[\d.]+/)?.[0] || '0');
                    const bNum = parseFloat(b.id.match(/[\d.]+/)?.[0] || '0');
                    if (bNum !== aNum) return bNum - aNum;
                    // flash가 pro보다 먼저
                    if (a.id.includes('flash') && !b.id.includes('flash')) return -1;
                    if (!a.id.includes('flash') && b.id.includes('flash')) return 1;
                    return a.id.localeCompare(b.id);
                });

            // 첫 번째 모델을 기본값으로 설정
            if (models.length > 0) {
                models[0].default = true;
            }

            return models;
        } catch (e) {
            window.__ivLyricsDebugLog?.('[Gemini Addon] Error fetching models:', e.message);
            return [];
        }
    }

    /**
     * 모델 목록 가져오기 (매번 API에서 로드)
     */
    async function getModels() {
        const apiKeys = getApiKeys();
        const baseUrl = getSetting('base-url', 'https://generativelanguage.googleapis.com/v1beta');
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
        'sv': { name: 'Swedish', native: 'Svenska', phoneticDesc: 'Swedish phonetic spelling' },
        'pt': { name: 'Portuguese', native: 'Português', phoneticDesc: 'Portuguese phonetic spelling' },
        'bn': { name: 'Bengali', native: 'বাংলা', phoneticDesc: 'Bengali script pronunciation' },
        'it': { name: 'Italian', native: 'Italiano', phoneticDesc: 'Italian phonetic spelling' },
        'th': { name: 'Thai', native: 'ไทย', phoneticDesc: 'Thai script pronunciation' },
        'vi': { name: 'Vietnamese', native: 'Tiếng Việt', phoneticDesc: 'Vietnamese phonetic spelling' },
        'id': { name: 'Indonesian', native: 'Bahasa Indonesia', phoneticDesc: 'Indonesian phonetic spelling' },
        'ms': { name: 'Malay', native: 'Bahasa Melayu', phoneticDesc: 'Malay phonetic spelling' }
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
            raw = getSetting('api-key', ''); // 기존 설정 호환
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

    function getSelectedModel() {
        return getSetting('model', null);
    }

    function getBaseUrl() {
        return getSetting('base-url', 'https://generativelanguage.googleapis.com/v1beta') || 'https://generativelanguage.googleapis.com/v1beta';
    }

    function getLangInfo(lang) {
        if (!lang) return LANGUAGE_DATA['en'];
        const shortLang = lang.split('-')[0].toLowerCase();
        return LANGUAGE_DATA[lang] || LANGUAGE_DATA[shortLang] || LANGUAGE_DATA['en'];
    }

    /**
     * Build generationConfig from advanced parameter settings
     */
    function getGenerationConfig() {
        const config = {};

        // maxOutputTokens
        const useMaxTokens = getSetting('adv-maxOutputTokens-enabled', true);
        if (useMaxTokens) {
            config.maxOutputTokens = parseInt(getSetting('adv-maxOutputTokens-value', 20000)) || 20000;
        }

        // thinking config
        const useThinking = getSetting('adv-thinking-enabled', false);
        if (useThinking) {
            const budget = parseInt(getSetting('adv-thinking-budget', 1024)) || 1024;
            config.thinkingConfig = { thinkingBudget: budget };
        } else {
            // Disable thinking to enable true streaming
            config.thinkingConfig = { thinkingBudget: 0 };
        }

        return config;
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

        return `You are a translation API. Translate the song title and artist name to ${langInfo.name} (${langInfo.native}).

**Input**:
- Title: ${title}
- Artist: ${artist}

**Output MUST be valid JSON**:
{
  "translatedTitle": "translated title in ${langInfo.native}",
  "translatedArtist": "translated artist name in ${langInfo.native}",
  "romanizedTitle": "romanized title (Latin alphabet)",
  "romanizedArtist": "romanized artist name (Latin alphabet)"
}

**Rules**:
1. If the title/artist is already in ${langInfo.name}, keep it as-is
2. romanized fields should use Latin alphabet only
3. Do NOT use markdown code blocks`;
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
     * Call Gemini API and return raw text response
     */
    async function callGeminiAPIRaw(prompt, maxRetries = 3) {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) {
            throw new Error('[Gemini] API key is required. Please configure your Gemini API key in settings.');
        }

        const model = getSelectedModel();
        if (!model) {
            throw new Error('[Gemini] Model is not selected. Please select a model in settings.');
        }
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const baseUrl = getBaseUrl();
                    const endpoint = `${baseUrl.replace(/\/$/, '')}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            contents: [{
                                role: 'user',
                                parts: [{ text: prompt }]
                            }],
                            generationConfig: getGenerationConfig()
                        })
                    });

                    if (response.status === 429 || response.status === 403) {
                        window.__ivLyricsDebugLog?.(`[Gemini Addon] API key ${keyIndex + 1} failed (${response.status}), trying next...`);
                        break; // Try next key
                    }

                    if (!response.ok) {
                        // Try to parse error response for better error messages
                        let errorMessage = `HTTP ${response.status}`;
                        try {
                            const errorData = await response.json();
                            if (errorData.error?.message) {
                                errorMessage = errorData.error.message;
                            }
                        } catch (parseError) {
                            // Use default error message if parsing fails
                        }
                        throw new Error(`[Gemini] ${errorMessage}`);
                    }

                    const data = await response.json();
                    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

                    if (!rawText) {
                        throw new Error('[Gemini] Empty response from API');
                    }

                    return rawText;

                } catch (e) {
                    lastError = e;
                    window.__ivLyricsDebugLog?.(`[Gemini Addon] Attempt ${attempt + 1} failed:`, e.message);

                    if (attempt < maxRetries - 1) {
                        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
            }
        }

        throw lastError || new Error('[Gemini] All API keys and retries exhausted');
    }

    async function callGeminiAPIStream(prompt, onLine, maxRetries = 3) {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) throw new Error('[Gemini] API key is required.');
        const model = getSelectedModel();
        if (!model) throw new Error('[Gemini] Model is not selected.');
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const baseUrl = getBaseUrl();
                    const endpoint = `${baseUrl.replace(/\/$/, '')}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ role: 'user', parts: [{ text: prompt }] }],
                            generationConfig: getGenerationConfig()
                        })
                    });

                    if (response.status === 429 || response.status === 403) { break; }
                    if (!response.ok) {
                        let msg = `HTTP ${response.status}`;
                        try { const d = await response.json(); if (d.error?.message) msg = d.error.message; } catch (e) { }
                        throw new Error(`[Gemini] ${msg}`);
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
                            if (!line.startsWith('data: ')) continue;
                            try {
                                const parsed = JSON.parse(line.slice(6));
                                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
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

                    if (!accumulated) throw new Error('[Gemini] Empty response from streaming API');
                    return accumulated;

                } catch (e) {
                    lastError = e;
                    if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }
        throw lastError || new Error('[Gemini] All API keys and retries exhausted');
    }

    /**
     * Call Gemini API and parse JSON response (for metadata, TMI, etc.)
     */
    async function callGeminiAPI(prompt, maxRetries = 3) {
        const rawText = await callGeminiAPIRaw(prompt, maxRetries);
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
        // (AI might add extra text before/after the actual translation)
        if (lines.length > expectedLineCount) {
            // Try to find a contiguous block of expectedLineCount lines
            // that looks most like translated content
            window.__ivLyricsDebugLog?.(`[Gemini Addon] Got ${lines.length} lines, expected ${expectedLineCount}. Trimming...`);

            // Simple heuristic: take the last expectedLineCount lines
            // (AI often adds explanation at the beginning)
            return lines.slice(-expectedLineCount);
        }

        // If we have fewer lines, pad with empty strings
        window.__ivLyricsDebugLog?.(`[Gemini Addon] Got ${lines.length} lines, expected ${expectedLineCount}. Padding...`);
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

    const GeminiAddon = {
        ...ADDON_INFO,

        async init() {
            window.__ivLyricsDebugLog?.(`[Gemini Addon] Initialized (v${ADDON_INFO.version})`);
        },

        /**
         * 연결 테스트 (SettingsUIBuilder/AddonUI에서 사용)
         */
        async testConnection() {
            await callGeminiAPIRaw('Reply with just "OK" if you receive this.');
        },

        getSettingsUI() {
            const React = Spicetify.React;
            const { useState, useCallback, useEffect } = React;

            return function GeminiSettings() {
                const initialApiKeys = getSetting('api-keys', '') || getSetting('api-key', '');
                const [apiKeys, setApiKeys] = useState(
                    Array.isArray(initialApiKeys) ? JSON.stringify(initialApiKeys) : initialApiKeys
                );
                const [baseUrl, setBaseUrl] = useState(getSetting('base-url', 'https://generativelanguage.googleapis.com/v1beta'));
                const [model, setModel] = useState(getSelectedModel());
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
                        // ADDON_INFO.models 업데이트 (다른 곳에서 사용할 수 있도록)
                        ADDON_INFO.models = models;
                    } catch (e) {
                        window.__ivLyricsDebugLog?.('[Gemini Addon] Failed to load models:', e);
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
                    const value = e.target.value;
                    setApiKeys(value);
                    setSetting('api-keys', value);
                }, []);

                const handleBaseUrlChange = useCallback((e) => {
                    const value = e.target.value;
                    setBaseUrl(value);
                    setSetting('base-url', value);
                }, []);

                const handleModelChange = useCallback((e) => {
                    const value = e.target.value;
                    setModel(value);
                    setSetting('model', value);
                }, []);

                const handleRefreshModels = useCallback(() => {
                    loadModels();
                }, [loadModels]);

                const handleTest = useCallback(async () => {
                    setTestStatus('Testing...');
                    try {
                        await callGeminiAPIRaw('Reply with just "OK" if you receive this.');
                        setTestStatus('✓ Connection successful!');
                    } catch (e) {
                        setTestStatus(`✗ Error: ${e.message}`);
                    }
                }, []);



                // ... (existing code for models)

                // ... (existing code for test)

                const hasApiKey = getApiKeys().length > 0;

                return React.createElement('div', { className: 'ai-addon-settings gemini-settings' },
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'API Key(s)'),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('input', {
                                type: 'text',
                                value: apiKeys,
                                onChange: handleApiKeyChange,
                                placeholder: 'AIza... (multiple keys: ["key1", "key2"])'
                            }),
                            React.createElement('button', {
                                onClick: () => window.open(ADDON_INFO.apiKeyUrl, '_blank'),
                                className: 'ai-addon-btn-secondary'
                            }, 'Get API Key')
                        ),
                        React.createElement('small', null, 'Enter a single key or JSON array for rotation')
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'Base URL'),
                        React.createElement('input', {
                            type: 'text',
                            value: baseUrl,
                            onChange: handleBaseUrlChange,
                            placeholder: 'https://generativelanguage.googleapis.com/v1beta'
                        }),
                        React.createElement('small', null, 'Change this to use Gemini-compatible APIs')
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'Model'),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('select', {
                                value: model,
                                onChange: handleModelChange,
                                disabled: modelsLoading
                            },
                                modelsLoading
                                    ? React.createElement('option', { value: '' }, 'Loading models...')
                                    : availableModels.length > 0
                                        ? [
                                            !model && React.createElement('option', { key: '__placeholder__', value: '' }, '-- Select a model --'),
                                            ...availableModels.map(m => React.createElement('option', { key: m.id, value: m.id }, m.name))
                                        ].filter(Boolean)
                                        : React.createElement('option', { value: '' }, hasApiKey ? 'No models found' : 'Enter API key first')
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
                const [maxTokensEnabled, setMaxTokensEnabled] = useState(getSetting('adv-maxOutputTokens-enabled', true));
                const [maxTokensValue, setMaxTokensValue] = useState(getSetting('adv-maxOutputTokens-value', 20000));
                const [thinkingEnabled, setThinkingEnabled] = useState(getSetting('adv-thinking-enabled', false));
                const [thinkingBudget, setThinkingBudget] = useState(getSetting('adv-thinking-budget', 1024));

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
                        // Max Output Tokens
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                            React.createElement('input', {
                                type: 'checkbox', checked: maxTokensEnabled,
                                onChange: (e) => { setMaxTokensEnabled(e.target.checked); setSetting('adv-maxOutputTokens-enabled', e.target.checked); }
                            }),
                            React.createElement('span', { style: { fontSize: '12px', minWidth: '110px' } }, 'Max Output Tokens'),
                            React.createElement('input', {
                                type: 'number', value: maxTokensValue, disabled: !maxTokensEnabled,
                                style: { width: '80px', fontSize: '12px' },
                                onChange: (e) => { const v = parseInt(e.target.value) || 20000; setMaxTokensValue(v); setSetting('adv-maxOutputTokens-value', v); }
                            })
                        ),
                        // Thinking
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                            React.createElement('input', {
                                type: 'checkbox', checked: thinkingEnabled,
                                onChange: (e) => { setThinkingEnabled(e.target.checked); setSetting('adv-thinking-enabled', e.target.checked); }
                            }),
                            React.createElement('span', { style: { fontSize: '12px', minWidth: '110px' } }, 'Thinking'),
                            React.createElement('input', {
                                type: 'number', value: thinkingBudget, disabled: !thinkingEnabled,
                                style: { width: '80px', fontSize: '12px' },
                                placeholder: 'Budget',
                                onChange: (e) => { const v = parseInt(e.target.value) || 1024; setThinkingBudget(v); setSetting('adv-thinking-budget', v); }
                            })
                        ),
                        React.createElement('small', { style: { opacity: 0.5, fontSize: '11px' } }, 'Uncheck to exclude parameter from API request. Thinking OFF enables real-time streaming.')
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
                ? await callGeminiAPIStream(prompt, onLine)
                : await callGeminiAPIRaw(prompt);
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
            const result = await callGeminiAPI(prompt);
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
            const result = await callGeminiAPI(prompt);

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
            return await callGeminiAPI(prompt);
        }
    };

    // ============================================
    // Registration
    // ============================================

    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(GeminiAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();

    window.__ivLyricsDebugLog?.('[Gemini Addon] Module loaded');
})();
