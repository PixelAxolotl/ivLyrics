// Run "npm i @types/react" to have this type package available in workspace
/// <reference types="react" />
/// <reference path="../../globals.d.ts" />

// Furigana Converter Module for ivLyrics
const FuriganaConverter = (() => {
  let kuromojiInstance = null;
  let isInitializing = false;
  let initPromise = null;
  const conversionCache = new Map();

  // Debug mode - set to false to reduce console logs
  const DEBUG_MODE = false;
  const MAX_CONVERSION_CACHE_SIZE = 1000;
  let hasLoggedKuromojiWarning = false;

// Patch XMLHttpRequest once to fix Kuromoji dictionary URLs
if (!XMLHttpRequest.prototype.__ivLyricsFuriganaPatched) {
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    // Fix Kuromoji dictionary URLs
    if (
      typeof url === "string" &&
      url.includes("/dict/") &&
      url.includes(".dat.gz")
    ) {
      // If URL doesn't start with http/https, fix it
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url =
          "https://unpkg.com/kuromoji@0.1.2/dict/" + url.split("/dict/").pop();
      }
      // If URL has wrong host, fix it
      else if (url.includes("xpui.app.spotify.com")) {
        const filename = url.split("/dict/").pop();
        url = "https://unpkg.com/kuromoji@0.1.2/dict/" + filename;
      }
    }
    return originalXHROpen.call(this, method, url, ...args);
  };
  XMLHttpRequest.prototype.__ivLyricsFuriganaPatched = true;
}

  const init = async () => {
    if (kuromojiInstance) {
      return Promise.resolve();
    }

    if (isInitializing) {
      return initPromise;
    }

    isInitializing = true;
    initPromise = new Promise((resolve, reject) => {
      if (typeof window.kuromoji === "undefined") {
        reject(new Error("Kuromoji library not loaded"));
        return;
      }

      // Use any path - our XHR patch will fix it
      const dicPath = "/dict";

      window.kuromoji
        .builder({
          dicPath: dicPath,
        })
        .build((err, tokenizer) => {
          if (err) {
            isInitializing = false;
            reject(err);
            return;
          }

          kuromojiInstance = tokenizer;
          isInitializing = false;

          // Trigger re-render by dispatching a custom event
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("furigana-ready"));
          }, 100);

          resolve();
        });
    });

    return initPromise;
  };

  const containsKanji = (text) => {
    const kanjiRegex = /[\u4E00-\u9FAF\u3400-\u4DBF]/;
    return kanjiRegex.test(text);
  };

  const katakanaToHiragana = (katakana) => {
    if (!katakana) return "";

    return katakana
      .split("")
      .map((char) => {
        const code = char.charCodeAt(0);
        if (code >= 0x30a1 && code <= 0x30f6) {
          return String.fromCharCode(code - 0x60);
        }
        return char;
      })
      .join("");
  };

  const convertToFurigana = (text) => {
    if (!text || typeof text !== "string") {
      return text;
    }

    if (!containsKanji(text)) {
      return text;
    }

    if (conversionCache.has(text)) {
      return conversionCache.get(text);
    }

    if (!kuromojiInstance) {
      if (DEBUG_MODE && !hasLoggedKuromojiWarning) {
        console.warn("[ivLyrics] Kuromoji is not initialized yet.");
        hasLoggedKuromojiWarning = true;
      }
      return text;
    }

    try {
      const tokens = kuromojiInstance.tokenize(text);
      let result = "";

      for (const token of tokens) {
        const surface = token.surface_form;
        const reading = token.reading || token.pronunciation; // Fallback to pronunciation

        // Only add ruby if token has kanji AND reading
        if (reading && containsKanji(surface)) {
          const hiragana = katakanaToHiragana(reading);

          // Process character by character to handle mixed kanji/kana
          let tokenResult = "";
          let readingIndex = 0;
          let i = 0;

          while (i < surface.length) {
            const char = surface[i];

            if (containsKanji(char)) {
              // Found a kanji - collect consecutive kanji
              let kanjiSequence = char;
              i++;

              while (i < surface.length && containsKanji(surface[i])) {
                kanjiSequence += surface[i];
                i++;
              }

              // Find the reading for this kanji sequence
              // Look ahead in surface to find kana that matches reading
              let nextKanaInSurface = "";
              let tempI = i;
              while (tempI < surface.length && !containsKanji(surface[tempI])) {
                nextKanaInSurface += surface[tempI];
                tempI++;
              }

              // Find where this kana appears in the remaining reading
              let kanjiReading = "";
              if (nextKanaInSurface.length > 0) {
                // Find the kana in the reading
                const remainingReading = hiragana.substring(readingIndex);
                const kanaIndex = remainingReading.indexOf(nextKanaInSurface);

                if (kanaIndex > 0) {
                  // Reading up to the kana is for the kanji
                  kanjiReading = remainingReading.substring(0, kanaIndex);
                } else if (kanaIndex === 0) {
                  // No reading for this kanji? Shouldn't happen but handle it
                  kanjiReading = "";
                } else {
                  // Kana not found - take all remaining as kanji reading
                  kanjiReading = remainingReading;
                }
              } else {
                // No more kana in surface - rest of reading is for this kanji
                kanjiReading = hiragana.substring(readingIndex);
              }

              if (kanjiReading) {
                tokenResult += `<ruby>${kanjiSequence}<rt>${kanjiReading}</rt></ruby>`;
                readingIndex += kanjiReading.length;
              } else {
                tokenResult += kanjiSequence;
              }
            } else {
              // Regular kana - just add it
              tokenResult += char;
              readingIndex++;
              i++;
            }
          }

          result += tokenResult;
        } else {
          result += surface;
        }
      }

      if (conversionCache.size >= MAX_CONVERSION_CACHE_SIZE) {
        const firstKey = conversionCache.keys().next().value;
        conversionCache.delete(firstKey);
      }
      conversionCache.set(text, result);

      return result;
    } catch (error) {
      if (DEBUG_MODE) {
        console.error("[ivLyrics] Furigana conversion failed:", error);
      }
      return text;
    }
  };

  const isAvailable = () => {
    return kuromojiInstance !== null;
  };

  const clearCache = () => {
    conversionCache.clear();
  };

  return {
    init,
    convertToFurigana,
    containsKanji,
    isAvailable,
    clearCache,
  };
})();

window.FuriganaConverter = FuriganaConverter;

// Load Kuromoji library for furigana conversion
if (typeof window.kuromoji === "undefined") {
  const kuromojiScript = document.createElement("script");
  kuromojiScript.src =
    "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js";
  kuromojiScript.async = false; // Load synchronously to ensure it's available
  kuromojiScript.onload = () => {
    // Initialize immediately
    if (typeof window.FuriganaConverter !== "undefined") {
      window.FuriganaConverter.init()
        .then(() => {
          // Trigger lyrics re-render if furigana is enabled
          if (CONFIG?.visual?.["furigana-enabled"]) {
            // Try multiple methods to trigger re-render
            if (window.lyricContainer) {
              try {
                window.lyricContainer.forceUpdate();
              } catch (e) { }
            }
          }
        })
        .catch((err) => { });
    }
  };
  kuromojiScript.onerror = (err) => { };
  document.head.appendChild(kuromojiScript);
} else {
  // If Kuromoji is already loaded, initialize immediately
  if (typeof window.FuriganaConverter !== "undefined") {
    window.FuriganaConverter.init()
      .then(() => { })
      .catch((err) => { });
  }
}

// === ivLyrics-overlay 전송 모듈 ===
// LyricsService Extension에서 제공하는 OverlaySender를 사용
// 이 파일에 있던 OverlaySender는 Extension으로 이동됨 (어떤 페이지에서든 작동)

// Extension에서 이미 OverlaySender가 로드되어 있으면 그것을 사용
// OverlaySender는 window.OverlaySender로 전역 접근 가능
if (!window.OverlaySender) {
  console.warn("[ivLyrics] OverlaySender not found from Extension, waiting...");
  if (!window.__ivLyricsOverlaySenderWaitTimer) {
    window.__ivLyricsOverlaySenderWaitTimer = setInterval(() => {
      if (window.OverlaySender) {
        clearInterval(window.__ivLyricsOverlaySenderWaitTimer);
        window.__ivLyricsOverlaySenderWaitTimer = null;
        ivLyricsDebug("[ivLyrics] OverlaySender loaded from Extension");
      }
    }, 100);

    setTimeout(() => {
      if (window.__ivLyricsOverlaySenderWaitTimer) {
        clearInterval(window.__ivLyricsOverlaySenderWaitTimer);
        window.__ivLyricsOverlaySenderWaitTimer = null;
      }
    }, 5000);
  }
}

// 하위 호환성을 위해 OverlaySender 별칭 생성
const OverlaySender = window.OverlaySender;


/** @type {React} */
const react = Spicetify.React;
const { useState, useEffect, useCallback, useMemo, useRef } = react;

const getNonSectionLyricsText = (lyrics = []) =>
  lyrics
    .map((line) => line?.text || "")
    .filter((line) => line && !Utils.isSectionHeader(line))
    .join("\n");

const hasInstrumentalMarker = (lyrics = []) => {
  if (!lyrics || lyrics.length === 0 || lyrics.length > 3) return false;

  const firstLine = lyrics[0]?.text?.toLowerCase()?.trim() || "";
  if (firstLine.includes("no lyrics") || firstLine.includes("instrumental")) {
    return true;
  }

  for (const line of lyrics) {
    const text = line?.text?.toLowerCase() || "";
    if (text.includes("no lyrics") || text.includes("instrumental")) {
      return true;
    }
  }

  return false;
};

// Update Banner Component - Fluent Design Style
const UpdateBanner = ({ updateInfo, onDismiss }) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const installCommand = Utils.getInstallCommand();
  const platformName = Utils.getPlatformName();

  const handleCopy = async () => {
    const success = await Utils.copyToClipboard(installCommand);
    if (success) {
      setCopied(true);
      Toast.success(I18n.t("notifications.installCommandCopied"));
      setTimeout(() => setCopied(false), 2500);
    } else {
      Toast.error(I18n.t("notifications.copyFailed"));
    }
  };

  return react.createElement(
    "div",
    {
      className: "ivLyrics-update-banner",
      style: {
        background: "rgba(255, 255, 255, 0.05)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: "12px",
        margin: "12px 16px",
        backdropFilter: "blur(40px) saturate(180%)",
        WebkitBackdropFilter: "blur(40px) saturate(180%)",
        boxShadow:
          "0 8px 32px 0 rgba(0, 0, 0, 0.18), inset 0 1px 0 0 rgba(255, 255, 255, 0.05)",
        animation: "slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        position: "relative",
        zIndex: 150,
        overflow: "hidden",
        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
    react.createElement(
      "div",
      {
        style: {
          padding: "16px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
        },
      },
      react.createElement(
        "div",
        { style: { flex: 1, minWidth: 0 } },
        react.createElement(
          "div",
          {
            style: {
              fontSize: "15px",
              fontWeight: "600",
              color: "rgba(255, 255, 255, 0.95)",
              marginBottom: "6px",
              letterSpacing: "-0.01em",
            },
          },
          I18n.t("notifications.updateAvailable")
        ),
        react.createElement(
          "div",
          {
            style: {
              fontSize: "13px",
              color: "rgba(255, 255, 255, 0.6)",
              lineHeight: "1.5",
            },
          },
          `${I18n.t("update.versionChange")} ${updateInfo.currentVersion} → ${updateInfo.latestVersion}`
        )
      ),
      react.createElement(
        "div",
        { style: { display: "flex", gap: "8px", alignItems: "center" } },
        react.createElement(
          "button",
          {
            onClick: () => setIsExpanded(!isExpanded),
            className: "lyrics-update-button-primary",
            style: {
              background: "rgba(255, 255, 255, 0.15)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              color: "rgba(255, 255, 255, 0.95)",
              padding: "8px 16px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: "600",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              backdropFilter: "blur(10px)",
              letterSpacing: "-0.01em",
            },
          },
          isExpanded ? I18n.t("update.collapse") : I18n.t("update.expand")
        ),
        react.createElement(
          "button",
          {
            onClick: onDismiss,
            className: "lyrics-update-button-close",
            style: {
              background: "transparent",
              border: "none",
              color: "rgba(255, 255, 255, 0.5)",
              cursor: "pointer",
              fontSize: "20px",
              padding: "4px 8px",
              borderRadius: "6px",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              lineHeight: "1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            },
          },
          "×"
        )
      )
    ),
    isExpanded &&
    react.createElement(
      "div",
      {
        style: {
          padding: "0 20px 20px 20px",
          borderTop: "1px solid rgba(255, 255, 255, 0.06)",
          animation: "expandDown 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        },
      },
      react.createElement(
        "div",
        { style: { marginTop: "16px" } },
        react.createElement(
          "div",
          {
            style: {
              fontSize: "13px",
              color: "rgba(255, 255, 255, 0.7)",
              marginBottom: "10px",
              fontWeight: "500",
            },
          },
          platformName
        ),
        react.createElement(
          "div",
          {
            style: {
              background: "rgba(0, 0, 0, 0.25)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "8px",
              padding: "12px 14px",
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              fontSize: "12px",
              color: "rgba(255, 255, 255, 0.85)",
              wordBreak: "break-all",
              lineHeight: "1.6",
              marginBottom: "12px",
              userSelect: "all",
            },
          },
          installCommand
        )
      ),
      react.createElement(
        "div",
        { style: { display: "flex", gap: "8px", marginTop: "12px" } },
        react.createElement(
          "button",
          {
            onClick: handleCopy,
            className: "lyrics-update-button-secondary",
            disabled: copied,
            style: {
              flex: 1,
              background: copied
                ? "rgba(16, 185, 129, 0.15)"
                : "rgba(255, 255, 255, 0.08)",
              border: copied
                ? "1px solid rgba(16, 185, 129, 0.3)"
                : "1px solid rgba(255, 255, 255, 0.15)",
              color: copied
                ? "rgba(16, 185, 129, 1)"
                : "rgba(255, 255, 255, 0.9)",
              padding: "10px 16px",
              borderRadius: "8px",
              cursor: copied ? "default" : "pointer",
              fontSize: "13px",
              fontWeight: "600",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              letterSpacing: "-0.01em",
            },
          },
          copied ? I18n.t("update.copied") : I18n.t("update.copyCommand")
        ),
        react.createElement(
          "a",
          {
            href: updateInfo.releaseUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            style: {
              flex: 1,
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "rgba(255, 255, 255, 0.9)",
              padding: "10px 16px",
              borderRadius: "8px",
              textDecoration: "none",
              fontSize: "13px",
              fontWeight: "600",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              letterSpacing: "-0.01em",
            },
          },
          I18n.t("update.releaseNotes")
        )
      )
    )
  );
};
/** @type {import("react").ReactDOM | null} */
let reactDOM = Spicetify.ReactDOM;

function ensureReactDOM() {
  if (
    reactDOM &&
    (typeof reactDOM.render === "function" ||
      typeof reactDOM.createPortal === "function")
  ) {
    return reactDOM;
  }

  const resolved = window?.Spicetify?.ReactDOM || window?.ReactDOM || null;
  if (resolved && resolved !== reactDOM) {
    reactDOM = resolved;
    window.reactDOM = resolved;
  }

  return reactDOM;
}

window.ivLyricsEnsureReactDOM = ensureReactDOM;
// Define a function called "render" to specify app entry point
// This function will be used to mount app to main view.
function render() {
  return react.createElement(LyricsContainer, null);
}

// Optimized utility functions with better error handling and performance
const APP_NAME = "ivLyrics";
const IVLYRICS_DEBUG = false;
if (typeof window.__IVLYRICS_DEBUG__ !== "boolean") {
  window.__IVLYRICS_DEBUG__ = IVLYRICS_DEBUG;
}
if (!window.__ivLyricsDebugLog) {
  window.__ivLyricsDebugLog = (...args) => {
    if (window.__IVLYRICS_DEBUG__) {
      console.log(...args);
    }
  };
}
const ivLyricsDebug = (...args) => {
  window.__ivLyricsDebugLog?.(...args);
};

// IndexedDB for track sync offsets
const DB_NAME = "ivLyrics-db";
const DB_VERSION = 1;
const STORE_NAME = "track-sync-offsets";

let dbInstance = null;

const initDB = () => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("[ivLyrics] IndexedDB error:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      ivLyricsDebug("[ivLyrics] IndexedDB initialized");
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
        ivLyricsDebug("[ivLyrics] IndexedDB object store created");
      }
    };
  });
};

const TrackSyncDB = {
  async getOffset(trackUri) {
    try {
      const db = await initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(trackUri);

        request.onsuccess = () => resolve(request.result || 0);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("[ivLyrics] Failed to get offset:", error);
      return 0;
    }
  },

  async setOffset(trackUri, offset) {
    try {
      const db = await initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(offset, trackUri);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("[ivLyrics] Failed to set offset:", error);
    }
  },

  async clearOffset(trackUri) {
    try {
      const db = await initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(trackUri);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("[ivLyrics] Failed to clear offset:", error);
    }
  },

  async getAllOffsets() {
    try {
      const db = await initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAllKeys();

        request.onsuccess = () => {
          const keys = request.result;
          const getAllRequest = store.getAll();

          getAllRequest.onsuccess = () => {
            const values = getAllRequest.result;
            const result = {};
            keys.forEach((key, index) => {
              result[key] = values[index];
            });
            resolve(result);
          };

          getAllRequest.onerror = () => reject(getAllRequest.error);
        };

        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("[ivLyrics] Failed to get all offsets:", error);
      return {};
    }
  },

  async importOffsets(offsetsObj) {
    try {
      const db = await initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        // Clear existing data first
        const clearRequest = store.clear();

        clearRequest.onsuccess = () => {
          // Add all new offsets
          Object.entries(offsetsObj).forEach(([trackUri, offset]) => {
            store.put(offset, trackUri);
          });
        };

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      console.error("[ivLyrics] Failed to import offsets:", error);
    }
  },
};

// TrackSyncDB를 window에 등록 (LyricsService와 다른 컴포넌트에서 사용 가능)
window.TrackSyncDB = TrackSyncDB;

// IndexedDB for track language overrides (곡별 언어 오버라이드)
const LANG_DB_NAME = "ivLyrics-lang-db";
const LANG_DB_VERSION = 1;
const LANG_STORE_NAME = "track-language-overrides";

let langDbInstance = null;

