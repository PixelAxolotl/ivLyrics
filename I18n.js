// I18n.js - Internationalization System for ivLyrics
// This module provides language support for the extension
// IMPORTANT: This file must be loaded AFTER LangKo.js and LangEn.js

// Define I18n on window object immediately using IIFE
(function () {
    // Cached language data
    let currentLanguage = null;
    let languageData = {};
    let fallbackData = {};
    const STORAGE_KEY = "ivLyrics:visual:language";
    const DEFAULT_LANGUAGE = "ko";
    const LANGUAGE_CODES = ["ko", "en", "zh-CN", "zh-TW", "ja", "es", "fr", "de", "it", "ru", "sv", "pt", "hi", "ar", "fa", "bn", "cs", "th", "tr", "vi", "id", "ms"];
    const AVAILABLE_LANGUAGES = [];
    const KEY_PATH_CACHE_LIMIT = 2048;
    const RESEARCH_KEY_ALIASES = {
        "tmi.title": "research.title",
        "tmi.requireKey": "research.requireProvider",
        "tmi.disclaimer": "research.disclaimer",
        "tmi.loading": "research.loading",
        "tmi.close": "research.close",
        "tmi.cancel": "research.cancel",
        "tmi.regenerate": "research.regenerate",
        "tmi.errorFetch": "research.errorFetch",
        "tmi.errorQuota": "research.errorQuota",
        "tmi.errorQuotaHint": "research.errorQuotaHint",
        "tmi.viewInfo": "research.gestureHint",
        "tmi.clickForTMI": "research.title",
        "vinyl.tmiHint": "research.gestureHint",
        "vinyl.tmiGesture": "research.gesture",
        "settings.aiProviders.providerSelectionDesc": "research.providerDescription",
        "settings.aiProviders.tmiProvider": "research.title",
        "settings.aiProviders.supports.tmi": "research.title",
        "settingsAdvanced.tmiStyle.title": "research.styleTitle",
        "settingsAdvanced.tmiStyle.subtitle": "research.styleSubtitle",
        "settingsAdvanced.tmiStyle.fontSize.desc": "research.fontSizeDesc",
        "settingsAdvanced.tmiStyle.fontSize.info": "research.fontSizeInfo"
    };
    const keyPathCache = new Map();
    let keyPathSplit = null;
    let lastKeyPath = null;
    let lastKeyPathSegments = null;
    let canCacheKeyPaths = false;
    try {
        keyPathSplit = String.prototype.split;
        canCacheKeyPaths = /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(keyPathSplit));
    } catch (e) { }

    function getStoredLanguage() {
        try {
            if (window.ivLyricsStoragePersistence) {
                return window.ivLyricsStoragePersistence.getItem(STORAGE_KEY);
            }
            if (typeof Spicetify !== 'undefined' && Spicetify.LocalStorage) {
                return Spicetify.LocalStorage.get(STORAGE_KEY);
            }
            return localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return null;
        }
    }

    function storeLanguage(langCode) {
        try {
            if (window.ivLyricsStoragePersistence) {
                window.ivLyricsStoragePersistence.setItem(STORAGE_KEY, langCode);
            } else if (typeof Spicetify !== 'undefined' && Spicetify.LocalStorage) {
                Spicetify.LocalStorage.set(STORAGE_KEY, langCode);
            } else {
                localStorage.setItem(STORAGE_KEY, langCode);
            }
        } catch (e) { }
    }

    // Language display names
    const LANGUAGE_NAMES = {
        ko: "한국어",
        en: "English",
        "zh-CN": "简体中文",
        "zh-TW": "繁體中文",
        ja: "日本語",
        es: "Español",
        fr: "Français",
        de: "Deutsch",
        it: "Italiano",
        ru: "Русский",
        sv: "Svenska",
        pt: "Português",
        hi: "हिन्दी",
        ar: "العربية",
        fa: "فارسی",
        bn: "বাংলা",
        cs: "Čeština",
        th: "ภาษาไทย",
        tr: "Türkçe",
        vi: "Tiếng Việt",
        id: "Bahasa Indonesia",
        ms: "Bahasa Melayu"
    };

    /**
     * Get language data from external JS files (LangKo.js, LangEn.js, etc.).
     * Each language file publishes its table as window.LANG_<CODE>, e.g.
     * "zh-CN" -> window.LANG_ZH_CN.
     */
    const LANGUAGE_DATA_GLOBALS = new Map(
        LANGUAGE_CODES.map((code) => [code, `LANG_${code.toUpperCase().replace("-", "_")}`])
    );

    function getLanguageData(langCode) {
        const globalName = LANGUAGE_DATA_GLOBALS.get(langCode);
        return (globalName && window[globalName]) || null;
    }

    /**
     * Keep the public language list aligned with language files actually loaded.
     */
    function refreshAvailableLanguages() {
        let hasDefaultLanguage = false;
        AVAILABLE_LANGUAGES.length = 0;

        for (let i = 0; i < LANGUAGE_CODES.length; i++) {
            const code = LANGUAGE_CODES[i];
            if (getLanguageData(code)) {
                AVAILABLE_LANGUAGES.push(code);
                if (code === DEFAULT_LANGUAGE) {
                    hasDefaultLanguage = true;
                }
            }
        }

        if (!hasDefaultLanguage) {
            AVAILABLE_LANGUAGES.unshift(DEFAULT_LANGUAGE);
        }

        return AVAILABLE_LANGUAGES;
    }

    /**
     * Get nested value from object by key path
     */
    function getKeyPathSegments(keyPath) {
        if (
            typeof keyPath !== "string"
            || keyPath.length > 256
            || !canCacheKeyPaths
            || String.prototype.split !== keyPathSplit
        ) {
            return keyPath.split(".");
        }

        if (keyPath === lastKeyPath) return lastKeyPathSegments;

        const cached = keyPathCache.get(keyPath);
        if (cached) {
            lastKeyPath = keyPath;
            lastKeyPathSegments = cached;
            return cached;
        }

        const keys = keyPath.split(".");
        lastKeyPath = keyPath;
        lastKeyPathSegments = keys;
        if (keyPathCache.size < KEY_PATH_CACHE_LIMIT) {
            keyPathCache.set(keyPath, keys);
        }
        return keys;
    }

    function getNestedValue(obj, keyPath) {
        if (!obj || !keyPath) return null;
        const keys = getKeyPathSegments(keyPath);
        let value = obj;
        for (let i = 0; i < keys.length; i++) {
            if (value && typeof value === "object" && keys[i] in value) {
                value = value[keys[i]];
            } else {
                return null;
            }
        }
        return (typeof value === "object") ? null : value;
    }

    /**
     * Get translation string.
     */
    function getString(keyPath, params) {
        if (!keyPath) return "";
        keyPath = RESEARCH_KEY_ALIASES[keyPath] || keyPath;

        // Try to initialize if not done yet
        if (currentLanguage === null) {
            initSync();
        }

        // Try current language
        let value = getNestedValue(languageData, keyPath);

        // Try fallback language
        if (value === null && fallbackData) {
            value = getNestedValue(fallbackData, keyPath);
        }

        // Return an empty string if no translation found so caller fallbacks can run.
        if (value === null) {
            return "";
        }

        // Replace parameters
        if (typeof value === "string" && params && typeof params === "object") {
            return value.replace(/\{(\w+)\}/g, function (match, paramKey) {
                return params[paramKey] !== undefined ? params[paramKey] : match;
            });
        }

        return value;
    }

    /**
     * Initialize the i18n system synchronously
     */
    function initSync() {
        if (currentLanguage !== null) return;
        refreshAvailableLanguages();

        // Get saved language
        let savedLang = getStoredLanguage();

        if (!savedLang || AVAILABLE_LANGUAGES.indexOf(savedLang) === -1) {
            const invalidSavedLang = savedLang;
            savedLang = DEFAULT_LANGUAGE;

            // Old index-based backups can map an unrelated value (for example
            // "true" or "3") onto the language key. Repair the persisted value
            // as well as the in-memory fallback so it is not exported again.
            if (invalidSavedLang) {
                storeLanguage(savedLang);
                window.__ivLyricsDebugLog?.(
                    "[I18n] Replaced an unsupported stored language with the default."
                );
            }
        }

        // Load fallback data first
        fallbackData = getLanguageData(DEFAULT_LANGUAGE) || {};

        // Load selected language
        const data = getLanguageData(savedLang);
        if (data) {
            languageData = data;
            currentLanguage = savedLang;
        } else {
            languageData = fallbackData;
            currentLanguage = DEFAULT_LANGUAGE;
        }

        // The custom-app entrypoint can run before this subfile. Keep the
        // already-created runtime config aligned with the validated language.
        if (window.CONFIG && window.CONFIG.visual) {
            window.CONFIG.visual.language = currentLanguage;
        }

        window.__ivLyricsDebugLog?.("[I18n] Initialized: " + currentLanguage);
    }

    /**
     * Async init (just calls sync version)
     */
    function init() {
        initSync();
        return Promise.resolve();
    }

    /**
     * Get current language code
     */
    function getCurrentLanguage() {
        if (currentLanguage === null) initSync();
        return currentLanguage || DEFAULT_LANGUAGE;
    }

    /**
     * Set language and save to storage
     */
    function setLanguage(langCode) {
        refreshAvailableLanguages();

        if (AVAILABLE_LANGUAGES.indexOf(langCode) === -1) {
            console.error("[I18n] Invalid language: " + langCode);
            return Promise.resolve(false);
        }

        if (langCode === currentLanguage) {
            return Promise.resolve(true);
        }

        const newData = getLanguageData(langCode);
        if (!newData) {
            console.error("[I18n] Language data not found: " + langCode);
            return Promise.resolve(false);
        }

        // Update fallback if switching away from default
        if (langCode !== DEFAULT_LANGUAGE) {
            fallbackData = getLanguageData(DEFAULT_LANGUAGE) || {};
        }

        languageData = newData;
        currentLanguage = langCode;
        if (window.CONFIG && window.CONFIG.visual) {
            window.CONFIG.visual.language = currentLanguage;
        }

        // Save to storage
        storeLanguage(langCode);

        window.__ivLyricsDebugLog?.("[I18n] Language changed to: " + langCode);
        return Promise.resolve(true);
    }

    /**
     * Get list of available languages
     */
    function getAvailableLanguages() {
        refreshAvailableLanguages();

        return AVAILABLE_LANGUAGES.map(function (code) {
            return { code, name: LANGUAGE_NAMES[code] || code };
        });
    }

    /**
     * Get display name for language code
     */
    function getLanguageName(langCode) {
        return LANGUAGE_NAMES[langCode] || langCode;
    }

    /**
     * 주어진 i18n 키의 번역 문자열을 로드된 모든 언어에서 수집하여 반환
     * 검색 시 모든 언어의 번역을 검색 대상에 포함시키기 위해 사용
     * @param {string} keyPath - i18n 키 경로 (예: "settings.language.label")
     * @returns {string[]} - 중복 제거된 번역 문자열 배열
     */
    function getAllTranslations(keyPath) {
        if (!keyPath) return [];
        keyPath = RESEARCH_KEY_ALIASES[keyPath] || keyPath;
        const translations = [];
        const availableLanguages = refreshAvailableLanguages();
        for (let i = 0; i < availableLanguages.length; i++) {
            const langData = getLanguageData(availableLanguages[i]);
            if (langData) {
                const value = getNestedValue(langData, keyPath);
                if (value && translations.indexOf(value) === -1) {
                    translations.push(value);
                }
            }
        }
        return translations;
    }

    /**
     * Check if initialized
     */
    function isInitialized() {
        return currentLanguage !== null;
    }

    refreshAvailableLanguages();

    // Create the I18n object
    const I18n = {
        init,
        initSync,
        getString,
        t: getString,
        getAllTranslations,
        getCurrentLanguage,
        setLanguage,
        getAvailableLanguages,
        getLanguageName,
        isInitialized,
        AVAILABLE_LANGUAGES,
        DEFAULT_LANGUAGE
    };

    // Export to window
    window.I18n = I18n;

    // Create global helper function
    window.t = function (key, params) {
        return I18n.t(key, params);
    };

    // Initialize immediately
    try {
        initSync();
    } catch (e) {
        console.error("[I18n] Init error:", e);
    }
})();
