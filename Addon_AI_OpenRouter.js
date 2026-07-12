/**
 * OpenRouter AI Addon for ivLyrics
 * OpenRouter를 통한 다양한 AI 모델 사용 (번역, 발음, TMI 생성)
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
        id: 'openrouter',
        name: 'OpenRouter',
        author: 'ivLis STUDIO',
        description: {
            ko: 'OpenRouter를 통해 다양한 AI 모델 사용 (Claude, GPT, Gemini, Llama 등)',
            en: 'Access multiple AI models via OpenRouter (Claude, GPT, Gemini, Llama, etc.)',
            ja: 'OpenRouterを通じて様々なAIモデルを使用（Claude、GPT、Gemini、Llamaなど）',
            'zh-CN': '通过 OpenRouter 使用多种 AI 模型（Claude、GPT、Gemini、Llama 等）',
        },
        version: '1.0.0',
        apiKeyUrl: 'https://openrouter.ai/keys',
        supports: {
            translate: true,
            metadata: true,
            tmi: true,
            lyricsStudy: true,
            characterPronunciation: true
        },
        models: []
    };

    const BASE_URL = 'https://openrouter.ai/api/v1';

    /**
     * OpenRouter API에서 사용 가능한 모델 목록을 가져옴
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
                window.__ivLyricsDebugLog?.('[OpenRouter Addon] Failed to fetch models:', response.status);
                return [];
            }

            const data = await response.json();
            const models = (data.data || [])
                .filter(m => m.id && !m.id.includes('vision') && !m.id.includes('image'))
                .map(m => ({
                    id: m.id,
                    name: m.name || m.id,
                    context_length: m.context_length
                }))
                .sort((a, b) => {
                    // 인기 모델 우선
                    const priority = ['anthropic/claude', 'openai/gpt-4', 'openai/gpt-3.5', 'google/gemini', 'meta-llama', 'mistralai'];
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
            window.__ivLyricsDebugLog?.('[OpenRouter Addon] Error fetching models:', e.message);
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
        'sv': { name: 'Swedish', native: 'Svenska' },
        'pt': { name: 'Portuguese', native: 'Português' },
        'bn': { name: 'Bengali', native: 'বাংলা' },
        'cs': { name: 'Czech', native: 'Čeština' },
        'it': { name: 'Italian', native: 'Italiano' },
        'th': { name: 'Thai', native: 'ไทย' },
        'tr': { name: 'Turkish', native: 'Türkçe' },
        'vi': { name: 'Vietnamese', native: 'Tiếng Việt' },
        'id': { name: 'Indonesian', native: 'Bahasa Indonesia' },
        'ms': { name: 'Malay', native: 'Bahasa Melayu' }
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
        return getSetting('model', 'anthropic/claude-3.5-sonnet');
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

    async function callOpenRouterAPIRaw(prompt, maxRetries = 3) {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) {
            throw new Error('[OpenRouter] API key is required. Please configure your API key in settings.');
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
                            'Authorization': `Bearer ${apiKey}`,
                            'HTTP-Referer': 'https://github.com/ivLis-STUDIO/ivLyrics',
                            'X-Title': 'ivLyrics'
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
                        window.__ivLyricsDebugLog?.(`[OpenRouter Addon] API key ${keyIndex + 1} failed (${response.status}), trying next...`);
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
                        throw new Error(`[OpenRouter] ${errorMessage}`);
                    }

                    if (!response.ok) {
                        let errorMessage = `HTTP ${response.status}`;
                        try {
                            const errorData = await response.json();
                            if (errorData.error?.message) {
                                errorMessage = errorData.error.message;
                            }
                        } catch (parseError) { }
                        throw new Error(`[OpenRouter] ${errorMessage}`);
                    }

                    const data = await response.json();
                    const rawText = data.choices?.[0]?.message?.content || '';

                    if (!rawText) {
                        throw new Error('[OpenRouter] Empty response from API');
                    }

                    return rawText;

                } catch (e) {
                    lastError = e;
                    window.__ivLyricsDebugLog?.(`[OpenRouter Addon] Attempt ${attempt + 1} failed:`, e.message);

                    if (e.message.includes('Invalid API key') || e.message.includes('permission denied')) {
                        throw e;
                    }

                    if (attempt < maxRetries - 1) {
                        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
            }
        }

        throw lastError || new Error('[OpenRouter] All API keys and retries exhausted');
    }

    function emitStreamingLines(accumulated, onLine, state, flush = false) {
        if (!onLine) return;

        if (flush) {
            const finalLine = accumulated.slice(state.offset);
            onLine(state.index, finalLine);
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

    async function callOpenRouterAPIStream(prompt, onLine, maxRetries = 3) {
        const apiKeys = getApiKeys();
        if (apiKeys.length === 0) throw new Error('[OpenRouter] API key is required.');
        const model = getSelectedModel();
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const response = await fetch(`${BASE_URL}/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://github.com/ivLis-STUDIO/ivLyrics', 'X-Title': 'ivLyrics' },
                        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], ...getAdvancedRequestParams(), stream: true })
                    });
                    if (response.status === 429 || response.status === 403) { break; }
                    if (!response.ok) {
                        let msg = `HTTP ${response.status}`;
                        try { const d = await response.json(); if (d.error?.message) msg = d.error.message; } catch (e) { }
                        throw new Error(`[OpenRouter] ${msg}`);
                    }
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let sseBuffer = '', accumulated = '';
                    const lineState = { index: 0, offset: 0 };
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
                        emitStreamingLines(accumulated, onLine, lineState);
                    }
                    emitStreamingLines(accumulated, onLine, lineState, true);
                    if (!accumulated) throw new Error('[OpenRouter] Empty response from streaming API');
                    return accumulated;
                } catch (e) {
                    lastError = e;
                    if (e.message.includes('Invalid API key') || e.message.includes('permission denied')) throw e;
                    if (attempt < maxRetries - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }
        throw lastError || new Error('[OpenRouter] All API keys and retries exhausted');
    }

    async function callOpenRouterAPI(prompt, maxRetries = 3) {
        const rawText = await callOpenRouterAPIRaw(prompt, maxRetries);
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

    const OpenRouterAddon = {
        ...ADDON_INFO,

        getSettingsUI() {
            const React = Spicetify.React;
            const { useState, useEffect, useCallback } = React;

            return function OpenRouterSettings() {
                const initialApiKeys = getSetting('api-keys', '') || getSetting('api-key', '');
                const [apiKeys, setApiKeys] = useState(
                    Array.isArray(initialApiKeys) ? JSON.stringify(initialApiKeys) : initialApiKeys
                );
                const [selectedModel, setSelectedModel] = useState(getSetting('model', 'anthropic/claude-3.5-sonnet'));
                const [customModel, setCustomModel] = useState(getSetting('custom-model', ''));
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
                        console.error('[OpenRouter Addon] Failed to load models:', e);
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
                    if (val !== '__custom__') {
                        setCustomModel('');
                        setSetting('custom-model', '');
                    }
                };

                const handleCustomModelChange = (e) => {
                    const val = e.target.value;
                    setCustomModel(val);
                    setSetting('custom-model', val);
                    if (val) {
                        setSetting('model', val);
                    }
                };

                const handleTest = async () => {
                    setTestStatus('Testing...');
                    try {
                        const result = await callOpenRouterAPIRaw('Say "Hello" in one word.');
                        setTestStatus(result ? '✓ Connection successful' : '✗ Empty response');
                    } catch (e) {
                        setTestStatus(`✗ ${e.message}`);
                    }
                };



                const isModelInList = availableModels.some(m => m.id === selectedModel);
                const hasApiKey = getApiKeys().length > 0;

                return React.createElement('div', { className: 'ai-addon-settings openrouter-settings' },
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('label', null, 'API Key(s)'),
                        React.createElement('div', { className: 'ai-addon-input-group' },
                            React.createElement('input', {
                                type: 'text',
                                value: apiKeys,
                                onChange: handleApiKeyChange,
                                placeholder: 'sk-or-... (multiple: ["key1", "key2"])'
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
                                value: isModelInList ? selectedModel : '__custom__',
                                onChange: handleModelChange,
                                disabled: modelsLoading || availableModels.length === 0
                            },
                                modelsLoading && React.createElement('option', { value: '' }, 'Loading models...'),
                                !modelsLoading && availableModels.length === 0 && React.createElement('option', { value: '' }, 'Enter API key first'),
                                availableModels.map(m => React.createElement('option', { key: m.id, value: m.id }, m.name)),
                                !isModelInList && React.createElement('option', { value: '__custom__' }, 'Custom Model')
                            ),
                            React.createElement('button', {
                                onClick: loadModels,
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
                        React.createElement('input', { type: 'text', value: customModel, onChange: handleCustomModelChange, placeholder: 'e.g., anthropic/claude-3-opus' })
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
                ? await callOpenRouterAPIStream(prompt, onLine)
                : await callOpenRouterAPIRaw(prompt);
            const lines = parseTextLines(rawResponse, expectedLineCount);

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
            const result = await callOpenRouterAPI(prompt);
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
            const result = await callOpenRouterAPI(prompt);

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
            return await callOpenRouterAPI(prompt);
        },

        async generateLyricsStudy(params) {
            if (!Array.isArray(params?.lines) || params.lines.length === 0) {
                throw new Error('No lyrics lines provided');
            }

            const prompt = buildLyricsStudyPrompt(params);
            return await callOpenRouterAPI(prompt);
        }
    };

    // ============================================
    // Registration
    // ============================================

    const registerAddon = () => {
        if (window.AIAddonManager) {
            window.AIAddonManager.register(OpenRouterAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();

    window.__ivLyricsDebugLog?.('[OpenRouter Addon] Module loaded');
})();