const initLangDB = () => {
  return new Promise((resolve, reject) => {
    if (langDbInstance) {
      resolve(langDbInstance);
      return;
    }

    const request = indexedDB.open(LANG_DB_NAME, LANG_DB_VERSION);

    request.onerror = () => {
      console.error("[ivLyrics] Language IndexedDB error:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      langDbInstance = request.result;
      ivLyricsDebug("[ivLyrics] Language IndexedDB initialized");
      resolve(langDbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(LANG_STORE_NAME)) {
        db.createObjectStore(LANG_STORE_NAME);
        ivLyricsDebug("[ivLyrics] Language IndexedDB object store created");
      }
    };
  });
};

const TrackLanguageDB = {
  async getLanguage(trackUri) {
    try {
      const db = await initLangDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([LANG_STORE_NAME], "readonly");
        const store = transaction.objectStore(LANG_STORE_NAME);
        const request = store.get(trackUri);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("[ivLyrics] Failed to get language override:", error);
      return null;
    }
  },

  async setLanguage(trackUri, language) {
    try {
      const db = await initLangDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([LANG_STORE_NAME], "readwrite");
        const store = transaction.objectStore(LANG_STORE_NAME);
        const request = store.put(language, trackUri);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("[ivLyrics] Failed to set language override:", error);
    }
  },

  async clearLanguage(trackUri) {
    try {
      const db = await initLangDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([LANG_STORE_NAME], "readwrite");
        const store = transaction.objectStore(LANG_STORE_NAME);
        const request = store.delete(trackUri);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("[ivLyrics] Failed to clear language override:", error);
    }
  },

  async getAllOverrides() {
    try {
      const db = await initLangDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([LANG_STORE_NAME], "readonly");
        const store = transaction.objectStore(LANG_STORE_NAME);
        const request = store.getAllKeys();

        request.onsuccess = () => {
          const keys = request.result;
          const getAllRequest = store.getAll();

          getAllRequest.onsuccess = () => {
            const values = getAllRequest.result;
            const result = {};
            keys.forEach((key, index) => {
              result[key] = values[index];
            });
            resolve(result);
          };

          getAllRequest.onerror = () => reject(getAllRequest.error);
        };

        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("[ivLyrics] Failed to get all language overrides:", error);
      return {};
    }
  },
};

// TrackLanguageDB를 window에 등록 (다른 컴포넌트에서 사용 가능)
window.TrackLanguageDB = TrackLanguageDB;

// Migrate from localStorage to IndexedDB
(async () => {
  try {
    const oldOffsets = localStorage.getItem("ivLyrics:track-sync-offsets");
    if (oldOffsets) {
      ivLyricsDebug("[ivLyrics] Migrating track-sync-offsets to IndexedDB");
      const offsetsObj = JSON.parse(oldOffsets);
      await TrackSyncDB.importOffsets(offsetsObj);
      localStorage.removeItem("ivLyrics:track-sync-offsets");
      ivLyricsDebug("[ivLyrics] Migration complete");
    }
  } catch (error) {
    console.error("[ivLyrics] Migration failed:", error);
  }
})();

const __storageKeys = localStorage.getItem(`${APP_NAME}:storage-keys`);
const StorageKeys = new Set(__storageKeys ? JSON.parse(__storageKeys) : []);
/**
 *
 * @param {string} newKey
 */
const saveStorageKeys = (newKey) => {
  if (typeof newKey !== "string") return;
  if (!newKey.startsWith(APP_NAME)) return;
  StorageKeys.add(newKey);
  try {
    localStorage.setItem(
      `${APP_NAME}:storage-keys`,
      JSON.stringify(Array.from(StorageKeys))
    );
  } catch (e) {
    console.error("Failed to save storage keys:", e);
  }
};
const StorageManager = {
  get(key, defaultVal = true) {
    saveStorageKeys(key);
    try {
      const value = localStorage.getItem(key);
      return value !== null ? value === "true" : defaultVal;
    } catch (error) {
      return defaultVal;
    }
  },

  getPersisted(key) {
    saveStorageKeys(key);
    // Try Spicetify LocalStorage first (more reliable)
    try {
      const value = Spicetify?.LocalStorage?.get(key);
      if (typeof value === "string") return value;
    } catch (error) {
      // Error ignored
    }

    // Fallback to regular localStorage
    try {
      return localStorage.getItem(key);
    } catch (error) {
      // Error ignored
    }

    return null;
  },

  /**
   *
   * @deprecated Use saveConfig instead for unified saving
   */
  setPersisted(key, value) {
    saveStorageKeys(key);
    const stringValue = String(value);
    let success = false;

    // Try Spicetify LocalStorage first
    try {
      Spicetify?.LocalStorage?.set(key, stringValue);
      success = true;
    } catch (error) {
      // Error ignored
    }

    // Fallback to regular localStorage
    try {
      localStorage.setItem(key, stringValue);
      success = true;
    } catch (error) {
      // Error ignored
    }

    if (!success) {
      // Failed to persist data
    }
  },

  // Unified config save method to reduce duplication
  saveConfig(name, value) {
    saveStorageKeys(`${APP_NAME}:visual:${name}`);
    if (name === "gemini-api-key" || name === "gemini-api-key-romaji") {
      // Save sensitive keys to both storages for persistence
      this.setPersisted(`${APP_NAME}:visual:${name}`, value);
    } else if (name === "language") {
      // Language setting needs to be saved to both storages for I18n system
      this.setPersisted(`${APP_NAME}:visual:${name}`, value);
    } else {
      localStorage.setItem(`${APP_NAME}:visual:${name}`, value);
    }
  },

  getItem(key) {
    saveStorageKeys(key);
    return localStorage.getItem(key);
  },
  setItem(key, value) {
    saveStorageKeys(key);
    return localStorage.setItem(key, value);
  },
  removeItem(key) {
    saveStorageKeys(key);
    return localStorage.removeItem(key);
  },
  getItemRaw(key) {
    return localStorage.getItem(key);
  },
  setItemRaw(key, value) {
    return localStorage.setItem(key, value);
  },
  removeItemRaw(key) {
    return localStorage.removeItem(key);
  },
  SpicetifyLocalStorageGet(key) {
    saveStorageKeys(key);
    return Spicetify.LocalStorage.get(key);
  },
  SpicetifyLocalStorageGetRaw(key) {
    return Spicetify.LocalStorage.get(key);
  },

  async exportConfig() {
    const config = {};
    const CLIENT_HASH_KEY = `${APP_NAME}:user-hash`;

    StorageKeys.forEach((key) => {
      // Client ID는 내보내기에서 제외
      if (key === CLIENT_HASH_KEY) return;

      const val = StorageManager.getItem(key);
      if (val !== null) config[key] = val;
    });

    // IndexedDB의 track-sync-offsets를 포함
    const trackSyncOffsets = await TrackSyncDB.getAllOffsets();
    if (Object.keys(trackSyncOffsets).length > 0) {
      config["ivLyrics:track-sync-offsets"] = JSON.stringify(trackSyncOffsets);
      ivLyricsDebug("[ivLyrics] Exporting track-sync-offsets from IndexedDB:", trackSyncOffsets);
    } else {
      ivLyricsDebug("[ivLyrics] No track-sync-offsets found in IndexedDB");
    }

    ivLyricsDebug("[ivLyrics] Exported config keys:", Object.keys(config));

    return config;
  },
  async importConfig(config) {
    const CLIENT_HASH_KEY = `${APP_NAME}:user-hash`;

    // track-sync-offsets를 IndexedDB로 가져오기
    if (config["ivLyrics:track-sync-offsets"]) {
      try {
        const offsetsObj = JSON.parse(config["ivLyrics:track-sync-offsets"]);
        await TrackSyncDB.importOffsets(offsetsObj);
        ivLyricsDebug("[ivLyrics] Imported track-sync-offsets to IndexedDB");
        delete config["ivLyrics:track-sync-offsets"]; // localStorage에 저장하지 않음
      } catch (error) {
        console.error("[ivLyrics] Failed to import track-sync-offsets:", error);
      }
    }

    // Client ID가 있다면 삭제 (불러오기에서 제외)
    if (config[CLIENT_HASH_KEY]) {
      delete config[CLIENT_HASH_KEY];
      ivLyricsDebug("[ivLyrics] Client ID excluded from import");
    }

    // 나머지 설정을 localStorage에 저장
    Object.entries(config).forEach(([key, value]) => {
      StorageManager.setItemRaw(key, value);
      saveStorageKeys(key);
    });
  },
};

// DB Export/Import Manager - 모든 IndexedDB 데이터 내보내기/가져오기
const DB_EXPORT_TARGETS = [
  { name: "ivLyrics-db", version: 1, stores: ["track-sync-offsets"] },
  { name: "ivLyrics-lang-db", version: 1, stores: ["track-language-overrides"] },
  { name: "ivLyricsCache", version: 6, stores: ["lyrics", "translations", "youtube", "metadata", "sync", "tmi"] },
  { name: "ivLyricsSelectedVideos", version: 1, stores: ["selectedVideos"] },
];

const DBExportManager = {
  _openDB(name, version, stores) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        for (const storeName of stores) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        }
      };
    });
  },

  _readStore(db, storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const records = [];

      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          records.push({ key: cursor.key, value: cursor.value });
          cursor.continue();
        } else {
          resolve(records);
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  _writeStore(db, storeName, records) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      store.clear();
      for (const record of records) {
        if (store.keyPath) {
          store.put(record.value);
        } else {
          store.put(record.value, record.key);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async exportAllDBs() {
    const result = {};
    for (const target of DB_EXPORT_TARGETS) {
      try {
        const db = await this._openDB(target.name, target.version, target.stores);
      const existingStores = new Set(Array.from(db.objectStoreNames));
      result[target.name] = {};
      for (const storeName of target.stores) {
          if (existingStores.has(storeName)) {
            result[target.name][storeName] = await this._readStore(db, storeName);
          }
      }
        db.close();
      } catch (e) {
        console.warn(`[ivLyrics] Failed to export DB ${target.name}:`, e);
      }
    }
    return result;
  },

  async importAllDBs(data) {
    for (const target of DB_EXPORT_TARGETS) {
      if (!data[target.name]) continue;
      try {
        const db = await this._openDB(target.name, target.version, target.stores);
        const existingStores = new Set(Array.from(db.objectStoreNames));
        for (const storeName of target.stores) {
          if (existingStores.has(storeName) && data[target.name][storeName]) {
            await this._writeStore(db, storeName, data[target.name][storeName]);
          }
        }
        db.close();
      } catch (e) {
        console.error(`[ivLyrics] Failed to import DB ${target.name}:`, e);
      }
    }
  },
};

const KARAOKE = 0;
const SYNCED = 1;
const UNSYNCED = 2;

const CONFIG = {
  visual: {
    language:
      StorageManager.getItem("ivLyrics:visual:language") || StorageManager.getItem("ivLyrics:visual:language"),
    "playbar-button": StorageManager.get(
      "ivLyrics:visual:playbar-button",
      false
    ),
    "fullscreen-button": StorageManager.get(
      "ivLyrics:visual:fullscreen-button",
      false
    ),
    "panel-lyrics-enabled": StorageManager.get(
      "ivLyrics:visual:panel-lyrics-enabled",
      true
    ),
    "panel-lyrics-lines":
      StorageManager.getItem("ivLyrics:visual:panel-lyrics-lines") || "5",
    "panel-font-scale":
      StorageManager.getItem("ivLyrics:visual:panel-font-scale") || "100",
    "panel-lyrics-font-family":
      StorageManager.getItem("ivLyrics:visual:panel-lyrics-font-family") ||
      "Pretendard Variable",
    "panel-lyrics-original-font":
      StorageManager.getItem("ivLyrics:visual:panel-lyrics-original-font") || "",
    "panel-lyrics-phonetic-font":
      StorageManager.getItem("ivLyrics:visual:panel-lyrics-phonetic-font") || "",
    "panel-lyrics-translation-font":
      StorageManager.getItem("ivLyrics:visual:panel-lyrics-translation-font") || "",
    "panel-lyrics-original-size":
      StorageManager.getItem("ivLyrics:visual:panel-lyrics-original-size") || "18",
    "panel-lyrics-phonetic-size":
      StorageManager.getItem("ivLyrics:visual:panel-lyrics-phonetic-size") || "13",
    "panel-lyrics-translation-size":
      StorageManager.getItem("ivLyrics:visual:panel-lyrics-translation-size") || "13",
    "panel-bg-type":
      StorageManager.getItem("ivLyrics:visual:panel-bg-type") || "album",
    "panel-bg-color":
      StorageManager.getItem("ivLyrics:visual:panel-bg-color") || "#6366f1",
    "panel-bg-gradient-1":
      StorageManager.getItem("ivLyrics:visual:panel-bg-gradient-1") || "#6366f1",
    "panel-bg-gradient-2":
      StorageManager.getItem("ivLyrics:visual:panel-bg-gradient-2") || "#a855f7",
    "panel-bg-opacity":
      StorageManager.getItem("ivLyrics:visual:panel-bg-opacity") || "30",
    "panel-border-enabled": StorageManager.get(
      "ivLyrics:visual:panel-border-enabled",
      false
    ),
    "panel-border-color":
      StorageManager.getItem("ivLyrics:visual:panel-border-color") || "#ffffff",
    "panel-border-opacity":
      StorageManager.getItem("ivLyrics:visual:panel-border-opacity") || "10",
    colorful: StorageManager.get("ivLyrics:visual:colorful", false),
    "gradient-background": StorageManager.get(
      "ivLyrics:visual:gradient-background"
    ),
    "album-bg-blur":
      StorageManager.getItem("ivLyrics:visual:album-bg-blur") || "20",
    "reduce-motion": StorageManager.get(
      "ivLyrics:visual:reduce-motion",
      false
    ),

    "blur-gradient-background": StorageManager.get(
      "ivLyrics:visual:blur-gradient-background",
      false
    ),
    "background-brightness":
      StorageManager.getItem("ivLyrics:visual:background-brightness") ||
      "30",
    "solid-background": StorageManager.get(
      "ivLyrics:visual:solid-background",
      false
    ),
    "video-background": StorageManager.get(
      "ivLyrics:visual:video-background",
      false
    ),
    "video-helper-enabled": StorageManager.get(
      "ivLyrics:visual:video-helper-enabled",
      false
    ),
    "lyrics-helper-enabled": StorageManager.get(
      "ivLyrics:visual:lyrics-helper-enabled",
      false
    ),
    "video-blur":
      StorageManager.getItem("ivLyrics:visual:video-blur") || "5",
    "video-cover": StorageManager.get(
      "ivLyrics:visual:video-cover",
      false
    ),
    "solid-background-color":
      StorageManager.getItem("ivLyrics:visual:solid-background-color") ||
      "#1e3a8a",
    noise: StorageManager.get("ivLyrics:visual:noise"),
    "background-color":
      StorageManager.getItem("ivLyrics:visual:background-color") ||
      "var(--spice-main)",
    "active-color":
      StorageManager.getItem("ivLyrics:visual:active-color") ||
      "var(--spice-text)",
    "inactive-color":
      StorageManager.getItem("ivLyrics:visual:inactive-color") ||
      "rgba(var(--spice-rgb-subtext),0.5)",
    "highlight-color":
      StorageManager.getItem("ivLyrics:visual:highlight-color") ||
      "var(--spice-button)",
    alignment:
      StorageManager.getItem("ivLyrics:visual:alignment") || "center",
    "lines-before":
      StorageManager.getItem("ivLyrics:visual:lines-before") || "0",
    "lines-after":
      StorageManager.getItem("ivLyrics:visual:lines-after") || "2",
    "font-size": StorageManager.getItem("ivLyrics:visual:font-size") || "32",
    "font-family":
      StorageManager.getItem("ivLyrics:visual:font-family") ||
      "Pretendard Variable",
    "original-font-family":
      StorageManager.getItem("ivLyrics:visual:original-font-family") ||
      "Pretendard Variable",
    "phonetic-font-family":
      StorageManager.getItem("ivLyrics:visual:phonetic-font-family") ||
      "Pretendard Variable",
    "translation-font-family":
      StorageManager.getItem("ivLyrics:visual:translation-font-family") ||
      "Pretendard Variable",
    "original-font-weight":
      StorageManager.getItem("ivLyrics:visual:original-font-weight") ||
      "400",
    "original-font-size":
      StorageManager.getItem("ivLyrics:visual:original-font-size") || "32",
    "translation-font-weight":
      StorageManager.getItem("ivLyrics:visual:translation-font-weight") ||
      "300",
    "translation-font-size":
      StorageManager.getItem("ivLyrics:visual:translation-font-size") ||
      "24",
    "translation-spacing":
      StorageManager.getItem("ivLyrics:visual:translation-spacing") || "8",
    "phonetic-font-weight":
      StorageManager.getItem("ivLyrics:visual:phonetic-font-weight") ||
      "400",
    "phonetic-font-size":
      StorageManager.getItem("ivLyrics:visual:phonetic-font-size") || "20",
    "phonetic-opacity":
      StorageManager.getItem("ivLyrics:visual:phonetic-opacity") || "70",
    "phonetic-spacing":
      StorageManager.getItem("ivLyrics:visual:phonetic-spacing") || "4",
    "phonetic-hyphen-replace":
      StorageManager.getItem("ivLyrics:visual:phonetic-hyphen-replace") || "keep",
    "original-letter-spacing":
      StorageManager.getItem("ivLyrics:visual:original-letter-spacing") || "0",
    "phonetic-letter-spacing":
      StorageManager.getItem("ivLyrics:visual:phonetic-letter-spacing") || "0",
    "translation-letter-spacing":
      StorageManager.getItem("ivLyrics:visual:translation-letter-spacing") || "0",
    "furigana-font-weight":
      StorageManager.getItem("ivLyrics:visual:furigana-font-weight") ||
      "300",
    "furigana-font-size":
      StorageManager.getItem("ivLyrics:visual:furigana-font-size") || "14",
    "furigana-opacity":
      StorageManager.getItem("ivLyrics:visual:furigana-opacity") || "80",
    "furigana-spacing":
      StorageManager.getItem("ivLyrics:visual:furigana-spacing") || "2",
    "text-shadow-enabled": StorageManager.get(
      "ivLyrics:visual:text-shadow-enabled",
      true
    ),
    "text-shadow-color":
      StorageManager.getItem("ivLyrics:visual:text-shadow-color") ||
      "#000000",
    "text-shadow-opacity":
      StorageManager.getItem("ivLyrics:visual:text-shadow-opacity") || "50",
    "text-shadow-blur":
      StorageManager.getItem("ivLyrics:visual:text-shadow-blur") || "2",
    "original-opacity":
      StorageManager.getItem("ivLyrics:visual:original-opacity") || "100",
    "translation-opacity":
      StorageManager.getItem("ivLyrics:visual:translation-opacity") || "85",
    "translate:translated-lyrics-source":
      StorageManager.getItem(
        "ivLyrics:visual:translate:translated-lyrics-source"
      ) || "auto",
    "translate:display-mode":
      StorageManager.getItem("ivLyrics:visual:translate:display-mode") ||
      "replace",
    "translate:target-language":
      StorageManager.getItem("ivLyrics:visual:translate:target-language") ||
      "auto",
    "translate:detect-language-override":
      StorageManager.getItem(
        "ivLyrics:visual:translate:detect-language-override"
      ) || "off",
    "translation-mode:english":
      StorageManager.getItem("ivLyrics:visual:translation-mode:english") ||
      "none",
    "translation-mode:japanese":
      StorageManager.getItem("ivLyrics:visual:translation-mode:japanese") ||
      "none",
    "translation-mode:korean":
      StorageManager.getItem("ivLyrics:visual:translation-mode:korean") ||
      "none",
    "translation-mode:chinese":
      StorageManager.getItem("ivLyrics:visual:translation-mode:chinese") ||
      "none",
    "translation-mode:russian":
      StorageManager.getItem("ivLyrics:visual:translation-mode:russian") ||
      "none",
    "translation-mode:vietnamese":
      StorageManager.getItem(
        "ivLyrics:visual:translation-mode:vietnamese"
      ) || "none",
    "translation-mode:german":
      StorageManager.getItem("ivLyrics:visual:translation-mode:german") ||
      "none",
    "translation-mode:spanish":
      StorageManager.getItem("ivLyrics:visual:translation-mode:spanish") ||
      "none",
    "translation-mode:french":
      StorageManager.getItem("ivLyrics:visual:translation-mode:french") ||
      "none",
    "translation-mode:italian":
      StorageManager.getItem("ivLyrics:visual:translation-mode:italian") ||
      "none",
    "translation-mode:portuguese":
      StorageManager.getItem(
        "ivLyrics:visual:translation-mode:portuguese"
      ) || "none",
    "translation-mode:dutch":
      StorageManager.getItem("ivLyrics:visual:translation-mode:dutch") ||
      "none",
    "translation-mode:polish":
      StorageManager.getItem("ivLyrics:visual:translation-mode:polish") ||
      "none",
    "translation-mode:turkish":
      StorageManager.getItem("ivLyrics:visual:translation-mode:turkish") ||
      "none",
    "translation-mode:arabic":
      StorageManager.getItem("ivLyrics:visual:translation-mode:arabic") ||
      "none",
    "translation-mode:hindi":
      StorageManager.getItem("ivLyrics:visual:translation-mode:hindi") ||
      "none",
    "translation-mode:thai":
      StorageManager.getItem("ivLyrics:visual:translation-mode:thai") ||
      "none",
    "translation-mode:indonesian":
      StorageManager.getItem(
        "ivLyrics:visual:translation-mode:indonesian"
      ) || "none",
    "translation-mode:gemini":
      StorageManager.getItem("ivLyrics:visual:translation-mode:gemini") ||
      "none",
    "translation-mode-2:english":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:english") ||
      "none",
    "translation-mode-2:japanese":
      StorageManager.getItem(
        "ivLyrics:visual:translation-mode-2:japanese"
      ) || "none",
    "translation-mode-2:korean":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:korean") ||
      "none",
    "translation-mode-2:chinese":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:chinese") ||
      "none",
    "translation-mode-2:russian":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:russian") ||
      "none",
    "translation-mode-2:vietnamese":
      StorageManager.getItem(
        "ivLyrics:visual:translation-mode-2:vietnamese"
      ) || "none",
    "translation-mode-2:german":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:german") ||
      "none",
    "translation-mode-2:spanish":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:spanish") ||
      "none",
    "translation-mode-2:french":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:french") ||
      "none",
    "translation-mode-2:italian":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:italian") ||
      "none",
    "translation-mode-2:portuguese":
      StorageManager.getItem(
        "ivLyrics:visual:translation-mode-2:portuguese"
      ) || "none",
    "translation-mode-2:dutch":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:dutch") ||
      "none",
    "translation-mode-2:polish":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:polish") ||
      "none",
    "translation-mode-2:turkish":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:turkish") ||
      "none",
    "translation-mode-2:arabic":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:arabic") ||
      "none",
    "translation-mode-2:hindi":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:hindi") ||
      "none",
    "translation-mode-2:thai":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:thai") ||
      "none",
    "translation-mode-2:indonesian":
      StorageManager.getItem(
        "ivLyrics:visual:translation-mode-2:indonesian"
      ) || "none",
    "translation-mode-2:gemini":
      StorageManager.getItem("ivLyrics:visual:translation-mode-2:gemini") ||
      "none",
    "gemini-api-key":
      StorageManager.getPersisted("ivLyrics:visual:gemini-api-key") || "",
    "gemini-api-key-romaji":
      StorageManager.getPersisted("ivLyrics:visual:gemini-api-key-romaji") ||
      "",
    translate: StorageManager.get("ivLyrics:visual:translate", false),
    "furigana-enabled": StorageManager.get(
      "ivLyrics:visual:furigana-enabled",
      false
    ),
    "ja-detect-threshold":
      StorageManager.getItem("ivLyrics:visual:ja-detect-threshold") || "40",
    "hans-detect-threshold":
      StorageManager.getItem("ivLyrics:visual:hans-detect-threshold") ||
      "40",
    "fade-blur": StorageManager.get("ivLyrics:visual:fade-blur"),
    "highlight-mode": StorageManager.get("ivLyrics:visual:highlight-mode", false),
    "highlight-intensity":
      StorageManager.getItem("ivLyrics:visual:highlight-intensity") || "70",
    "karaoke-bounce": StorageManager.get(
      "ivLyrics:visual:karaoke-bounce",
      true
    ),
    "karaoke-mode-enabled": StorageManager.get(
      "ivLyrics:visual:karaoke-mode-enabled",
      true
    ),
    "spotify-fake-karaoke-enabled": StorageManager.get(
      "ivLyrics:visual:spotify-fake-karaoke-enabled",
      false
    ),
    "pseudo-karaoke-render-advance": StorageManager.get(
      "ivLyrics:visual:pseudo-karaoke-render-advance",
      250
    ),
    // Prefetch settings
    "prefetch-enabled": StorageManager.get(
      "ivLyrics:visual:prefetch-enabled",
      true
    ),
    "prefetch-video-enabled": StorageManager.get(
      "ivLyrics:visual:prefetch-video-enabled",
      true
    ),
    // Community sync settings
    "community-sync-enabled": StorageManager.get(
      "ivLyrics:visual:community-sync-enabled",
      true
    ),
    "community-sync-auto-apply": StorageManager.get(
      "ivLyrics:visual:community-sync-auto-apply",
      true
    ),
    "community-sync-min-confidence":
      Number(StorageManager.getItem("ivLyrics:visual:community-sync-min-confidence")) || 0.5,
    "community-sync-auto-submit": StorageManager.get(
      "ivLyrics:visual:community-sync-auto-submit",
      false
    ),
    "fullscreen-key":
      StorageManager.getItem("ivLyrics:visual:fullscreen-key") || "f12",
    "synced-compact": StorageManager.get("ivLyrics:visual:synced-compact"),
    // 메타데이터 번역 (제목/아티스트)
    "translate-metadata": StorageManager.get(
      "ivLyrics:visual:translate-metadata",
      false
    ),
    "translate-metadata-mode":
      StorageManager.getItem("ivLyrics:visual:translate-metadata-mode") || "translated",
    // Fullscreen settings
    "fullscreen-two-column": StorageManager.get(
      "ivLyrics:visual:fullscreen-two-column",
      true
    ),
    "fullscreen-layout-reverse": StorageManager.get(
      "ivLyrics:visual:fullscreen-layout-reverse",
      false
    ),
    "fullscreen-show-album": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-album",
      true
    ),
    "fullscreen-show-info": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-info",
      true
    ),
    "fullscreen-center-when-no-lyrics": StorageManager.get(
      "ivLyrics:visual:fullscreen-center-when-no-lyrics",
      true
    ),
    "fullscreen-album-size":
      StorageManager.getItem("ivLyrics:visual:fullscreen-album-size") ||
      "400",
    "fullscreen-album-radius":
      StorageManager.getItem("ivLyrics:visual:fullscreen-album-radius") ||
      "12",
    "fullscreen-title-size":
      StorageManager.getItem("ivLyrics:visual:fullscreen-title-size") ||
      "48",
    "fullscreen-artist-size":
      StorageManager.getItem("ivLyrics:visual:fullscreen-artist-size") ||
      "24",
    "fullscreen-lyrics-right-padding":
      Number(StorageManager.getItem("ivLyrics:visual:fullscreen-lyrics-right-padding")) ||
      0,
    // Fullscreen UI elements
    "fullscreen-show-clock": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-clock",
      true
    ),
    "fullscreen-clock-size":
      Number(StorageManager.getItem("ivLyrics:visual:fullscreen-clock-size")) ||
      48,
    "fullscreen-show-context": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-context",
      true
    ),
    "fullscreen-show-next-track": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-next-track",
      true
    ),
    "fullscreen-next-track-seconds":
      Number(StorageManager.getItem("ivLyrics:visual:fullscreen-next-track-seconds")) ||
      15,
    "fullscreen-show-controls": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-controls",
      true
    ),
    "fullscreen-show-volume": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-volume",
      true
    ),
    "fullscreen-show-progress": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-progress",
      true
    ),
    "fullscreen-show-lyrics-progress": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-lyrics-progress",
      false
    ),
    // Fullscreen control styles
    "fullscreen-control-button-size":
      Number(StorageManager.getItem("ivLyrics:visual:fullscreen-control-button-size")) ||
      36,
    "fullscreen-controls-background": StorageManager.get(
      "ivLyrics:visual:fullscreen-controls-background",
      false
    ),
    // Fullscreen auto-hide
    "fullscreen-auto-hide-ui": StorageManager.get(
      "ivLyrics:visual:fullscreen-auto-hide-ui",
      true
    ),
    "fullscreen-auto-hide-delay":
      Number(StorageManager.getItem("ivLyrics:visual:fullscreen-auto-hide-delay")) ||
      3,
    // Browser fullscreen (monitor fill)
    "fullscreen-browser-fullscreen": StorageManager.get(
      "ivLyrics:visual:fullscreen-browser-fullscreen",
      false
    ),
    // TMI font size
    "fullscreen-tmi-font-size":
      Number(StorageManager.getItem("ivLyrics:visual:fullscreen-tmi-font-size")) ||
      100,
    // TV Mode settings
    "fullscreen-tv-mode": StorageManager.get(
      "ivLyrics:visual:fullscreen-tv-mode",
      false
    ),
    "fullscreen-tv-album-size":
      Number(StorageManager.getItem("ivLyrics:visual:fullscreen-tv-album-size")) ||
      140,
    "fullscreen-tv-show-album-name": StorageManager.get(
      "ivLyrics:visual:fullscreen-tv-show-album-name",
      true
    ),
    "fullscreen-tv-show-controls": StorageManager.get(
      "ivLyrics:visual:fullscreen-tv-show-controls",
      false
    ),
    "fullscreen-tv-show-progress": StorageManager.get(
      "ivLyrics:visual:fullscreen-tv-show-progress",
      false
    ),
    // Normal mode album name display
    "fullscreen-show-album-name": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-album-name",
      false
    ),
    // Title trim setting
    "fullscreen-trim-title": StorageManager.get(
      "ivLyrics:visual:fullscreen-trim-title",
      false
    ),
    // Context image setting
    "fullscreen-show-context-image": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-context-image",
      true
    ),
    // Info gap setting
    "fullscreen-info-gap":
      Number(StorageManager.getItem("ivLyrics:visual:fullscreen-info-gap")) || 24,
    // Queue panel setting
    "fullscreen-show-queue": StorageManager.get(
      "ivLyrics:visual:fullscreen-show-queue",
      true
    ),

    delay: 0,
  },

  get modes() { return window.I18n ? [I18n.t("modes.karaoke"), I18n.t("modes.synced"), I18n.t("modes.unsynced")] : ["Karaoke", "Synced", "Unsynced"]; },
};



CONFIG.visual["lines-before"] = Number.parseInt(CONFIG.visual["lines-before"]);
CONFIG.visual["lines-after"] = Number.parseInt(CONFIG.visual["lines-after"]);
CONFIG.visual["font-size"] = Number.parseInt(CONFIG.visual["font-size"]);
CONFIG.visual["original-font-weight"] = Number.parseInt(
  CONFIG.visual["original-font-weight"]
);
CONFIG.visual["original-font-size"] = Number.parseInt(
  CONFIG.visual["original-font-size"]
);
CONFIG.visual["translation-font-weight"] = Number.parseInt(
  CONFIG.visual["translation-font-weight"]
);
CONFIG.visual["translation-font-size"] = Number.parseInt(
  CONFIG.visual["translation-font-size"]
);
CONFIG.visual["text-shadow-opacity"] = Number.parseInt(
  CONFIG.visual["text-shadow-opacity"]
);
CONFIG.visual["text-shadow-blur"] = Number.parseInt(
  CONFIG.visual["text-shadow-blur"]
);
CONFIG.visual["original-opacity"] = Number.parseInt(
  CONFIG.visual["original-opacity"]
);
CONFIG.visual["translation-opacity"] = Number.parseInt(
  CONFIG.visual["translation-opacity"]
);
CONFIG.visual["background-brightness"] = Number.parseInt(
  CONFIG.visual["background-brightness"]
);
CONFIG.visual["ja-detect-threshold"] = Number.parseInt(
  CONFIG.visual["ja-detect-threshold"]
);
CONFIG.visual["hans-detect-threshold"] = Number.parseInt(
  CONFIG.visual["hans-detect-threshold"]
);
CONFIG.visual["highlight-intensity"] = Number.parseInt(
  CONFIG.visual["highlight-intensity"]
);

// Extension에서 접근 가능하도록 window에 노출
window.CONFIG = CONFIG;

let CACHE = {};

const emptyState = {
  karaoke: null,
  synced: null,
  unsynced: null,
  currentLyrics: null,
};

// Enhanced cache system with memory-efficient LRU and automatic cleanup
const CacheManager = {
  _cache: new Map(),
  _maxSize: 100, // Limit cache to 100 songs
  _ttl: 30 * 60 * 1000, // 30 minutes TTL
  _cleanupTimer: null,
  _statsEnabled: false,

  // Performance statistics
  _stats: {
    hits: 0,
    misses: 0,
    evictions: 0,
    cleanups: 0,
  },

  init() {
    // Start periodic cleanup to prevent memory leaks
    this._startPeriodicCleanup();

    // Listen for memory pressure events
    if ("memory" in performance) {
      this._setupMemoryPressureListener();
    }
  },

  get(key) {
    const item = this._cache.get(key);
    if (!item) {
      if (this._statsEnabled) this._stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > item.expiry) {
      this._cache.delete(key);
      if (this._statsEnabled) this._stats.misses++;
      return null;
    }

    // Update access time for LRU (move to end)
    this._cache.delete(key);
    item.lastAccessed = Date.now();
    this._cache.set(key, item);

    if (this._statsEnabled) this._stats.hits++;
    return item.data;
  },

  set(key, data) {
    // Clean up if cache is getting too large
    if (this._cache.size >= this._maxSize) {
      this._cleanupOldEntries();
    }

    this._cache.set(key, {
      data,
      expiry: Date.now() + this._ttl,
      lastAccessed: Date.now(),
      size: this._estimateSize(data),
    });
  },

  _cleanupOldEntries() {
    // LRU eviction - remove oldest entries
    const entries = Array.from(this._cache.entries());
    const toRemove = Math.floor(entries.length * 0.3); // Remove 30% to reduce frequent cleanups

    // Sort by last accessed time (oldest first)
    entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    for (let i = 0; i < toRemove; i++) {
      this._cache.delete(entries[i][0]);
    }

    if (this._statsEnabled) {
      this._stats.evictions += toRemove;
      this._stats.cleanups++;
    }
  },

  _startPeriodicCleanup() {
    // Clean up expired entries every 5 minutes
    this._cleanupTimer = setInterval(() => {
      const now = Date.now();
      const keysToDelete = [];

      for (const [key, item] of this._cache.entries()) {
        if (now > item.expiry) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach((key) => this._cache.delete(key));

      if (this._statsEnabled && keysToDelete.length > 0) {
        this._stats.cleanups++;
      }
    }, 5 * 60 * 1000);
  },

  _setupMemoryPressureListener() {
    // Aggressive cleanup on memory pressure
    if (typeof PerformanceObserver !== "undefined") {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.name === "memory") {
              const { totalJSHeapSize, usedJSHeapSize, jsHeapSizeLimit } =
                entry;
              const memoryUsage = usedJSHeapSize / jsHeapSizeLimit;

              // If memory usage > 80%, clear half the cache
              if (memoryUsage > 0.8) {
                this._aggressiveCleanup();
              }
            }
          }
        });
        observer.observe({ entryTypes: ["measure"] });
      } catch (error) {
        // Performance Observer not available
      }
    }
  },

  _aggressiveCleanup() {
    const entries = Array.from(this._cache.entries());
    const toRemove = Math.floor(entries.length * 0.5);

    entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    for (let i = 0; i < toRemove; i++) {
      this._cache.delete(entries[i][0]);
    }
  },

  _estimateSize(data) {
    // Rough estimation of object size in bytes
    try {
      return JSON.stringify(data).length * 2; // 2 bytes per character (UTF-16)
    } catch {
      return 1000; // Default estimate
    }
  },

  clear() {
    this._cache.clear();
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  },

  // Clear cache entries for a specific URI
  clearByUri(uri) {
    const keysToDelete = [];
    for (const [key] of this._cache) {
      if (key.includes(uri)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => this._cache.delete(key));
    return keysToDelete.length;
  },

  // Get cache statistics
  getStats() {
    const hitRate =
      (this._stats.hits / (this._stats.hits + this._stats.misses)) * 100;
    return {
      ...this._stats,
      hitRate: isNaN(hitRate) ? 0 : hitRate.toFixed(2),
      cacheSize: this._cache.size,
      maxSize: this._maxSize,
    };
  },

  enableStats() {
    this._statsEnabled = true;
  },
};

