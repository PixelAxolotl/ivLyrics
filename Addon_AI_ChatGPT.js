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
            tmi: true,          // TMI 생성
            lyricsStudy: true,  // 학습 모드 생성
            characterPronunciation: true
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

        const normalizedBaseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
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
        'sv': { name: 'Swedish', native: 'Svenska', phoneticDesc: 'Swedish phonetic spelling' },
        'pt': { name: 'Portuguese', native: 'Português', phoneticDesc: 'Portuguese phonetic spelling' },
        'bn': { name: 'Bengali', native: 'বাংলা', phoneticDesc: 'Bengali script pronunciation' },
        'cs': { name: 'Czech', native: 'Čeština', phoneticDesc: 'Czech phonetic spelling' },
        'it': { name: 'Italian', native: 'Italiano', phoneticDesc: 'Italian phonetic spelling' },
        'th': { name: 'Thai', native: 'ไทย', phoneticDesc: 'Thai script pronunciation' },
        'tr': { name: 'Turkish', native: 'Türkçe', phoneticDesc: 'Turkish phonetic spelling' },
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
- If an input line contains " / " between simultaneous vocal parts, preserve " / " and translate each part separately
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
- If an input line contains " / " between simultaneous vocal parts, preserve " / " and convert each part separately
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

    function buildLyricsStudyPrompt({ title, artist, targetLang, sourceLang = 'auto', lines = [], category = 'lines', difficulty = 'normal', chunkIndex = 1, chunkTotal = 1 }) {
        const langInfo = getLangInfo(targetLang || 'ko');
        const normalizedDifficulty = ['easy', 'normal', 'hard', 'native'].includes(String(difficulty || '').toLowerCase()) ? String(difficulty || '').toLowerCase() : 'normal';
        const difficultyMap = {
            easy: {
                label: 'Easy',
                guidance: 'Assume a beginner or lower-intermediate learner. Use short explanations, define common words, avoid jargon, and make quiz distractors clearly distinguishable.'
            },
            normal: {
                label: 'Normal',
                guidance: 'Assume an intermediate learner. Balance natural meaning, useful grammar, vocabulary nuance, and practical examples.'
            },
            hard: {
                label: 'Hard',
                guidance: 'Assume an advanced learner. Include finer nuance, grammar contrasts, register, collocation, and more challenging quiz distractors.'
            },
            native: {
                label: 'Native-level',
                guidance: 'Assume a near-native learner. Explain subtle tone, implication, idiom, literary compression, rhythm, and natural alternatives without simplifying too much.'
            }
        };
        const difficultyInfo = difficultyMap[normalizedDifficulty] || difficultyMap.normal;
        const pronunciationGuide = [
            `Use one pronunciation style across every chunk: IPA-style phonetic transcription in Latin/IPA symbols.`,
            `Wrap it in /.../ for phonemic pronunciation or [...] for close phonetic detail.`,
            `Do not write pronunciation in the target language script, and do not use ad-hoc syllable romanization.`,
            `For example, write "like ships in the night" as "/laɪk ʃɪps ɪn ðə naɪt/", not "라이크 쉽스 인 나이트" and not "lie-ku ships in nightu".`,
            `For Japanese lyrics, keep kana/furigana only in "reading"; use IPA-style Latin/IPA symbols in "pronunciation".`
        ].join(" ");
        const payload = lines.map((line) => ({
            index: Number(line.index),
            text: String(line.text || '')
        })).filter((line) => Number.isFinite(line.index) && line.text.trim());
        const normalizedCategory = ['summary', 'lines', 'expressions', 'quiz'].includes(category) ? category : 'lines';
        const categoryRules = {
            summary: `Create only a compact learning-focused song summary. Explain the emotional situation, speaker attitude, and 2-3 language-learning takeaways. Do not create line notes, expressions, or quiz items.`,
            lines: `Create line-level learning cards for every provided lyric line. Keep each explanation short but specific. Include reading and pronunciation when useful. Include 1-2 grammar/pattern notes for each line that has a reusable structure; each note must explain how the pattern works in this lyric.`,
            expressions: `Create only 1-2 vocabulary expansion cards from words or short phrases that actually appear in the provided lyrics. Prefer practical items where learners benefit from alternatives, related words, or forms such as tense, base form, past participle, polite/casual form, particles, or collocations. Do not list many key phrases.`,
            quiz: `Create only 2-4 choice-based quiz items from the provided lyrics. Mix formats using the type field: meaning, blank, usage, rewrite, and grammar. Include fill-in-the-blank items where the question contains ____ and the choices are candidate words or short phrases. Include practical transfer items that ask how a lyric expression would be used or rephrased in everyday conversation, work email, meeting, or other non-lyric context. Do not make every question a literal lyric translation. Distractors must be plausible. Each question must include a lineIndex and should show the actual lyric phrase instead of referring to a line number. Include reading and pronunciation if the question quotes a lyric.`
        };
        const outputShapes = {
            summary: `{
  "summary": "2-3 sentence learning-focused summary in ${langInfo.native}"
}`,
            lines: `{
  "lines": [
    {
      "index": 0,
      "reading": "hiragana/kana reading if the lyric is Japanese; otherwise optional reading aid",
      "pronunciation": "IPA-style pronunciation if useful, e.g. /laɪk ʃɪps/; no local-script or ad-hoc romanization",
      "translation": "natural meaning in ${langInfo.native}",
      "explanation": "line-level explanation in ${langInfo.native}",
      "grammar": [{ "pattern": "reusable structure or grammar point", "explanation": "how it works in this lyric in ${langInfo.native}", "note": "short nuance or usage note in ${langInfo.native}" }],
      "vocabulary": [{ "term": "word", "reading": "hiragana/kana reading if Japanese", "pronunciation": "IPA-style pronunciation if useful", "meaning": "meaning in ${langInfo.native}", "note": "optional note in ${langInfo.native}" }]
    }
  ]
}`,
            expressions: `{
  "keyExpressions": [
    { "expression": "word or short phrase from the lyric", "reading": "hiragana/kana reading if Japanese", "pronunciation": "IPA-style pronunciation if useful", "meaning": "meaning in ${langInfo.native}", "note": "practical learner note in ${langInfo.native}", "alternatives": ["substitutable expression"], "forms": ["base/past/past participle or other useful forms"], "relatedWords": ["similar or related word"], "lineIndexes": [0] }
  ]
}`,
            quiz: `{
  "quiz": [
    { "type": "meaning|blank|usage|rewrite|grammar", "question": "question in ${langInfo.native}; for blank type include ____ where the missing word/phrase goes", "choices": ["A", "B", "C", "D"], "answerIndex": 0, "explanation": "why in ${langInfo.native}", "lineIndex": 0, "reading": "optional", "pronunciation": "optional" }
  ]
}`
        };

        return `You are a language learning tutor inside a lyrics app. Build one category of a compact study pack from the provided song lyrics.

Target explanation language: ${langInfo.name} (${langInfo.native})
Detected/source language: ${sourceLang}
Song: ${title || ''}
Artist: ${artist || ''}
Category: ${normalizedCategory}
Difficulty: ${difficultyInfo.label}
Difficulty guidance: ${difficultyInfo.guidance}
Chunk: ${chunkIndex}/${chunkTotal}

Rules:
- Return ONLY valid JSON. No markdown, no code fences, no extra text.
- Write every human-readable explanation, meaning, question, and quiz explanation in ${langInfo.native}.
- Match the selected difficulty. Easy should be simpler and more scaffolded; hard/native-level should include deeper nuance and more demanding quiz distractors.
- Keep original lyric fragments short. Do not quote long lyric passages.
- Preserve original line indexes exactly.
- Do not refer to "line 3", "3rd line", "N번째 줄", or similar labels. Show the actual lyric phrase when a specific lyric matters.
- ${pronunciationGuide}
- Add "pronunciation" only when it helps; when present, it must follow the pronunciation style above.
- If the source lyric is Japanese or contains kanji, add "reading" as hiragana/kana reading. Do not put an explanation in "reading"; only the reading text.
- Explain useful vocabulary, grammar, idioms, tone, and natural meaning.
- Use the "grammar" array for reusable patterns, particles, verb forms, sentence endings, tense/aspect, omitted subjects, or word order. Do not leave grammar as only a label; include a concrete explanation tied to the lyric.
- Avoid generic filler such as "this is poetic" unless you explain the exact language cue. Prefer one practical learner insight over broad textbook summaries.
- When a word or phrase has nuance, explain the contrast with the literal meaning or a more common alternative.
- For the expressions category, output expansion cards, not a long list of key phrases. Base each item on a lyric word or short phrase and include alternatives/forms/relatedWords only when useful.
- For quiz items, vary answerIndex. Do not place every correct answer at choices[0].
- For quiz items, vary the type field. Do not make all items meaning questions; use blank, usage, rewrite, and grammar when the lyric supports them.
- For blank type, put ____ directly in the question and make choices short words or phrases that fit the blank.
- For blank type, include enough context in the question itself because the full original lyric line may be hidden while the learner answers.
- For quiz items, include some practical transfer questions when possible: how to say the idea naturally in everyday speech, how to soften it, or how to adapt it for workplace/formal writing.
- Repeated lyric phrases should produce at most one quiz item across the whole pack. If the same sentence or chorus line appears again, skip it and choose a different lyric phrase.
- If a line is too simple, keep its explanation short.
- Generate only the requested category. Omit unrelated top-level keys.

Task:
${categoryRules[normalizedCategory]}

Output JSON shape:
${outputShapes[normalizedCategory]}

Input lines:
${JSON.stringify(payload)}`;
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

        async generateCharacterPronunciation({ lines, lang = 'ko', sourceLang = 'auto', unitMode = 'char' }) {
            if (!Array.isArray(lines) || lines.length === 0) {
                throw new Error('No lines provided');
            }

            const prompt = buildCharacterPronunciationPrompt(lines, lang, sourceLang, unitMode);
            const result = await callChatGPTAPI(prompt);
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
        },

        async generateLyricsStudy(params) {
            if (!Array.isArray(params?.lines) || params.lines.length === 0) {
                throw new Error('No lyrics lines provided');
            }

            const prompt = buildLyricsStudyPrompt(params);
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