// window에 등록하여 Settings.js에서 접근 가능하도록 함
window.CacheManager = CacheManager;
window.CACHE = CACHE;

// Rate limiting utility
const RateLimiter = {
  _calls: new Map(),

  canMakeCall(key, maxCalls = 5, windowMs = 60000) {
    const now = Date.now();
    const calls = this._calls.get(key) || [];
    let firstValidIndex = 0;
    while (
      firstValidIndex < calls.length &&
      now - calls[firstValidIndex] >= windowMs
    ) {
      firstValidIndex++;
    }

    const validCalls =
      firstValidIndex === 0 ? calls : calls.slice(firstValidIndex);

    if (validCalls.length >= maxCalls) {
      return false;
    }

    validCalls.push(now);
    this._calls.set(key, validCalls);
    return true;
  },
};

// ============================================
// SpotifyDataHelper - Spotify 트랙 메타데이터 추출 유틸리티
// ============================================
const SpotifyDataHelper = {
  /**
   * Spotify 트랙 데이터를 추출
   * @param {string} uri - Spotify URI (spotify:track:XXXX)
   * @returns {Object|null} spotifyData
   */
  extractSpotifyData(uri) {
    try {
      const trackId = uri?.split(':')[2];
      if (!trackId) return null;

      const playerData = Spicetify.Player?.data;
      const currentTrack = playerData?.item || playerData?.track?.metadata;

      if (!currentTrack) return null;

      const currentUri = currentTrack.uri || `spotify:track:${currentTrack.id}`;
      if (currentUri !== uri) {
        const queue = Spicetify.Queue?.nextTracks || [];
        const nextTrack = queue.find(t => {
          const tUri = t.contextTrack?.uri || t.uri;
          return tUri === uri;
        });
        if (nextTrack) {
          const metadata = nextTrack.contextTrack?.metadata || nextTrack.metadata || {};
          return {
            name: metadata.title || nextTrack.name,
            artists: this._parseArtists(metadata),
            album: metadata.album_title || metadata.album,
            isrc: metadata.isrc || null,
            duration_ms: parseInt(metadata.duration) || nextTrack.duration_ms || 0
          };
        }
        return null;
      }

      const metadata = currentTrack.metadata || currentTrack;
      return {
        name: metadata.title || currentTrack.name,
        artists: this._parseArtists(metadata),
        album: metadata.album_title || metadata.album?.name || metadata.album,
        isrc: metadata.isrc || currentTrack.external_ids?.isrc || null,
        duration_ms: parseInt(metadata.duration) || currentTrack.duration_ms || 0
      };
    } catch (error) {
      console.warn('[SpotifyDataHelper] Failed to extract Spotify data:', error);
      return null;
    }
  },

  _parseArtists(metadata) {
    if (metadata.artist_name) {
      return metadata.artist_name.split(', ');
    }
    if (metadata.artists) {
      if (Array.isArray(metadata.artists)) {
        return metadata.artists.map(a => a.name || a);
      }
      return [metadata.artists];
    }
    return [];
  }
};

window.SpotifyDataHelper = SpotifyDataHelper;

// Prefetcher for next track elements (lyrics, phonetic, translation, video background)
const Prefetcher = {
  _prefetchCache: new Map(),
  _inflightRequests: new Map(),
  _lastPrefetchedUri: null,
  _prefetchDelay: 1500, // 1.5초 지연 후 프리페치 시작
  _prefetchTimer: null,
  _lyricsContainer: null, // LyricsContainer 참조

  /**
   * LyricsContainer 참조 설정
   */
  setLyricsContainer(container) {
    this._lyricsContainer = container;
  },

  /**
   * 다음 곡의 모든 요소를 미리 요청 (통합 데이터 → 가사 → 번역/발음 → 영상 배경)
   * @param {Object} trackInfo - 트랙 정보 (uri, artist, title 등)
   * @param {number} mode - 가사 모드
   */
  async prefetchNextTrack(trackInfo, mode = -1) {
    if (!trackInfo?.uri) return;

    // 이미 프리페치된 곡이면 스킵
    if (this._lastPrefetchedUri === trackInfo.uri) return;

    // 이전 프리페치 타이머 취소
    if (this._prefetchTimer) {
      clearTimeout(this._prefetchTimer);
      this._prefetchTimer = null;
    }

    // 약간의 지연 후 프리페치 시작 (현재 곡 로딩에 영향을 주지 않도록)
    this._prefetchTimer = setTimeout(async () => {
      this._lastPrefetchedUri = trackInfo.uri;

      ivLyricsDebug(`[Prefetcher] Starting prefetch for: ${trackInfo.title}`);

      try {
        // 영상 배경 프리페치는 가사 유무와 무관하게 독립적으로 시작
        const prefetchPromises = [];
        if (CONFIG.visual["video-background"] && CONFIG.visual["prefetch-video-enabled"] !== false) {
          prefetchPromises.push(this._prefetchVideoBackground(trackInfo.uri));
        }

        // 1단계: 가사 먼저 프리페치
        const lyrics = await this._prefetchLyrics(trackInfo, mode);

        if (!lyrics || (!lyrics.synced && !lyrics.unsynced && !lyrics.karaoke)) {
          ivLyricsDebug(`[Prefetcher] No lyrics found for: ${trackInfo.title}`);
        } else {
          // 2단계: 가사 로드 완료 후 번역/발음 프리페치
          if (CONFIG.visual["prefetch-enabled"] !== false) {
            prefetchPromises.push(this._prefetchTranslations(trackInfo, lyrics));
          }
        }

        if (prefetchPromises.length > 0) {
          await Promise.allSettled(prefetchPromises);
        }
        ivLyricsDebug(`[Prefetcher] Completed all prefetch for: ${trackInfo.title}`);
      } catch (error) {
        console.warn(`[Prefetcher] Prefetch failed:`, error);
      }
    }, this._prefetchDelay);
  },

  /**
   * 가사 프리페치
   */
  async _prefetchLyrics(trackInfo, mode) {
    const uri = trackInfo.uri;

    // 이미 CACHE에 있으면 반환
    if (CACHE[uri]) {
      ivLyricsDebug(`[Prefetcher] Lyrics already cached for: ${trackInfo.title}`);
      return CACHE[uri];
    }

    // 이미 요청 중이면 기존 요청 반환
    const inflightKey = `lyrics:${uri}`;
    if (this._inflightRequests.has(inflightKey)) {
      return this._inflightRequests.get(inflightKey);
    }

    const prefetchPromise = (async () => {
      try {
        ivLyricsDebug(`[Prefetcher] Fetching lyrics for: ${trackInfo.title}`);

        // 마켓플레이스 에드온 로드 대기
        if (window.MarketplaceManager?.readyPromise) {
          await window.MarketplaceManager.readyPromise;
        }

        // LyricsService Extension을 통해 가사 로드 (LyricsAddonManager 사용)
        const resp = await window.LyricsService.getLyricsFromProviders(trackInfo);
        if (!resp.uri) resp.uri = trackInfo.uri;

        if (resp?.provider) {
          // 가사 캐시에 저장
          CACHE[resp.uri] = resp;
          ivLyricsDebug(`[Prefetcher] Lyrics cached for: ${trackInfo.title} (provider: ${resp.provider})`);
          return resp;
        }

        return null;
      } catch (error) {
        console.warn(`[Prefetcher] Lyrics prefetch failed:`, error.message);
        return null;
      } finally {
        this._inflightRequests.delete(inflightKey);
      }
    })();

    this._inflightRequests.set(inflightKey, prefetchPromise);
    return prefetchPromise;
  },

  /**
   * Gemini 번역/발음 프리페치
   */
  async _prefetchTranslations(trackInfo, lyrics) {
    const uri = trackInfo.uri;
    const trackId = uri?.split(':')[2];  // spotify:track:XXXX -> XXXX
    const cacheKeyBase = `prefetch:translation:${uri}`;

    // 이미 캐시에 있으면 스킵
    if (this._prefetchCache.has(cacheKeyBase)) {
      ivLyricsDebug(`[Prefetcher] Translation already cached for: ${trackInfo.title}`);
      return;
    }

    // 이미 요청 중이면 기존 요청 반환
    if (this._inflightRequests.has(cacheKeyBase)) {
      return this._inflightRequests.get(cacheKeyBase);
    }

    const lyricsArray = lyrics.synced || lyrics.unsynced || lyrics.karaoke;
    if (!lyricsArray || lyricsArray.length === 0) return;

    // 언어 감지
    const detectedLanguage = LyricsService.detectLanguage(lyricsArray);
    if (!detectedLanguage) return;
    // Update Utils detected language for furigana check
    Utils.setDetectedLanguage(detectedLanguage);

    // 현재 설정된 display mode 확인
    let friendlyLanguage = null;
    try {
      friendlyLanguage = new Intl.DisplayNames(["en"], { type: "language" })
        .of(detectedLanguage.split("-")[0])
        ?.toLowerCase();
    } catch (error) {
      // ignore
    }

    const modeKey = friendlyLanguage || "gemini";
    const displayMode1 = CONFIG.visual[`translation-mode:${modeKey}`];
    const displayMode2 = CONFIG.visual[`translation-mode-2:${modeKey}`];

    // 번역/발음 모드가 설정되어 있지 않으면 스킵
    if ((!displayMode1 || displayMode1 === "none") && (!displayMode2 || displayMode2 === "none")) {
      return;
    }

    // Section header 제외한 텍스트 추출
    const text = getNonSectionLyricsText(lyricsArray);

    if (!text.trim()) return;

    // 발음이 필요한지, 번역이 필요한지 확인
    const needPhonetic = displayMode1 === "gemini_romaji" || displayMode2 === "gemini_romaji";
    const needTranslation = (displayMode1 && displayMode1 !== "none" && displayMode1 !== "gemini_romaji") ||
      (displayMode2 && displayMode2 !== "none" && displayMode2 !== "gemini_romaji");

    const prefetchPromise = (async () => {
      try {
        ivLyricsDebug(`[Prefetcher] Fetching translation for: ${trackInfo.title} (phonetic: ${needPhonetic}, translation: ${needTranslation})`);

        // CacheManager에도 저장 (getGeminiTranslation에서 사용)
        const processTranslationResult = (outText) => {
          if (!outText) return null;

          let lines;
          if (Array.isArray(outText)) {
            lines = outText;
          } else if (typeof outText === "string") {
            lines = outText.split("\n");
          } else {
            return null;
          }

          const originalNonSectionIndexMap = new Map();
          let nonSectionLineIndex = 0;
          lyricsArray.forEach((line, i) => {
            const lineText = line?.text || "";
            if (!Utils.isSectionHeader(lineText) && lineText.trim() !== "") {
              originalNonSectionIndexMap.set(i, nonSectionLineIndex++);
            }
          });

          const cleanTranslationLines = lines.filter(
            (line) => line && line.trim() !== "" && !Utils.isSectionHeader(line.trim())
          );

          const mapped = lyricsArray.map((line, i) => {
            const originalText = line?.text || "";
            if (Utils.isSectionHeader(originalText)) {
              return { ...line, text: null, originalText };
            }
            if (originalText.trim() === "") {
              return { ...line, text: "", originalText };
            }
            const positionInNonSectionLines = originalNonSectionIndexMap.get(i);
            const translatedText = cleanTranslationLines[positionInNonSectionLines]?.trim() || "";
            return { ...line, text: translatedText || line?.text || "", originalText };
          });

          return mapped;
        };

        // 발음 요청 (wantSmartPhonetic = true)
        if (needPhonetic) {
          try {
            const phoneticResponse = await window.Translator.callGemini({
              trackId,
              artist: trackInfo.artist,
              title: trackInfo.title,
              text,
              wantSmartPhonetic: true,
              provider: lyrics.provider,
              ignoreCache: false,
            });

            if (phoneticResponse.phonetic) {
              const mapped = processTranslationResult(phoneticResponse.phonetic);
              if (mapped) {
                CacheManager.set(`${uri}:${lyrics.provider}:gemini_romaji`, mapped);
                ivLyricsDebug(`[Prefetcher] Phonetic cached for: ${trackInfo.title} (provider: ${lyrics.provider})`);
              }
            }
          } catch (error) {
            console.warn(`[Prefetcher] Phonetic prefetch failed:`, error.message);
          }
        }

        // 번역 요청 (wantSmartPhonetic = false)
        if (needTranslation) {
          try {
            const translationResponse = await window.Translator.callGemini({
              trackId,
              artist: trackInfo.artist,
              title: trackInfo.title,
              text,
              wantSmartPhonetic: false,
              provider: lyrics.provider,
              ignoreCache: false,
            });

            if (translationResponse.translation) {
              const mapped = processTranslationResult(translationResponse.translation);
              if (mapped) {
                // mode1, mode2 중 번역이 필요한 것에 캐시 저장
                if (displayMode1 && displayMode1 !== "none" && displayMode1 !== "gemini_romaji") {
                  CacheManager.set(`${uri}:${lyrics.provider}:${displayMode1}`, mapped);
                }
                if (displayMode2 && displayMode2 !== "none" && displayMode2 !== "gemini_romaji") {
                  CacheManager.set(`${uri}:${lyrics.provider}:${displayMode2}`, mapped);
                }
                ivLyricsDebug(`[Prefetcher] Translation cached for: ${trackInfo.title} (provider: ${lyrics.provider})`);
              }
            }
          } catch (error) {
            console.warn(`[Prefetcher] Translation prefetch failed:`, error.message);
          }
        }

        // 결과를 프리페치 캐시에 저장 (완료 표시용)
        this._prefetchCache.set(cacheKeyBase, {
          lyricsArray,
          displayMode1,
          displayMode2,
          timestamp: Date.now(),
        });

        ivLyricsDebug(`[Prefetcher] Prefetch completed for: ${trackInfo.title}`);
        return true;
      } catch (error) {
        console.warn(`[Prefetcher] Translation prefetch failed:`, error.message);
        return null;
      } finally {
        this._inflightRequests.delete(cacheKeyBase);
      }
    })();

    this._inflightRequests.set(cacheKeyBase, prefetchPromise);
    return prefetchPromise;
  },

  /**
   * 영상 배경 정보 프리페치
   */
  async _prefetchVideoBackground(uri) {
    const trackId = uri.split(":")[2];
    const cacheKey = `prefetch:video:${trackId}`;

    // 이미 캐시에 있으면 스킵
    if (this._prefetchCache.has(cacheKey)) {
      ivLyricsDebug(`[Prefetcher] Video info already cached for trackId: ${trackId}`);
      const cached = this._prefetchCache.get(cacheKey);
      if (cached?.data?.youtubeVideoId) {
        this._prefetchVideoWithHelper(cached.data.youtubeVideoId);
      }
      return;
    }

    // 이미 요청 중이면 기존 요청 반환
    if (this._inflightRequests.has(cacheKey)) {
      return this._inflightRequests.get(cacheKey);
    }

    const prefetchPromise = (async () => {
      try {
        ivLyricsDebug(`[Prefetcher] Fetching video info for trackId: ${trackId} (fallback)`);

        const userHash = Utils.getUserHash();
        // Spotify 트랙 메타데이터를 백엔드에 전달 (백엔드가 Spotify API에 접근 불가하므로)
        let youtubeApiUrl = `https://lyrics.api.ivl.is/lyrics/youtube?trackId=${trackId}&userHash=${userHash}`;
        const spotifyData = SpotifyDataHelper.extractSpotifyData(uri);
        if (spotifyData?.name) {
          youtubeApiUrl += `&trackName=${encodeURIComponent(spotifyData.name)}`;
          if (spotifyData.artists?.length) {
            youtubeApiUrl += `&trackArtists=${encodeURIComponent(spotifyData.artists.join(', '))}`;
          }
        }
        const response = await fetch(youtubeApiUrl);
        const data = await response.json();

        if (data.success) {
          this._prefetchCache.set(cacheKey, {
            data: data.data,
            timestamp: Date.now(),
          });
          ivLyricsDebug(`[Prefetcher] Video info cached for trackId: ${trackId}`);
          // 헬퍼를 통한 영상 미리 다운로드
          if (data.data?.youtubeVideoId) {
            this._prefetchVideoWithHelper(data.data.youtubeVideoId);
          }
        }

        return data;
      } catch (error) {
        console.warn(`[Prefetcher] Video prefetch failed:`, error.message);
        return null;
      } finally {
        this._inflightRequests.delete(cacheKey);
      }
    })();

    this._inflightRequests.set(cacheKey, prefetchPromise);
    return prefetchPromise;
  },

  /**
   * 헬퍼 프로그램을 통한 영상 미리 다운로드
   * @param {string} videoId - YouTube 비디오 ID
   */
  async _prefetchVideoWithHelper(videoId) {
    // 헬퍼 프리페치 설정 확인
    if (CONFIG.visual["prefetch-video-enabled"] === false) return;
    if (CONFIG.visual["video-helper-enabled"] !== true && CONFIG.visual["video-helper-enabled"] !== "true") return;

    // VideoHelperService 존재 확인
    if (typeof VideoHelperService === "undefined") return;

    const helperCacheKey = `prefetch:helper:${videoId}`;

    // 이미 프리페치 요청 중이면 스킵
    if (this._inflightRequests.has(helperCacheKey)) {
      ivLyricsDebug(`[Prefetcher] Helper prefetch already in progress for: ${videoId}`);
      return;
    }

    // 이미 다운로드 완료된 영상이면 스킵
    if (this._prefetchCache.has(helperCacheKey)) {
      ivLyricsDebug(`[Prefetcher] Video already prefetched via helper: ${videoId}`);
      return;
    }

    try {
      // 헬퍼 연결 상태 확인
      const isAvailable = await VideoHelperService.isHelperAvailable();
      if (!isAvailable) {
        ivLyricsDebug(`[Prefetcher] Helper not available, skipping prefetch for: ${videoId}`);
        return;
      }

      ivLyricsDebug(`[Prefetcher] Starting helper prefetch for video: ${videoId}`);

      // 요청 중 표시
      this._inflightRequests.set(helperCacheKey, true);

      // 헬퍼에 영상 요청 (다운로드 시작)
      const abortFn = VideoHelperService.requestVideo(videoId, {
        onProgress: (percent, speed, eta, message, status) => {
          if (percent > 0 && percent < 100) {
            ivLyricsDebug(`[Prefetcher] Helper prefetch progress: ${percent}% for ${videoId}`);
          }
        },
        onComplete: (url) => {
          ivLyricsDebug(`[Prefetcher] Helper prefetch complete for: ${videoId}`);
          this._prefetchCache.set(helperCacheKey, {
            videoId: videoId,
            url: url,
            timestamp: Date.now(),
          });
          this._inflightRequests.delete(helperCacheKey);
        },
        onError: (message) => {
          console.warn(`[Prefetcher] Helper prefetch failed for ${videoId}:`, message);
          this._inflightRequests.delete(helperCacheKey);
        },
      });

      // 30초 후 자동 중단 (너무 오래 걸리면)
      setTimeout(() => {
        if (this._inflightRequests.has(helperCacheKey)) {
          ivLyricsDebug(`[Prefetcher] Helper prefetch timeout for: ${videoId}`);
          abortFn();
          this._inflightRequests.delete(helperCacheKey);
        }
      }, 30000);

    } catch (error) {
      console.warn(`[Prefetcher] Helper prefetch error:`, error.message);
      this._inflightRequests.delete(helperCacheKey);
    }
  },

  /**
   * 프리페치된 영상 배경 정보 가져오기
   */
  getVideoInfo(uri) {
    const trackId = uri.split(":")[2];
    const cacheKey = `prefetch:video:${trackId}`;
    const cached = this._prefetchCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
      return cached.data;
    }
    return null;
  },

  /**
   * 캐시 정리
   */
  clearCache() {
    this._prefetchCache.clear();
    this._inflightRequests.clear();
    this._lastPrefetchedUri = null;
  },

  /**
   * 오래된 캐시 항목 정리 (30분 이상)
   */
  cleanupOldEntries() {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000;

    for (const [key, value] of this._prefetchCache) {
      if (now - value.timestamp > maxAge) {
        this._prefetchCache.delete(key);
      }
    }
  },
};

// 주기적으로 오래된 프리페치 캐시 정리 (10분마다)
if (!window.__ivLyricsPrefetchCleanupTimer) {
    window.__ivLyricsPrefetchCleanupTimer = setInterval(() => {
        Prefetcher.cleanupOldEntries();
    }, 10 * 60 * 1000);
}

let lyricContainerUpdate;
let reloadLyrics;

const fontSizeLimit = { min: 16, max: 256, step: 4 };

const thresholdSizeLimit = { min: 0, max: 100, step: 5 };

const LyricsCacheEditModal = ({
  isOpen,
  isLoading,
  isSaving,
  originalLines,
  pronunciationText,
  translationText,
  expectedLineCount,
  hasPronunciationCache,
  hasTranslationCache,
  trackTitle,
  trackArtist,
  provider,
  error,
  onClose,
  onSave,
  onPronunciationChange,
  onTranslationChange,
}) => {
  if (!isOpen) {
    return null;
  }

  const normalizeEditorLines = (text, count) => {
    const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
    while (lines.length < count) {
      lines.push("");
    }
    return lines.slice(0, count);
  };

  const sanitizedOriginalLines = Array.isArray(originalLines)
    ? Array.from({ length: expectedLineCount }, (_, index) =>
      String(originalLines[index] ?? "")
    )
    : normalizeEditorLines("", expectedLineCount);
  const pronunciationLines = normalizeEditorLines(
    pronunciationText,
    expectedLineCount
  );
  const translationLines = normalizeEditorLines(
    translationText,
    expectedLineCount
  );

  const updateLine = (lines, index, nextValue, onChange) => {
    const nextLines = [...lines];
    nextLines[index] = String(nextValue ?? "").replace(/\r\n?/g, " ");
    onChange(nextLines.join("\n"));
  };

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget && !isSaving) {
      onClose();
    }
  };

  return react.createElement(
    "div",
    {
      className: "ivlyrics-cache-edit-overlay",
      onClick: handleOverlayClick,
    },
    react.createElement(
      "div",
      {
        className: "ivlyrics-cache-edit-modal",
        role: "dialog",
        "aria-modal": true,
        "aria-label": I18n.t("lyricsCacheEditor.title"),
      },
      react.createElement(
        "div",
        { className: "ivlyrics-cache-edit-header" },
        react.createElement(
          "div",
          { className: "ivlyrics-cache-edit-header-copy" },
          react.createElement(
            "h2",
            { className: "ivlyrics-cache-edit-title" },
            I18n.t("lyricsCacheEditor.title")
          ),
          react.createElement(
            "p",
            { className: "ivlyrics-cache-edit-subtitle" },
            `${trackTitle || I18n.t("lyricsCacheEditor.unknownTrack")}${trackArtist ? ` · ${trackArtist}` : ""}`
          ),
          react.createElement(
            "p",
            { className: "ivlyrics-cache-edit-meta" },
            `${I18n.t("lyricsCacheEditor.lineCount")}: ${expectedLineCount}${provider ? ` · ${provider}` : ""}`
          )
        ),
        react.createElement(
          "button",
          {
            type: "button",
            className: "ivlyrics-cache-edit-close",
            onClick: onClose,
            disabled: isSaving,
            "aria-label": I18n.t("lyricsCacheEditor.close"),
          },
          "×"
        )
      ),
      react.createElement(
        "div",
        { className: "ivlyrics-cache-edit-body" },
        isLoading
          ? react.createElement(
            "div",
            { className: "ivlyrics-cache-edit-loading" },
            I18n.t("lyricsCacheEditor.loading")
          )
          : react.createElement(
            "div",
            { className: "ivlyrics-cache-edit-content" },
            react.createElement(
              "div",
              { className: "ivlyrics-cache-edit-status" },
              react.createElement(
                "div",
                { className: "ivlyrics-cache-edit-status-item" },
                react.createElement(
                  "span",
                  null,
                  I18n.t("menu.pronunciation")
                ),
                react.createElement(
                  "span",
                  { className: "ivlyrics-cache-edit-badge" },
                  hasPronunciationCache
                    ? I18n.t("lyricsCacheEditor.cached")
                    : I18n.t("lyricsCacheEditor.empty")
                )
              ),
              react.createElement(
                "div",
                { className: "ivlyrics-cache-edit-status-item" },
                react.createElement(
                  "span",
                  null,
                  I18n.t("menu.translationLabel")
                ),
                react.createElement(
                  "span",
                  { className: "ivlyrics-cache-edit-badge" },
                  hasTranslationCache
                    ? I18n.t("lyricsCacheEditor.cached")
                    : I18n.t("lyricsCacheEditor.empty")
                )
              )
            ),
            react.createElement(
              "div",
              { className: "ivlyrics-cache-edit-list" },
              ...sanitizedOriginalLines.map((originalLine, index) =>
                react.createElement(
                  "div",
                  {
                    key: `cache-edit-line-${index}`,
                    className: "ivlyrics-cache-edit-item",
                  },
                  react.createElement(
                    "div",
                    { className: "ivlyrics-cache-edit-item-index" },
                    index + 1
                  ),
                  react.createElement(
                    "div",
                    { className: "ivlyrics-cache-edit-item-fields" },
                    react.createElement(
                      "div",
                      { className: "ivlyrics-cache-edit-field" },
                      react.createElement(
                        "div",
                        { className: "ivlyrics-cache-edit-field-header" },
                        react.createElement(
                          "span",
                          null,
                          I18n.t("lyricsCacheEditor.original")
                        ),
                        react.createElement(
                          "span",
                          { className: "ivlyrics-cache-edit-badge" },
                          I18n.t("lyricsCacheEditor.reference")
                        )
                      ),
                      react.createElement(
                        "div",
                        { className: "ivlyrics-cache-edit-original-line" },
                        originalLine || " "
                      )
                    ),
                    react.createElement(
                      "div",
                      { className: "ivlyrics-cache-edit-field" },
                      react.createElement(
                        "div",
                        { className: "ivlyrics-cache-edit-field-header" },
                        react.createElement(
                          "span",
                          null,
                          I18n.t("menu.pronunciation")
                        )
                      ),
                      react.createElement("textarea", {
                        className: "ivlyrics-cache-edit-line-input",
                        rows: 2,
                        value: pronunciationLines[index] ?? "",
                        onChange: (event) =>
                          updateLine(
                            pronunciationLines,
                            index,
                            event.target.value,
                            onPronunciationChange
                          ),
                        onKeyDown: (event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                          }
                        },
                        spellCheck: false,
                        placeholder: I18n.t(
                          "lyricsCacheEditor.pronunciationPlaceholder"
                        ),
                      })
                    ),
                    react.createElement(
                      "div",
                      { className: "ivlyrics-cache-edit-field" },
                      react.createElement(
                        "div",
                        { className: "ivlyrics-cache-edit-field-header" },
                        react.createElement(
                          "span",
                          null,
                          I18n.t("menu.translationLabel")
                        )
                      ),
                      react.createElement("textarea", {
                        className: "ivlyrics-cache-edit-line-input",
                        rows: 2,
                        value: translationLines[index] ?? "",
                        onChange: (event) =>
                          updateLine(
                            translationLines,
                            index,
                            event.target.value,
                            onTranslationChange
                          ),
                        onKeyDown: (event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                          }
                        },
                        spellCheck: true,
                        placeholder: I18n.t(
                          "lyricsCacheEditor.translationPlaceholder"
                        ),
                      })
                    )
                  )
                )
              )
            )
          ),
        error &&
        react.createElement(
          "p",
          { className: "ivlyrics-cache-edit-error" },
          error
        )
      ),
      react.createElement(
        "div",
        { className: "ivlyrics-cache-edit-footer" },
        react.createElement(
          "button",
          {
            type: "button",
            className: "ivlyrics-cache-edit-button secondary",
            onClick: onClose,
            disabled: isSaving,
          },
          I18n.t("lyricsCacheEditor.cancel")
        ),
        react.createElement(
          "button",
          {
            type: "button",
            className: "ivlyrics-cache-edit-button primary",
            onClick: onSave,
            disabled: isLoading || isSaving,
          },
          isSaving
            ? I18n.t("lyricsCacheEditor.saving")
            : I18n.t("lyricsCacheEditor.save")
        )
      )
    )
  );
};

class LyricsContainer extends react.Component {
  constructor() {
    super();
    this.state = {
      karaoke: null,
      synced: null,
      unsynced: null,
      currentLyrics: null,
      romaji: null,
      furigana: null,
      hiragana: null,
      hangul: null,
      romaja: null,
      katakana: null,
      cn: null,
      hk: null,
      tw: null,
      uri: "",
      provider: "",
      contributors: null,
      colors: {
        background: "",
        inactive: "",
      },
      dynamicColors: null,
      tempo: "0.25s",
      explicitMode: -1,
      mode: -1,
      isLoading: false,
      showMarketplace: false,
      versionIndex: 0,
      versionIndex2: 0,
      isFullscreen: false,
      isFloatingMenuOpen: false,
      isFloatingMenuClosing: false,
      isFADMode: false,
      isCached: false,
      language: null,
      isPhoneticLoading: false,
      isTranslationLoading: false,
      currentLyricIndex: 0,
      videoInfo: null,
      // 메타데이터 번역
      translatedMetadata: null,
      isLyricsEditModalOpen: false,
      isLyricsEditLoading: false,
      isLyricsEditSaving: false,
      lyricsEditOriginalLines: [],
      lyricsEditPronunciationText: "",
      lyricsEditTranslationText: "",
      lyricsEditHasPronunciationCache: false,
      lyricsEditHasTranslationCache: false,
      lyricsEditError: "",
    };
    this.currentTrackUri = "";
    this.nextTrackUri = "";
    this._cleanupFloatingMenuOutsideClick = null;
    this.availableModes = [];
    this.styleVariables = {};
    this.fullscreenContainer = document.createElement("div");
    this.fullscreenContainer.id = "lyrics-fullscreen-container";
    this.mousetrap = null;
    this.containerRef = react.createRef(null);
    this.translator = null;
    this.initMoustrap();
    // Cache last state
    this.languageOverride = CONFIG.visual["translate:detect-language-override"];
    // 트랙별 언어 오버라이드 (IndexedDB에서 로드)
    this.trackLanguageOverride = null;
    this.reRenderLyricsPage = false;
    this.displayMode = null;

    // Prevent infinite render loops
    this.lastProcessedUri = null;
    this.lastProcessedMode = null;

    // Translation loading timers - separate for phonetic and translation
    this.phoneticLoadingTimer = null;
    this.translationLoadingTimer = null;
    this.streamingApplyTimer = null;
    this.pendingStreamingPayload = null;
    this.floatingMenuCloseTimer = null;

    // Portrait viewport detection
    this._isPortraitViewport = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(orientation: portrait)").matches
      : false;

    // Mouse idle timer for auto-hiding controls
    this.mouseIdleTimer = null;
    this.isMouseActive = true;

    // Mouse event handlers for auto-hide controls (defined here so ref can use them)
    this._handleMouseMove = () => {
      this.isMouseActive = true;
      const container = this.containerRef.current;
      if (container) {
        container.classList.remove('controls-hidden');
        container.classList.remove('ui-hidden');
      }

      // Clear existing timer
      if (this.mouseIdleTimer) {
        clearTimeout(this.mouseIdleTimer);
      }

      // Set new timer - hide after 3 seconds of inactivity
      this.mouseIdleTimer = setTimeout(() => {
        this.isMouseActive = false;
        const container = this.containerRef.current;
        if (container) {
          container.classList.add('controls-hidden');
          container.classList.add('ui-hidden');
        }
      }, 3000);
    };

    this._handleMouseLeave = () => {
      // Immediately hide when mouse leaves
      if (this.mouseIdleTimer) clearTimeout(this.mouseIdleTimer);
      this.isMouseActive = false;
      const container = this.containerRef.current;
      if (container) {
        container.classList.add('controls-hidden');
        container.classList.add('ui-hidden');
      }
    };

    // Bind regenerate translation method
    this.regenerateTranslation = this.regenerateTranslation.bind(this);
  }

  shouldReduceMotion() {
    return CONFIG.visual["reduce-motion"] === true;
  }

  getMotionDurationMs() {
    return this.shouldReduceMotion() ? 24 : 280;
  }

  clearFloatingMenuCloseTimer() {
    if (this.floatingMenuCloseTimer) {
      clearTimeout(this.floatingMenuCloseTimer);
      this.floatingMenuCloseTimer = null;
    }
  }

  openFloatingMenu() {
    this.clearFloatingMenuCloseTimer();
    this.setState({
      isFloatingMenuOpen: true,
      isFloatingMenuClosing: false,
    });
  }

  closeFloatingMenu() {
    if (!this.state.isFloatingMenuOpen && !this.state.isFloatingMenuClosing) {
      return;
    }

    this.clearFloatingMenuCloseTimer();
    this.setState({
      isFloatingMenuOpen: false,
      isFloatingMenuClosing: true,
    });

    this.floatingMenuCloseTimer = setTimeout(() => {
      this.setState({ isFloatingMenuClosing: false });
      this.floatingMenuCloseTimer = null;
    }, this.getMotionDurationMs());
  }

  toggleFloatingMenu() {
    if (this.state.isFloatingMenuOpen) {
      this.closeFloatingMenu();
      return;
    }

    this.openFloatingMenu();
  }

  getTranslationTargetLanguage() {
    const targetLanguage =
      window.CONFIG?.visual?.["translate:target-language"] ||
      localStorage.getItem("ivLyrics:visual:translate:target-language");

    if (targetLanguage && targetLanguage !== "auto") {
      return targetLanguage;
    }

    return (
      window.I18n?.getCurrentLanguage?.() ||
      Spicetify.Locale?.getLocale?.()?.split("-")[0] ||
      "en"
    );
  }

  getEditingBaseLyrics() {
    const currentMode = this.getCurrentMode();

    if (currentMode === KARAOKE && Array.isArray(this.state.karaoke)) {
      return this.state.karaoke;
    }
    if (currentMode === SYNCED && Array.isArray(this.state.synced)) {
      return this.state.synced;
    }
    if (currentMode === UNSYNCED && Array.isArray(this.state.unsynced)) {
      return this.state.unsynced;
    }

    return this.resolveLyricsForMode(this.state, currentMode) || [];
  }

  getEditableCacheSourceLines() {
    return (this.getEditingBaseLyrics() || [])
      .map((line) => line?.originalText || line?.text || "")
      .filter((line) => !Utils.isSectionHeader(line) && String(line).trim() !== "");
  }

  buildCacheEditorText(lines, expectedCount) {
    const safeLines = Array.isArray(lines) ? lines : [];
    const normalizedLines = Array.from({ length: expectedCount }, (_, index) => {
      const line = safeLines[index];
      return typeof line === "string" ? line : String(line ?? "");
    });
    return normalizedLines.join("\n");
  }

  normalizeCacheEditorLines(text, expectedCount) {
    const normalizedText = String(text ?? "").replace(/\r\n?/g, "\n");
    const lines = normalizedText.split("\n");

    if (lines.length > expectedCount) {
      return null;
    }

    while (lines.length < expectedCount) {
      lines.push("");
    }

    return lines;
  }

  closeLyricsEditModal() {
    if (this.state.isLyricsEditSaving) {
      return;
    }

    this.setState({
      isLyricsEditModalOpen: false,
      isLyricsEditLoading: false,
      lyricsEditError: "",
    });
  }

  async openLyricsEditModal() {
    const sourceLines = this.getEditableCacheSourceLines();
    const trackId = this.state.uri?.split(":")[2];

    if (!trackId || sourceLines.length === 0) {
      Toast.error(I18n.t("notifications.noLyricsLoaded"));
      return;
    }

    const userLang = this.getTranslationTargetLanguage();
    const provider = this.state.provider || null;

    this.setState({
      isLyricsEditModalOpen: true,
      isLyricsEditLoading: true,
      isLyricsEditSaving: false,
      lyricsEditOriginalLines: sourceLines,
      lyricsEditPronunciationText: "",
      lyricsEditTranslationText: "",
      lyricsEditHasPronunciationCache: false,
      lyricsEditHasTranslationCache: false,
      lyricsEditError: "",
    });

    try {
      const [phoneticCache, translationCache] = await Promise.all([
        LyricsCache.getTranslation(trackId, userLang, true, provider),
        LyricsCache.getTranslation(trackId, userLang, false, provider),
      ]);

      const phoneticLines = Array.isArray(phoneticCache?.phonetic)
        ? phoneticCache.phonetic
        : [];
      const translationLines = Array.isArray(translationCache?.translation)
        ? translationCache.translation
        : [];

      this.setState({
        isLyricsEditLoading: false,
        lyricsEditPronunciationText: this.buildCacheEditorText(
          phoneticLines,
          sourceLines.length
        ),
        lyricsEditTranslationText: this.buildCacheEditorText(
          translationLines,
          sourceLines.length
        ),
        lyricsEditHasPronunciationCache: phoneticLines.some(
          (line) => String(line ?? "").trim() !== ""
        ),
        lyricsEditHasTranslationCache: translationLines.some(
          (line) => String(line ?? "").trim() !== ""
        ),
      });
    } catch (error) {
      this.setState({
        isLyricsEditLoading: false,
        lyricsEditError: I18n.t("lyricsCacheEditor.loadFailed"),
      });
    }
  }

  refreshLyricsAfterCacheEdit() {
    const trackUri = this.state.uri;
    if (trackUri) {
      CacheManager.clearByUri(trackUri);
      if (this._dmResults?.[trackUri]) {
        delete this._dmResults[trackUri];
      }
    }

    const trackId = trackUri?.split(":")[2];
    if (trackId) {
      window.Translator?.clearMemoryCache?.(trackId);
      window.Translator?.clearInflightRequests?.(trackId);
    }

    this.lastProcessedMode = null;
    this.lyricsSource(this.state, this.getCurrentMode());
  }

  async saveLyricsEditModal() {
    if (this.state.isLyricsEditLoading || this.state.isLyricsEditSaving) {
      return;
    }

    const expectedLineCount = this.state.lyricsEditOriginalLines.length;
    const pronunciationLines = this.normalizeCacheEditorLines(
      this.state.lyricsEditPronunciationText,
      expectedLineCount
    );
    const translationLines = this.normalizeCacheEditorLines(
      this.state.lyricsEditTranslationText,
      expectedLineCount
    );

    if (!pronunciationLines || !translationLines) {
      this.setState({
        lyricsEditError: I18n.t("lyricsCacheEditor.lineOverflow"),
      });
      return;
    }

    const trackId = this.state.uri?.split(":")[2];
    if (!trackId) {
      this.setState({
        lyricsEditError: I18n.t("lyricsCacheEditor.trackMissing"),
      });
      return;
    }

    const userLang = this.getTranslationTargetLanguage();
    const provider = this.state.provider || null;

    this.setState({
      isLyricsEditSaving: true,
      lyricsEditError: "",
    });

    try {
      await Promise.all([
        LyricsCache.setTranslation(
          trackId,
          userLang,
          true,
          { phonetic: pronunciationLines },
          provider
        ),
        LyricsCache.setTranslation(
          trackId,
          userLang,
          false,
          { translation: translationLines },
          provider
        ),
      ]);

      this.setState({
        isLyricsEditModalOpen: false,
        isLyricsEditSaving: false,
        lyricsEditHasPronunciationCache: pronunciationLines.some(
          (line) => String(line ?? "").trim() !== ""
        ),
        lyricsEditHasTranslationCache: translationLines.some(
          (line) => String(line ?? "").trim() !== ""
        ),
        lyricsEditError: "",
      });

      this.refreshLyricsAfterCacheEdit();
      Toast.success(I18n.t("lyricsCacheEditor.saved"));
    } catch (error) {
      this.setState({
        isLyricsEditSaving: false,
        lyricsEditError: I18n.t("lyricsCacheEditor.saveFailed"),
      });
    }
  }

  /**
   * 메타데이터 번역 요청 (제목/아티스트)
   * @param {string} uri - 트랙 URI
   * @param {string} title - 원본 제목
   * @param {string} artist - 원본 아티스트
   */
  async fetchMetadataTranslation(uri, title, artist) {
    // 메타데이터 번역 설정이 꺼져 있으면 스킵
    if (!CONFIG.visual["translate-metadata"]) {
      return;
    }

    const trackId = uri?.split(':')[2];
    if (!trackId || !title || !artist) {
      return;
    }

    try {
      const result = await window.Translator.translateMetadata({
        trackId,
        title,
        artist,
        ignoreCache: false,
      });

      // 현재 트랙이 여전히 같은지 확인
      if (this.currentTrackUri === uri && result) {
        this.setState({ translatedMetadata: result });

        // 오버레이로 번역된 메타데이터 전송
        if (window.OverlaySender?.sendTranslatedMetadata) {
          window.OverlaySender.sendTranslatedMetadata(result);
        }
      }
    } catch (error) {
      console.warn('[ivLyrics] Metadata translation failed:', error);
    }
  }

  /**
   * 저장된 선택 영상 로드 (IndexedDB에서)
   * @param {string} trackUri - 트랙 URI
   */
  async loadSavedVideoForTrack(trackUri) {
    if (!trackUri) return;

    try {
      const savedVideo = await Utils.getSelectedVideo(trackUri);
      if (savedVideo && savedVideo.youtubeVideoId) {
        ivLyricsDebug(`[ivLyrics] Loading saved video for track: ${savedVideo.youtubeVideoId}`);
        this.setState({
          videoInfo: {
            youtubeVideoId: savedVideo.youtubeVideoId,
            youtubeTitle: savedVideo.youtubeTitle,
            captionStartTime: savedVideo.captionStartTime,
            communityEntryId: savedVideo.communityEntryId,
            isAutoGenerated: savedVideo.isAutoGenerated
          }
        });
      }
    } catch (error) {
      console.error('[ivLyrics] Failed to load saved video:', error);
    }
  }

  /**
   * 발음 로딩 상태를 시작합니다 (1초 후에 로딩 메시지 표시)
   */
  startPhoneticLoading() {
    this.clearPhoneticLoading();
    this.phoneticLoadingTimer = setTimeout(() => {
      this.setState({ isPhoneticLoading: true });
    }, 1000);
  }

  /**
   * 발음 로딩 상태를 종료합니다
   */
  clearPhoneticLoading() {
    if (this.phoneticLoadingTimer) {
      clearTimeout(this.phoneticLoadingTimer);
      this.phoneticLoadingTimer = null;
    }
    this.setState({ isPhoneticLoading: false });
  }

  /**
   * 번역 로딩 상태를 시작합니다 (1초 후에 로딩 메시지 표시)
   */
  startTranslationLoading() {
    this.clearTranslationLoading();
    this.translationLoadingTimer = setTimeout(() => {
      this.setState({ isTranslationLoading: true });
    }, 1000);
  }

  /**
   * 번역 로딩 상태를 종료합니다
   */
  clearTranslationLoading() {
    if (this.translationLoadingTimer) {
      clearTimeout(this.translationLoadingTimer);
      this.translationLoadingTimer = null;
    }
    this.setState({ isTranslationLoading: false });
  }

  applyStreamingTranslation({
    uri,
    lyrics,
    lyricsMode1,
    lyricsMode2,
    displayMode1,
    displayMode2,
  }) {
    this.pendingStreamingPayload = {
      uri,
      lyrics,
      lyricsMode1,
      lyricsMode2,
      displayMode1,
      displayMode2,
    };

    if (this.streamingApplyTimer) {
      return;
    }

    this.streamingApplyTimer = setTimeout(() => {
      this.streamingApplyTimer = null;
      const payload = this.pendingStreamingPayload;
      this.pendingStreamingPayload = null;
      if (!payload || this.state.uri !== payload.uri) {
        return;
      }

      const optimizedTranslations = this.optimizeTranslations(
        payload.lyrics,
        payload.lyricsMode1,
        payload.lyricsMode2,
        payload.lyricsMode1 ? payload.displayMode1 : null,
        payload.lyricsMode2 ? payload.displayMode2 : null
      );
      const finalLyrics = Array.isArray(optimizedTranslations)
        ? optimizedTranslations
        : [];

      this.setState({
        currentLyrics: finalLyrics,
      });

      window.dispatchEvent(new CustomEvent('ivLyrics:lyrics-ready', {
        detail: {
          trackInfo: {
            uri: payload.uri,
            title: this.state.title,
            artist: this.state.artist
          },
          lyrics: finalLyrics
        }
      }));
    }, 50);
  }

  /**
   * 번역 재생성 메서드 - ignore_cache를 true로 설정하여 새로운 번역 요청
   */
  async regenerateTranslation() {
    // 번역이 활성화되어 있는지 확인
    const provider = CONFIG.visual["translate:translated-lyrics-source"];

    if (!provider || provider === "none") {
      return;
    }

    // 현재 가사가 있는지 확인
    if (!this.state.currentLyrics || this.state.currentLyrics.length === 0) {
      Toast.error(I18n.t("notifications.noLyricsLoaded"));
      return;
    }

    const originalLanguage = this.provideLanguageCode(this.state.currentLyrics);
    const friendlyLanguage =
      originalLanguage &&
      new Intl.DisplayNames(["en"], { type: "language" })
        .of(originalLanguage.split("-")[0])
        ?.toLowerCase();
    const modeKey = friendlyLanguage || "gemini";
    const mode1 = CONFIG.visual[`translation-mode:${modeKey}`];
    const mode2 = CONFIG.visual[`translation-mode-2:${modeKey}`];

    // Gemini 번역인지 확인
    const isGeminiMode =
      mode1?.startsWith("gemini") || mode2?.startsWith("gemini");

    if (!isGeminiMode) {
      Toast.error(I18n.t("notifications.translationRegenerateGeminiOnly"));
      return;
    }

    // 발음과 번역 중 어떤 것이 필요한지 확인
    const needPhonetic = mode1 === "gemini_romaji" || mode2 === "gemini_romaji";
    const needTranslation = mode1 === "gemini_ko" || mode2 === "gemini_ko";

    // trackId 가져오기
    const trackId = Spicetify.Player.data?.item?.uri?.split(':')[2];
    if (!trackId) {
      Toast.error(I18n.t("notifications.noTrackPlaying"));
      return;
    }

    try {
      this.startTranslationLoading();

      Toast.show(I18n.t("notifications.regeneratingTranslation"), false, 2000);

      // 먼저 로컬 캐시에서 해당 트랙의 번역 캐시 삭제
      const userLang = I18n.getCurrentLanguage();
      try {
        // 번역 캐시 삭제 (발음과 번역 모두)
        await Promise.all([
          LyricsCache.clearTranslationForTrack(trackId),
        ]);
        // 메모리 캐시도 초기화
        window.Translator.clearMemoryCache(trackId);
        window.Translator.clearInflightRequests(trackId);
        ivLyricsDebug(`[regenerateTranslation] Cleared local cache for ${trackId}`);
      } catch (e) {
        console.warn('[regenerateTranslation] Failed to clear cache:', e);
      }

      // 원본 가사 가져오기 (번역되지 않은 원문)
      const lyricsState = this.state;
      const currentMode = this.getCurrentMode();

      // 원본 가사를 가져오기 위해 synced, karaoke, unsynced 중 현재 모드에 해당하는 것 사용
      let originalLyrics = [];
      if (currentMode === KARAOKE && this.state.karaoke) {
        originalLyrics = this.state.karaoke;
      } else if (currentMode === SYNCED && this.state.synced) {
        originalLyrics = this.state.synced;
      } else if (currentMode === UNSYNCED && this.state.unsynced) {
        originalLyrics = this.state.unsynced;
      } else {
        // fallback: currentLyrics에서 originalText 사용
        originalLyrics = this.state.currentLyrics || [];
      }

      // Section line 제거하고 원문 텍스트만 추출 (getGeminiTranslation과 동일)
      const text = getNonSectionLyricsText(originalLyrics);

      const currentUri = lyricsState.uri;
      const currentProvider = lyricsState.provider || "";

      if (!this._dmResults) {
        this._dmResults = {};
      }
      if (!this._dmResults[currentUri]) {
        this._dmResults[currentUri] = {};
      }

      this._dmResults[currentUri].lastMode1 = mode1;
      this._dmResults[currentUri].lastMode2 = mode2;
      this._dmResults[currentUri].lastProvider = currentProvider;

	      const originalNonSectionIndexMap = new Map();
	      let nonSectionLineIndex = 0;
	      originalLyrics.forEach((line, i) => {
	        const lineText = line?.text || "";
	        if (!Utils.isSectionHeader(lineText) && lineText.trim() !== "") {
	          originalNonSectionIndexMap.set(i, nonSectionLineIndex++);
	        }
	      });

      const mapResultLinesToLyrics = (linesInput) => {
        if (!Array.isArray(linesInput)) return null;

        const cleanTranslationLines = linesInput.filter(
          (line) =>
            line !== undefined &&
            line !== null &&
            String(line).trim() !== "" &&
            !Utils.isSectionHeader(String(line).trim())
        );

        return originalLyrics.map((line, i) => {
          const originalText = line?.text || "";

          if (Utils.isSectionHeader(originalText)) {
            return {
              ...line,
              text: null,
              originalText,
            };
          }

          if (originalText.trim() === "") {
            return {
              ...line,
              text: "",
              originalText,
            };
          }

	          const positionInNonSectionLines =
	            originalNonSectionIndexMap.get(i);
	          const translatedText =
	            cleanTranslationLines[positionInNonSectionLines]?.trim() || "";

          return {
            ...line,
            text: translatedText || line?.text || "",
            originalText,
          };
        });
      };

      const extractGeminiOutput = (response, wantSmartPhonetic) => {
        let outText = wantSmartPhonetic
          ? response?.phonetic
          : response?.translation || response?.vi;

        if (
          Array.isArray(outText) &&
          outText.length === 1 &&
          typeof outText[0] === "string"
        ) {
          try {
            if (outText[0].trim().startsWith("{")) {
              const parsed = JSON.parse(outText[0]);
              if (wantSmartPhonetic && Array.isArray(parsed.phonetic)) {
                outText = parsed.phonetic;
              } else if (
                !wantSmartPhonetic &&
                Array.isArray(parsed.translation)
              ) {
                outText = parsed.translation;
              } else if (
                !wantSmartPhonetic &&
                Array.isArray(parsed.vi)
              ) {
                outText = parsed.vi;
              }
            }
          } catch (e) {
            // Keep the original output when the streamed payload is not JSON-wrapped.
          }
        }

        return outText;
      };

      let streamedLyrics1 = null;
      let streamedLyrics2 = null;
      const streamedPhoneticLines = [];
      const streamedTranslationLines = [];

      const pushStreamingUpdate = () => {
        if (this.state.uri !== currentUri) {
          return;
        }

        this._dmResults[currentUri].mode1 = streamedLyrics1;
        this._dmResults[currentUri].mode2 = streamedLyrics2;

        this.applyStreamingTranslation({
          uri: currentUri,
          lyrics: originalLyrics,
          lyricsMode1: streamedLyrics1,
          lyricsMode2: streamedLyrics2,
          displayMode1: mode1,
          displayMode2: mode2,
        });
      };

      const handlePhoneticStreamLine = needPhonetic
        ? (lineIndex, lineText) => {
          if (typeof lineIndex !== "number" || lineIndex < 0) {
            return;
          }
          if (this.state.uri !== currentUri) {
            return;
          }

          streamedPhoneticLines[lineIndex] =
            typeof lineText === "string" ? lineText : String(lineText ?? "");

          const partialMapped = mapResultLinesToLyrics(streamedPhoneticLines);
          if (!partialMapped) {
            return;
          }

          if (mode1 === "gemini_romaji") {
            streamedLyrics1 = partialMapped;
          }
          if (mode2 === "gemini_romaji") {
            streamedLyrics2 = partialMapped;
          }
          pushStreamingUpdate();
        }
        : null;

      const handleTranslationStreamLine = needTranslation
        ? (lineIndex, lineText) => {
          if (typeof lineIndex !== "number" || lineIndex < 0) {
            return;
          }
          if (this.state.uri !== currentUri) {
            return;
          }

          streamedTranslationLines[lineIndex] =
            typeof lineText === "string" ? lineText : String(lineText ?? "");

          const partialMapped = mapResultLinesToLyrics(streamedTranslationLines);
          if (!partialMapped) {
            return;
          }

          if (mode1 === "gemini_ko") {
            streamedLyrics1 = partialMapped;
          }
          if (mode2 === "gemini_ko") {
            streamedLyrics2 = partialMapped;
          }
          pushStreamingUpdate();
        }
        : null;

      // 발음과 번역을 별도로 요청 (둘 다 필요한 경우)
      let phoneticResponse = null;
      let translationResponse = null;

      // 발음 요청 (gemini_romaji)
      if (needPhonetic) {
        phoneticResponse = await window.Translator.callGemini({
          trackId,
          artist: this.state.artist || lyricsState.artist,
          title: this.state.title || lyricsState.title,
          text,
          wantSmartPhonetic: true,
          provider: lyricsState.provider,
          ignoreCache: true,
          onLine: handlePhoneticStreamLine,
        });
      }

      // 번역 요청 (gemini_ko)
      if (needTranslation) {
        translationResponse = await window.Translator.callGemini({
          trackId,
          artist: this.state.artist || lyricsState.artist,
          title: this.state.title || lyricsState.title,
          text,
          wantSmartPhonetic: false,
          provider: lyricsState.provider,
          ignoreCache: true,
          onLine: handleTranslationStreamLine,
        });
      }

      // 번역 결과를 getGeminiTranslation과 동일한 방식으로 처리하는 함수
      const processTranslationResult = (outText, lyrics) => {
        if (!outText) return null;

        // Handle both array and string formats
        let lines;
        if (Array.isArray(outText)) {
          lines = outText;
        } else if (typeof outText === "string") {
          lines = outText.split("\n");
        } else {
          return null;
        }

        // Create mapping arrays for proper alignment
        const originalNonSectionLines = [];
        const originalNonSectionIndices = [];

        // Collect non-section lines from original lyrics (excluding empty lines)
        lyrics.forEach((line, i) => {
          const text = line?.text || "";
          if (!Utils.isSectionHeader(text) && text.trim() !== "") {
            originalNonSectionLines.push(text);
            originalNonSectionIndices.push(i);
          }
        });

        // Filter out section headers and empty lines from translation results
        const cleanTranslationLines = lines.filter(
          (line) =>
            line && line.trim() !== "" && !Utils.isSectionHeader(line.trim())
        );

        // Use the clean translation lines for mapping
        lines = cleanTranslationLines;

        // Smart mapping that accounts for section headers and empty lines
        const mapped = lyrics.map((line, i) => {
          const originalText = line?.text || "";

          // If this is a section header, keep original and don't show translation
          if (Utils.isSectionHeader(originalText)) {
            return {
              ...line,
              text: null,
              originalText: originalText,
            };
          }

          // If this is an empty line, keep it empty
          if (originalText.trim() === "") {
            return {
              ...line,
              text: "",
              originalText: originalText,
            };
          }

          // Find the translation index for this non-section, non-empty line
	          const positionInNonSectionLines =
	            originalNonSectionIndexMap.get(i);
	          const translatedText = lines[positionInNonSectionLines]?.trim() || "";

          return {
            ...line,
            text: translatedText || line?.text || "",
            originalText: originalText,
          };
        });

        return mapped;
      };

      // mode1과 mode2 각각 처리 - 둘 다 활성화된 경우 각각의 결과를 올바르게 할당
      let translatedLyrics1 = null;
      let translatedLyrics2 = null;

      const phoneticOutput = extractGeminiOutput(phoneticResponse, true);
      const translationOutput = extractGeminiOutput(translationResponse, false);

      // mode1 처리
      // mode1 처리
      if (mode1 === "gemini_romaji" && phoneticOutput) {
        translatedLyrics1 = processTranslationResult(phoneticOutput, originalLyrics);
      } else if (mode1 === "gemini_ko" && translationOutput) {
        translatedLyrics1 = processTranslationResult(translationOutput, originalLyrics);
      }

      // mode2 처리 (mode1과 독립적으로)
      if (mode2 === "gemini_romaji" && phoneticOutput) {
        translatedLyrics2 = processTranslationResult(phoneticOutput, originalLyrics);
      } else if (mode2 === "gemini_ko" && translationOutput) {
        translatedLyrics2 = processTranslationResult(translationOutput, originalLyrics);
      }

      // _dmResults에 번역 결과 저장
      // mode1과 mode2 결과 저장
      this._dmResults[currentUri].mode1 = translatedLyrics1;
      this._dmResults[currentUri].mode2 = translatedLyrics2;
      this._dmResults[currentUri].lastMode1 = mode1;
      this._dmResults[currentUri].lastMode2 = mode2;

      // CacheManager에도 새 결과 저장 (getGeminiTranslation에서 캐시 히트하도록)
      this._dmResults[currentUri].lastProvider = currentProvider;
      if (translatedLyrics1 && mode1) {
        CacheManager.set(`${currentUri}:${currentProvider}:${mode1}`, translatedLyrics1);
      }
      if (translatedLyrics2 && mode2) {
        CacheManager.set(`${currentUri}:${currentProvider}:${mode2}`, translatedLyrics2);
      }

      // lyricsSource를 다시 호출하여 기존 로직으로 화면 업데이트
      this.lyricsSource(this.state, currentMode);
      Toast.success(I18n.t("notifications.translationRegenerated"));
    } catch (error) {
      Toast.error(`${I18n.t("notifications.translationRegenerateFailed")}: ${error.message}`);
    } finally {
      this.clearTranslationLoading();
    }
  }

  infoFromTrack(track) {
    const meta = track?.metadata;
    if (!meta) {
      return null;
    }
    return {
      duration: Number(meta.duration),
      album: meta.album_title,
      artist: meta.artist_name,
      title: meta.title,
      uri: track.uri,
      image: meta.image_url,
    };
  }


  async fetchColors(uri) {
    let vibrant = 0;
    let dynamicColors = null;

    try {
      try {
        const { fetchExtractedColorForTrackEntity } =
          Spicetify.GraphQL.Definitions;
        const { data } = await Spicetify.GraphQL.Request(
          fetchExtractedColorForTrackEntity,
          { uri }
        );
        const { hex } =
          data.trackUnion.albumOfTrack.coverArt.extractedColors.colorDark;
        vibrant = Number.parseInt(hex.replace("#", ""), 16);
      } catch {
        const colors = await Spicetify.CosmosAsync.get(
          `https://spclient.wg.spotify.com/colorextractor/v1/extract-presets?uri=${uri}&format=json`
        );
        vibrant = colors.entries[0].color_swatches.find(
          (color) => color.preset === "VIBRANT_NON_ALARMING"
        ).color;
      }
    } catch {
      vibrant = 8747370;
    }

    if (CONFIG.visual["blur-gradient-background"]) {
      try {
        const coverUrl =
          Spicetify.Player.data?.item?.metadata?.image_xlarge_url ||
          Spicetify.Player.data?.item?.metadata?.image_large_url ||
          Spicetify.Player.data?.item?.metadata?.image_url;

        if (coverUrl && Spicetify.GraphQL?.Definitions?.getDynamicColorsByUris) {
          const colorQuery = await Spicetify.GraphQL.Request(
            Spicetify.GraphQL.Definitions.getDynamicColorsByUris,
            { imageUris: [coverUrl] }
          );

          const colorData = colorQuery?.data?.getDynamicColorsByUris?.[0];
          if (colorData) {
            const rgbaToHex = (rgba) => {
              if (!rgba) return null;
              const r = Math.round(rgba.red * 255);
              const g = Math.round(rgba.green * 255);
              const b = Math.round(rgba.blue * 255);
              return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
            };

            // 다양한 색상 레벨 추출
            const minContrast = colorData.minContrast?.backgroundBase
              ? rgbaToHex(colorData.minContrast.backgroundBase)
              : Utils.convertIntToRGB(vibrant);
            const highContrast = colorData.highContrast?.backgroundBase
              ? rgbaToHex(colorData.highContrast.backgroundBase)
              : Utils.convertIntToRGB(vibrant, 0.7);
            const overlayColor = colorData.higherContrast?.backgroundBase
              ? rgbaToHex(colorData.higherContrast.backgroundBase)
              : Utils.convertIntToRGB(vibrant, 0.5);

            dynamicColors = { minContrast, highContrast, overlayColor };
          }
        }
      } catch (e) {
        console.warn("[ivLyrics] Failed to fetch dynamic colors:", e);
      }

      // GraphQL 실패 시 vibrant 색상 기반 폴백 그라데이션
      if (!dynamicColors) {
        const baseColor = Utils.convertIntToRGB(vibrant);
        const darkerColor = Utils.convertIntToRGB(vibrant, 0.6);
        const darkestColor = Utils.convertIntToRGB(vibrant, 0.3);
        dynamicColors = {
          minContrast: baseColor,
          highContrast: darkerColor,
          overlayColor: darkestColor,
        };
      }
    }

    this.setState({
      colors: {
        background: Utils.convertIntToRGB(vibrant),
        inactive: Utils.convertIntToRGB(vibrant, 3),
      },
      dynamicColors,
    });
  }

  async fetchTempo(uri) {
    const audio = await Spicetify.CosmosAsync.get(
      `https://api.spotify.com/v1/audio-features/${uri.split(":")[2]}`
    );
    let tempo = audio.tempo;

    const MIN_TEMPO = 60;
    const MAX_TEMPO = 150;
    const MAX_PERIOD = 0.4;
    if (!tempo) tempo = 105;
    if (tempo < MIN_TEMPO) tempo = MIN_TEMPO;
    if (tempo > MAX_TEMPO) tempo = MAX_TEMPO;

    let period =
      MAX_PERIOD - ((tempo - MIN_TEMPO) / (MAX_TEMPO - MIN_TEMPO)) * MAX_PERIOD;
    period = Math.round(period * 100) / 100;

    this.setState({
      tempo: `${String(period)}s`,
    });
  }

  /**
   * @deprecated LyricsService.getLyricsFromProviders 사용 권장
   * 가사 로드는 Extension(LyricsService)을 통해 처리됨
   */
  async tryServices(trackInfo, mode = -1) {
    // LyricsService Extension을 통해 가사 로드 (LyricsAddonManager 사용)
    if (window.LyricsService?.getLyricsFromProviders) {
      const result = await window.LyricsService.getLyricsFromProviders(trackInfo);
      if (!result.uri) result.uri = trackInfo.uri;
      return result;
    }

    // LyricsService가 없으면 에러
    console.error('[LyricsContainer] LyricsService Extension이 로드되지 않았습니다.');
    return { ...emptyState, uri: trackInfo.uri, error: 'LyricsService not loaded' };
  }

  async fetchLyrics(track, mode = -1, refresh = false) {
    try {
      const info = this.infoFromTrack(track);
      if (!info) {
        this.setState({ error: "No track info", isLoading: false });
        return;
      }

      // 트랙별 언어 오버라이드 로드 (IndexedDB)
      try {
        this.trackLanguageOverride = await TrackLanguageDB.getLanguage(info.uri);
      } catch (e) {
        console.warn("[ivLyrics] Failed to load track language override:", e);
        this.trackLanguageOverride = null;
      }

      // keep artist/title for prompts
      this.setState({ artist: info.artist, title: info.title, coverUrl: info.image, translatedMetadata: null });

      // 메타데이터 번역 요청 (백그라운드에서 비동기로)
      this.fetchMetadataTranslation(info.uri, info.title, info.artist);

      // Refresh: Clear memory cache for this track to force re-fetch from providers
      if (refresh && CACHE[info.uri]) {
        delete CACHE[info.uri];
      }

      let isCached = this.lyricsSaved(info.uri);

      if (CONFIG.visual.colorful || CONFIG.visual["gradient-background"] || CONFIG.visual["blur-gradient-background"]) {
        this.fetchColors(info.uri);
      }

      this.fetchTempo(info.uri);
      this.resetDelay();

      let tempState;
      // if lyrics are cached
      if (
        (mode === -1 && CACHE[info.uri]) ||
        CACHE[info.uri]?.[CONFIG.modes?.[mode]]
      ) {
        tempState = { provider: "", contributors: null, ...CACHE[info.uri], isCached };
        const cachedMode = CACHE[info.uri]?.mode;
        if (typeof cachedMode === "number" && cachedMode !== -1) {
          tempState = { ...tempState, mode: cachedMode };
        }
      } else {
        // Save current mode before loading to maintain UI consistency
        const currentMode = this.getCurrentMode();
        this.lastModeBeforeLoading = currentMode !== -1 ? currentMode : SYNCED;
        this.setState({ ...emptyState, provider: "", contributors: null, isLoading: true, isCached: false });

        // 마켓플레이스 에드온 로드 대기
        if (window.MarketplaceManager?.readyPromise) {
          await window.MarketplaceManager.readyPromise;
        }

        // LyricsService Extension을 통해 가사 로드 (LyricsAddonManager 사용)
        const resp = await window.LyricsService.getLyricsFromProviders(info);
        if (!resp.uri) resp.uri = info.uri;

        if (resp.provider) {
          // Cache lyrics
          CACHE[resp.uri] = resp;
        }

        // This True when the user presses the Cache Lyrics button and saves it to localStorage.
        isCached = this.lyricsSaved(resp.uri);

        // In case user skips tracks too fast and multiple callbacks
        // set wrong lyrics to current track.
        if (resp.uri === this.currentTrackUri) {
          tempState = { provider: "", contributors: null, ...resp, isLoading: false, isCached };
        } else {
          return;
        }
      }

      // Check if lyrics indicate no lyrics / instrumental
      // Conditions: 
      // 1. Total lines <= 3
      // 2. First line contains "no lyrics" or "instrumental"
      const checkNoLyrics = (lyrics) => {
        if (!lyrics || lyrics.length === 0) return false;
        return hasInstrumentalMarker(lyrics);
      };

      // If all lyrics types indicate no lyrics, treat as instrumental
      const isInstrumental =
        checkNoLyrics(tempState.karaoke) ||
        checkNoLyrics(tempState.synced) ||
        checkNoLyrics(tempState.unsynced);

      if (isInstrumental) {
        tempState = {
          ...tempState,
          karaoke: null,
          synced: null,
          unsynced: null,
          error: "Instrumental"
        };
      }

      let finalMode = mode;
      if (mode === -1) {
        if (this.state.explicitMode !== -1) {
          finalMode = this.state.explicitMode;
        } else {
          // Auto switch: prefer karaoke, then synced, then unsynced
          if (tempState.karaoke) {
            finalMode = KARAOKE;
          } else if (tempState.synced) {
            finalMode = SYNCED;
          } else if (tempState.unsynced) {
            finalMode = UNSYNCED;
          }
        }
      }

      const initialLyricsForMode = this.resolveLyricsForMode(tempState, finalMode);

      // if song changed one time
      if (tempState.uri !== this.state.uri || refresh) {
        // Detect language from the new lyrics data
        let defaultLanguage = null;
        if (tempState.synced) {
          defaultLanguage = Utils.detectLanguage(tempState.synced);
        } else if (tempState.unsynced) {
          defaultLanguage = Utils.detectLanguage(tempState.unsynced);
        }

        // reset and apply - preserve cached translations if available
        this.setState({
          furigana: null,
          romaji: null,
          hiragana: null,
          katakana: null,
          hangul: null,
          romaja: null,
          cn: null,
          hk: null,
          tw: null,
          ...tempState,
          language: defaultLanguage,
          ...this.applyTranslationStates(tempState),
          currentLyrics: initialLyricsForMode || [],
        });
        return;
      }

      // Preserve cached translations when not changing songs
      this.setState({
        ...tempState,
        ...this.applyTranslationStates(tempState),
        currentLyrics: initialLyricsForMode || [],
      });
    } catch (error) {
      this.setState({
        error: `Failed to fetch lyrics: ${error.message}`,
        isLoading: false,
        ...emptyState,
      });
    }
  }

  resolveLyricsForMode(lyricsState, mode) {
    if (!lyricsState) return null;

    const preferredModeKey =
      typeof mode === "number" && mode >= 0 ? CONFIG.modes?.[mode] : null;
    const preferredLyrics =
      preferredModeKey && lyricsState[preferredModeKey]
        ? lyricsState[preferredModeKey]
        : null;

    return (
      preferredLyrics ||
      lyricsState.karaoke ||
      lyricsState.synced ||
      lyricsState.unsynced ||
      null
    );
  }

  lyricsSource(lyricsState, mode) {
    if (!lyricsState) return;

    const lyrics = this.resolveLyricsForMode(lyricsState, mode);
    if (!lyrics) {
      this.setState({ currentLyrics: [] });
      // 오버레이에 가사 없음 상태 전송 (트랙 정보 업데이트용)
      window.dispatchEvent(new CustomEvent('ivLyrics:lyrics-ready', {
        detail: {
          trackInfo: { uri: lyricsState.uri, title: this.state.title, artist: this.state.artist },
          lyrics: []
        }
      }));
      return;
    }

    // Clean up any existing progress flags from previous songs
    const currentUri = lyricsState.uri;
    if (this.lastCleanedUri !== currentUri) {
      // Remove all progress flags
      Object.keys(this).forEach((key) => {
        if (key.includes(":inProgress")) {
          delete this[key];
        }
      });
      // Reset per-track progressive results and inflight maps
      this._dmResults = {};
      this._inflightGemini = new Map();
      if (this.streamingApplyTimer) {
        clearTimeout(this.streamingApplyTimer);
        this.streamingApplyTimer = null;
      }
      this.pendingStreamingPayload = null;
      this.lastCleanedUri = currentUri;
    }

    // Handle translation and display modes efficiently
    const originalLanguage = this.provideLanguageCode(lyrics);
    let friendlyLanguage = null;

    if (originalLanguage) {
      try {
        friendlyLanguage = new Intl.DisplayNames(["en"], { type: "language" })
          .of(originalLanguage.split("-")[0])
          ?.toLowerCase();
      } catch (error) {
        // Error ignored
      }
    }

    // For Gemini mode, use generic keys if no specific language detected
    const modeKey = friendlyLanguage || "gemini";

    const displayMode1 = CONFIG.visual[`translation-mode:${modeKey}`];
    const displayMode2 = CONFIG.visual[`translation-mode-2:${modeKey}`];

    this.language = originalLanguage;
    this.displayMode = displayMode1; // Keep for legacy compatibility
    this.displayMode2 = displayMode2;

    const processMode = async (mode, baseLyrics, onProgress = null) => {
      if (!mode || mode === "none") {
        ivLyricsDebug("[processMode] Mode is none or empty:", mode);
        return null;
      }
      ivLyricsDebug("[processMode] Processing mode:", mode);
      try {
        if (String(mode).startsWith("gemini")) {
          const result = await this.getGeminiTranslation(
            lyricsState,
            baseLyrics,
            mode,
            onProgress
          );
          ivLyricsDebug("[processMode] Gemini result sample:", result?.[0]);
          return result;
        } else {
          return await this.getTraditionalConversion(
            lyricsState,
            baseLyrics,
            originalLanguage,
            mode
          );
        }
      } catch (error) {
        const modeDisplayName =
          mode === "gemini_romaji"
            ? I18n.t("notifications.romajiTranslationFailed")
            : I18n.t("notifications.koreanTranslationFailed");
        Toast.error(`${modeDisplayName}: ${error.message || "Unknown error"}`);
        return null; // Return null on failure
      }
    };

    const { uri } = lyricsState; // Capture the URI for this specific request

    // If no display modes are active, just optimize the original lyrics (e.g., to handle note lines)
    if (
      (!displayMode1 || displayMode1 === "none") &&
      (!displayMode2 || displayMode2 === "none")
    ) {
      const optimizedLyrics = this.optimizeTranslations(
        lyrics,
        null,
        null,
        null,
        null
      );
      const finalLyrics = Array.isArray(optimizedLyrics) ? optimizedLyrics : [];
      this.setState({
        currentLyrics: finalLyrics,
      });
      // 🔹 ivLyrics-overlay 앱으로 원문 가사 전송 (번역 모드 미사용)
      window.dispatchEvent(new CustomEvent('ivLyrics:lyrics-ready', {
        detail: {
          trackInfo: { uri, title: this.state.title, artist: this.state.artist },
          lyrics: finalLyrics
        }
      }));
      return;
    }

    // 즉시 원문 표시 - 번역이 로딩되는 동안에도 사용자가 가사를 볼 수 있도록
    // URI 체크: 곡이 변경되지 않았을 때만 표시
    if (this.state.uri === uri) {
      const optimizedOriginal = this.optimizeTranslations(
        lyrics,
        null,
        null,
        null,
        null
      );
      const originalLyrics = Array.isArray(optimizedOriginal) ? optimizedOriginal : [];
      this.setState({
        currentLyrics: originalLyrics,
      });
      // 🔹 ivLyrics-overlay 앱으로 원문 가사 먼저 전송 (번역 로딩 전)
      // 단, 번역 모드가 켜져 있다면 번역이 준비될 때까지 기다림 (UI 깜빡임/레이아웃 변경 방지)
      const isTranslationEnabled = (displayMode1 && displayMode1 !== 'none') || (displayMode2 && displayMode2 !== 'none');

      if (!isTranslationEnabled) {
        window.dispatchEvent(new CustomEvent('ivLyrics:lyrics-ready', {
          detail: {
            trackInfo: { uri, title: this.state.title, artist: this.state.artist },
            lyrics: originalLyrics
          }
        }));
      }
    }

    // Progressive loading: keep results per track so Mode 1 does not disappear when Mode 2 finishes
    // Check if display modes or provider changed - if so, clear cached results
    const currentProvider = lyricsState.provider || '';
    if (this._dmResults[currentUri]) {
      const cached = this._dmResults[currentUri];
      // If provider changed, invalidate all cache for this track
      if (cached.lastProvider !== currentProvider) {
        ivLyricsDebug(`[processLyricsWithDisplayModes] Provider changed from ${cached.lastProvider} to ${currentProvider}, invalidating cache`);
        cached.mode1 = null;
        cached.mode2 = null;
      }
      // If mode settings changed, invalidate cache for that mode
      if (cached.lastMode1 !== displayMode1) {
        cached.mode1 = null;
      }
      if (cached.lastMode2 !== displayMode2) {
        cached.mode2 = null;
      }
    }

    this._dmResults[currentUri] = this._dmResults[currentUri] || {
      mode1: null,
      mode2: null,
    };
    this._dmResults[currentUri].lastMode1 = displayMode1;
    this._dmResults[currentUri].lastMode2 = displayMode2;
    this._dmResults[currentUri].lastProvider = currentProvider;

    let lyricsMode1 = this._dmResults[currentUri].mode1;
    let lyricsMode2 = this._dmResults[currentUri].mode2;

    const updateCombinedLyrics = () => {
      // Guard clause to prevent race conditions from previous songs
      if (this.state.uri !== uri) {
        return;
      }
      ivLyricsDebug(
        "[updateCombinedLyrics] Mode1 data:",
        lyricsMode1 ? "present" : "null"
      );
      ivLyricsDebug(
        "[updateCombinedLyrics] Mode2 data:",
        lyricsMode2 ? "present" : "null"
      );
      // Smart deduplication and optimization - pass display modes
      const optimizedTranslations = this.optimizeTranslations(
        lyrics,
        lyricsMode1,
        lyricsMode2,
        lyricsMode1 ? displayMode1 : null,
        lyricsMode2 ? displayMode2 : null
      );
      const finalLyrics = Array.isArray(optimizedTranslations)
        ? optimizedTranslations
        : [];

      this.setState({
        currentLyrics: finalLyrics,
      });

      // 🔹 ivLyrics-overlay 앱으로 가사 전송
      window.dispatchEvent(new CustomEvent('ivLyrics:lyrics-ready', {
        detail: {
          trackInfo: { uri, title: this.state.title, artist: this.state.artist },
          lyrics: finalLyrics
        }
      }));
    };

    // 스마트 로딩 전략: 두 모드 모두 활성화된 경우 둘 다 완료될 때까지 기다림
    const mode1Active = displayMode1 && displayMode1 !== "none";
    const mode2Active = displayMode2 && displayMode2 !== "none";

    ivLyricsDebug(
      "[displayTranslations] Mode1:",
      displayMode1,
      "Active:",
      mode1Active
    );
    ivLyricsDebug(
      "[displayTranslations] Mode2:",
      displayMode2,
      "Active:",
      mode2Active
    );

    if (mode1Active && mode2Active) {
      // 두 개 모드 모두 활성화: 각각 완료되는 즉시 업데이트 (Progressive Loading)
      // 캐시된 결과가 있으면 재사용, 없으면 새로 요청
      const promise1 = lyricsMode1
        ? Promise.resolve(lyricsMode1)
        : processMode(displayMode1, lyrics, (partialLyrics) => {
          if (this.state.uri !== uri || !partialLyrics) return;
          lyricsMode1 = partialLyrics;
          this._dmResults[currentUri].mode1 = partialLyrics;
          this.applyStreamingTranslation({
            uri,
            lyrics,
            lyricsMode1,
            lyricsMode2,
            displayMode1,
            displayMode2,
          });
        });
      const promise2 = lyricsMode2
        ? Promise.resolve(lyricsMode2)
        : processMode(displayMode2, lyrics, (partialLyrics) => {
          if (this.state.uri !== uri || !partialLyrics) return;
          lyricsMode2 = partialLyrics;
          this._dmResults[currentUri].mode2 = partialLyrics;
          this.applyStreamingTranslation({
            uri,
            lyrics,
            lyricsMode1,
            lyricsMode2,
            displayMode1,
            displayMode2,
          });
        });

      // 각 promise가 완료되는 즉시 업데이트
      promise1
        .then((result) => {
          // Guard clause: 다른 곡으로 변경되었는지 확인
          if (this.state.uri !== uri) {
            return;
          }
          if (result) {
            lyricsMode1 = result;
            this._dmResults[currentUri].mode1 = result;
            updateCombinedLyrics(); // 첫 번째 결과가 나오면 즉시 표시
          }
        })
        .catch((error) => {
          console.error("[Mode1] Error:", error);
          // 실패해도 계속 진행
        });

      promise2
        .then((result) => {
          // Guard clause: 다른 곡으로 변경되었는지 확인
          if (this.state.uri !== uri) {
            return;
          }
          if (result) {
            lyricsMode2 = result;
            this._dmResults[currentUri].mode2 = result;
            updateCombinedLyrics(); // 두 번째 결과가 나오면 즉시 추가 표시
          }
        })
        .catch((error) => {
          console.error("[Mode2] Error:", error);
          // 실패해도 계속 진행
        });
    } else if (mode1Active) {
      // Mode1만 활성화: Mode1 완료 시 바로 업데이트
      // Mode2는 비활성화되었으므로 null로 설정
      lyricsMode2 = null;
      this._dmResults[currentUri].mode2 = null;

      // 캐시된 결과가 있으면 바로 업데이트, 없으면 새로 요청
      if (lyricsMode1) {
        updateCombinedLyrics();
      } else {
        processMode(displayMode1, lyrics, (partialLyrics) => {
          if (this.state.uri !== uri || !partialLyrics) return;
          lyricsMode1 = partialLyrics;
          this._dmResults[currentUri].mode1 = partialLyrics;
          this.applyStreamingTranslation({
            uri,
            lyrics,
            lyricsMode1,
            lyricsMode2,
            displayMode1,
            displayMode2,
          });
        })
          .then((result) => {
            lyricsMode1 = result;
            this._dmResults[currentUri].mode1 = result;
            updateCombinedLyrics();
          })
          .catch((error) => {
            // 실패해도 UI 업데이트 (원문은 이미 표시됨)
            updateCombinedLyrics();
          });
      }
    } else if (mode2Active) {
      // Mode2만 활성화: Mode2 완료 시 바로 업데이트
      // Mode1은 비활성화되었으므로 null로 설정
      lyricsMode1 = null;
      this._dmResults[currentUri].mode1 = null;

      // 캐시된 결과가 있으면 바로 업데이트, 없으면 새로 요청
      if (lyricsMode2) {
        updateCombinedLyrics();
      } else {
        processMode(displayMode2, lyrics, (partialLyrics) => {
          if (this.state.uri !== uri || !partialLyrics) return;
          lyricsMode2 = partialLyrics;
          this._dmResults[currentUri].mode2 = partialLyrics;
          this.applyStreamingTranslation({
            uri,
            lyrics,
            lyricsMode1,
            lyricsMode2,
            displayMode1,
            displayMode2,
          });
        })
          .then((result) => {
            lyricsMode2 = result;
            this._dmResults[currentUri].mode2 = result;
            updateCombinedLyrics();
          })
          .catch((error) => {
            // 실패해도 UI 업데이트 (원문은 이미 표시됨)
            updateCombinedLyrics();
          });
      }
    }
  }

  /**
   * Smart optimization for translations - removes duplicates and identical content
   * @param {Array} originalLyrics - Original lyrics
   * @param {Array} mode1 - Translation from Display Mode 1
   * @param {Array} mode2 - Translation from Display Mode 2
   * @param {String} displayMode1 - Mode type for mode1 (e.g., "gemini_romaji", "gemini_ko")
   * @param {String} displayMode2 - Mode type for mode2
   * @returns {Array} Optimized lyrics with smart deduplication
   */
  optimizeTranslations(
    originalLyrics,
    mode1,
    mode2,
    displayMode1,
    displayMode2
  ) {
    // React 31 방지: 배열 유효성 검사
    if (!originalLyrics || !Array.isArray(originalLyrics)) {
      return [];
    }

    // Determine which mode is phonetic (romaji) and which is translation
    const mode1IsPhonetic = displayMode1 === "gemini_romaji";
    const mode2IsPhonetic = displayMode2 === "gemini_romaji";

    // Helper: note/placeholder-only line (e.g., ♪, …)
    const isNoteLine = (text) => {
      const t = String(text || "").trim();
      if (!t) return true;
      return /^[\s♪♩♫♬·•・。.、…~\-]+$/.test(t);
    };

    // Helper function to normalize text for comparison
    const normalizeForComparison = (text) => {
      if (!text || typeof text !== "string") return "";
      return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, "") // remove punctuation/symbols but keep letters/numbers of any script
        .replace(/\s+/g, " ")
        .trim();
    };

    // Helper function to check if two translations are similar (>85% similarity)
    const areTranslationsSimilar = (text1, text2) => {
      if (!text1 || !text2) return false;
      const norm1 = normalizeForComparison(text1);
      const norm2 = normalizeForComparison(text2);
      if (!norm1 || !norm2) return false;
      if (norm1 === norm2) return true;
      const words1 = norm1.split(" ").filter((w) => w.length > 2);
      const words2 = norm2.split(" ").filter((w) => w.length > 2);
      if (words1.length === 0 || words2.length === 0) return false;
	      const words2Set = new Set(words2);
	      const commonWords = words1.filter((word) => words2Set.has(word));
      const similarity =
        commonWords.length / Math.max(words1.length, words2.length);
      return similarity > 0.85;
    };

    // Process each line to determine what to display
    const processedLyrics = originalLyrics.map((line, i) => {
      // React 31 방지: null/undefined 체크 및 안전한 텍스트 추출
      if (!line) {
        return { text: null, text2: null, originalText: "" };
      }

      // Safely extract original text
      const originalText =
        typeof line === "object" ? line.text || "" : String(line || "");
      let translation1 = "";
      let translation2 = "";

      // Safely extract translations with boundary check
      if (mode1 && Array.isArray(mode1) && i < mode1.length && mode1[i]) {
        translation1 =
          typeof mode1[i] === "object"
            ? mode1[i].text || ""
            : String(mode1[i] || "");
      }
      if (mode2 && Array.isArray(mode2) && i < mode2.length && mode2[i]) {
        translation2 =
          typeof mode2[i] === "object"
            ? mode2[i].text || ""
            : String(mode2[i] || "");
      }

      // If original is a note/placeholder line, never show sub-lines
      if (isNoteLine(originalText)) {
        return { ...line, originalText, text: null, text2: null };
      }

      // Ignore translations that are notes-only
      if (isNoteLine(translation1)) translation1 = "";
      if (isNoteLine(translation2)) translation2 = "";

      const normalizedOriginal = normalizeForComparison(originalText);
      const normalizedTrans1 = normalizeForComparison(translation1);
      const normalizedTrans2 = normalizeForComparison(translation2);

      const trans1SameAsOriginal =
        normalizedTrans1 && normalizedTrans1 === normalizedOriginal;
      const trans2SameAsOriginal =
        normalizedTrans2 && normalizedTrans2 === normalizedOriginal;
      const translationsSame =
        normalizedTrans1 &&
        normalizedTrans2 &&
        (normalizedTrans1 === normalizedTrans2 ||
          areTranslationsSimilar(translation1, translation2));

      let finalText = null; // This will be phonetic (romaji/발음)
      let finalText2 = null; // This will be translation (번역)

      // Helper function to process phonetic hyphen replacement
      const processPhoneticHyphen = (text) => {
        if (!text || typeof text !== "string") return text;
        const hyphenMode = CONFIG.visual["phonetic-hyphen-replace"] || "keep";
        if (hyphenMode === "keep") return text;
        if (hyphenMode === "space") return text.replace(/-/g, " ");
        if (hyphenMode === "remove") return text.replace(/-/g, "");
        return text;
      };

      // Assign to correct slots based on mode types
      let phoneticText = "";
      let translationText = "";

      if (mode1IsPhonetic) {
        phoneticText = processPhoneticHyphen(translation1);
      } else if (mode1) {
        translationText = translation1;
      }

      if (mode2IsPhonetic) {
        phoneticText = processPhoneticHyphen(translation2);
      } else if (mode2) {
        translationText = translation2;
      }

      // Deduplication logic
      if (translationsSame) {
        // Both are the same, always show in translation slot (not phonetic)
        const combinedText = translation1 || translation2;
        if (!trans1SameAsOriginal) {
          finalText2 = combinedText; // Always use translation slot when they're the same
        }
      } else {
        // Different results - assign to correct slots
        // finalText = phonetic, finalText2 = translation
        if (!trans1SameAsOriginal && phoneticText) finalText = phoneticText;
        if (!trans2SameAsOriginal && translationText)
          finalText2 = translationText;
        // Also handle case where trans1 is same but trans2 is not
        if (trans1SameAsOriginal && !trans2SameAsOriginal) {
          if (mode2IsPhonetic) {
            finalText = translation2;
          } else {
            finalText2 = translation2;
          }
        } else if (!trans1SameAsOriginal && trans2SameAsOriginal) {
          if (mode1IsPhonetic) {
            finalText = translation1;
          } else {
            finalText2 = translation1;
          }
        }
      }

      // Create safe line object ensuring all properties are valid
      const safeLine = {
        ...(line && typeof line === "object" ? line : {}),
        originalText: String(originalText),
        text: finalText ? String(finalText) : null,
        text2: finalText2 ? String(finalText2) : (line.text2 ? String(line.text2) : null),
      };

      return safeLine;
    });

    return processedLyrics;
  }

  getGeminiTranslation(lyricsState, lyrics, mode, onProgress = null) {
    return new Promise((resolve, reject) => {
      const viKey = StorageManager.getPersisted(
        `${APP_NAME}:visual:gemini-api-key`
      );
      const romajiKey = StorageManager.getPersisted(
        `${APP_NAME}:visual:gemini-api-key-romaji`
      );

      // Determine mode type and API key
      let wantSmartPhonetic = false;
      let apiKey;

      if (mode === "gemini_romaji") {
        // Use Smart Phonetic logic for the unified Romaji, Romaja, Pinyin button
        wantSmartPhonetic = true;
        apiKey = "no";
      } else {
        // Default to Korean
        apiKey = "no";
      }

      if (!apiKey || !Array.isArray(lyrics) || lyrics.length === 0) {
        return reject(
          new Error(
            "Gemini API key missing. Please add at least one key in Settings."
          )
        );
      }

      const cacheKey = mode;
      const providerKey = lyricsState.provider || '';
      const cacheKey2 = `${lyricsState.uri}:${providerKey}:${cacheKey}`;
      const cached = CacheManager.get(cacheKey2);

      if (cached) {
        // Fix cached items if they have double-encoded JSON structure
        let fixNeeded = false;
        let targetField = wantSmartPhonetic ? 'phonetic' : 'translation';

        if (cached[targetField] && Array.isArray(cached[targetField]) &&
          cached[targetField].length === 1 && typeof cached[targetField][0] === 'string' &&
          cached[targetField][0].trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(cached[targetField][0]);
            if (wantSmartPhonetic && Array.isArray(parsed.phonetic)) {
              cached.phonetic = parsed.phonetic;
              fixNeeded = true;
            } else if (!wantSmartPhonetic && Array.isArray(parsed.translation)) {
              cached.translation = parsed.translation;
              fixNeeded = true;
            } else if (parsed.translation && Array.isArray(parsed.translation)) {
              // Fallback
              cached[targetField] = parsed.translation;
              fixNeeded = true;
            }
          } catch (e) { }
        }

        return resolve(cached);
      }

      // De-duplicate concurrent calls per (uri, type). Share the same promise for callers
      const inflightKey = `${lyricsState.uri}:${providerKey}:${cacheKey}`;
      if (this._inflightGemini?.has(inflightKey)) {
        return this._inflightGemini
          .get(inflightKey)
          .then(resolve)
          .catch(reject);
      }

      // Use optimized rate limiter with separate keys for each translation type
      const rateLimitKey = mode.replace("gemini_", "gemini-");
      if (!RateLimiter.canMakeCall(rateLimitKey, 5, 2000)) {
        const modeName =
          mode === "gemini_romaji" ? "Romaji, Romaja, Pinyin" : "Korean";
        return reject(
          new Error(
            I18n.t("notifications.tooManyTranslationRequests")
          )
        );
      }

      // Filter out section headers before sending to Gemini for translation
      const text = getNonSectionLyricsText(lyrics);

      // Create mapping arrays for proper alignment
	      const originalNonSectionIndexMap = new Map();
	      let nonSectionLineIndex = 0;
	      lyrics.forEach((line, i) => {
	        const lineText = line?.text || "";
	        if (!Utils.isSectionHeader(lineText) && lineText.trim() !== "") {
	          originalNonSectionIndexMap.set(i, nonSectionLineIndex++);
	        }
	      });

      const mapResultLinesToLyrics = (linesInput) => {
        if (!Array.isArray(linesInput)) return null;

        const cleanTranslationLines = linesInput.filter(
          (line) =>
            line !== undefined &&
            line !== null &&
            String(line).trim() !== "" &&
            !Utils.isSectionHeader(String(line).trim())
        );

        return lyrics.map((line, i) => {
          const originalText = line?.text || "";

          if (Utils.isSectionHeader(originalText)) {
            return {
              ...line,
              text: null,
              originalText: originalText,
            };
          }

          if (originalText.trim() === "") {
            return {
              ...line,
              text: "",
              originalText: originalText,
            };
          }

	          const positionInNonSectionLines =
	            originalNonSectionIndexMap.get(i);
	          const translatedText =
	            cleanTranslationLines[positionInNonSectionLines]?.trim() || "";

          return {
            ...line,
            text: translatedText || line?.text || "",
            originalText: originalText,
          };
        });
      };

      const streamedLines = [];
      const handleStreamLine = onProgress
        ? (lineIndex, lineText) => {
          if (typeof lineIndex !== "number" || lineIndex < 0) return;
          streamedLines[lineIndex] = typeof lineText === "string" ? lineText : "";
          const partialMapped = mapResultLinesToLyrics(streamedLines);
          if (partialMapped && this.state.uri === lyricsState.uri) {
            onProgress(partialMapped);
          }
        }
        : null;

      // Start appropriate loading indicator based on mode type (1초 후 표시)
      if (wantSmartPhonetic) {
        this.startPhoneticLoading();
      } else {
        this.startTranslationLoading();
      }

      const inflightPromise = window.Translator.callGemini({
        apiKey,
        artist: this.state.artist || lyricsState.artist,
        title: this.state.title || lyricsState.title,
        text,
        wantSmartPhonetic,
        provider: lyricsState.provider,
        onLine: handleStreamLine,
      })
        .then((response) => {
          let outText;
          if (wantSmartPhonetic) {
            outText = response.phonetic;
          } else {
            outText = response.translation || response.vi;
          }

          if (!outText) throw new Error("Empty result from Gemini.");

          // Handle nested JSON packaging (API issue workaround)
          if (Array.isArray(outText) && outText.length === 1 && typeof outText[0] === 'string') {
            try {
              if (outText[0].trim().startsWith('{')) {
                const parsed = JSON.parse(outText[0]);
                if (wantSmartPhonetic && Array.isArray(parsed.phonetic)) {
                  outText = parsed.phonetic;
                } else if (!wantSmartPhonetic && Array.isArray(parsed.translation)) {
                  outText = parsed.translation;
                } else if (parsed.translation && Array.isArray(parsed.translation)) {
                  // Fallback: request was phonetic but response came as translation?
                  // or just general structure match
                  outText = parsed.translation;
                }
              }
            } catch (e) {
              // Not valid JSON, process as standard array
            }
          }

          // Handle both array and string formats
          let lines;
          if (Array.isArray(outText)) {
            lines = outText;
          } else if (typeof outText === "string") {
            lines = outText.split("\n");
          } else {
            throw new Error("Invalid translation format received from Gemini.");
          }
          const mapped = mapResultLinesToLyrics(lines);
          if (!mapped) {
            throw new Error("Failed to map streamed translation lines.");
          }
          CacheManager.set(cacheKey2, mapped);
          return mapped;
        })
        .finally(() => {
          // Clear appropriate loading indicator based on mode type
          if (wantSmartPhonetic) {
            this.clearPhoneticLoading();
          } else {
            this.clearTranslationLoading();
          }
          this._inflightGemini = this._inflightGemini || new Map();
          this._inflightGemini?.delete(inflightKey);
        });

      this._inflightGemini = this._inflightGemini || new Map();
      this._inflightGemini.set(inflightKey, inflightPromise);
      inflightPromise.then(resolve).catch(reject);
    });
  }

  getTraditionalConversion(lyricsState, lyrics, language, displayMode) {
    return new Promise((resolve, reject) => {
      if (!Array.isArray(lyrics))
        return reject(new Error("Invalid lyrics format for conversion."));

      const cacheKey = `${lyricsState.uri}:trad:${language}:${displayMode}`;
      const cached = CacheManager.get(cacheKey);
      if (cached) return resolve(cached);

      // De-duplicate concurrent calls per (uri, language, mode)
      this._inflightTrad = this._inflightTrad || new Map();
      const inflightKey = `${lyricsState.uri}:trad:${language}:${displayMode}`;
      if (this._inflightTrad.has(inflightKey)) {
        return this._inflightTrad.get(inflightKey).then(resolve).catch(reject);
      }

      // Start translation loading indicator (1초 후 표시)
      this.startTranslationLoading();

      const inflightPromise = this.translateLyrics(
        language,
        lyrics,
        displayMode
      )
        .then((translated) => {
          if (translated !== undefined && translated !== null) {
            CacheManager.set(cacheKey, translated);
            return translated;
          }
          throw new Error("Empty result from conversion.");
        })
        .finally(() => {
          this.clearTranslationLoading();
          this._inflightTrad.delete(inflightKey);
        });

      this._inflightTrad.set(inflightKey, inflightPromise);
      inflightPromise.then(resolve).catch(reject);
    });
  }

  provideLanguageCode(lyrics) {
    if (!lyrics) return null;

    // 1. 트랙별 언어 오버라이드 우선 확인 (IndexedDB에서 로드된 값)
    if (this.trackLanguageOverride) {
      Utils.setDetectedLanguage(this.trackLanguageOverride);
      return this.trackLanguageOverride;
    }

    // For Kuromoji mode, use language override if set
    if (CONFIG.visual["translate:detect-language-override"] !== "off") {
      const overrideLanguage =
        CONFIG.visual["translate:detect-language-override"];
      // Update Utils detected language for furigana check
      Utils.setDetectedLanguage(overrideLanguage);
      return overrideLanguage;
    }

    // If we have a cached language in state, use it
    if (this.state.language) {
      // Update Utils detected language for furigana check
      Utils.setDetectedLanguage(this.state.language);
      return this.state.language;
    }

    // Otherwise, detect language from lyrics
    const detectedLanguage = Utils.detectLanguage(lyrics);
    // Update Utils detected language for furigana check
    Utils.setDetectedLanguage(detectedLanguage);
    return detectedLanguage;
  }

  async translateLyrics(language, lyrics, targetConvert) {
    if (
      !language ||
      !Array.isArray(lyrics) ||
      String(targetConvert).startsWith("gemini")
    ) {
      return lyrics;
    }

    if (!this.translator) {
      this.translator = new window.Translator(language);
    }
    await this.translator.awaitFinished(language);

    let result;
    try {
      if (language === "ja") {
        // Japanese
        const map = {
          romaji: { target: "romaji", mode: "spaced" },
          furigana: { target: "hiragana", mode: "furigana" },
          hiragana: { target: "hiragana", mode: "normal" },
          katakana: { target: "katakana", mode: "normal" },
        };

        if (!map[targetConvert]) return lyrics;

        result = await Promise.all(
          lyrics.map(
            async (lyric) =>
              await this.translator.romajifyText(
                lyric?.text || "",
                map[targetConvert].target,
                map[targetConvert].mode
              )
          )
        );
      } else if (language === "ko") {
        // Korean
        if (targetConvert !== "romaja") return lyrics;
        result = await Promise.all(
          lyrics.map(
            async (lyric) =>
              await this.translator.convertToRomaja(
                lyric?.text || "",
                targetConvert
              )
          )
        );
      } else if (language === "zh-hans") {
        // Chinese (Simplified)
        if (targetConvert === "pinyin") {
          result = await Promise.all(
            lyrics.map(
              async (lyric) =>
                await this.translator.convertToPinyin(lyric?.text || "", {
                  toneType: "mark",
                  type: "string",
                })
            )
          );
          // Warn if pinyin conversion produced no visible changes (likely CDN blocked -> fallback)
          const anyChanged = lyrics.some(
            (lyric, i) => (result?.[i] ?? "") !== (lyric?.text || "")
          );
          if (!anyChanged) {
            Toast.error(I18n.t("notifications.pinyinLibraryUnavailable"));
          }
        } else {
          const map = {
            cn: { from: "cn", target: "cn" },
            tw: { from: "cn", target: "tw" },
            hk: { from: "cn", target: "hk" },
          };

          // prevent conversion between the same language.
          if (targetConvert === "cn") {
            Toast.show(I18n.t("notifications.conversionSkippedSimplified"));
            return lyrics;
          }

          result = await Promise.all(
            lyrics.map(
              async (lyric) =>
                await this.translator.convertChinese(
                  lyric?.text || "",
                  map[targetConvert].from,
                  map[targetConvert].target
                )
            )
          );
        }
      } else if (language === "zh-hant") {
        // Chinese (Traditional)
        if (targetConvert === "pinyin") {
          result = await Promise.all(
            lyrics.map(
              async (lyric) =>
                await this.translator.convertToPinyin(lyric?.text || "", {
                  toneType: "mark",
                  type: "string",
                })
            )
          );
          // Warn if pinyin conversion produced no visible changes (likely CDN blocked -> fallback)
          const anyChanged = lyrics.some(
            (lyric, i) => (result?.[i] ?? "") !== (lyric?.text || "")
          );
          if (!anyChanged) {
            Toast.error(I18n.t("notifications.pinyinLibraryUnavailable"));
          }
        } else {
          const map = {
            cn: { from: "t", target: "cn" },
            hk: { from: "t", target: "hk" },
            tw: { from: "t", target: "tw" },
          };

          if (!map[targetConvert]) return lyrics;

          // Allow conversion from Traditional Chinese to different variants/simplified
          result = await Promise.all(
            lyrics.map(
              async (lyric) =>
                await this.translator.convertChinese(
                  lyric?.text || "",
                  map[targetConvert].from,
                  map[targetConvert].target
                )
            )
          );
        }
      }

      const res = Utils.processTranslatedLyrics(result, lyrics);
      Toast.success(I18n.t("notifications.conversionCompleted"));
      return res;
    } catch (error) {
      Toast.error(`${I18n.t("notifications.conversionFailed")}: ${error.message || "Unknown error"}`
      );
    }
  }

  /**
   * 커뮤니티 싱크 오프셋 자동 적용
   */
  async applyCommunityOffset(trackUri) {
    try {
      // 이미 로컬에 저장된 오프셋이 있으면 스킵
      const localOffset = await Utils.getTrackSyncOffset(trackUri);
      if (localOffset && localOffset !== 0) {
        ivLyricsDebug(`[ivLyrics] Using local offset: ${localOffset}ms`);
        return;
      }

      // 커뮤니티 오프셋 조회
      const communityData = await Utils.getCommunityOffset(trackUri);
      if (!communityData) return;

      const minConfidence = CONFIG.visual["community-sync-min-confidence"] || 0.5;

      // 신뢰도가 최소값 이상인 경우에만 적용
      if ((communityData.confidence ?? 0) >= minConfidence) {
        const offsetToApply = communityData.medianOffsetMs ?? communityData.offsetMs ?? 0;

        if (offsetToApply !== 0) {
          await Utils.setTrackSyncOffset(trackUri, offsetToApply);
          ivLyricsDebug(`[ivLyrics] Applied community offset: ${offsetToApply}ms (confidence: ${communityData.confidence})`);

          // UI 업데이트를 위해 이벤트 발생
          window.dispatchEvent(new CustomEvent('ivLyrics:offset-changed', {
            detail: { trackUri, offset: offsetToApply }
          }));
        }
      }
    } catch (error) {
      console.error("[ivLyrics] Failed to apply community offset:", error);
    }
  }

  resetDelay() {
    CONFIG.visual.delay =
      Number(
        StorageManager.getItem(`lyrics-delay:${Spicetify.Player.data.item.uri}`)
      ) || 0;
  }

  // Helper method to get translation states for saving/restoring
  getTranslationStates() {
    return {
      romaji: this.state.romaji,
      furigana: this.state.furigana,
      hiragana: this.state.hiragana,
      katakana: this.state.katakana,
      hangul: this.state.hangul,
      romaja: this.state.romaja,
      cn: this.state.cn,
      hk: this.state.hk,
      tw: this.state.tw,
      currentLyrics: this.state.currentLyrics,
      language: this.state.language,
    };
  }

  // Helper method to apply translation states
  applyTranslationStates(states, additional = {}) {
    return {
      ...additional,
      ...(states.romaji && { romaji: states.romaji }),
      ...(states.furigana && { furigana: states.furigana }),
      ...(states.hiragana && { hiragana: states.hiragana }),
      ...(states.katakana && { katakana: states.katakana }),
      ...(states.hangul && { hangul: states.hangul }),
      ...(states.romaja && { romaja: states.romaja }),
      ...(states.cn && { cn: states.cn }),
      ...(states.hk && { hk: states.hk }),
      ...(states.tw && { tw: states.tw }),
      ...(states.currentLyrics && { currentLyrics: states.currentLyrics }),
      ...(states.language && { language: states.language }),
    };
  }

  saveLocalLyrics(uri, lyrics) {
    // Include translations and phonetic conversions in cache
    const fullLyricsData = {
      ...lyrics,
      ...this.getTranslationStates(),
    };

    const localLyrics =
      JSON.parse(StorageManager.getItem(`${APP_NAME}:local-lyrics`)) || {};
    localLyrics[uri] = fullLyricsData;
    StorageManager.setItem(
      `${APP_NAME}:local-lyrics`,
      JSON.stringify(localLyrics)
    );
    this.setState({ isCached: true });
  }

  deleteLocalLyrics(uri) {
    const localLyrics =
      JSON.parse(StorageManager.getItem(`${APP_NAME}:local-lyrics`)) || {};
    delete localLyrics[uri];
    StorageManager.setItem(
      `${APP_NAME}:local-lyrics`,
      JSON.stringify(localLyrics)
    );
    this.setState({ isCached: false });
  }

  lyricsSaved(uri) {
    const localLyrics =
      JSON.parse(StorageManager.getItem(`${APP_NAME}:local-lyrics`)) || {};
    return !!localLyrics[uri];
  }

  resetTranslationCache(uri) {
    // Clear translation cache for this URI
    const clearedCount = CacheManager.clearByUri(uri);

    // Clear progressive results for this track
    if (this._dmResults && this._dmResults[uri]) {
      delete this._dmResults[uri];
    }

    // Clear inflight Gemini requests for this track
    if (this._inflightGemini) {
      const keysToDelete = [];
      for (const [key] of this._inflightGemini) {
        if (key.startsWith(`${uri}:`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach((key) => this._inflightGemini.delete(key));
    }

    // Check if there are any translations to reset
    const hasTranslations =
      this.state.romaji ||
      this.state.furigana ||
      this.state.hiragana ||
      this.state.katakana ||
      this.state.hangul ||
      this.state.romaja ||
      this.state.cn ||
      this.state.hk ||
      this.state.tw;

    // Reset translation states
    this.setState({
      romaji: null,
      furigana: null,
      hiragana: null,
      katakana: null,
      hangul: null,
      romaja: null,
      cn: null,
      hk: null,
      tw: null,
    });

    // Force re-process lyrics with current display modes
    const currentMode = this.getCurrentMode();
    this.lyricsSource(this.state, currentMode);

    if (hasTranslations) {
      Toast.success(I18n.t("notifications.translationCacheReset").replace("{count}", clearedCount));
    } else {
      Toast.success(I18n.t("notifications.translationCacheRemoved"));
    }
  }

  processLyricsFromFile(event) {
    const file = event.target.files;
    if (!file.length) return;
    const reader = new FileReader();

    if (file[0].size > 1024 * 1024) {
      Toast.error(I18n.t("notifications.fileTooLarge"));
      return;
    }

    reader.onload = (e) => {
      try {
        const localLyrics = Utils.parseLocalLyrics(e.target.result);
        const parsedKeys = Object.keys(localLyrics)
          .filter((key) => localLyrics[key])
          .map((key) => key[0].toUpperCase() + key.slice(1));

        if (!parsedKeys.length) {
          Toast.error(I18n.t("notifications.noValidLyricsInFile"));
          return;
        }

        this.setState({
          ...localLyrics,
          provider: "local",
          ...this.applyTranslationStates(localLyrics),
        });
        CACHE[this.currentTrackUri] = {
          ...localLyrics,
          provider: "local",
          uri: this.currentTrackUri,
        };
        this.saveLocalLyrics(this.currentTrackUri, localLyrics);

        Toast.success(I18n.t("notifications.lyricsLoadedFromFile").replace("{types}", parsedKeys.join(", ")));
      } catch (e) {
        Toast.error(I18n.t("notifications.lyricsLoadFailed"));
      }
    };

    reader.onerror = (e) => {
      Toast.error(I18n.t("notifications.fileReadFailed"));
    };

    reader.readAsText(file[0]);
    event.target.value = "";
  }
  initMoustrap() {
    if (!this.mousetrap && Spicetify.Mousetrap) {
      this.mousetrap = new Spicetify.Mousetrap();
    }
  }

  componentDidMount() {
    document.body.classList.add('ivlyrics-page-active');

    // Prevent duplicate global registration
    if (window.lyricContainer && window.lyricContainer !== this) {
      if (typeof window.lyricContainer.componentWillUnmount === "function") {
        window.lyricContainer.componentWillUnmount();
      }
    }

    // Register instance for external access
    window.lyricContainer = this;
    // Note: reloadLyrics will be exposed after it's defined below

    // Prefetcher에 LyricsContainer 참조 설정
    Prefetcher.setLyricsContainer(this);

    // Cache DOM elements to avoid repeated queries
    this._domCache = {
      viewport: null,
      fadContainer: null,
      fileInput: null,
    };

    // Check for first-run setup wizard
    if (typeof isSetupNeeded === "function" && isSetupNeeded()) {
      setTimeout(() => {
        if (typeof openSetupWizard === "function") {
          openSetupWizard();
        }
      }, 500); // Small delay to ensure all components are loaded
    }

    // Check for updates when app starts
    setTimeout(() => {
      Utils.showUpdateNotificationIfAvailable().catch((error) => {
        // Error ignored
      });
    }, 3000); // Delay to avoid interfering with app startup

    // Initialize enhanced cache system only once
    if (!CacheManager._initialized) {
      CacheManager.init();
      CacheManager._initialized = true;
    }

    this.onQueueChange = async ({ data: queue }) => {
      const newUri = queue.current?.uri;
      if (!newUri) return;

      // 트랙이 변경되었을 때만 실행 (중복 요청 방지)
      if (this.currentTrackUri !== newUri) {
        if (this.state.isLyricsEditModalOpen) {
          this.closeLyricsEditModal();
        }
        // 이전 트랙의 진행 중인 번역 요청 정리
        const previousTrackId = this.currentTrackUri?.split(':')[2];
        if (previousTrackId) {
          window.Translator.clearInflightRequests(previousTrackId);
        }

        this.currentTrackUri = newUri;
        this.setState({ explicitMode: -1 }, () => {
          this.fetchLyrics(queue.current, -1);
        });
        this.viewPort.scrollTo(0, 0);

        // 트랙 변경 시 videoInfo 초기화 후 저장된 영상 확인
        this.setState({ videoInfo: null });
        this.loadSavedVideoForTrack(newUri);

        // 커뮤니티 싱크 오프셋 자동 적용
        if (CONFIG.visual["community-sync-enabled"] && CONFIG.visual["community-sync-auto-apply"]) {
          this.applyCommunityOffset(newUri);
        }
      }

      // 다음 곡의 모든 요소 프리페치 (가사 → 번역/발음 → 영상 배경)
      const nextTrack = queue.queued?.[0] || queue.nextUp?.[0];
      const nextInfo = this.infoFromTrack(nextTrack);
      // Debounce next track fetch
      if (!nextInfo || nextInfo.uri === this.nextTrackUri) return;
      this.nextTrackUri = nextInfo.uri;

      // Prefetcher가 가사부터 번역/영상까지 순차적으로 처리
      Prefetcher.prefetchNextTrack(nextInfo, this.state.explicitMode);
    };

    if (Spicetify.Player?.data?.item) {
      this.currentTrackUri = Spicetify.Player.data.item.uri;
      this.setState({ explicitMode: -1 }, () => {
        this.fetchLyrics(Spicetify.Player.data.item, -1);
      });
      // 초기 로드 시 저장된 영상 확인
      this.loadSavedVideoForTrack(Spicetify.Player.data.item.uri);
    }

    this.updateVisualOnConfigChange();
    Utils.addQueueListener(this.onQueueChange);

    lyricContainerUpdate = () => {
      this.reRenderLyricsPage = !this.reRenderLyricsPage;
      this.updateVisualOnConfigChange();
      this.forceUpdate();
    };

    reloadLyrics = async (clearCache = true) => {
      ivLyricsDebug("[ivLyrics] Reloading lyrics...", { trackId: Spicetify.Player.data?.item?.uri, clearCache });

      // 메모리 캐시는 항상 초기화 (window.CACHE와의 참조를 유지하기 위해 객체의 키만 삭제)
      Object.keys(CACHE).forEach(key => delete CACHE[key]);

      // 현재 트랙 정보
      const item = Spicetify.Player.data?.item;
      const trackUri = item?.uri;
      const trackId = trackUri?.split(":").pop();

      // CacheManager (Gemini 번역 메모리 캐시)도 항상 현재 트랙에 대해 초기화
      if (trackUri) {
        CacheManager.clearByUri(trackUri);
      }

      // _dmResults (번역/발음 결과 메모리 캐시)도 초기화
      if (this._dmResults) {
        if (trackUri) {
          delete this._dmResults[trackUri];
        } else {
          this._dmResults = {};
        }
      }

      // 진행 중인 Gemini 요청도 취소
      if (this._inflightGemini && trackUri) {
        for (const [key] of this._inflightGemini) {
          if (key.startsWith(`${trackUri}:`)) {
            this._inflightGemini.delete(key);
          }
        }
      }

      // clearCache가 true이고 트랙 정보가 있으면 로컬 캐시도 삭제
      if (clearCache && trackId) {
        ivLyricsDebug("[ivLyrics] Clearing track cache for:", trackId);
        await LyricsCache.clearTrack(trackId);
        window.Translator?.clearMemoryCache?.(trackId);
        window.Translator?.clearInflightRequests?.(trackId);
        window.SyncDataService?.clearCache(trackId);
      }

      this.updateVisualOnConfigChange();
      this.forceUpdate();
      ivLyricsDebug("[ivLyrics] Fetching new lyrics...");
      this.fetchLyrics(
        Spicetify.Player.data.item,
        this.state.explicitMode,
        true
      );
    };

    // Expose reloadLyrics for external calls (e.g. SyncDataCreator)
    this.reloadLyrics = reloadLyrics;
    window.reloadLyrics = reloadLyrics;

    // Cache viewport element for better performance
    this.viewPort =
      this._domCache?.viewport ??
      (this._domCache &&
        (this._domCache.viewport =
          document.querySelector(".Root__main-view .os-viewport") ??
          document.querySelector(
            ".Root__main-view .main-view-container__scroll-node"
          )));

    this.configButton = new Spicetify.Menu.Item(
      "ivLyrics config",
      false,
      openConfig,
      "lyrics"
    );
    this.configButton.register();

    // Throttled font size change to improve performance
    let fontSizeChangeTimeout = null;
    this.onFontSizeChange = (event) => {
      if (!event.ctrlKey) return;

      // Prevent too frequent updates
      if (fontSizeChangeTimeout) return;

      fontSizeChangeTimeout = setTimeout(() => {
        fontSizeChangeTimeout = null;
      }, 50); // 50ms throttle

      const dir = event.deltaY < 0 ? 1 : -1;
      let temp = CONFIG.visual["font-size"] + dir * fontSizeLimit.step;
      if (temp < fontSizeLimit.min) {
        temp = fontSizeLimit.min;
      } else if (temp > fontSizeLimit.max) {
        temp = fontSizeLimit.max;
      }
      CONFIG.visual["font-size"] = temp;
      StorageManager.saveConfig("font-size", temp);
      lyricContainerUpdate();
    };

    this.toggleFullscreen = () => {
      const isEnabled = !this.state.isFullscreen;
      const useBrowserFullscreen = CONFIG.visual["fullscreen-browser-fullscreen"] === true;
      if (isEnabled) {
        // 기존 컨테이너가 DOM에 남아있으면 제거
        const existingContainer = document.getElementById("lyrics-fullscreen-container");
        if (existingContainer) {
          existingContainer.innerHTML = '';
          existingContainer.remove();
        }
        // 새로운 전체화면 컨테이너 생성
        this.fullscreenContainer = document.createElement("div");
        this.fullscreenContainer.id = "lyrics-fullscreen-container";
        // TMI 폰트 크기 CSS 변수 설정
        const tmiScale = (CONFIG.visual["fullscreen-tmi-font-size"] || 100) / 100;
        this.fullscreenContainer.style.setProperty("--fullscreen-tmi-font-size", tmiScale);
        document.body.append(this.fullscreenContainer);
        this.mousetrap.bind("esc", this.toggleFullscreen);
        // ESC 키 직접 리스너 추가 (Mousetrap이 캡처하지 못할 경우 대비)
        this._escHandler = (e) => {
          if (e.key === "Escape" && this.state.isFullscreen) {
            e.preventDefault();
            e.stopPropagation();
            this.toggleFullscreen();
          }
        };
        document.addEventListener("keydown", this._escHandler);

        // 브라우저 전체화면 변경 감지 리스너 추가
        this._fullscreenChangeHandler = () => {
          // 브라우저 전체화면이 종료되었고, ivLyrics 전체화면이 활성화된 상태라면
          if (!document.fullscreenElement && this.state.isFullscreen && useBrowserFullscreen) {
            this.toggleFullscreen();
          }
        };
        document.addEventListener("fullscreenchange", this._fullscreenChangeHandler);

        // 브라우저 전체화면 활성화
        if (useBrowserFullscreen && !document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch((err) => {
            console.debug("Fullscreen request failed:", err);
          });
        }
      } else {
        // 먼저 setState를 호출하여 React가 Portal 렌더링을 중단하도록 함
        // (이렇게 하면 React가 자연스럽게 컴포넌트를 언마운트함)

        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => { });
        }
        this.mousetrap.unbind("esc");
        // ESC 키 리스너 제거
        if (this._escHandler) {
          document.removeEventListener("keydown", this._escHandler);
          this._escHandler = null;
        }
        // 브라우저 전체화면 변경 리스너 제거
        if (this._fullscreenChangeHandler) {
          document.removeEventListener("fullscreenchange", this._fullscreenChangeHandler);
          this._fullscreenChangeHandler = null;
        }
        // 전체화면 종료 이벤트 발생 (GlobalShortcuts에서 이전 페이지로 이동하기 위해)
        window.dispatchEvent(new CustomEvent("ivLyrics:fullscreen-closed"));

        // 컨테이너는 setState 후 다음 렌더 사이클에서 React가 Portal을 렌더링하지 않으므로
        // 약간의 딜레이 후에 안전하게 제거
        const containerToRemove = this.fullscreenContainer;
        setTimeout(() => {
          if (containerToRemove && containerToRemove.parentNode) {
            containerToRemove.remove();
          }
          // 혹시 남아있는 컨테이너도 제거
          const leftover = document.getElementById("lyrics-fullscreen-container");
          if (leftover && leftover.parentNode) {
            leftover.remove();
          }
        }, 100); // React 렌더 사이클이 완료될 시간 확보
      }

      // 먼저 상태를 업데이트하여 React가 Portal 렌더링을 중단하게 함
      this.setState({
        isFullscreen: isEnabled,
        justEnteredFullscreen: isEnabled, // 전체화면 진입 시 true로 설정하여 축소 아이콘 대신 메뉴 아이콘 표시
        isFloatingMenuOpen: isEnabled ? this.state.isFloatingMenuOpen : false,
        isFloatingMenuClosing: false,
      });
    };
    this.mousetrap.reset();
    // 전체화면 단축키는 GlobalShortcuts.js에서 전역으로 처리
    window.addEventListener("fad-request", lyricContainerUpdate);

    // 설정 변경 리스너 - 노래방 모드 토글 처리
    this.handleConfigChange = (event) => {
      if (event.detail?.name === "karaoke-mode-enabled") {
        // 노래방 모드 설정이 변경되면 현재 모드를 다시 계산
        this.setState({ explicitMode: -1 });
      } else if (event.detail?.name === "spotify-fake-karaoke-enabled") {
        this.reloadLyrics?.(false);
      } else if (event.detail?.name === "pseudo-karaoke-render-advance") {
        this.forceUpdate?.();
      }
    };
    window.addEventListener("ivLyrics", this.handleConfigChange);

    // Listen for lyric index changes from Pages.js
    this.handleLyricIndexChange = (event) => {
      if (event.detail && typeof event.detail.index === 'number') {
        this.setState({ currentLyricIndex: event.detail.index });
      }
    };
    window.addEventListener("ivLyrics:lyric-index-changed", this.handleLyricIndexChange);

    // Portrait viewport detection listener
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this._portraitMql = window.matchMedia("(orientation: portrait)");
      this._portraitChangeHandler = (e) => {
        this._isPortraitViewport = e.matches;
        this.forceUpdate();
      };
      if (this._portraitMql.addEventListener) {
        this._portraitMql.addEventListener("change", this._portraitChangeHandler);
      } else if (this._portraitMql.addListener) {
        this._portraitMql.addListener(this._portraitChangeHandler);
      }
    }
  }

  componentWillUnmount() {
    document.body.classList.remove('ivlyrics-page-active');

    // Core cleanup
    Utils.removeQueueListener(this.onQueueChange);
    this.configButton?.deregister();
    this.mousetrap?.reset();
    window.removeEventListener("fad-request", lyricContainerUpdate);
    window.removeEventListener("ivLyrics", this.handleConfigChange);
    window.removeEventListener("ivLyrics:lyric-index-changed", this.handleLyricIndexChange);
    if (this._cleanupFloatingMenuOutsideClick) {
      this._cleanupFloatingMenuOutsideClick();
      this._cleanupFloatingMenuOutsideClick = null;
    }
    this.clearFloatingMenuCloseTimer();

    // Mouse idle timer cleanup
    if (this.mouseIdleTimer) {
      clearTimeout(this.mouseIdleTimer);
      this.mouseIdleTimer = null;
    }
    // Remove mouse event listeners from container
    const container = this.containerRef.current;
    if (container && this._handleMouseMove) {
      container.removeEventListener('mousemove', this._handleMouseMove);
      container.removeEventListener('mouseleave', this._handleMouseLeave);
    }
    this._handleMouseMove = null;
    this._handleMouseLeave = null;

    // Portrait viewport listener cleanup
    if (this._portraitMql && this._portraitChangeHandler) {
      if (this._portraitMql.removeEventListener) {
        this._portraitMql.removeEventListener("change", this._portraitChangeHandler);
      } else if (this._portraitMql.removeListener) {
        this._portraitMql.removeListener(this._portraitChangeHandler);
      }
      this._portraitMql = null;
      this._portraitChangeHandler = null;
    }

    // ESC 키 리스너 정리
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler);
      this._escHandler = null;
    }

    // 브라우저 전체화면 변경 리스너 정리
    if (this._fullscreenChangeHandler) {
      document.removeEventListener("fullscreenchange", this._fullscreenChangeHandler);
      this._fullscreenChangeHandler = null;
    }

    // Clean up translation loading timer
    this.clearTranslationLoading();
    if (this.streamingApplyTimer) {
      clearTimeout(this.streamingApplyTimer);
      this.streamingApplyTimer = null;
    }
    this.pendingStreamingPayload = null;

    // Clean up cache system
    CacheManager.clear();

    // Clear DOM cache
    if (this._domCache) {
      this._domCache = null;
    }

    // Clean up global references
    if (window.lyricContainer === this) {
      delete window.lyricContainer;
    }

    // Clean up performance monitoring
    if (window.lyricsPerformance) {
      delete window.lyricsPerformance;
    }

    // Clean up inflight requests
    if (this._inflightGemini) {
      this._inflightGemini.clear();
      this._inflightGemini = null;
    }

    if (this._inflightTrad) {
      this._inflightTrad.clear();
      this._inflightTrad = null;
    }

    // Clean up progressive results
    if (this._dmResults) {
      this._dmResults = null;
    }

    // Force garbage collection hint
    if (window.gc && typeof window.gc === "function") {
      setTimeout(() => window.gc(), 100);
    }
  }

  updateVisualOnConfigChange() {
    this.availableModes = CONFIG.modes;

    if (!CONFIG.visual.colorful) {
      this.styleVariables = {
        "--lyrics-color-active": CONFIG.visual["active-color"],
        "--lyrics-color-inactive": CONFIG.visual["inactive-color"],
        "--lyrics-highlight-background": CONFIG.visual["highlight-color"],
        "--lyrics-background-noise": CONFIG.visual.noise
          ? "var(--background-noise)"
          : "unset",
      };
    } else if (CONFIG.visual.colorful) {
      this.styleVariables = {
        "--lyrics-color-active": "white",
        "--lyrics-color-inactive": "rgba(255, 255, 255, 0.4)",
        "--lyrics-color-background":
          this.state.colors.background || "transparent",
        "--lyrics-highlight-background": this.state.colors.inactive,
        "--lyrics-background-noise": CONFIG.visual.noise
          ? "var(--background-noise)"
          : "unset",
      };
    }

    this.styleVariables = {
      ...this.styleVariables,
      "--lyrics-align-text": CONFIG.visual.alignment,
      "--lyrics-font-size": `${CONFIG.visual["font-size"]}px`,
      "--animation-tempo": this.state.tempo,
      "--lyrics-font-family":
        CONFIG.visual["font-family"] || "var(--font-family)",
      "--lyrics-original-font-family":
        CONFIG.visual["original-font-family"] || "var(--font-family)",
      "--lyrics-phonetic-font-family":
        CONFIG.visual["phonetic-font-family"] || "var(--font-family)",
      "--lyrics-translation-font-family":
        CONFIG.visual["translation-font-family"] || "var(--font-family)",
      "--lyrics-fullscreen-right-padding": `${CONFIG.visual["fullscreen-lyrics-right-padding"] || 40}px`,
      "--fullscreen-tmi-font-size": (CONFIG.visual["fullscreen-tmi-font-size"] || 100) / 100,
    };

    // mousetrap은 ESC 키 등 전체화면 내 단축키용으로만 사용
    // 전체화면 단축키는 GlobalShortcuts.js에서 전역으로 처리
  }

  getCurrentMode() {
    let mode = -1;
    if (this.state.explicitMode !== -1) {
      mode = this.state.explicitMode;
    } else {
      // Auto switch: prefer karaoke, then synced, then unsynced
      // 노래방 모드가 비활성화되어 있으면 karaoke를 건너뛰고 synced부터 시작
      if (this.state.karaoke && CONFIG.visual["karaoke-mode-enabled"]) {
        mode = KARAOKE;
      } else if (this.state.synced) {
        mode = SYNCED;
      } else if (this.state.unsynced) {
        mode = UNSYNCED;
      }
    }
    return mode;
  }

  render() {
    // 미리보기 컴포넌트에서 사용할 수 있도록 첫 가사 시간을 전역으로 노출
    window.ivLyrics_firstLyricTime = this.state.currentLyrics && this.state.currentLyrics.length > 0
      ? this.state.currentLyrics[0].startTime
      : 0;

    // Enhanced FAD container detection - try multiple selectors if main one fails
    let fadLyricsContainer = this._domCache?.fadContainer;

    if (!fadLyricsContainer || !document.contains(fadLyricsContainer)) {
      // Try main selector first
      fadLyricsContainer = document.getElementById("fad-ivLyrics-container");

      // If not found, try alternative selectors for FAD extension
      if (!fadLyricsContainer) {
        const altSelectors = ["[data-fad-lyrics]", ".fad-lyrics-container"];

        for (const selector of altSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            fadLyricsContainer = element;
            break;
          }
        }
      }

      // Cache the result
      if (this._domCache) {
        this._domCache.fadContainer = fadLyricsContainer;
      }
    }

    this.state.isFADMode = !!fadLyricsContainer;

    if (this.state.isFADMode) {
      // Text colors will be set by FAD extension
      // Disable colorful backgrounds in FAD mode
      this.styleVariables = {};
    } else if (CONFIG.visual.colorful && this.state.colors.background) {
      const isLight = Utils.isColorLight(this.state.colors.background);
      this.styleVariables = {
        "--lyrics-color-active": isLight ? "black" : "white",
        "--lyrics-color-inactive": isLight
          ? "rgba(0, 0, 0, 0.4)"
          : "rgba(255, 255, 255, 0.4)",
        "--lyrics-color-background": this.state.colors.background,
        "--lyrics-highlight-background": this.state.colors.inactive,
        "--lyrics-background-noise": CONFIG.visual.noise
          ? "var(--background-noise)"
          : "unset",
      };
    } else if (CONFIG.visual["solid-background"]) {
      const isLight = Utils.isColorLight(
        CONFIG.visual["solid-background-color"]
      );
      this.styleVariables = {
        "--lyrics-color-active": isLight ? "black" : "white",
        "--lyrics-color-inactive": isLight
          ? "rgba(0, 0, 0, 0.4)"
          : "rgba(255, 255, 255, 0.4)",
        "--lyrics-color-background": CONFIG.visual["solid-background-color"],
        "--lyrics-highlight-background": isLight
          ? "rgba(0, 0, 0, 0.1)"
          : "rgba(255, 255, 255, 0.1)",
        "--lyrics-background-noise": CONFIG.visual.noise
          ? "var(--background-noise)"
          : "unset",
      };
    }

    const backgroundStyle = {};
    // Disable background features when in FAD mode (Full Screen extension)
    if (!this.state.isFADMode && CONFIG.visual["video-background"]) {
      // Video background is handled by the component
    } else if (!this.state.isFADMode && CONFIG.visual["gradient-background"]) {
      const brightness = CONFIG.visual["background-brightness"] / 100;
      const blurAmount = CONFIG.visual["album-bg-blur"] ?? 20;
      // 앨범 커버 이미지 가져오기
      const albumArtUrl =
        Spicetify.Player.data?.item?.metadata?.image_xlarge_url ||
        Spicetify.Player.data?.item?.metadata?.image_large_url ||
        Spicetify.Player.data?.item?.metadata?.image_url;

      if (albumArtUrl) {
        backgroundStyle.backgroundImage = `url(${albumArtUrl})`;
        backgroundStyle.backgroundRepeat = "no-repeat";
        backgroundStyle.filter = `brightness(${brightness}) blur(${blurAmount}px)`;
        backgroundStyle.backgroundSize = "cover";
        backgroundStyle.backgroundPosition = "center";
      }
    } else if (!this.state.isFADMode && CONFIG.visual["blur-gradient-background"]) {
      const brightness = CONFIG.visual["background-brightness"] / 100;

      // hex/rgb 문자열에서 RGB 값 추출
      const parseColor = (color) => {
        if (!color) return { r: 30, g: 30, b: 40 };
        // hex 형식
        const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
        if (hexMatch) {
          return { r: parseInt(hexMatch[1], 16), g: parseInt(hexMatch[2], 16), b: parseInt(hexMatch[3], 16) };
        }
        // rgb() 형식
        const rgbMatch = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color);
        if (rgbMatch) {
          return { r: parseInt(rgbMatch[1]), g: parseInt(rgbMatch[2]), b: parseInt(rgbMatch[3]) };
        }
        return { r: 30, g: 30, b: 40 };
      };

      let c1 = { r: 30, g: 30, b: 40 };
      let c2 = { r: 60, g: 40, b: 70 };
      let c3 = { r: 20, g: 50, b: 60 };

      if (this.state.dynamicColors) {
        c1 = parseColor(this.state.dynamicColors.minContrast);
        c2 = parseColor(this.state.dynamicColors.highContrast);
        c3 = parseColor(this.state.dynamicColors.overlayColor);
      }

      backgroundStyle["--ivLyrics-c1"] = `${c1.r}, ${c1.g}, ${c1.b}`;
      backgroundStyle["--ivLyrics-c2"] = `${c2.r}, ${c2.g}, ${c2.b}`;
      backgroundStyle["--ivLyrics-c3"] = `${c3.r}, ${c3.g}, ${c3.b}`;
      backgroundStyle.filter = `brightness(${brightness}) saturate(2.5)`;
    } else if (
      !this.state.isFADMode &&
      CONFIG.visual.colorful &&
      this.state.colors.background
    ) {
      const brightness = CONFIG.visual["background-brightness"] / 100;
      backgroundStyle.backgroundColor = this.state.colors.background;
      backgroundStyle.filter = `brightness(${brightness})`;
    } else if (!this.state.isFADMode && CONFIG.visual["solid-background"]) {
      const brightness = CONFIG.visual["background-brightness"] / 100;
      backgroundStyle.backgroundColor = CONFIG.visual["solid-background-color"];
      backgroundStyle.filter = `brightness(${brightness})`;
    }

    // Helper function to convert hex color with opacity
    const hexToRgba = (hex, opacity) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (result) {
        const r = parseInt(result[1], 16);
        const g = parseInt(result[2], 16);
        const b = parseInt(result[3], 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
      }
      return hex;
    };

    // Build text shadow CSS value
    const shadowColor = hexToRgba(
      CONFIG.visual["text-shadow-color"],
      CONFIG.visual["text-shadow-opacity"]
    );
    const textShadow = CONFIG.visual["text-shadow-enabled"]
      ? `0 0 ${CONFIG.visual["text-shadow-blur"]}px ${shadowColor}`
      : "none";
    const textDropShadow = CONFIG.visual["text-shadow-enabled"]
      ? `drop-shadow(0 0 ${CONFIG.visual["text-shadow-blur"]}px ${shadowColor})`
      : "none";

    this.styleVariables = {
      ...this.styleVariables,
      "--lyrics-align-text": CONFIG.visual.alignment,
      "--lyrics-font-size": `${CONFIG.visual["font-size"]}px`,
      "--lyrics-font-family":
        CONFIG.visual["font-family"] || "var(--font-family)",
      "--lyrics-original-font-family":
        CONFIG.visual["original-font-family"] || "var(--font-family)",
      "--lyrics-phonetic-font-family":
        CONFIG.visual["phonetic-font-family"] || "var(--font-family)",
      "--lyrics-translation-font-family":
        CONFIG.visual["translation-font-family"] || "var(--font-family)",
      "--lyrics-original-font-weight": CONFIG.visual["original-font-weight"],
      "--lyrics-original-font-size": `${CONFIG.visual["original-font-size"]}px`,
      "--lyrics-translation-font-weight":
        CONFIG.visual["translation-font-weight"],
      "--lyrics-translation-font-size": `${CONFIG.visual["translation-font-size"]}px`,
      "--lyrics-translation-spacing": `${CONFIG.visual["translation-spacing"] || 8
        }px`,
      "--lyrics-phonetic-font-weight":
        CONFIG.visual["phonetic-font-weight"] || "400",
      "--lyrics-phonetic-font-size": `${CONFIG.visual["phonetic-font-size"] || 20
        }px`,
      "--lyrics-phonetic-opacity":
        (CONFIG.visual["phonetic-opacity"] || 70) / 100,
      "--lyrics-phonetic-spacing": `${CONFIG.visual["phonetic-spacing"] || 4
        }px`,
      "--lyrics-original-letter-spacing": `${CONFIG.visual["original-letter-spacing"] || 0}px`,
      "--lyrics-phonetic-letter-spacing": `${CONFIG.visual["phonetic-letter-spacing"] || 0}px`,
      "--lyrics-translation-letter-spacing": `${CONFIG.visual["translation-letter-spacing"] || 0}px`,
      "--lyrics-furigana-font-weight": CONFIG.visual["furigana-font-weight"],
      "--lyrics-furigana-font-size": `${CONFIG.visual["furigana-font-size"]}px`,
      "--lyrics-furigana-opacity": CONFIG.visual["furigana-opacity"] / 100,
      "--lyrics-furigana-spacing": `${CONFIG.visual["furigana-spacing"]}px`,
      "--lyrics-line-spacing": `${CONFIG.visual["line-spacing"] || 8}px`,
      "--lyrics-text-shadow": textShadow,
      "--lyrics-text-drop-shadow": textDropShadow,
      "--lyrics-original-opacity": CONFIG.visual["original-opacity"] / 100,
      "--lyrics-translation-opacity":
        CONFIG.visual["translation-opacity"] / 100,
      "--highlight-inactive-opacity":
        (100 - (CONFIG.visual["highlight-intensity"] || 70)) / 100,
      "--animation-tempo": this.state.tempo,
      "--lyrics-fullscreen-right-padding": `${CONFIG.visual["fullscreen-lyrics-right-padding"] || 40}px`,
      "--fullscreen-tmi-font-size": (CONFIG.visual["fullscreen-tmi-font-size"] || 100) / 100,
      "--iv-motion-ease-standard": "cubic-bezier(0.22, 1, 0.36, 1)",
      "--iv-motion-duration-fast": this.shouldReduceMotion() ? "1ms" : "180ms",
      "--iv-motion-duration-medium": this.shouldReduceMotion() ? "1ms" : "280ms",
      "--iv-motion-duration-slow": this.shouldReduceMotion() ? "1ms" : "420ms",
      "--iv-motion-distance-sm": this.shouldReduceMotion() ? "0px" : "10px",
      "--iv-motion-distance-md": this.shouldReduceMotion() ? "0px" : "18px",
    };

    let mode = this.getCurrentMode();

    let showTranslationButton;

    // Get current display modes to track changes
    const originalLanguage = this.provideLanguageCode(this.state.currentLyrics);
    const friendlyLanguage =
      originalLanguage &&
      new Intl.DisplayNames(["en"], { type: "language" })
        .of(originalLanguage.split("-")[0])
        ?.toLowerCase();

    // For Gemini mode, use generic keys if no specific language detected
    const modeKey = friendlyLanguage || "gemini";

    const displayMode1 = CONFIG.visual[`translation-mode:${modeKey}`];
    const displayMode2 = CONFIG.visual[`translation-mode-2:${modeKey}`];
    const currentModeKey = `${mode}_${displayMode1 || "none"}_${displayMode2 || "none"
      }`;

    // Only call lyricsSource on state/mode/translation changes, not every render
    if (
      this.lastProcessedUri !== this.state.uri ||
      this.lastProcessedMode !== currentModeKey
    ) {
      this.lastProcessedUri = this.state.uri;
      this.lastProcessedMode = currentModeKey;
      this.lyricsSource(this.state, mode);
    }
    const hasTranslation = false;

    // Always render the Conversions button on synced/unsynced pages.
    // Previously it was gated by detected language/loading state, causing it to
    // be hidden on initial load or for non-target languages (e.g., English).
    const potentialMode =
      this.state.explicitMode !== -1
        ? this.state.explicitMode
        : this.state.isLoading
          ? this.lastModeBeforeLoading || SYNCED
          : mode;

    showTranslationButton =
      potentialMode === KARAOKE ||
      potentialMode === SYNCED ||
      potentialMode === UNSYNCED ||
      mode === -1;

    // 번역 재생성 버튼 활성화 조건 확인
    const translationProvider =
      CONFIG.visual["translate:translated-lyrics-source"];
    const hasTranslationEnabled =
      translationProvider && translationProvider !== "none";
    const hasGeminiTranslation =
      hasTranslationEnabled &&
      (displayMode1?.startsWith("gemini") ||
        displayMode2?.startsWith("gemini"));

    // Gemini 번역이 실제로 로드되었는지 확인 (_dmResults 확인)
    const currentUri = this.state.uri;
    const hasLoadedGeminiTranslation = !!(
      hasGeminiTranslation &&
      this._dmResults &&
      this._dmResults[currentUri] &&
      ((displayMode1?.startsWith("gemini") &&
        this._dmResults[currentUri].mode1) ||
        (displayMode2?.startsWith("gemini") &&
          this._dmResults[currentUri].mode2))
    );

    const canRegenerateTranslation = hasLoadedGeminiTranslation;
    const cacheEditModal =
      this.state.isLyricsEditModalOpen &&
      react.createElement(LyricsCacheEditModal, {
        isOpen: this.state.isLyricsEditModalOpen,
        isLoading: this.state.isLyricsEditLoading,
        isSaving: this.state.isLyricsEditSaving,
        originalLines: this.state.lyricsEditOriginalLines,
        pronunciationText: this.state.lyricsEditPronunciationText,
        translationText: this.state.lyricsEditTranslationText,
        expectedLineCount: this.state.lyricsEditOriginalLines.length,
        hasPronunciationCache: this.state.lyricsEditHasPronunciationCache,
        hasTranslationCache: this.state.lyricsEditHasTranslationCache,
        trackTitle: this.state.title,
        trackArtist: this.state.artist,
        provider: this.state.provider,
        error: this.state.lyricsEditError,
        onClose: () => this.closeLyricsEditModal(),
        onSave: () => this.saveLyricsEditModal(),
        onPronunciationChange: (value) =>
          this.setState({ lyricsEditPronunciationText: value, lyricsEditError: "" }),
        onTranslationChange: (value) =>
          this.setState({ lyricsEditTranslationText: value, lyricsEditError: "" }),
      });

    const activeLyricsPage = window.LyricsPageRenderer
      ? react.createElement(window.LyricsPageRenderer, {
        mode,
        karaokeMode: KARAOKE,
        syncedMode: SYNCED,
        unsyncedMode: UNSYNCED,
        trackUri: this.state.uri,
        currentLyrics: this.state.currentLyrics,
        karaoke: this.state.karaoke,
        karaokeSource: this.state.karaokeSource,
        synced: this.state.synced,
        unsynced: this.state.unsynced,
        provider: this.state.provider,
        contributors: this.state.contributors,
        copyright: this.state.copyright,
        isLoading: this.state.isLoading,
        showMarketplace: this.state.showMarketplace,
        onCloseMarketplace: () => this.setState({ showMarketplace: false }),
        reRenderLyricsPage: this.reRenderLyricsPage,
      })
      : react.createElement(
        "div",
        {
          className: "lyrics-lyricsContainer-LyricsUnavailablePage",
        },
        react.createElement(
          "span",
          {
            className: "lyrics-lyricsContainer-LyricsUnavailableMessage",
          },
          this.state.isLoading ? LoadingIcon : "(• _ • )"
        )
      );

    // Tab bar removed - modes are now auto-detected
    const topBarContent = null;

    // Update banner component
    const updateBanner = window.ivLyrics_updateInfo?.available
      ? react.createElement(UpdateBanner, {
        updateInfo: window.ivLyrics_updateInfo,
        onDismiss: () =>
          Utils.dismissUpdate(window.ivLyrics_updateInfo.latestVersion),
      })
      : null;

    const hasLyrics = !!(this.state.karaoke || this.state.synced || this.state.unsynced);
    const isTwoColumn = CONFIG.visual["fullscreen-two-column"] !== false;
    const isLayoutReversed = CONFIG.visual["fullscreen-layout-reverse"] === true;
    const centerWhenNoLyrics = CONFIG.visual["fullscreen-center-when-no-lyrics"] !== false;
    const shouldReduceMotion = this.shouldReduceMotion();
    const shouldRenderFloatingMenu =
      !this.state.isFullscreen ||
      this.state.isFloatingMenuOpen ||
      this.state.isFloatingMenuClosing;
    const modeButtons = [
      this.state.karaoke &&
      CONFIG.visual["karaoke-mode-enabled"] &&
      react.createElement(
        Spicetify.ReactComponent.TooltipWrapper,
        { key: "karaoke", label: I18n.t("modes.karaoke") },
        react.createElement(
          "button",
          {
            type: "button",
            className: `lyrics-config-button lyrics-mode-button ${mode === KARAOKE ? "active" : ""}`,
            onClick: () => this.switchTo(KARAOKE),
            "aria-pressed": mode === KARAOKE,
          },
          react.createElement("svg", {
            width: 18,
            height: 18,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            dangerouslySetInnerHTML: {
              __html: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
            },
          })
        )
      ),
      this.state.synced &&
      react.createElement(
        Spicetify.ReactComponent.TooltipWrapper,
        { key: "synced", label: I18n.t("modes.synced") },
        react.createElement(
          "button",
          {
            type: "button",
            className: `lyrics-config-button lyrics-mode-button ${mode === SYNCED ? "active" : ""}`,
            onClick: () => this.switchTo(SYNCED),
            "aria-pressed": mode === SYNCED,
          },
          react.createElement("svg", {
            width: 18,
            height: 18,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            dangerouslySetInnerHTML: {
              __html: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
            },
          })
        )
      ),
      this.state.unsynced &&
      react.createElement(
        Spicetify.ReactComponent.TooltipWrapper,
        { key: "unsynced", label: I18n.t("modes.unsynced") },
        react.createElement(
          "button",
          {
            type: "button",
            className: `lyrics-config-button lyrics-mode-button ${mode === UNSYNCED ? "active" : ""}`,
            onClick: () => this.switchTo(UNSYNCED),
            "aria-pressed": mode === UNSYNCED,
          },
          react.createElement("svg", {
            width: 18,
            height: 18,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            dangerouslySetInnerHTML: {
              __html: '<path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/>',
            },
          })
        )
      ),
    ].filter(Boolean);

    // Build fullscreen class names
    let fullscreenClasses = "";
    if (this.state.isFullscreen) {
      fullscreenClasses = " fullscreen-active";
      if (!isTwoColumn) {
        fullscreenClasses += " fullscreen-single-column";
      }
      if (isLayoutReversed && isTwoColumn) {
        fullscreenClasses += " layout-reversed";
      }
      if (!hasLyrics && centerWhenNoLyrics) {
        fullscreenClasses += " fullscreen-no-lyrics";
      }
      // Portrait mode class (not in TV mode)
      if (this._isPortraitViewport && CONFIG.visual["fullscreen-tv-mode"] !== true) {
        fullscreenClasses += " portrait-mode";
      }
      // TV Mode class
      if (CONFIG.visual["fullscreen-tv-mode"] === true) {
        fullscreenClasses += " tv-mode-active";
      }
      // TMI 폰트 크기 CSS 변수 업데이트
      if (this.fullscreenContainer) {
        const tmiScale = (CONFIG.visual["fullscreen-tmi-font-size"] || 100) / 100;
        this.fullscreenContainer.style.setProperty("--fullscreen-tmi-font-size", tmiScale);
      }
    }

    const out = react.createElement(
      "div",
      {
        className: `lyrics-lyricsContainer-LyricsContainer${CONFIG.visual["fade-blur"] ? " blur-enabled" : ""
          }${CONFIG.visual["highlight-mode"] ? " highlight-mode-enabled" : ""}${fadLyricsContainer ? " fad-enabled" : ""}${fullscreenClasses}${shouldReduceMotion ? " motion-reduced" : ""}`,
        style: this.styleVariables,
        ref: (el) => {
          if (!el) return;
          this.containerRef.current = el;
          el.onmousewheel = this.onFontSizeChange;

          // Attach mouse event listeners for auto-hide controls
          if (!el._mouseEventsAttached) {
            el._mouseEventsAttached = true;
            el.addEventListener('mousemove', this._handleMouseMove);
            el.addEventListener('mouseleave', this._handleMouseLeave);
            // Start the idle timer
            this._handleMouseMove();
          }
        },
      },
      // Left panel for fullscreen mode
      this.state.isFullscreen && window.FullscreenOverlay && react.createElement(window.FullscreenOverlay, {
        coverUrl: this.state.coverUrl,
        title: this.state.title,
        artist: this.state.artist,
        isFullscreen: this.state.isFullscreen,
        currentLyricIndex: this.state.currentLyricIndex || 0,
        totalLyrics: Array.isArray(this.state.currentLyrics) ? this.state.currentLyrics.length : 0,
        translatedMetadata: this.state.translatedMetadata,
        trackUri: this.state.uri
      }),
      // Tab bar for mode switching
      topBarContent,
      // Update notification banner
      updateBanner,
      (!CONFIG.visual["video-background"] || this.state.isFADMode) && react.createElement("div", {
        id: "ivLyrics-gradient-background",
        className: CONFIG.visual["blur-gradient-background"] ? "color-gradient-bg" : "",
        style: backgroundStyle,
      },
        // 블러 그라데이션일 때 여러 블롭 생성
        CONFIG.visual["blur-gradient-background"] && [
          react.createElement("div", { key: "blob1", className: "gradient-blob blob-1" }),
          react.createElement("div", { key: "blob2", className: "gradient-blob blob-2" }),
          react.createElement("div", { key: "blob3", className: "gradient-blob blob-3" }),
          react.createElement("div", { key: "blob4", className: "gradient-blob blob-4" }),
          react.createElement("div", { key: "blob5", className: "gradient-blob blob-5" }),
          react.createElement("div", { key: "blob6", className: "gradient-blob blob-6" }),
        ]
      ),
      !this.state.isFADMode && CONFIG.visual["video-background"] && window.VideoBackground && react.createElement(window.VideoBackground, {
        trackUri: this.state.uri,
        firstLyricTime: this.state.currentLyrics && this.state.currentLyrics.length > 0 ? this.state.currentLyrics[0].startTime : 0,
        brightness: CONFIG.visual["background-brightness"],
        blurAmount: CONFIG.visual["video-blur"],
        coverMode: CONFIG.visual["video-cover"],
        externalVideoInfo: this.state.videoInfo
      }),
      (!CONFIG.visual["video-background"] || this.state.isFADMode) && react.createElement("div", {
        className: "lyrics-lyricsContainer-LyricsBackground",
      }),
      // Phonetic loading indicator
      this.state.isPhoneticLoading &&
      react.createElement(
        "div",
        {
          className: "lyrics-translation-loading-indicator",
        },
        react.createElement(
          "div",
          {
            className: "lyrics-translation-loading-content",
          },
          react.createElement("div", {
            className: "lyrics-translation-loading-spinner",
          }),
          react.createElement(
            "span",
            null,
            I18n.t("notifications.requestingPronunciation")
          )
        )
      ),
      // Translation loading indicator
      this.state.isTranslationLoading &&
      react.createElement(
        "div",
        {
          className: "lyrics-translation-loading-indicator",
          style: { top: this.state.isPhoneticLoading ? "100px" : "20px" },
        },
        react.createElement(
          "div",
          {
            className: "lyrics-translation-loading-content",
          },
          react.createElement("div", {
            className: "lyrics-translation-loading-spinner",
          }),
          react.createElement(
            "span",
            null,
            I18n.t("notifications.requestingTranslation")
          )
        )
      ),
      // ===== 플로팅 바 (일반 모드: 전체 표시, 전체화면: 메뉴 토글 방식) =====
      react.createElement(
        "div",
        {
          className: "lyrics-config-button-container lyrics-fluent-floating-toolbar" +
            (this.state.isFullscreen ? " fullscreen-mode-container" : "") +
            (this.state.isFullscreen && this.state.isFloatingMenuOpen ? " menu-open" : "") +
            (this.state.isFullscreen && this.state.isFloatingMenuClosing ? " menu-closing" : ""),
          ref: (el) => {
            if (this._cleanupFloatingMenuOutsideClick) {
              this._cleanupFloatingMenuOutsideClick();
              this._cleanupFloatingMenuOutsideClick = null;
            }

            if (el && this.state.isFullscreen) {
              // 전체화면에서 바깥 클릭 시 메뉴 닫기
              const handleClickOutside = (e) => {
                if (!el.contains(e.target) && (this.state.isFloatingMenuOpen || this.state.isFloatingMenuClosing)) {
                  this.closeFloatingMenu();
                }
              };
              document.addEventListener('click', handleClickOutside);
              this._cleanupFloatingMenuOutsideClick = () => {
                document.removeEventListener('click', handleClickOutside);
              };
            }
          },
        },
        // 전체화면에서만 보이는 메뉴 토글 버튼
        this.state.isFullscreen && react.createElement(
          "button",
          {
            className: "lyrics-config-button lyrics-floating-menu-toggle",
            type: "button",
            onClick: (e) => {
              e.stopPropagation();
              this.toggleFloatingMenu();
            },
          },
          react.createElement("svg", {
            width: 20,
            height: 20,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            dangerouslySetInnerHTML: {
              __html: this.state.isFloatingMenuOpen
                ? '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>' // X 아이콘
                : '<line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line>', // 햄버거 아이콘
            },
          })
        ),
        // 메뉴 내용 (일반 모드: 항상 표시, 전체화면: 열렸을 때만 표시)
        shouldRenderFloatingMenu && react.createElement(
          "div",
          {
            className: `lyrics-floating-menu-content${this.state.isFullscreen && this.state.isFloatingMenuOpen ? " menu-open" : ""}${this.state.isFullscreen && this.state.isFloatingMenuClosing ? " menu-closing" : ""}`,
          },
          showTranslationButton &&
          react.createElement(TranslationMenu, {
            friendlyLanguage,
            hasTranslation: {},
          }),
          react.createElement(RegenerateTranslationButton, {
            onRegenerate: this.regenerateTranslation,
            isEnabled: canRegenerateTranslation,
            isLoading: this.state.isTranslationLoading,
          }),
          react.createElement(SyncAdjustButtonFluent, {
            trackUri: this.currentTrackUri,
            provider: this.state.provider, // Pass provider
            onOffsetChange: (offset) => {
              this.forceUpdate();
            },
          }),
          react.createElement(CommunityVideoButton, {
            trackUri: this.currentTrackUri,
            videoInfo: this.state.videoInfo,
            onVideoSelect: async (newVideoInfo) => {
              this.setState({ videoInfo: newVideoInfo });
              if (newVideoInfo && this.currentTrackUri) {
                await Utils.saveSelectedVideo(this.currentTrackUri, newVideoInfo);
              }
            },
          }),
          react.createElement(ShareImageButton, {
            lyrics: this.state.currentLyrics || [],
            trackInfo: {
              name: Spicetify.Player.data?.item?.name || Spicetify.Player.data?.item?.metadata?.title || '',
              artist: Spicetify.Player.data?.item?.artists?.map(a => a.name).join(', ') || Spicetify.Player.data?.item?.metadata?.artist_name || '',
              cover: Spicetify.Player.data?.item?.metadata?.image_xlarge_url ||
                Spicetify.Player.data?.item?.metadata?.image_large_url ||
                Spicetify.Player.data?.item?.metadata?.image_url ||
                Spicetify.Player.data?.item?.album?.images?.[0]?.url || '',
            },
          }),
          hasLyrics &&
          react.createElement(
            Spicetify.ReactComponent.TooltipWrapper,
            {
              label: I18n.t("lyricsCacheEditor.button"),
            },
            react.createElement(
              "button",
              {
                className: "lyrics-config-button lyrics-cache-edit-button",
                type: "button",
                onClick: () => this.openLyricsEditModal(),
                disabled:
                  this.state.isLyricsEditLoading || this.state.isLyricsEditSaving,
                "data-active": this.state.isLyricsEditModalOpen ? "true" : "false",
              },
              react.createElement("svg", {
                width: 18,
                height: 18,
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 2,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                dangerouslySetInnerHTML: {
                  __html:
                    '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4Z"></path>',
                },
              })
            )
          ),
          // 마켓플레이스 버튼
          react.createElement(
            Spicetify.ReactComponent.TooltipWrapper,
            { label: I18n.t("marketplace.title") },
            react.createElement(
              "button",
              {
                className: `lyrics-config-button lyrics-marketplace-button${this.state.showMarketplace ? " active" : ""}`,
                type: "button",
                onClick: () => this.setState({ showMarketplace: !this.state.showMarketplace }),
              },
              react.createElement("svg", {
                width: 18,
                height: 18,
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 2,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                dangerouslySetInnerHTML: {
                  __html: '<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 01-8 0"></path>',
                },
              })
            )
          ),
          react.createElement(SettingsMenu),
          // 전체화면 토글 버튼
          (() => !document.getElementById("fad-ivLyrics-container"))() && react.createElement(
            Spicetify.ReactComponent.TooltipWrapper,
            {
              label: this.state.isFullscreen ? I18n.t("menu.exitFullscreen") || "Exit Fullscreen" : I18n.t("menu.fullscreen"),
            },
            react.createElement(
              "button",
              {
                className: "lyrics-config-button lyrics-fullscreen-toggle-button",
                type: "button",
                onClick: () => {
                  if (this.state.isFullscreen) {
                    this.closeFloatingMenu();
                  }
                  this.toggleFullscreen();
                },
              },
              react.createElement("svg", {
                width: 20,
                height: 20,
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 2,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                dangerouslySetInnerHTML: {
                  __html: this.state.isFullscreen
                    ? '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>'
                    : '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
                },
              })
            )
          ),
          modeButtons.length > 0 &&
          react.createElement(
            "div",
            { className: "lyrics-config-mode-section" },
            react.createElement("div", { className: "lyrics-config-separator" }),
            react.createElement(
              "div",
              {
                className: "lyrics-config-mode-group",
                role: "group",
              },
              ...modeButtons
            )
          ),
          react.createElement(SyncDataCreatorButton, {
            trackInfo: {
              uri: this.currentTrackUri,
              name: Spicetify.Player.data?.item?.name || '',
              artists: Spicetify.Player.data?.item?.artists || [],
              album: Spicetify.Player.data?.item?.album || {},
            },
            showHint: true,
            provider: this.state.provider,
            initialLyrics: this.state.currentLyrics
          })
        )
      ),
      cacheEditModal,
      activeLyricsPage
    );

    const dom = ensureReactDOM();
    if (
      this.state.isFullscreen &&
      dom?.createPortal &&
      this.fullscreenContainer
    ) {
      return dom.createPortal(out, this.fullscreenContainer);
    }
    if (fadLyricsContainer && dom?.createPortal) {
      return dom.createPortal(out, fadLyricsContainer);
    }
    return out;
  }

  switchTo(mode) {
    this.lastProcessedMode = null;
    this.setState((prevState) => ({
      explicitMode: mode,
      currentLyrics:
        this.resolveLyricsForMode(prevState, mode) ||
        prevState.currentLyrics ||
        [],
    }));
  }

}

// 초기화 시 저장된 Google Fonts 로드
(function loadGoogleFonts() {
  const GOOGLE_FONTS = [
    "Noto Sans KR",
    "Nanum Gothic",
    "Nanum Myeongjo",
    "Black Han Sans",
    "Do Hyeon",
    "Jua",
    "Nanum Gothic Coding",
    "Gowun Batang",
    "Gowun Dodum",
    "IBM Plex Sans KR",
    "Roboto",
    "Open Sans",
    "Lato",
    "Montserrat",
    "Poppins",
    "Inter",
    "Raleway",
    "Oswald",
    "Merriweather",
    "Playfair Display",
  ];
  const GOOGLE_FONT_SET = new Set(GOOGLE_FONTS);

  const fontsToLoad = new Set();

  // Helper to add fonts from comma-separated string
  const addFonts = (fontString) => {
    if (!fontString) return;
    const fonts = fontString.split(",").map((f) => f.trim().replace(/['"]/g, ""));
    fonts.forEach((font) => {
      if (font && GOOGLE_FONT_SET.has(font)) {
        fontsToLoad.add(font);
      }
    });
  };

  // 전체 폰트 (레거시)
  addFonts(CONFIG.visual["font-family"]);

  // 개별 폰트
  addFonts(CONFIG.visual["original-font-family"]);
  addFonts(CONFIG.visual["phonetic-font-family"]);
  addFonts(CONFIG.visual["translation-font-family"]);

  // Google Fonts 로드
  fontsToLoad.forEach((font) => {
    const linkId = `ivLyrics-google-font-${font.replace(/ /g, "-")}`;
    if (!document.getElementById(linkId)) {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      // Pretendard는 CDN에서 로드
      if (font === "Pretendard Variable") {
        link.href =
          "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css";
      } else {
        link.href = `https://fonts.googleapis.com/css2?family=${font.replace(
          / /g,
          "+"
        )}:wght@100;200;300;400;500;600;700;800;900&display=swap`;
      }
      document.head.appendChild(link);
    }
  });
})();

// URL Scheme 파라미터 처리
(function handleURLScheme() {
  const moduleState =
    window.__ivLyricsUrlSchemeModule ||
    (window.__ivLyricsUrlSchemeModule = {
      initialized: false,
      unlisten: null,
      lastRouteKey: null,
      lastLoginToken: null,
    });

  // 현재 URL의 파라미터를 확인
  const checkURLParams = () => {
    try {
      const currentPath = Spicetify.Platform.History.location.pathname;
      const currentSearch = Spicetify.Platform.History.location.search || "";
      const routeKey = `${currentPath}?${currentSearch}`;
      if (moduleState.lastRouteKey === routeKey) {
        return;
      }
      moduleState.lastRouteKey = routeKey;
      const searchParams = new URLSearchParams(currentSearch);

      // spotify://ivLyrics/ 경로인지 확인
      if (currentPath.includes('/ivLyrics')) {
        // alert 파라미터가 있으면 알림 표시
        const alertMessage = searchParams.get('alert');
        if (alertMessage) {
          Toast.show(decodeURIComponent(alertMessage), false, 3000);
        }

        // 다른 파라미터들도 처리 가능
        // 예: action, data 등
        const action = searchParams.get('action');
        if (action === 'discord-auth') {
          const loginToken = searchParams.get('loginToken');
          if (loginToken && moduleState.lastLoginToken !== loginToken) {
            moduleState.lastLoginToken = loginToken;
            if (typeof Utils !== 'undefined' && Utils.handleDiscordAuthCallback) {
              Utils.handleDiscordAuthCallback(loginToken);
            }
          }
        }
      }
    } catch (error) {
      console.error('[ivLyrics] URL Scheme error:', error);
    }
  };

  // 초기 체크
  if (Spicetify.Platform?.History) {
    if (moduleState.initialized) {
      return;
    }

    moduleState.initialized = true;
    checkURLParams();

    // History 변경 감지
    moduleState.unlisten = Spicetify.Platform.History.listen(() => {
      checkURLParams();
    });
  }
})();

// 공지사항 시스템 초기화
(function initNoticeSystem() {
  // 앱이 완전히 로드된 후 공지사항 확인
  if (!window.__ivLyricsNoticeInitTimer) {
    window.__ivLyricsNoticeInitTimer = setTimeout(() => {
      window.__ivLyricsNoticeInitTimer = null;
      if (typeof window.showNoticeIfNeeded === 'function') {
        window.showNoticeIfNeeded();
      }
    }, 3000); // 3초 후 실행 (앱 로드 완료 대기)
  }
})();

// Toast 주기적 정리 시작 (Utils.js 로드 후 실행되도록 지연)
if (!window.__ivLyricsToastCleanupInitTimer) {
  window.__ivLyricsToastCleanupInitTimer = setTimeout(() => {
    window.__ivLyricsToastCleanupInitTimer = null;
    if (window.Toast && window.Toast.startPeriodicCleanup) {
      window.Toast.startPeriodicCleanup();
    }
  }, 100);
}
