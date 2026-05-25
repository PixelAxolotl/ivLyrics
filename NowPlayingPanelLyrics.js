// ============================================
// NowPlayingPanelLyrics.js
// 우측 패널 (Now Playing View)에 가사를 표시하는 모듈
// ============================================

(function NowPlayingPanelLyricsModule() {
    "use strict";

    const MODULE_KEY = "__ivLyricsNowPlayingPanelModule";
    const moduleState = window[MODULE_KEY] || (window[MODULE_KEY] = {
        initialized: false,
        runtimeStarted: false,
        waitTimer: null,
        panelObserver: null,
        pageObserver: null,
        pageObserverTimeout: null,
        historyUnlisten: null,
        lyricsListener: null,
        settingsListener: null,
        insertTimer: null
    });

    // Spicetify가 준비될 때까지 대기
    if (!window.Spicetify || !Spicetify.React || !Spicetify.ReactDOM) {
        if (!moduleState.waitTimer) {
            moduleState.waitTimer = setTimeout(() => {
                moduleState.waitTimer = null;
                NowPlayingPanelLyricsModule();
            }, 300);
        }
        return;
    }

    moduleState.waitTimer = null;
    if (moduleState.initialized) {
        return;
    }
    moduleState.initialized = true;

    const PANEL_DEBUG = false;
    const panelDebug = (...args) => {
        if (PANEL_DEBUG) {
            console.log(...args);
        }
    };

    const react = Spicetify.React;
    const { useState, useEffect, useRef, useCallback, useMemo, memo } = react;

    // 설정 키
    const STORAGE_KEY = "ivLyrics:visual:panel-lyrics-enabled";
    const PANEL_LINES_KEY = "ivLyrics:visual:panel-lyrics-lines";
    const FONT_SCALE_KEY = "ivLyrics:visual:panel-font-scale";
    const FONT_FAMILY_KEY = "ivLyrics:visual:panel-lyrics-font-family";
    const ORIGINAL_FONT_KEY = "ivLyrics:visual:panel-lyrics-original-font";
    const PHONETIC_FONT_KEY = "ivLyrics:visual:panel-lyrics-phonetic-font";
    const TRANSLATION_FONT_KEY = "ivLyrics:visual:panel-lyrics-translation-font";
    const PANEL_WIDTH_KEY = "ivLyrics:visual:panel-lyrics-width";
    const ORIGINAL_SIZE_KEY = "ivLyrics:visual:panel-lyrics-original-size";
    const PHONETIC_SIZE_KEY = "ivLyrics:visual:panel-lyrics-phonetic-size";
    const TRANSLATION_SIZE_KEY = "ivLyrics:visual:panel-lyrics-translation-size";
    const PSEUDO_KARAOKE_SOURCES = new Set(['audio-analysis-pseudo', 'spotify-audio-analysis']);
    // 배경 설정 키
    const BG_TYPE_KEY = "ivLyrics:visual:panel-bg-type";
    const BG_COLOR_KEY = "ivLyrics:visual:panel-bg-color";
    const BG_GRADIENT_1_KEY = "ivLyrics:visual:panel-bg-gradient-1";
    const BG_GRADIENT_2_KEY = "ivLyrics:visual:panel-bg-gradient-2";
    const BG_OPACITY_KEY = "ivLyrics:visual:panel-bg-opacity";
    // 테두리 설정 키
    const BORDER_ENABLED_KEY = "ivLyrics:visual:panel-border-enabled";
    const BORDER_COLOR_KEY = "ivLyrics:visual:panel-border-color";
    const BORDER_OPACITY_KEY = "ivLyrics:visual:panel-border-opacity";

    // 기본 설정값
    const DEFAULT_ENABLED = true;
    const PANEL_CONTEXT_LINES_PER_SIDE = 4;
    const MIN_PANEL_VISIBLE_LINES = PANEL_CONTEXT_LINES_PER_SIDE * 2 + 1;
    const DEFAULT_LINES = MIN_PANEL_VISIBLE_LINES; // 위 4, 현재 1, 아래 4
    const DEFAULT_FONT_SCALE = 100; // 폰트 크기 배율 (50% ~ 200%)
    const DEFAULT_FONT_FAMILY = "Pretendard Variable";
    const DEFAULT_PANEL_WIDTH = 280;
    const DEFAULT_ORIGINAL_SIZE = 18;
    const DEFAULT_PHONETIC_SIZE = 13;
    const DEFAULT_TRANSLATION_SIZE = 13;
    // 배경 기본값
    const DEFAULT_BG_TYPE = "album";
    const DEFAULT_BG_COLOR = "#6366f1";
    const DEFAULT_BG_GRADIENT_1 = "#6366f1";
    const DEFAULT_BG_GRADIENT_2 = "#a855f7";
    const DEFAULT_BG_OPACITY = 30;
    // 테두리 기본값
    const DEFAULT_BORDER_ENABLED = false;
    const DEFAULT_BORDER_COLOR = "#ffffff";
    const DEFAULT_BORDER_OPACITY = 10;

    // 패널 가사 컨테이너 CSS 클래스
    const PANEL_CONTAINER_CLASS = "ivlyrics-panel-lyrics-container";
    const PANEL_SECTION_CLASS = "ivlyrics-panel-lyrics-section";
    const PANEL_STYLE_ID = "ivlyrics-panel-lyrics-styles";
    const PANEL_ACTIVE_BODY_CLASS = "ivlyrics-panel-lyrics-active";
    // Starry Night 테마용 Now Playing Bar 컨테이너
    const NOWPLAYING_BAR_CONTAINER_CLASS = "ivlyrics-nowplaying-bar-lyrics";

    // Observer 참조
    let panelObserver = moduleState.panelObserver;
    let lyricsRoot = null;
    let starryNightBarRoot = null; // Starry Night 테마용 렌더링 루트
    let stylesInjected = false;
    let pageObserver = moduleState.pageObserver;
    let pageObserverTimeout = moduleState.pageObserverTimeout;
    let historyUnlisten = moduleState.historyUnlisten;
    let lyricsListener = moduleState.lyricsListener;
    let settingsListener = moduleState.settingsListener;
    let insertTimer = moduleState.insertTimer;

    // ============================================
    // CSS 스타일 
    // 앨범 색상 배경의 카드 박스, 동적 폰트 설정
    // ============================================
    const getPanelStyles = () => {
        const fontFamily = getStorageValue(FONT_FAMILY_KEY, DEFAULT_FONT_FAMILY) || DEFAULT_FONT_FAMILY;
        const originalFont = getStorageValue(ORIGINAL_FONT_KEY, "") || "";
        const phoneticFont = getStorageValue(PHONETIC_FONT_KEY, "") || "";
        const translationFont = getStorageValue(TRANSLATION_FONT_KEY, "") || "";
        const panelWidth = getStorageValue(PANEL_WIDTH_KEY, DEFAULT_PANEL_WIDTH);
        const originalSize = getStorageValue(ORIGINAL_SIZE_KEY, DEFAULT_ORIGINAL_SIZE);
        const phoneticSize = getStorageValue(PHONETIC_SIZE_KEY, DEFAULT_PHONETIC_SIZE);
        const translationSize = getStorageValue(TRANSLATION_SIZE_KEY, DEFAULT_TRANSLATION_SIZE);

        // 개별 폰트가 설정되어 있으면 사용, 아니면 기본 폰트 사용
        const baseFontStack = `'${fontFamily}', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
        const originalFontStack = originalFont ? `${originalFont}, ${baseFontStack}` : baseFontStack;
        const phoneticFontStack = phoneticFont ? `${phoneticFont}, ${baseFontStack}` : baseFontStack;
        const translationFontStack = translationFont ? `${translationFont}, ${baseFontStack}` : baseFontStack;

        return `
/* Pretendard 폰트 import */
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css');

/* NowPlaying 패널 가사 CSS 변수 */
:root {
  --ivlyrics-panel-width: ${panelWidth}px;
  --ivlyrics-panel-font-family: ${baseFontStack};
  --ivlyrics-panel-original-font: ${originalFontStack};
  --ivlyrics-panel-phonetic-font: ${phoneticFontStack};
  --ivlyrics-panel-translation-font: ${translationFontStack};
  --ivlyrics-panel-original-size: ${originalSize}px;
  --ivlyrics-panel-phonetic-size: ${phoneticSize}px;
  --ivlyrics-panel-translation-size: ${translationSize}px;
}

/* ivLyrics 페이지에서는 패널 가사 숨기기 (중복 방지) */
/* JavaScript에서 body에 클래스를 추가하는 방식으로 동작 */
body.ivlyrics-page-active .ivlyrics-panel-lyrics-container,
body.ivlyrics-page-active .ivlyrics-panel-lyrics-section {
  display: none !important;
}

/* Now Playing Panel 가사가 켜져 있으면 Spotify 기본 미리보기 가사 숨기기 */
body.${PANEL_ACTIVE_BODY_CLASS} [data-testid="lyrics-npv-section"] {
  display: none !important;
}


/* Now Playing Panel Lyrics - 카드 스타일 */
.ivlyrics-panel-lyrics-container {
  width: 100% !important;
  font-family: var(--ivlyrics-panel-font-family) !important;
  order: 2 !important; /* 곡 정보 다음, 크레딧 전에 고정 위치 */
  --ivlyrics-font-scale: 1; /* 기본 스케일 (CSS 변수로 동적 조절) */
  cursor: pointer !important;
}

.ivlyrics-panel-lyrics-container:empty,
.ivlyrics-nowplaying-bar-lyrics:empty {
  display: none !important;
}

/* 카드 박스 - 앨범 색상 배경 (CSS 변수로 동적 색상 적용) */
.ivlyrics-panel-lyrics-section {
  position: relative !important;
  overflow: hidden !important;
  isolation: isolate !important;
  padding: 14px 16px 18px !important;
  border-radius: 12px !important;
  background: var(--ivlyrics-panel-bg, rgba(80, 80, 80, 0.6)) !important;
  border: var(--ivlyrics-panel-border, none) !important;
  backdrop-filter: blur(20px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
}

.ivlyrics-panel-bg-gradient {
  display: none;
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background-color: rgba(var(--ivlyrics-panel-c1, 30, 30, 40), var(--ivlyrics-panel-gradient-opacity, 0.78));
  filter: brightness(0.92) saturate(2.35);
  transition: background-color 1.5s ease, opacity 0.35s ease, filter 0.5s ease;
  contain: paint;
}

.ivlyrics-panel-lyrics-section.blur-gradient-bg .ivlyrics-panel-bg-gradient {
  display: block;
}

.ivlyrics-panel-bg-gradient::after {
  content: "";
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.46)),
    radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.18), transparent 42%);
  z-index: 2;
}

.ivlyrics-panel-bg-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(34px);
  opacity: 0.82;
  mix-blend-mode: screen;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  will-change: transform, filter;
}

.ivlyrics-panel-bg-blob.blob-1 { width: 92%; height: 92%; background: rgba(var(--ivlyrics-panel-c2, 60, 40, 70), 1); animation: ivlyrics-panel-blob-1 18s ease-in-out infinite; }
.ivlyrics-panel-bg-blob.blob-2 { width: 82%; height: 82%; background: rgba(var(--ivlyrics-panel-c3, 20, 50, 60), 0.95); animation: ivlyrics-panel-blob-2 22s ease-in-out infinite; }
.ivlyrics-panel-bg-blob.blob-3 { width: 62%; height: 62%; background: rgba(var(--ivlyrics-panel-c2, 60, 40, 70), 0.82); filter: blur(28px); animation: ivlyrics-panel-blob-3 15s ease-in-out infinite; }
.ivlyrics-panel-bg-blob.blob-4 { width: 84%; height: 84%; background: rgba(var(--ivlyrics-panel-c3, 20, 50, 60), 0.72); filter: blur(30px); animation: ivlyrics-panel-blob-4 25s ease-in-out infinite; }
.ivlyrics-panel-bg-blob.blob-5 { width: 58%; height: 58%; background: rgba(var(--ivlyrics-panel-c2, 60, 40, 70), 0.68); filter: blur(26px); animation: ivlyrics-panel-blob-5 16s ease-in-out infinite; }
.ivlyrics-panel-bg-blob.blob-6 { width: 100%; height: 100%; background: rgba(var(--ivlyrics-panel-c3, 20, 50, 60), 0.52); filter: blur(38px); animation: ivlyrics-panel-blob-6 20s ease-in-out infinite; }

@keyframes ivlyrics-panel-blob-1 {
  0%, 100% { top: -28%; left: -28%; transform: scale(1); }
  20% { top: 4%; left: 46%; transform: scale(1.12); }
  40% { top: 44%; left: 24%; transform: scale(0.9); }
  60% { top: 20%; left: -10%; transform: scale(1.14); }
  80% { top: -12%; left: 18%; transform: scale(0.96); }
}

@keyframes ivlyrics-panel-blob-2 {
  0%, 100% { top: 46%; left: 56%; transform: scale(1); }
  25% { top: 16%; left: -18%; transform: scale(1.2); }
  50% { top: -18%; left: 36%; transform: scale(0.86); }
  75% { top: 40%; left: 68%; transform: scale(1.1); }
}

@keyframes ivlyrics-panel-blob-3 {
  0%, 100% { top: 58%; left: -12%; transform: scale(1); }
  33% { top: -24%; left: 58%; transform: scale(1.28); }
  66% { top: 36%; left: 38%; transform: scale(0.82); }
}

@keyframes ivlyrics-panel-blob-4 {
  0%, 100% { top: -34%; left: 66%; transform: scale(1); }
  20% { top: 58%; left: 48%; transform: scale(0.9); }
  40% { top: 36%; left: -22%; transform: scale(1.18); }
  60% { top: -12%; left: 28%; transform: scale(1.05); }
  80% { top: 18%; left: 78%; transform: scale(0.86); }
}

@keyframes ivlyrics-panel-blob-5 {
  0%, 100% { top: 68%; left: 48%; transform: scale(1); }
  25% { top: 28%; left: 78%; transform: scale(1.24); }
  50% { top: -12%; left: 18%; transform: scale(0.9); }
  75% { top: 48%; left: -16%; transform: scale(1.1); }
}

@keyframes ivlyrics-panel-blob-6 {
  0%, 100% { top: 24%; left: 24%; transform: scale(1); }
  33% { top: -24%; left: -22%; transform: scale(1.15); }
  66% { top: 58%; left: 58%; transform: scale(0.92); }
}

.ivlyrics-panel-header,
.ivlyrics-panel-lyrics-wrapper,
.ivlyrics-panel-empty {
  position: relative !important;
  z-index: 1 !important;
}

/* Lyrics 라벨 */
.ivlyrics-panel-header {
  display: flex !important;
  align-items: center !important;
  margin-bottom: 10px !important;
  padding: 0 !important;
}

.ivlyrics-panel-header h2 {
  font-size: 11px !important;
  font-weight: 700 !important;
  color: rgba(255, 255, 255, 0.85) !important;
  margin: 0 !important;
  letter-spacing: 0.02em !important;
  font-family: var(--ivlyrics-panel-font-family) !important;
}

/* 가사 래퍼 - 슬라이드 업 애니메이션 */
.ivlyrics-panel-lyrics-wrapper {
  display: grid !important;
  grid-template-rows: repeat(var(--ivlyrics-panel-visible-lines, 9), minmax(0, 1fr)) !important;
  gap: 4px !important;
  height: var(--ivlyrics-panel-fixed-height, 342px) !important;
  max-height: var(--ivlyrics-panel-fixed-height, 342px) !important;
  overflow: hidden !important;
  position: relative !important;
  mask-image: none !important;
  -webkit-mask-image: none !important;
}

/* 슬라이드 업 애니메이션 */
@keyframes ivlyrics-slide-up {
  from {
    transform: translateY(10px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes ivlyrics-fade-out {
  from {
    opacity: 0.5;
  }
  to {
    opacity: 0.3;
  }
}

/* 노래방 글자 바운스 애니메이션 - 자연스럽고 미세한 효과 */
@keyframes ivlyrics-bounce {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
  100% {
    transform: scale(1);
  }
}

/* 가사 라인 */
@keyframes lyricsBreakBarPulse { 0%, 100% { transform: scaleY(0.32); opacity: 0.42; } 50% { transform: scaleY(1); opacity: 1; } }
@keyframes lyricsBreakDotWave { 0%, 100% { transform: translateY(0.15em) scale(0.7); opacity: 0.38; } 50% { transform: translateY(-0.15em) scale(1); opacity: 1; } }
@keyframes lyricsBreakRingBreathe { 0% { transform: scale(0.35); opacity: 0; } 45% { opacity: 0.9; } 100% { transform: scale(1.3); opacity: 0; } }
@keyframes lyricsBreakOrbitOne { from { transform: rotate(0deg) translateX(0.42em); } to { transform: rotate(360deg) translateX(0.42em); } }
@keyframes lyricsBreakOrbitTwo { from { transform: rotate(120deg) translateX(0.42em); } to { transform: rotate(480deg) translateX(0.42em); } }
@keyframes lyricsBreakOrbitThree { from { transform: rotate(240deg) translateX(0.42em); } to { transform: rotate(600deg) translateX(0.42em); } }
@keyframes lyricsBreakDiamondStep { 0%, 100% { opacity: 0.35; transform: rotate(45deg) scale(0.72); } 50% { opacity: 1; transform: rotate(45deg) scale(1.05); } }
@keyframes lyricsBreakScanMove { from { transform: translateX(0); } to { transform: translateX(2em); } }
@keyframes lyricsBreakArcSpin { to { transform: rotate(360deg); } }
@keyframes lyricsBreakSignalFlow { 0% { opacity: 0.48; stroke-dashoffset: 0; } 45% { opacity: 1; } 100% { opacity: 0.48; stroke-dashoffset: -48; } }
@keyframes lyricsBreakDotPulse { 0% { transform: scale(0.25); opacity: 0.8; } 100% { transform: scale(1.75); opacity: 0; } }
@keyframes lyricsBreakStackShift { 0%, 100% { opacity: 0.38; transform: scaleX(0.6); } 50% { opacity: 1; transform: scaleX(1); } }
@keyframes lyricsBreakSparkRotate { to { transform: rotate(360deg); } }
@keyframes lyricsBreakSplitBar { 0%, 100% { transform: scaleY(0.24); opacity: 0.36; } 50% { transform: scaleY(1); opacity: 1; } }
@keyframes lyricsBreakMetronome { from { transform: rotate(-24deg); } to { transform: rotate(24deg); } }
@keyframes lyricsBreakSpin { to { transform: rotate(360deg); } }
@keyframes lyricsBreakBeatHit { 0% { transform: scale(0.5); opacity: 0.5; } 9% { transform: scale(1.28); opacity: 1; } 45% { transform: scale(0.82); opacity: 0.7; } 100% { transform: scale(0.5); opacity: 0.5; } }
@keyframes lyricsBreakTrianglePulse { 0%, 100% { transform: scale(0.7); opacity: 0.45; } 50% { transform: scale(1.1); opacity: 1; } }
@keyframes lyricsBreakMorphShape { 0%, 100% { border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%; transform: rotate(0deg); } 25% { border-radius: 70% 30% 50% 50% / 30% 70% 30% 70%; transform: rotate(90deg); } 50% { border-radius: 50% 50% 30% 70% / 70% 30% 70% 30%; transform: rotate(180deg); } 75% { border-radius: 30% 70% 70% 30% / 50% 50% 50% 50%; transform: rotate(270deg); } }
@keyframes lyricsBreakStringPluck { 0% { transform: translateY(0); opacity: 0.4; } 4% { transform: translateY(-0.08em); opacity: 1; } 9% { transform: translateY(0.06em); } 14% { transform: translateY(-0.04em); } 19% { transform: translateY(0.03em); opacity: 0.75; } 28%, 100% { transform: translateY(0); opacity: 0.4; } }
@keyframes lyricsBreakKeyPress { 0%, 35%, 100% { transform: translateY(0); opacity: 0.55; } 5% { transform: translateY(0.12em); opacity: 1; } 20% { transform: translateY(0); opacity: 0.85; } }
@keyframes lyricsBreakBloomPulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
@keyframes lyricsBreakSpeakerRing { 0%, 100% { transform: scale(0.9); opacity: 0.4; } 18% { transform: scale(1.05); opacity: 1; } }
@keyframes lyricsBreakSpeakerCenter { 0%, 100% { transform: scale(0.68); } 18% { transform: scale(1.2); } }
@keyframes lyricsBreakCrossfadeBreathe { 0%, 100% { transform: scale(0.55); } 50% { transform: scale(1); } }

.ivlyrics-panel-line {
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
  gap: 2px !important;
  min-height: 0 !important;
  height: 100% !important;
  padding: 3px 0 !important;
  border-radius: 0 !important;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
  background: transparent !important;
  text-align: left !important;
  font-family: var(--ivlyrics-panel-font-family) !important;
  overflow: hidden !important;
  animation: ivlyrics-slide-up 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards !important;
}

/* 활성 라인 */
.ivlyrics-panel-line.active {
  background: transparent !important;
  opacity: 1 !important;
}

/* 지나간 라인 */
.ivlyrics-panel-line.past {
  opacity: 0.4 !important;
}

/* 다음 라인 */
.ivlyrics-panel-line.future {
  opacity: 0.6 !important;
}

/* 1. 발음 (Phonetic) - 아래에 작게 */
.ivlyrics-panel-line-interlude {
  display: inline-flex !important;
  align-items: center !important;
  max-width: 100% !important;
  color: rgba(255, 255, 255, 0.7) !important;
  font-family: var(--ivlyrics-panel-original-font) !important;
  line-height: 1.35 !important;
  white-space: nowrap !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-interlude {
  color: #ffffff !important;
}

.lyrics-break-indicator { display: inline-flex; align-items: center; gap: 0.3em; max-width: 100%; color: currentColor; vertical-align: middle; white-space: nowrap; }
.lyrics-break-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 1.16em; height: 1.16em; min-width: 18px; min-height: 18px; flex: 0 0 auto; overflow: visible; color: currentColor; }
.lyrics-break-icon span, .lyrics-break-icon svg { flex: 0 0 auto; }
.lyrics-break-label { font-family: var(--break-label-font-family, var(--ivlyrics-panel-original-font, inherit)); font-size: var(--break-label-font-size, 12px); font-weight: var(--break-label-font-weight, 200); line-height: 1; letter-spacing: 0; opacity: var(--break-label-opacity, 0.65); }
.lyrics-break-icon-equalizer, .lyrics-break-icon-dotWave, .lyrics-break-icon-diamonds, .lyrics-break-icon-splitBars, .lyrics-break-icon-reels, .lyrics-break-icon-piano { display: inline-flex; }
.lyrics-break-icon-equalizer, .lyrics-break-icon-splitBars { align-items: center; gap: 0.09em; }
.lyrics-break-icon-equalizer span, .lyrics-break-icon-splitBars span { display: block; width: 0.11em; min-width: 2px; height: 0.76em; border-radius: 999px; background: currentColor; transform: scaleY(0.4); transform-origin: center; }
.lyrics-break-icon-equalizer span { animation: lyricsBreakBarPulse var(--break-duration, 1100ms) ease-in-out infinite; }
.lyrics-break-icon-equalizer span:nth-child(2) { animation-delay: calc(var(--break-duration, 1100ms) * -0.18); }
.lyrics-break-icon-equalizer span:nth-child(3) { animation-delay: calc(var(--break-duration, 1100ms) * -0.36); }
.lyrics-break-icon-equalizer span:nth-child(4) { animation-delay: calc(var(--break-duration, 1100ms) * -0.54); }
.lyrics-break-icon-dotWave { align-items: center; gap: 0.1em; }
.lyrics-break-icon-dotWave span { width: 0.14em; height: 0.14em; border-radius: 50%; background: currentColor; animation: lyricsBreakDotWave var(--break-duration-fast, 790ms) ease-in-out infinite; }
.lyrics-break-icon-dotWave span:nth-child(2) { animation-delay: calc(var(--break-duration-fast, 790ms) * 0.1); }
.lyrics-break-icon-dotWave span:nth-child(3) { animation-delay: calc(var(--break-duration-fast, 790ms) * 0.2); }
.lyrics-break-icon-dotWave span:nth-child(4) { animation-delay: calc(var(--break-duration-fast, 790ms) * 0.3); }
.lyrics-break-icon-dotWave span:nth-child(5) { animation-delay: calc(var(--break-duration-fast, 790ms) * 0.4); }
.lyrics-break-icon-ripples::before, .lyrics-break-icon-ripples::after, .lyrics-break-icon-ripples span { content: ""; position: absolute; inset: 0.28em; border: 0.055em solid currentColor; border-radius: 50%; animation: lyricsBreakRingBreathe var(--break-duration-slow, 1815ms) ease-in-out infinite; }
.lyrics-break-icon-ripples::after { animation-delay: calc(var(--break-duration-slow, 1815ms) * -0.33); }
.lyrics-break-icon-ripples span { animation-delay: calc(var(--break-duration-slow, 1815ms) * -0.66); }
.lyrics-break-icon-orbit::before, .lyrics-break-icon-orbit::after, .lyrics-break-icon-orbit span { content: ""; position: absolute; top: 50%; left: 50%; width: 0.14em; height: 0.14em; margin: -0.07em; border-radius: 50%; background: currentColor; transform-origin: center; }
.lyrics-break-icon-orbit::before { animation: lyricsBreakOrbitOne var(--break-duration-slow, 1815ms) linear infinite; }
.lyrics-break-icon-orbit::after { animation: lyricsBreakOrbitTwo var(--break-duration-slow, 1815ms) linear infinite; }
.lyrics-break-icon-orbit span { animation: lyricsBreakOrbitThree var(--break-duration-slow, 1815ms) linear infinite; }
.lyrics-break-icon-diamonds { align-items: center; gap: 0.17em; }
.lyrics-break-icon-diamonds span { width: 0.2em; height: 0.2em; background: currentColor; transform: rotate(45deg) scale(0.72); animation: lyricsBreakDiamondStep var(--break-duration, 1100ms) ease-in-out infinite; }
.lyrics-break-icon-diamonds span:nth-child(2) { animation-delay: calc(var(--break-duration, 1100ms) * 0.13); }
.lyrics-break-icon-diamonds span:nth-child(3) { animation-delay: calc(var(--break-duration, 1100ms) * 0.25); }
.lyrics-break-icon-scan { width: 1.22em; height: 0.5em; border-left: 0.06em solid currentColor; border-right: 0.06em solid currentColor; overflow: hidden; }
.lyrics-break-icon-scan::before { content: ""; position: absolute; top: calc(50% - 0.05em); left: -0.76em; width: 0.72em; height: 0.1em; border-radius: 999px; background: currentColor; box-shadow: 0.32em 0 0 currentColor, 0.64em 0 0 currentColor; animation: lyricsBreakScanMove var(--break-duration, 1100ms) ease-in-out infinite; }
.lyrics-break-icon-arcs::before, .lyrics-break-icon-arcs::after { content: ""; position: absolute; inset: 0.16em; border: 0.07em solid transparent; border-top-color: currentColor; border-right-color: currentColor; border-radius: 50%; animation: lyricsBreakArcSpin var(--break-duration-slow, 1815ms) linear infinite; }
.lyrics-break-icon-arcs::after { inset: 0.34em; border-width: 0.055em; border-top-color: transparent; border-right-color: currentColor; border-bottom-color: currentColor; animation-direction: reverse; animation-duration: var(--break-duration, 1100ms); }
.lyrics-break-icon-signal { width: 1.32em; height: 0.52em; overflow: visible; }
.lyrics-break-icon-signal svg { display: block; width: 1.32em; height: 0.52em; fill: none; stroke: currentColor; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.lyrics-break-icon-signal path { stroke-dasharray: 18 14; animation: lyricsBreakSignalFlow var(--break-duration-slow, 1815ms) linear infinite; }
.lyrics-break-icon-pulseDot::before, .lyrics-break-icon-pulseDot::after { content: ""; position: absolute; inset: 0.4em; border-radius: 50%; background: currentColor; }
.lyrics-break-icon-pulseDot::after { inset: 0.26em; background: transparent; border: 0.04em solid currentColor; animation: lyricsBreakDotPulse var(--break-duration, 1100ms) ease-out infinite; }
.lyrics-break-icon-stack { display: grid; place-items: center; gap: 0.08em; }
.lyrics-break-icon-stack span { display: block; width: 0.78em; height: 0.09em; border-radius: 999px; background: currentColor; animation: lyricsBreakStackShift var(--break-duration, 1100ms) ease-in-out infinite; }
.lyrics-break-icon-stack span:nth-child(2) { width: 0.52em; animation-delay: calc(var(--break-duration, 1100ms) * -0.17); }
.lyrics-break-icon-stack span:nth-child(3) { width: 0.92em; animation-delay: calc(var(--break-duration, 1100ms) * -0.34); }
.lyrics-break-icon-spark { animation: lyricsBreakSparkRotate var(--break-duration-xslow, 4180ms) linear infinite; }
.lyrics-break-icon-spark span { position: absolute; top: 50%; left: 50%; width: 0.1em; height: 0.1em; margin: -0.05em; border-radius: 50%; background: currentColor; transform: rotate(calc(var(--i) * 45deg)) translateX(0.42em) scale(calc(0.45 + var(--i) * 0.06)); opacity: calc(0.22 + var(--i) * 0.08); }
.lyrics-break-icon-splitBars span { animation: lyricsBreakSplitBar var(--break-duration, 1100ms) ease-in-out infinite; }
.lyrics-break-icon-splitBars span:nth-child(1), .lyrics-break-icon-splitBars span:nth-child(4) { animation-delay: calc(var(--break-duration, 1100ms) * -0.22); }
.lyrics-break-icon-splitBars span:nth-child(2), .lyrics-break-icon-splitBars span:nth-child(3) { animation-delay: calc(var(--break-duration, 1100ms) * -0.06); }
.lyrics-break-icon-metronome::before { content: ""; position: absolute; left: calc(50% - 0.05em); bottom: 0.2em; width: 0.1em; height: 0.76em; border-radius: 999px; background: currentColor; transform-origin: bottom center; animation: lyricsBreakMetronome var(--break-duration-fast, 790ms) ease-in-out infinite alternate; }
.lyrics-break-icon-metronome::after { content: ""; position: absolute; left: calc(50% - 0.25em); bottom: 0.14em; width: 0.5em; height: 0.07em; border-radius: 999px; background: currentColor; opacity: 0.55; }
.lyrics-break-icon-vinyl { border: 0.04em solid currentColor; border-radius: 50%; animation: lyricsBreakSpin var(--break-duration-xslow, 4180ms) linear infinite; }
.lyrics-break-icon-vinyl::before { content: ""; position: absolute; inset: 0.22em; border: 0.025em solid currentColor; border-radius: 50%; opacity: 0.45; }
.lyrics-break-icon-vinyl::after { content: ""; position: absolute; inset: 0.47em; border-radius: 50%; background: currentColor; }
.lyrics-break-icon-vinyl > span { position: absolute; top: 0.08em; left: 50%; width: 0.08em; height: 0.08em; margin-left: -0.04em; border-radius: 50%; background: currentColor; }
.lyrics-break-icon-beat { width: 0.68em; height: 0.68em; border-radius: 50%; background: currentColor; animation: lyricsBreakBeatHit var(--break-duration-fast, 790ms) cubic-bezier(0.18, 0.9, 0.36, 1) infinite; }
.lyrics-break-icon-reels { align-items: center; gap: 0.2em; }
.lyrics-break-icon-reels span { position: relative; width: 0.42em; height: 0.42em; border: 0.04em solid currentColor; border-radius: 50%; animation: lyricsBreakSpin var(--break-duration-slow, 1815ms) linear infinite; }
.lyrics-break-icon-reels span:nth-child(2) { animation-direction: reverse; }
.lyrics-break-icon-reels span::before, .lyrics-break-icon-reels span::after { content: ""; position: absolute; top: 50%; left: 50%; background: currentColor; }
.lyrics-break-icon-reels span::before { width: 0.3em; height: 0.035em; margin: -0.0175em 0 0 -0.15em; }
.lyrics-break-icon-reels span::after { width: 0.035em; height: 0.3em; margin: -0.15em 0 0 -0.0175em; }
.lyrics-break-icon-triangle::before { content: ""; width: 0; height: 0; border-left: 0.56em solid currentColor; border-top: 0.34em solid transparent; border-bottom: 0.34em solid transparent; animation: lyricsBreakTrianglePulse var(--break-duration, 1100ms) ease-in-out infinite; }
.lyrics-break-icon-morph { width: 0.88em; height: 0.88em; background: currentColor; border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%; animation: lyricsBreakMorphShape var(--break-duration-xslow, 4180ms) ease-in-out infinite; }
.lyrics-break-icon-strings { display: flex; flex-direction: column; gap: 0.13em; }
.lyrics-break-icon-strings span { display: block; width: 1em; height: 0.035em; border-radius: 999px; background: currentColor; animation: lyricsBreakStringPluck var(--break-duration-slow, 1815ms) ease-out infinite; }
.lyrics-break-icon-strings span:nth-child(2) { animation-delay: calc(var(--break-duration-slow, 1815ms) * 0.05); }
.lyrics-break-icon-strings span:nth-child(3) { animation-delay: calc(var(--break-duration-slow, 1815ms) * 0.1); }
.lyrics-break-icon-strings span:nth-child(4) { animation-delay: calc(var(--break-duration-slow, 1815ms) * 0.15); }
.lyrics-break-icon-piano { align-items: center; gap: 0.08em; }
.lyrics-break-icon-piano span { display: block; width: 0.12em; height: 0.76em; border-radius: 0 0 0.04em 0.04em; background: currentColor; animation: lyricsBreakKeyPress var(--break-duration-slow, 1815ms) ease-in-out infinite; }
.lyrics-break-icon-piano span:nth-child(2) { animation-delay: calc(var(--break-duration-slow, 1815ms) * 0.45); }
.lyrics-break-icon-piano span:nth-child(3) { animation-delay: calc(var(--break-duration-slow, 1815ms) * 0.14); }
.lyrics-break-icon-piano span:nth-child(4) { animation-delay: calc(var(--break-duration-slow, 1815ms) * 0.68); }
.lyrics-break-icon-piano span:nth-child(5) { animation-delay: calc(var(--break-duration-slow, 1815ms) * 0.28); }
.lyrics-break-icon-bloom span { position: absolute; top: 50%; left: 50%; width: 0.2em; height: 0.2em; margin: -0.1em; border-radius: 50%; background: currentColor; animation: lyricsBreakBloomPulse var(--break-duration-slow, 1815ms) ease-in-out infinite; }
.lyrics-break-icon-bloom span:nth-child(1) { transform: translateX(-0.32em); }
.lyrics-break-icon-bloom span:nth-child(2) { transform: translateX(0.32em); animation-delay: calc(var(--break-duration-slow, 1815ms) * 0.25); }
.lyrics-break-icon-bloom span:nth-child(3) { transform: translateY(-0.32em); animation-delay: calc(var(--break-duration-slow, 1815ms) * 0.13); }
.lyrics-break-icon-bloom span:nth-child(4) { transform: translateY(0.32em); animation-delay: calc(var(--break-duration-slow, 1815ms) * 0.38); }
.lyrics-break-icon-speaker { border: 0.04em solid currentColor; border-radius: 50%; }
.lyrics-break-icon-speaker::before { content: ""; position: absolute; inset: 0.22em; border: 0.04em solid currentColor; border-radius: 50%; animation: lyricsBreakSpeakerRing var(--break-duration-fast, 790ms) cubic-bezier(0.2, 0.85, 0.4, 1) infinite; }
.lyrics-break-icon-speaker::after { content: ""; position: absolute; inset: 0.44em; border-radius: 50%; background: currentColor; animation: lyricsBreakSpeakerCenter var(--break-duration-fast, 790ms) cubic-bezier(0.2, 0.85, 0.4, 1) infinite; }
.lyrics-break-icon-crossfade::before, .lyrics-break-icon-crossfade::after { content: ""; position: absolute; top: 50%; width: 0.5em; height: 0.5em; margin-top: -0.25em; border-radius: 50%; background: currentColor; opacity: 0.55; animation: lyricsBreakCrossfadeBreathe var(--break-duration-slow, 1815ms) ease-in-out infinite; }
.lyrics-break-icon-crossfade::before { left: 0.24em; }
.lyrics-break-icon-crossfade::after { right: 0.24em; animation-delay: calc(var(--break-duration-slow, 1815ms) * -0.5); }
.ivlyrics-panel-line:not(.active) .lyrics-break-icon, .ivlyrics-panel-line:not(.active) .lyrics-break-icon *, .ivlyrics-panel-line:not(.active) .lyrics-break-icon::before, .ivlyrics-panel-line:not(.active) .lyrics-break-icon::after, .ivlyrics-panel-line:not(.active) .lyrics-break-icon *::before, .ivlyrics-panel-line:not(.active) .lyrics-break-icon *::after { animation-play-state: paused !important; }
.ivlyrics-panel-lyrics-section.playback-paused .lyrics-break-icon, .ivlyrics-panel-lyrics-section.playback-paused .lyrics-break-icon *, .ivlyrics-panel-lyrics-section.playback-paused .lyrics-break-icon::before, .ivlyrics-panel-lyrics-section.playback-paused .lyrics-break-icon::after, .ivlyrics-panel-lyrics-section.playback-paused .lyrics-break-icon *::before, .ivlyrics-panel-lyrics-section.playback-paused .lyrics-break-icon *::after { animation-play-state: paused !important; }

.ivlyrics-panel-line-phonetic {
  display: -webkit-box !important;
  -webkit-line-clamp: 1 !important;
  -webkit-box-orient: vertical !important;
  font-size: calc(var(--ivlyrics-panel-phonetic-size, 13px) * var(--ivlyrics-font-scale, 1)) !important;
  font-weight: 400 !important;
  color: rgba(255, 255, 255, 0.55) !important;
  line-height: 1.35 !important;
  letter-spacing: 0.01em !important;
  overflow: hidden !important;
  font-family: var(--ivlyrics-panel-phonetic-font) !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-phonetic {
  color: rgba(255, 255, 255, 0.75) !important;
}

/* 2. 원어 (Original Text) - 크고 볼드 */
.ivlyrics-panel-line-text {
  display: -webkit-box !important;
  -webkit-line-clamp: 2 !important;
  -webkit-box-orient: vertical !important;
  font-size: calc(var(--ivlyrics-panel-original-size, 18px) * var(--ivlyrics-font-scale, 1)) !important;
  font-weight: 700 !important;
  color: rgba(255, 255, 255, 0.7) !important;
  line-height: 1.4 !important;
  letter-spacing: -0.01em !important;
  word-break: keep-all !important;
  overflow-wrap: break-word !important;
  overflow: hidden !important;
  font-family: var(--ivlyrics-panel-original-font) !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-text {
  color: #ffffff !important;
  font-weight: 800 !important;
}

/* 3. 번역 (Translation) - 아래에 작게 */
.ivlyrics-panel-line-translation {
  display: -webkit-box !important;
  -webkit-line-clamp: 1 !important;
  -webkit-box-orient: vertical !important;
  font-size: calc(var(--ivlyrics-panel-translation-size, 13px) * var(--ivlyrics-font-scale, 1)) !important;
  font-weight: 500 !important;
  color: rgba(255, 255, 255, 0.5) !important;
  line-height: 1.35 !important;
  margin-top: 1px !important;
  overflow: hidden !important;
  font-family: var(--ivlyrics-panel-translation-font) !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-translation {
  color: rgba(255, 255, 255, 0.8) !important;
}

/* ========================================
   노래방 (Karaoke) 가사 스타일
   ======================================== */
.ivlyrics-panel-line-karaoke {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0px !important;
  font-size: calc(var(--ivlyrics-panel-original-size, 18px) * var(--ivlyrics-font-scale, 1)) !important;
  font-weight: 700 !important;
  line-height: 1.4 !important;
  font-family: var(--ivlyrics-panel-original-font) !important;
  max-height: calc(var(--ivlyrics-panel-original-size, 18px) * var(--ivlyrics-font-scale, 1) * 2.85) !important;
  overflow: hidden !important;
}

.ivlyrics-panel-line-karaoke.is-text-run,
.ivlyrics-panel-line-karaoke-row.is-text-run {
  display: block !important;
  flex-wrap: nowrap !important;
  letter-spacing: 0 !important;
  word-break: normal !important;
  overflow-wrap: normal !important;
  unicode-bidi: plaintext !important;
}

.ivlyrics-panel-line-karaoke.is-text-run.is-rtl,
.ivlyrics-panel-line-karaoke-row.is-text-run.is-rtl {
  direction: ltr !important;
}
.ivlyrics-panel-line-karaoke-stack {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  overflow: hidden !important;
}

.ivlyrics-panel-line-karaoke-row {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0px !important;
}

.ivlyrics-panel-line-karaoke-part {
  display: flex !important;
  flex-direction: column !important;
  gap: 1px !important;
}

.ivlyrics-panel-line-karaoke-row.background {
  opacity: 0.78 !important;
}

.ivlyrics-panel-line-karaoke-row.effect {
  font-style: italic !important;
  opacity: 0.72 !important;
}

.ivlyrics-panel-line-karaoke-row.speaker-a .ivlyrics-panel-karaoke-word.sung {
  color: #ffffff !important;
}

.ivlyrics-panel-line-karaoke-row.speaker-b .ivlyrics-panel-karaoke-word.sung {
  color: #9fd8ff !important;
}

.ivlyrics-panel-line.speaker-b .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-b.active .ivlyrics-panel-line-text {
  color: #9fd8ff !important;
}

.ivlyrics-panel-line-karaoke-row.speaker-c .ivlyrics-panel-karaoke-word.sung {
  color: #ffd18a !important;
}

.ivlyrics-panel-line.speaker-c .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-c.active .ivlyrics-panel-line-text {
  color: #ffd18a !important;
}

.ivlyrics-panel-line-karaoke-row.speaker-d .ivlyrics-panel-karaoke-word.sung {
  color: #d7b8ff !important;
}

.ivlyrics-panel-line.speaker-d .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-d.active .ivlyrics-panel-line-text {
  color: #d7b8ff !important;
}

.ivlyrics-panel-line-karaoke-row.speaker-sfx .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line-karaoke-row.effect .ivlyrics-panel-karaoke-word.sung {
  color: #9ff2c5 !important;
}

.ivlyrics-panel-line.speaker-sfx .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.effect .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-sfx.active .ivlyrics-panel-line-text,
.ivlyrics-panel-line.effect.active .ivlyrics-panel-line-text {
  color: #9ff2c5 !important;
}

.ivlyrics-panel-line-karaoke-row.speaker-male-1 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-male-1 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-male-1.active .ivlyrics-panel-line-text { color: #e6f2ff !important; }
.ivlyrics-panel-line-karaoke-row.speaker-male-2 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-male-2 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-male-2.active .ivlyrics-panel-line-text { color: #d7ecff !important; }
.ivlyrics-panel-line-karaoke-row.speaker-male-3 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-male-3 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-male-3.active .ivlyrics-panel-line-text { color: #edf7ff !important; }
.ivlyrics-panel-line-karaoke-row.speaker-male-4 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-male-4 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-male-4.active .ivlyrics-panel-line-text { color: #dbe7ff !important; }
.ivlyrics-panel-line-karaoke-row.speaker-male-5 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-male-5 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-male-5.active .ivlyrics-panel-line-text { color: #e2f8ff !important; }
.ivlyrics-panel-line-karaoke-row.speaker-female-1 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-female-1 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-female-1.active .ivlyrics-panel-line-text { color: #ffe7ef !important; }
.ivlyrics-panel-line-karaoke-row.speaker-female-2 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-female-2 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-female-2.active .ivlyrics-panel-line-text { color: #ffe0e8 !important; }
.ivlyrics-panel-line-karaoke-row.speaker-female-3 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-female-3 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-female-3.active .ivlyrics-panel-line-text { color: #fff0f5 !important; }
.ivlyrics-panel-line-karaoke-row.speaker-female-4 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-female-4 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-female-4.active .ivlyrics-panel-line-text { color: #ffdfe0 !important; }
.ivlyrics-panel-line-karaoke-row.speaker-female-5 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-female-5 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-female-5.active .ivlyrics-panel-line-text { color: #fbe5ff !important; }
.ivlyrics-panel-line-karaoke-row.speaker-duet-1 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-duet-1 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-duet-1.active .ivlyrics-panel-line-text { color: #eadfff !important; }
.ivlyrics-panel-line-karaoke-row.speaker-duet-2 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-duet-2 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-duet-2.active .ivlyrics-panel-line-text { color: #e2d2ff !important; }
.ivlyrics-panel-line-karaoke-row.speaker-duet-3 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-duet-3 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-duet-3.active .ivlyrics-panel-line-text { color: #f0e8ff !important; }
.ivlyrics-panel-line-karaoke-row.speaker-duet-4 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-duet-4 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-duet-4.active .ivlyrics-panel-line-text { color: #dec9ff !important; }
.ivlyrics-panel-line-karaoke-row.speaker-duet-5 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-duet-5 .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.speaker-duet-5.active .ivlyrics-panel-line-text { color: #e9dcff !important; }

@keyframes ivlyrics-panel-effect-tremble {
  0%, 100% { translate: 0 0; }
  25% { translate: -0.5px 0.25px; }
  50% { translate: 0.45px -0.25px; }
  75% { translate: -0.25px -0.35px; }
}

@keyframes ivlyrics-panel-adlib-float {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -1.5px; }
}

@keyframes ivlyrics-panel-pulse {
  0%, 100% { scale: 1; filter: brightness(1); }
  45% { scale: 1.025; filter: brightness(1.12); }
}

@keyframes ivlyrics-panel-wave {
  0%, 100% { translate: 0 0; }
  35% { translate: 0 -0.11em; }
  70% { translate: 0 0.03em; }
}

@keyframes ivlyrics-panel-sparkle {
  0%, 100% { filter: brightness(1); text-shadow: 0 0 0 rgba(255, 255, 255, 0); }
  42% { filter: brightness(1.22); text-shadow: 0 0 0.18em rgba(255, 255, 255, 0.34), 0 0 0.42em currentColor; }
  58% { filter: brightness(0.96); text-shadow: 0 0 0.08em rgba(255, 255, 255, 0.16); }
}

@keyframes ivlyrics-panel-echo {
  0%, 100% { text-shadow: 0 0 0 rgba(255, 255, 255, 0); }
  50% { text-shadow: 0.07em 0.04em 0 rgba(255, 255, 255, 0.18), 0.14em 0.08em 0.22em rgba(248, 251, 255, 0.28); }
}

@keyframes ivlyrics-panel-whisper {
  0%, 100% { opacity: 0.86; filter: blur(0); translate: 0 0; }
  45% { opacity: 0.72; filter: blur(0.55px); translate: 0.04em -0.02em; }
}

@keyframes ivlyrics-panel-bounce {
  0%, 100% { translate: 0 0; }
  32% { translate: 0 -0.16em; }
  58% { translate: 0 0.035em; }
  76% { translate: 0 -0.045em; }
}

@keyframes ivlyrics-panel-sway {
  0%, 100% { translate: 0 0; rotate: 0deg; }
  30% { translate: -0.035em 0; rotate: -1.2deg; }
  70% { translate: 0.035em 0; rotate: 1.2deg; }
}

@keyframes ivlyrics-panel-glow {
  0%, 100% { filter: brightness(1.16); text-shadow: 0 0 0.14em rgba(255, 255, 255, 0.34), 0 0 0.54em rgba(248, 251, 255, 0.3); }
  50% { filter: brightness(1.1); text-shadow: 0 0 0.1em rgba(255, 255, 255, 0.28), 0 0 0.44em rgba(248, 251, 255, 0.24); }
}

@keyframes ivlyrics-panel-glitch {
  0%, 100% { translate: 0 0; text-shadow: 0 0 0 transparent; }
  16% { translate: -0.035em 0.01em; text-shadow: 0.045em 0 rgba(111, 211, 255, 0.34), -0.045em 0 rgba(255, 116, 172, 0.3); }
  18% { translate: 0.03em -0.01em; text-shadow: -0.04em 0 rgba(111, 211, 255, 0.26), 0.04em 0 rgba(255, 116, 172, 0.28); }
  20%, 64% { translate: 0 0; text-shadow: 0 0 0 transparent; }
  66% { translate: 0.025em 0; text-shadow: 0.035em 0 rgba(111, 211, 255, 0.24), -0.035em 0 rgba(255, 116, 172, 0.24); }
  68% { translate: 0 0; text-shadow: 0 0 0 transparent; }
}

@keyframes ivlyrics-panel-flicker {
  0%, 100% { opacity: 1; filter: brightness(1); }
  12% { opacity: 0.76; filter: brightness(0.92); }
  15%, 48% { opacity: 1; filter: brightness(1.08); }
  52% { opacity: 0.82; filter: brightness(0.96); }
  56% { opacity: 1; filter: brightness(1.06); }
}

@keyframes ivlyrics-panel-float {
  0%, 100% { translate: 0 0; rotate: 0deg; }
  50% { translate: 0 -0.09em; rotate: 0.45deg; }
}

@keyframes ivlyrics-panel-blur {
  0%, 100% { filter: blur(0) brightness(1); opacity: 0.98; }
  50% { filter: blur(0.65px) brightness(1.08); opacity: 0.9; }
}

@keyframes ivlyrics-panel-pop {
  0%, 100% { scale: 1; filter: brightness(1); }
  18% { scale: 1.055; filter: brightness(1.12); }
  34% { scale: 0.992; filter: brightness(1); }
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.effect,
.ivlyrics-panel-line.effect.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-effect-tremble 180ms steps(2, end) infinite !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.adlib,
.ivlyrics-panel-line.adlib.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-adlib-float 1.05s ease-in-out infinite !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.pulse,
.ivlyrics-panel-line.pulse.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-pulse 940ms ease-in-out infinite !important;
  transform-origin: center !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.wave,
.ivlyrics-panel-line.wave.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-wave 920ms ease-in-out infinite !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.sparkle,
.ivlyrics-panel-line.sparkle.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-sparkle 1.18s ease-in-out infinite !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.echo,
.ivlyrics-panel-line.echo.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-echo 1.28s ease-in-out infinite !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.whisper,
.ivlyrics-panel-line.whisper.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-whisper 1.45s ease-in-out infinite !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.bounce,
.ivlyrics-panel-line.bounce.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-bounce 780ms cubic-bezier(0.2, 0.85, 0.24, 1) infinite !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.sway,
.ivlyrics-panel-line.sway.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-sway 1.35s ease-in-out infinite !important;
  transform-origin: center bottom !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.glow,
.ivlyrics-panel-line.glow.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-glow 1.35s ease-in-out infinite !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.glitch,
.ivlyrics-panel-line.glitch.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-glitch 1.12s steps(1, end) infinite !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.flicker,
.ivlyrics-panel-line.flicker.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-flicker 1.22s steps(1, end) infinite !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.float,
.ivlyrics-panel-line.float.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-float 1.65s ease-in-out infinite !important;
  transform-origin: center !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.blur,
.ivlyrics-panel-line.blur.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-blur 1.5s ease-in-out infinite !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-karaoke-row.pop,
.ivlyrics-panel-line.pop.active .ivlyrics-panel-line-text {
  animation: ivlyrics-panel-pop 1.08s cubic-bezier(0.18, 0.9, 0.36, 1) infinite !important;
  transform-origin: center !important;
}

.ivlyrics-panel-line.text-effects-disabled,
.ivlyrics-panel-line.text-effects-disabled *,
.ivlyrics-panel-line-karaoke-row.text-effects-disabled,
.ivlyrics-panel-line-karaoke-row.text-effects-disabled * {
  animation: none !important;
}

.ivlyrics-panel-karaoke-space {
  margin-right: 5px !important;
}

/* 노래방 단어 */
.ivlyrics-panel-karaoke-word {
  position: relative !important;
  display: inline-block !important;
  color: rgba(255, 255, 255, 0.5) !important;
  transition: color 0.15s ease, transform 0.15s ease !important;
  transform-origin: center bottom !important;
}

.ivlyrics-panel-karaoke-text-run-segment {
  position: relative !important;
  display: inline-block !important;
  white-space: pre !important;
  color: rgba(255, 255, 255, 0.5) !important;
  transition: color 0.15s ease, transform 0.15s ease !important;
  transform-origin: center bottom !important;
  vertical-align: baseline !important;
  unicode-bidi: isolate !important;
  -webkit-box-decoration-break: clone !important;
  box-decoration-break: clone !important;
}

.ivlyrics-panel-karaoke-text-run-space {
  white-space: pre-wrap !important;
}
/* 노래방 단어 - 활성 (하이라이트 + 미세 바운스) */
.ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-karaoke-text-run-segment.sung {
  color: #ffffff !important;
  animation: ivlyrics-bounce 0.2s ease-out forwards !important;
}

/* 노래방 라인 활성 시 단어 기본 색상 더 밝게 */
.ivlyrics-panel-line.active .ivlyrics-panel-karaoke-word,
.ivlyrics-panel-line.active .ivlyrics-panel-karaoke-text-run-segment {
  color: rgba(255, 255, 255, 0.6) !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-karaoke-word.sung,
.ivlyrics-panel-line.active .ivlyrics-panel-karaoke-text-run-segment.sung {
  color: #ffffff !important;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.5) !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-karaoke-text-run-segment.active {
  color: transparent !important;
  background-image: linear-gradient(var(--ivlyrics-panel-karaoke-gradient-direction, to right),
      #ffffff 0,
      #ffffff var(--ivlyrics-panel-karaoke-fill-soft-start, var(--ivlyrics-panel-karaoke-fill, 0%)),
      rgba(255, 255, 255, 0.6) var(--ivlyrics-panel-karaoke-fill-soft-end, var(--ivlyrics-panel-karaoke-fill, 0%)),
      rgba(255, 255, 255, 0.6) 100%) !important;
  background-repeat: no-repeat !important;
  -webkit-background-clip: text !important;
  background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
}

/* 가사 없음 상태 */
.ivlyrics-panel-empty {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-height: var(--ivlyrics-panel-fixed-height, 342px) !important;
  text-align: center !important;
  color: rgba(255, 255, 255, 0.6) !important;
  font-size: 13px !important;
  padding: 0 16px !important;
  font-family: 'Pretendard Variable', Pretendard, sans-serif !important;
}

/* Placeholder 라인 (빈 줄 - 높이 유지용) */
.ivlyrics-panel-line.placeholder {
  opacity: 0 !important;
  pointer-events: none !important;
  min-height: 0 !important;
}

/* Furigana (Ruby) 스타일 */
.ivlyrics-panel-line ruby {
  ruby-align: center !important;
}

.ivlyrics-panel-line ruby rt {
  font-size: 0.55em !important;
  color: rgba(255, 255, 255, 0.55) !important;
  font-weight: 400 !important;
}

.ivlyrics-panel-line.active ruby rt {
  color: rgba(255, 255, 255, 0.75) !important;
}

/* 스크롤바 숨기기 */
.ivlyrics-panel-lyrics-wrapper::-webkit-scrollbar {
  display: none !important;
}

.ivlyrics-panel-lyrics-wrapper {
  -ms-overflow-style: none !important;
  scrollbar-width: none !important;
}

/* ==========================================
   Starry Night 테마용 - Now Playing Bar 가사
   Root__now-playing-bar 하단에 표시
   ========================================== */
.ivlyrics-nowplaying-bar-lyrics {
  width: 100%;
  z-index: 10;
  pointer-events: auto;
  padding: 8px 16px;
  margin-top: 10px;
}

.ivlyrics-nowplaying-bar-lyrics .ivlyrics-panel-lyrics-section {
  background: rgba(0, 0, 0, 0.4) !important;
  backdrop-filter: blur(20px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
  border-radius: 8px !important;
  padding: 8px 12px 10px !important;
  max-width: 800px;
  margin: 0 auto;
}

.ivlyrics-nowplaying-bar-lyrics .ivlyrics-panel-header {
  margin-bottom: 4px !important;
}

.ivlyrics-nowplaying-bar-lyrics .ivlyrics-panel-lyrics-wrapper {
  gap: 2px !important;
  height: var(--ivlyrics-panel-bar-fixed-height, 246px) !important;
  max-height: var(--ivlyrics-panel-bar-fixed-height, 246px) !important;
}

.ivlyrics-nowplaying-bar-lyrics .ivlyrics-panel-line {
  padding: 2px 0 !important;
}

/* Starry Night 테마에서 Now Playing Bar에 flex-direction: column 적용 */
/* JavaScript에서 body에 클래스를 추가하는 방식으로 동작 */
body.ivlyrics-starrynight-theme .Root__now-playing-bar {
  display: flex !important;
  flex-direction: column !important;
}
`;
    };

    // ============================================
    // Google Fonts 목록 (Settings.js와 동기화)
    // ============================================
    const GOOGLE_FONTS = [
        "Pretendard Variable",
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

    // Google Fonts 로드 함수
    const loadGoogleFont = (fontFamily) => {
        if (!fontFamily) return;

        // 콤마로 구분된 여러 폰트 처리
        const fonts = fontFamily.split(",").map(f => f.trim().replace(/['"]/g, ""));

        fonts.forEach(font => {
            if (font && GOOGLE_FONTS.includes(font)) {
                const fontId = font.replace(/ /g, "-").toLowerCase();
                const linkId = `ivlyrics-panel-font-${fontId}`;

                let link = document.getElementById(linkId);
                if (!link) {
                    link = document.createElement("link");
                    link.id = linkId;
                    link.rel = "stylesheet";
                    document.head.appendChild(link);

                    if (font === "Pretendard Variable") {
                        link.href = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css";
                    } else {
                        link.href = `https://fonts.googleapis.com/css2?family=${font.replace(/ /g, "+")}:wght@100;200;300;400;500;600;700;800;900&display=swap`;
                    }
                    panelDebug(`[NowPlayingPanelLyrics] Loaded font: ${font}`);
                }
            }
        });
    };

    // 모든 패널 폰트 로드 (개별 폰트만)
    const loadAllPanelFonts = () => {
        const originalFont = getStorageValue(ORIGINAL_FONT_KEY, "") || "";
        const phoneticFont = getStorageValue(PHONETIC_FONT_KEY, "") || "";
        const translationFont = getStorageValue(TRANSLATION_FONT_KEY, "") || "";

        loadGoogleFont(originalFont);
        loadGoogleFont(phoneticFont);
        loadGoogleFont(translationFont);
    };

    // CSS 스타일 주입 함수
    const injectStyles = () => {
        // 폰트 먼저 로드
        loadAllPanelFonts();

        const existingStyle = document.getElementById(PANEL_STYLE_ID);
        if (existingStyle) {
            // 기존 스타일이 있으면 업데이트
            existingStyle.textContent = getPanelStyles();
            stylesInjected = true;
            return;
        }

        const styleElement = document.createElement('style');
        styleElement.id = PANEL_STYLE_ID;
        styleElement.textContent = getPanelStyles();
        document.head.appendChild(styleElement);
        stylesInjected = true;
        panelDebug("[NowPlayingPanelLyrics] Styles injected");
    };

    // 스타일 업데이트 함수 (설정 변경 시 호출)
    const updateStyles = () => {
        // 폰트 로드
        loadAllPanelFonts();

        const styleElement = document.getElementById(PANEL_STYLE_ID);
        if (styleElement) {
            styleElement.textContent = getPanelStyles();
            panelDebug("[NowPlayingPanelLyrics] Styles updated");
        } else {
            injectStyles();
        }
    };

    // CSS 변수 업데이트 함수 (빠른 업데이트용)
    const updateCSSVariables = () => {
        const fontFamily = getStorageValue(FONT_FAMILY_KEY, DEFAULT_FONT_FAMILY) || DEFAULT_FONT_FAMILY;
        const panelWidth = getStorageValue(PANEL_WIDTH_KEY, DEFAULT_PANEL_WIDTH);
        const originalSize = getStorageValue(ORIGINAL_SIZE_KEY, DEFAULT_ORIGINAL_SIZE);
        const phoneticSize = getStorageValue(PHONETIC_SIZE_KEY, DEFAULT_PHONETIC_SIZE);
        const translationSize = getStorageValue(TRANSLATION_SIZE_KEY, DEFAULT_TRANSLATION_SIZE);

        document.documentElement.style.setProperty('--ivlyrics-panel-width', panelWidth + 'px');
        document.documentElement.style.setProperty('--ivlyrics-panel-font-family', `'${fontFamily}', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif`);
        document.documentElement.style.setProperty('--ivlyrics-panel-original-size', originalSize + 'px');
        document.documentElement.style.setProperty('--ivlyrics-panel-phonetic-size', phoneticSize + 'px');
        document.documentElement.style.setProperty('--ivlyrics-panel-translation-size', translationSize + 'px');
    };

    // 현재 가사 상태
    let currentLyricsState = {
        lyrics: [],
        currentIndex: 0,
        isPlaying: false,
        trackUri: null
    };

    const clearInsertTimer = () => {
        if (insertTimer) {
            clearTimeout(insertTimer);
            insertTimer = null;
            moduleState.insertTimer = null;
        }
    };

    const setPanelActiveState = (isActive) => {
        document.body.classList.toggle(PANEL_ACTIVE_BODY_CLASS, isActive);
    };

    const getPlaybackPaused = () => {
        const paused = Spicetify.Player?.data?.isPaused;
        if (typeof paused === "boolean") {
            return paused;
        }
        return !(Spicetify.Player?.isPlaying?.() ?? false);
    };

    const getCurrentPathname = () => {
        try {
            return Spicetify.Platform?.History?.location?.pathname || window.location.pathname || "";
        } catch (error) {
            return window.location.pathname || "";
        }
    };

    const isIvLyricsPageActive = () => {
        const pathname = getCurrentPathname();
        return pathname === '/ivLyrics'
            || pathname.startsWith('/ivLyrics/')
            || document.querySelector('[data-testid="ivlyrics-page"]') !== null;
    };

    const scheduleInsertPanelLyrics = (delay = 100) => {
        clearInsertTimer();
        insertTimer = setTimeout(() => {
            insertTimer = null;
            moduleState.insertTimer = null;
            insertPanelLyrics();
        }, delay);
        moduleState.insertTimer = insertTimer;
    };

    // ============================================
    // 유틸리티 함수
    // ============================================
    const getStorageValue = (key, defaultValue) => {
        try {
            const value = localStorage.getItem(key);
            if (value === null) return defaultValue;
            if (value === "true") return true;
            if (value === "false") return false;
            const num = parseInt(value, 10);
            if (!isNaN(num)) return num;
            return value;
        } catch {
            return defaultValue;
        }
    };

    const getVisualSetting = (name, defaultValue) => {
        const configValue = window.CONFIG?.visual?.[name];
        if (configValue !== undefined && configValue !== null && configValue !== "") {
            return configValue;
        }
        return getStorageValue(`ivLyrics:visual:${name}`, defaultValue);
    };

    const normalizePanelVisibleLineCount = (value) => {
        const numericValue = parseInt(value, 10);
        const lineCount = Number.isFinite(numericValue) && numericValue > 0
            ? numericValue
            : DEFAULT_LINES;
        const visibleLineCount = Math.max(MIN_PANEL_VISIBLE_LINES, lineCount);
        return visibleLineCount % 2 === 0 ? visibleLineCount + 1 : visibleLineCount;
    };

    const translatePanelText = (key, fallback) => {
        try {
            return window.I18n?.t?.(key) || fallback;
        } catch {
            return fallback;
        }
    };

    const getPseudoKaraokeRenderAdvance = () => {
        const configuredAdvance = Number(getVisualSetting("pseudo-karaoke-render-advance", 0));
        return Number.isFinite(configuredAdvance) ? configuredAdvance : 0;
    };

    const setStorageValue = (key, value) => {
        try {
            localStorage.setItem(key, String(value));
        } catch (e) {
            console.error("[NowPlayingPanelLyrics] Storage error:", e);
        }
    };

    // ============================================
    // 노래방 가사 렌더링 헬퍼
    // syllables 또는 vocals 구조에서 syllables 추출
    // ============================================
    const KARAOKE_RTL_STRONG_CHAR_REGEX = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/u;
    const KARAOKE_LTR_STRONG_CHAR_REGEX = /[A-Za-z\u00C0-\u02AF\u0370-\u052F\u1E00-\u1EFF]/u;
    const KARAOKE_JOINING_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/u;
    const KARAOKE_TEXT_RUN_FILL_STEPS = 25;

    const getKaraokeTextDirection = (text) => {
        const normalizedText = typeof text === "string" ? text : "";
        let rtlCount = 0;
        let ltrCount = 0;

        for (const char of Array.from(normalizedText)) {
            if (KARAOKE_RTL_STRONG_CHAR_REGEX.test(char)) {
                rtlCount++;
                continue;
            }
            if (KARAOKE_LTR_STRONG_CHAR_REGEX.test(char)) {
                ltrCount++;
            }
        }

        return rtlCount > ltrCount ? "rtl" : "ltr";
    };

    const shouldUseKaraokeTextRun = (text) => {
        const normalizedText = typeof text === "string" ? text : "";
        return KARAOKE_RTL_STRONG_CHAR_REGEX.test(normalizedText) ||
            KARAOKE_JOINING_SCRIPT_REGEX.test(normalizedText);
    };

    const getKaraokeSyllablesText = (syllables) => (
        Array.isArray(syllables)
            ? syllables.map((syllable) => syllable?.text || "").join("")
            : ""
    );

    const toKaraokeFiniteTime = (value, fallback = 0) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    };

    const getKaraokeTextRunFill = (segment, currentTime) => {
        const startTime = toKaraokeFiniteTime(segment?.startTime, 0);
        const endTime = toKaraokeFiniteTime(segment?.endTime, startTime);
        if (currentTime <= startTime) return 0;
        if (currentTime >= endTime) return 100;

        const raw = Math.max(0, Math.min(1, (currentTime - startTime) / Math.max(1, endTime - startTime)));
        return Math.round(raw * KARAOKE_TEXT_RUN_FILL_STEPS) * (100 / KARAOKE_TEXT_RUN_FILL_STEPS);
    };

    const buildKaraokeTextRunSegments = (syllables) => {
        if (!Array.isArray(syllables) || syllables.length === 0) return [];

        const segments = [];
        let currentSegment = null;

        const flushSegment = () => {
            if (!currentSegment || currentSegment.text.length === 0) {
                currentSegment = null;
                return;
            }
            segments.push(currentSegment);
            currentSegment = null;
        };

        syllables.forEach((syllable) => {
            const text = syllable?.text || "";
            if (!text) return;

            const type = /^\s+$/u.test(text) ? "space" : "text";
            const startTime = toKaraokeFiniteTime(syllable?.startTime, currentSegment?.endTime ?? 0);
            const endTime = toKaraokeFiniteTime(syllable?.endTime, startTime);

            if (!currentSegment || currentSegment.type !== type) {
                flushSegment();
                currentSegment = {
                    type,
                    startIndex: segments.length,
                    text: "",
                    startTime,
                    endTime
                };
            }

            currentSegment.text += text;
            currentSegment.startTime = Math.min(currentSegment.startTime, startTime);
            currentSegment.endTime = Math.max(currentSegment.endTime, endTime);
        });

        flushSegment();
        return segments;
    };
    const splitRenderableSyllables = (syllables) => {
        if (!Array.isArray(syllables) || syllables.length === 0) return [];

        return syllables.flatMap((syllable) => {
            const text = syllable?.text || '';
            if (!text || !/\s/.test(text) || text.trim() === '') {
                return syllable;
            }

            return text
                .split(/(\s+)/)
                .filter((part) => part !== '')
                .map((part) => ({
                    ...syllable,
                    text: part
                }));
        });
    };

    const getSyllablesFromLine = (line) => {
        if (line.syllables && line.syllables.length > 0) {
            return splitRenderableSyllables(line.syllables);
        }
        if (line.vocals?.lead?.syllables) {
            // lead와 background 병합
            const allSyllables = [...line.vocals.lead.syllables];
            if (line.vocals.background) {
                line.vocals.background.forEach(bg => {
                    if (bg.syllables) {
                        allSyllables.push(...bg.syllables);
                    }
                });
            }
            // startTime 기준 정렬 후 렌더링용으로 공백 분리
            return splitRenderableSyllables(allSyllables.sort((a, b) => a.startTime - b.startTime));
        }
        return [];
    };

    const TEXT_EFFECT_KIND_CLASSES = new Set([
        'effect',
        'adlib',
        'pulse',
        'wave',
        'sparkle',
        'echo',
        'whisper',
        'bounce',
        'sway',
        'glow',
        'glitch',
        'flicker',
        'float',
        'blur',
        'pop'
    ]);

    const areTextEffectsEnabled = () => getVisualSetting('karaoke-text-effects', true) !== false;

    const getTextEffectKindClassParts = (kind) => {
        const kindClass = String(kind || '').trim().toLowerCase();
        if (!kindClass) return [];

        const classes = [kindClass];
        if (TEXT_EFFECT_KIND_CLASSES.has(kindClass) && !areTextEffectsEnabled()) {
            classes.push('text-effects-disabled');
        }
        return classes;
    };

    const getVocalRowsFromLine = (line) => {
        if (!line?.vocals?.lead?.syllables) return null;
        const normalizeSpeakerClass = (speaker) => String(speaker || '')
            .trim()
            .toLowerCase()
            .replace(/[_\s]+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
        const rows = [{
            key: 'lead',
            role: line.vocals.lead.role || 'lead',
            speaker: line.vocals.lead.speaker || '',
            kind: line.vocals.lead.kind || 'vocal',
            speakerClass: normalizeSpeakerClass(line.vocals.lead.speaker),
            phonetic: line.vocals.lead.phonetic || '',
            translation: line.vocals.lead.translation || '',
            syllables: splitRenderableSyllables(line.vocals.lead.syllables)
        }];

        if (Array.isArray(line.vocals.background)) {
            line.vocals.background.forEach((part, index) => {
                if (Array.isArray(part?.syllables) && part.syllables.length > 0) {
                    rows.push({
                        key: part.id || `background-${index}`,
                        role: 'background',
                        speaker: part.speaker || '',
                        kind: part.kind || 'vocal',
                        speakerClass: normalizeSpeakerClass(part.speaker),
                        phonetic: part.phonetic || '',
                        translation: part.translation || '',
                        syllables: splitRenderableSyllables(part.syllables)
                    });
                }
            });
        }

        return rows.length > 1 ? rows : null;
    };

    const splitLineByParallelShape = (text, rowCount) => {
        const value = typeof text === 'string' ? text.trim() : '';
        if (!value || rowCount <= 1) return [];

        const separatorParts = value.split(/\s*[\/|／｜]\s*/).filter(Boolean);
        if (separatorParts.length === rowCount) {
            return separatorParts;
        }

        const chars = Array.from(value);
        const lead = [];
        const background = [];
        let depth = 0;
        chars.forEach((char) => {
            if (char === '(') {
                depth++;
                return;
            }
            if (char === ')') {
                depth = Math.max(0, depth - 1);
                return;
            }
            if (depth > 0) {
                background.push(char);
            } else {
                lead.push(char);
            }
        });

        if (rowCount === 2 && background.join('').trim()) {
            return [lead.join('').trim(), background.join('').trim()];
        }

        return [];
    };

    const INTERLUDE_MIN_DURATION_MS = 500;
    const KARAOKE_TRAILING_INTERLUDE_DELAY_MS = 2500;
    const INTERLUDE_MARKER_REGEX = /^[\s\u00A0\u200B-\u200D\uFEFF\u2669-\u266C]+$/;
    const INSTRUMENTAL_BREAK_ICON_DESIGNS = new Set([
        "equalizer",
        "dotWave",
        "ripples",
        "orbit",
        "diamonds",
        "scan",
        "arcs",
        "signal",
        "pulseDot",
        "stack",
        "spark",
        "splitBars",
        "metronome",
        "vinyl",
        "beat",
        "reels",
        "triangle",
        "morph",
        "strings",
        "piano",
        "bloom",
        "speaker",
        "crossfade",
    ]);

    const getInstrumentalBreakSettings = () => {
        const configuredIcon = getVisualSetting("instrumental-break-icon", "equalizer") || "equalizer";
        const speed = Number(getVisualSetting("instrumental-break-animation-speed", 100));
        const safeSpeed = Number.isFinite(speed) ? Math.max(50, Math.min(200, speed)) : 100;
        const duration = Math.round(1100 * (100 / safeSpeed));
        const labelFontFamily = getVisualSetting("instrumental-break-label-font-family", "") ||
            getVisualSetting("panel-lyrics-original-font", "") ||
            getVisualSetting("original-font-family", "") ||
            "var(--ivlyrics-panel-original-font, var(--font-family))";
        const getLabelNumber = (settingKey, fallback, min, max) => {
            const settingValue = getVisualSetting(settingKey, fallback);
            const fallbackValue = settingValue !== undefined && settingValue !== null && settingValue !== ""
                ? settingValue
                : fallback;
            const numericValue = Number(fallbackValue);
            const safeValue = Number.isFinite(numericValue) ? numericValue : fallback;

            return Math.max(min, Math.min(max, safeValue));
        };

        return {
            icon: INSTRUMENTAL_BREAK_ICON_DESIGNS.has(configuredIcon) ? configuredIcon : "equalizer",
            showLabel: getVisualSetting("instrumental-break-show-label", false) === true,
            style: {
                "--break-duration": `${duration}ms`,
                "--break-duration-fast": `${Math.round(duration * 0.72)}ms`,
                "--break-duration-slow": `${Math.round(duration * 1.65)}ms`,
                "--break-duration-xslow": `${Math.round(duration * 3.8)}ms`,
                "--break-label-font-family": labelFontFamily,
                "--break-label-font-size": `${getLabelNumber("instrumental-break-label-font-size", 12, 12, 128)}px`,
                "--break-label-font-weight": getLabelNumber("instrumental-break-label-font-weight", 200, 100, 900),
                "--break-label-opacity": getLabelNumber("instrumental-break-label-opacity", 65, 0, 100) / 100,
            },
        };
    };

    const getInstrumentalBreakKind = (lineIndex, lineCount) => {
        if (lineIndex === 0) return "prelude";
        if (lineIndex === Math.max(0, lineCount - 1)) return "postlude";
        return "break";
    };

    const getInstrumentalBreakLabel = (kind) => {
        const key = kind === "prelude"
            ? "settingsAdvanced.instrumentalBreak.labels.prelude"
            : kind === "postlude"
                ? "settingsAdvanced.instrumentalBreak.labels.postlude"
                : "settingsAdvanced.instrumentalBreak.labels.break";

        return translatePanelText(key, kind === "prelude" ? "Intro" : kind === "postlude" ? "Outro" : "Break");
    };

    const getPlainLyricText = (value) => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (Array.isArray(value)) return value.map(getPlainLyricText).join('');

        if (typeof value === 'object') {
            if (value.props?.children !== undefined) return getPlainLyricText(value.props.children);
            if (typeof value.originalText === 'string') return value.originalText;
            if (typeof value.text === 'string') return value.text;
            if (typeof value.word === 'string') return value.word;
            if (Array.isArray(value.syllables)) return value.syllables.map(getPlainLyricText).join('');
            if (Array.isArray(value.vocals?.lead?.syllables)) {
                const lead = value.vocals.lead.syllables.map(getPlainLyricText).join('');
                const background = Array.isArray(value.vocals.background)
                    ? value.vocals.background
                        .flatMap(entry => Array.isArray(entry?.syllables) ? entry.syllables : [])
                        .map(getPlainLyricText)
                        .join('')
                    : '';
                return lead || background;
            }
        }

        return '';
    };

    const getInterludeCandidateText = (line) => {
        if (!line) return '';
        if (line.originalText !== undefined) return getPlainLyricText(line.originalText);
        if (line.text !== undefined) return getPlainLyricText(line.text);
        return getPlainLyricText(line);
    };

    const isInterludeMarkerText = (text) => {
        const normalized = String(text ?? '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/<[^>]+>/g, '')
            .trim();

        return !normalized || INTERLUDE_MARKER_REGEX.test(normalized);
    };

    const toFiniteTime = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };

    const getCurrentTrackDurationMs = () => {
        if (typeof Spicetify === "undefined") {
            return null;
        }

        return toFiniteTime(Spicetify.Player?.data?.item?.duration?.milliseconds);
    };

    const getLastSyllableEndTime = (line) => {
        let lastEndTime = null;
        const lineEndTime = toFiniteTime(line?.endTime);

        getSyllablesFromLine(line).forEach((syllable) => {
            const syllableStart = toFiniteTime(syllable?.startTime);
            const syllableEnd = toFiniteTime(syllable?.endTime)
                ?? (lineEndTime !== null && syllableStart !== null && lineEndTime >= syllableStart ? lineEndTime : null)
                ?? syllableStart;

            if (syllableEnd !== null) {
                lastEndTime = lastEndTime === null ? syllableEnd : Math.max(lastEndTime, syllableEnd);
            }
        });

        return lastEndTime;
    };

    const getInterludeInfo = (line, lineIndex = -1, lineCount = 0) => {
        const startTime = toFiniteTime(line?.startTime);
        if (startTime === null || !isInterludeMarkerText(getInterludeCandidateText(line))) {
            return { isInterlude: false, durationMs: 0 };
        }

        const endTime = toFiniteTime(line?.endTime);
        const durationMs = endTime !== null && endTime > startTime ? endTime - startTime : 0;

        return {
            isInterlude: durationMs > INTERLUDE_MIN_DURATION_MS,
            durationMs,
            kind: getInstrumentalBreakKind(lineIndex, lineCount)
        };
    };

    const getTrailingKaraokeInterludeInfo = (line, nextLine = null, lineIndex = -1, lineCount = 0) => {
        const lyricEndTime = getLastSyllableEndTime(line);
        const startTime = lyricEndTime !== null ? lyricEndTime + KARAOKE_TRAILING_INTERLUDE_DELAY_MS : null;
        const nextStartTime = toFiniteTime(nextLine?.startTime);
        const trackEndTime = lineIndex === Math.max(0, lineCount - 1) ? getCurrentTrackDurationMs() : null;
        const endTime = nextStartTime ?? trackEndTime;
        const durationMs = startTime !== null && endTime !== null && endTime > startTime
            ? endTime - startTime
            : 0;

        return {
            isInterlude: durationMs > INTERLUDE_MIN_DURATION_MS,
            durationMs,
            startTime,
            endTime,
            kind: lineIndex >= Math.max(0, lineCount - 1) ? "postlude" : "break",
            source: "karaoke-trailing-gap"
        };
    };

    const getTrailingKaraokeInterludeKey = (lineIndex, interludeInfo) => {
        if (!interludeInfo?.isInterlude) return null;
        return `${lineIndex}:${interludeInfo.startTime}:${interludeInfo.endTime}`;
    };

    // ============================================
    // 노래방 단어 컴포넌트 (개별 syllable)
    // DOM 직접 조작으로 리렌더링 없이 하이라이트
    // ============================================
    const KaraokeWord = memo(({ syllable, idx, isLinePast }) => {
        const wordRef = useRef(null);
        const text = syllable.text || '';

        // 외부에서 시간 업데이트 시 클래스만 토글 (리렌더링 없음)
        useEffect(() => {
            if (!wordRef.current) return;

            const updateSungState = () => {
                const el = wordRef.current;
                if (!el) return;

                // isLinePast가 true면 항상 sung
                if (isLinePast) {
                    if (!el.classList.contains('sung')) {
                        el.classList.add('sung');
                    }
                    return;
                }

                // 현재 시간과 비교 (ref에서 직접 읽음)
                const currentTime = window._ivLyricsPanelCurrentTime || 0;
                const shouldBeSung = currentTime >= syllable.startTime;

                if (shouldBeSung && !el.classList.contains('sung')) {
                    el.classList.add('sung');
                } else if (!shouldBeSung && el.classList.contains('sung')) {
                    el.classList.remove('sung');
                }
            };

            // 초기 상태 설정
            updateSungState();

            // 커스텀 이벤트로 업데이트 수신
            window.addEventListener('ivlyrics-panel-time-update', updateSungState);
            return () => {
                window.removeEventListener('ivlyrics-panel-time-update', updateSungState);
            };
        }, [syllable.startTime, isLinePast]);

        // 텍스트가 비어있으면 렌더링하지 않음
        if (!text) return null;

        // 공백만 있는 경우 공백 span 반환
        if (text.trim() === '') {
            return react.createElement("span", {
                key: `space-${idx}`,
                className: "ivlyrics-panel-karaoke-space"
            }, " ");
        }

        // 텍스트에 공백이 포함된 경우 그대로 렌더링 (공백 유지)
        return react.createElement("span", {
            key: idx,
            ref: wordRef,
            className: `ivlyrics-panel-karaoke-word ${isLinePast ? 'sung' : ''}`
        }, text);
    });

    const KaraokeTextRunSegment = memo(({ segment, idx, isLinePast, textDirection }) => {
        const segmentRef = useRef(null);
        const text = segment?.text || "";
        const segmentDirection = getKaraokeTextDirection(text) || textDirection || "ltr";
        const gradientDirection = segmentDirection === "rtl" ? "to left" : "to right";

        useEffect(() => {
            if (!segmentRef.current || !text || segment?.type === "space") return;

            const updateSegmentState = () => {
                const el = segmentRef.current;
                if (!el) return;

                const currentTime = window._ivLyricsPanelCurrentTime || 0;
                const fill = isLinePast ? 100 : getKaraokeTextRunFill(segment, currentTime);
                const isDone = fill >= 100;
                const isActive = fill > 0 && fill < 100;

                el.classList.toggle("sung", isDone);
                el.classList.toggle("active", isActive);

                if (isActive) {
                    const softEdge = 10;
                    el.style.setProperty("--ivlyrics-panel-karaoke-gradient-direction", gradientDirection);
                    el.style.setProperty("--ivlyrics-panel-karaoke-fill", String(fill) + "%");
                    el.style.setProperty("--ivlyrics-panel-karaoke-fill-soft-start", String(Math.max(0, fill - softEdge)) + "%");
                    el.style.setProperty("--ivlyrics-panel-karaoke-fill-soft-end", String(Math.min(100, fill + softEdge)) + "%");
                } else {
                    el.style.removeProperty("--ivlyrics-panel-karaoke-gradient-direction");
                    el.style.removeProperty("--ivlyrics-panel-karaoke-fill");
                    el.style.removeProperty("--ivlyrics-panel-karaoke-fill-soft-start");
                    el.style.removeProperty("--ivlyrics-panel-karaoke-fill-soft-end");
                }
            };

            updateSegmentState();
            window.addEventListener("ivlyrics-panel-time-update", updateSegmentState);
            return () => {
                window.removeEventListener("ivlyrics-panel-time-update", updateSegmentState);
            };
        }, [segment, text, isLinePast, gradientDirection]);

        if (!text) return null;
        if (segment?.type === "space") {
            return react.createElement("span", {
                key: "text-run-space-" + idx,
                className: "ivlyrics-panel-karaoke-text-run-space"
            }, text);
        }

        return react.createElement("span", {
            key: "text-run-" + idx,
            ref: segmentRef,
            className: "ivlyrics-panel-karaoke-text-run-segment " + (isLinePast ? "sung" : ""),
            dir: segmentDirection
        }, text);
    });
    // ============================================
    // 노래방 라인 컴포넌트 (syllables 포함)
    // ============================================
    const KaraokeLine = memo(({ syllables, vocalRows, isActive, isPast, phonetic, translation, lineClass, textEffectRevision = 0 }) => {
        const rowPhonetics = splitLineByParallelShape(phonetic, Array.isArray(vocalRows) ? vocalRows.length : 0);
        const rowTranslations = splitLineByParallelShape(translation, Array.isArray(vocalRows) ? vocalRows.length : 0);
        const renderKaraokeSyllables = (items, keyPrefix, className) => {
            const joinedText = getKaraokeSyllablesText(items);

            if (shouldUseKaraokeTextRun(joinedText)) {
                const textDirection = getKaraokeTextDirection(joinedText);
                const segments = buildKaraokeTextRunSegments(items);
                const renderSegments = textDirection === "rtl" ? [...segments].reverse() : segments;

                return react.createElement("div", {
                    className: className + " is-text-run " + (textDirection === "rtl" ? "is-rtl" : ""),
                    dir: textDirection === "rtl" ? "ltr" : textDirection
                },
                    renderSegments.map((segment, idx) =>
                        react.createElement(KaraokeTextRunSegment, {
                            key: keyPrefix + "-text-run-" + segment.startIndex + "-" + idx,
                            segment,
                            idx,
                            isLinePast: isPast,
                            textDirection
                        })
                    )
                );
            }

            return react.createElement("div", { className },
                items.map((syllable, idx) =>
                    react.createElement(KaraokeWord, {
                        key: keyPrefix + "-" + idx,
                        syllable,
                        idx,
                        isLinePast: isPast
                    })
                )
            );
        };

        const karaokeContent = Array.isArray(vocalRows) && vocalRows.length > 1
            ? react.createElement("div", { className: "ivlyrics-panel-line-karaoke ivlyrics-panel-line-karaoke-stack" },
                vocalRows.map((row, rowIndex) => {
                    const rowKindClasses = getTextEffectKindClassParts(row.kind);
                    const rowKey = row.key || "row-" + rowIndex;
                    const rowClassName = "ivlyrics-panel-line-karaoke-row " + (row.role || "") + " " + rowKindClasses.join(" ") + " " + (row.speakerClass ? "speaker-" + row.speakerClass : "");
                    return (
                    react.createElement("div", {
                        key: rowKey,
                        className: "ivlyrics-panel-line-karaoke-part " + (row.role || "") + " " + rowKindClasses.join(" ") + " " + (row.speakerClass ? "speaker-" + row.speakerClass : "")
                    },
                        renderKaraokeSyllables(row.syllables, rowKey, rowClassName),
                        (row.phonetic || rowPhonetics[rowIndex]) && react.createElement("div", {
                            className: "ivlyrics-panel-line-phonetic"
                        }, row.phonetic || rowPhonetics[rowIndex]),
                        (row.translation || rowTranslations[rowIndex]) && react.createElement("div", {
                            className: "ivlyrics-panel-line-translation"
                        }, row.translation || rowTranslations[rowIndex])
                    )
                    );
                })
            )
            : renderKaraokeSyllables(syllables, "main", "ivlyrics-panel-line-karaoke");

        return react.createElement("div", { className: lineClass },
            // 노래방 가사 (글자별 타이밍)
            karaokeContent,
            // 발음
            !(Array.isArray(vocalRows) && vocalRows.length > 1) && phonetic && react.createElement("div", {
                className: "ivlyrics-panel-line-phonetic"
            }, phonetic),
            // 번역
            !(Array.isArray(vocalRows) && vocalRows.length > 1) && translation && react.createElement("div", {
                className: "ivlyrics-panel-line-translation"
            }, translation)
        );
    }, (prevProps, nextProps) => {
        // 라인 상태가 바뀔 때만 리렌더링
        return prevProps.isActive === nextProps.isActive &&
            prevProps.isPast === nextProps.isPast &&
            prevProps.lineClass === nextProps.lineClass &&
            prevProps.textEffectRevision === nextProps.textEffectRevision &&
            prevProps.phonetic === nextProps.phonetic &&
            prevProps.translation === nextProps.translation &&
            prevProps.vocalRows === nextProps.vocalRows;
    });

    const createBreakIconChildren = (icon) => {
        const span = (key, props = {}) => react.createElement("span", { key, ...props });

        switch (icon) {
            case "dotWave":
                return [0, 1, 2, 3, 4].map((index) => span(index));
            case "ripples":
            case "orbit":
            case "vinyl":
                return span("main");
            case "diamonds":
            case "stack":
                return [0, 1, 2].map((index) => span(index));
            case "signal":
                return react.createElement(
                    "svg",
                    { viewBox: "0 0 112 32", "aria-hidden": "true" },
                    react.createElement("path", {
                        d: "M2 18 H20 L26 9 L34 25 L43 14 L50 18 H68 L74 9 L82 25 L91 14 L98 18 H110",
                    })
                );
            case "spark":
                return [0, 1, 2, 3, 4, 5, 6, 7].map((index) => span(index, { style: { "--i": index } }));
            case "splitBars":
            case "strings":
                return [0, 1, 2, 3].map((index) => span(index));
            case "reels":
                return [0, 1].map((index) => span(index));
            case "piano":
                return [0, 1, 2, 3, 4].map((index) => span(index));
            case "bloom":
                return [0, 1, 2, 3].map((index) => span(index));
            case "scan":
            case "arcs":
            case "pulseDot":
            case "metronome":
            case "beat":
            case "triangle":
            case "morph":
            case "speaker":
            case "crossfade":
                return null;
            case "equalizer":
            default:
                return [0, 1, 2, 3].map((index) => span(index));
        }
    };

    const InterludeLine = memo(({ durationMs, kind, lineClass, settingsRevision = 0 }) => {
        const settings = getInstrumentalBreakSettings();
        const label = getInstrumentalBreakLabel(kind || "break");

        return react.createElement("div", { className: `${lineClass} interlude` },
            react.createElement("div", {
                className: `ivlyrics-panel-line-interlude lyrics-break-indicator lyrics-break-kind-${kind || "break"}`,
                "aria-label": settings.showLabel ? label : undefined,
                "aria-hidden": settings.showLabel ? undefined : "true",
                style: settings.style
            },
                react.createElement("span", {
                    className: `lyrics-break-icon lyrics-break-icon-${settings.icon}`
                }, createBreakIconChildren(settings.icon)),
                settings.showLabel && react.createElement("span", { className: "lyrics-break-label" }, label)
            )
        );
    }, (prevProps, nextProps) => {
        return prevProps.lineClass === nextProps.lineClass &&
            prevProps.durationMs === nextProps.durationMs &&
            prevProps.kind === nextProps.kind &&
            prevProps.settingsRevision === nextProps.settingsRevision;
    });

    // ============================================
    // 일반 가사 라인 컴포넌트
    // ============================================
    const NormalLine = memo(({ displayText, phonetic, translation, lineClass }) => {
        return react.createElement("div", { className: lineClass },
            react.createElement("div", {
                className: "ivlyrics-panel-line-text",
                dangerouslySetInnerHTML: displayText ? { __html: displayText } : undefined
            }, displayText ? undefined : " "),
            phonetic && react.createElement("div", {
                className: "ivlyrics-panel-line-phonetic"
            }, phonetic),
            translation && react.createElement("div", {
                className: "ivlyrics-panel-line-translation"
            }, translation)
        );
    }, (prevProps, nextProps) => {
        return prevProps.lineClass === nextProps.lineClass &&
            prevProps.displayText === nextProps.displayText &&
            prevProps.phonetic === nextProps.phonetic &&
            prevProps.translation === nextProps.translation;
    });

    // ============================================
    // 가사 라인 컴포넌트 (Apple Music 스타일)
    // 노래방 가사와 일반 가사 모두 지원
    // ============================================
    const LyricLine = memo(({ line, lineIndex, lineCount, isActive, isPast, isFuture, translation, phonetic, isPlaceholder, instrumentalBreakRevision = 0, textEffectRevision = 0 }) => {
        const speakerClass = String(line?.speaker || '')
            .trim()
            .toLowerCase()
            .replace(/[_\s]+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
        const lineKindClasses = getTextEffectKindClassParts(line?.kind);
        const lineClass = `ivlyrics-panel-line ${isActive ? 'active' : ''} ${isPast ? 'past' : ''} ${isFuture ? 'future' : ''} ${isPlaceholder ? 'placeholder' : ''} ${lineKindClasses.join(' ')} ${speakerClass ? `speaker-${speakerClass}` : ''}`;
        const interludeInfo = isPlaceholder ? { isInterlude: false, durationMs: 0 } : (line?.interludeInfo || getInterludeInfo(line, lineIndex, lineCount));

        // 노래방 가사인지 확인
        const vocalRows = useMemo(() => getVocalRowsFromLine(line), [line]);
        const syllables = useMemo(() => vocalRows?.[0]?.syllables || getSyllablesFromLine(line), [line, vocalRows]);
        const isKaraoke = syllables.length > 0;
        const displayText = line.originalText || line.text || '';

        if (interludeInfo.isInterlude) {
            if (!isActive) {
                return react.createElement("div", {
                    className: `${lineClass} interlude`,
                    "aria-hidden": "true"
                });
            }

            return react.createElement(InterludeLine, {
                durationMs: interludeInfo.durationMs,
                kind: interludeInfo.kind || "break",
                lineClass,
                settingsRevision: instrumentalBreakRevision
            });
        }

        // 노래방 가사인 경우
        if (isKaraoke) {
            return react.createElement(KaraokeLine, {
                syllables,
                vocalRows,
                isActive,
                isPast,
                phonetic,
                translation,
                lineClass,
                textEffectRevision
            });
        }

        // 일반 가사
        return react.createElement(NormalLine, {
            displayText,
            phonetic,
            translation,
            lineClass
        });
    }, (prevProps, nextProps) => {
        // currentTime 제거됨 - 라인 상태 변경 시에만 리렌더링
        return prevProps.isActive === nextProps.isActive &&
            prevProps.isPast === nextProps.isPast &&
            prevProps.isFuture === nextProps.isFuture &&
            prevProps.isPlaceholder === nextProps.isPlaceholder &&
            prevProps.translation === nextProps.translation &&
            prevProps.phonetic === nextProps.phonetic &&
            prevProps.lineIndex === nextProps.lineIndex &&
            prevProps.lineCount === nextProps.lineCount &&
            prevProps.instrumentalBreakRevision === nextProps.instrumentalBreakRevision &&
            prevProps.textEffectRevision === nextProps.textEffectRevision &&
            prevProps.line === nextProps.line;
    });

    // ============================================
    // 패널 가사 메인 컴포넌트
    // ============================================
    const PanelLyrics = () => {
        const [lyrics, setLyrics] = useState([]);
        const [karaokeSource, setKaraokeSource] = useState(null);
        const [currentIndex, setCurrentIndex] = useState(0);
        const [activeTrailingInterludeKey, setActiveTrailingInterludeKey] = useState(null);
        // currentTime은 더 이상 상태로 관리하지 않음 - 전역 변수 사용
        const [trackOffset, setTrackOffset] = useState(0); // 곡별 싱크 오프셋
        const [globalOffset, setGlobalOffset] = useState(() => window.Utils?.getGlobalSyncOffset?.() || 0);
        const [pseudoKaraokeAdvanceMs, setPseudoKaraokeAdvanceMs] = useState(getPseudoKaraokeRenderAdvance());
        const [isEnabled, setIsEnabled] = useState(getStorageValue(STORAGE_KEY, DEFAULT_ENABLED));
        const [numLines, setNumLines] = useState(() => normalizePanelVisibleLineCount(getStorageValue(PANEL_LINES_KEY, DEFAULT_LINES)));
        const [fontScale, setFontScale] = useState(parseInt(getStorageValue(FONT_SCALE_KEY, DEFAULT_FONT_SCALE), 10));
        const [instrumentalBreakRevision, setInstrumentalBreakRevision] = useState(0);
        const [textEffectRevision, setTextEffectRevision] = useState(0);
        const [isPlaybackPaused, setIsPlaybackPaused] = useState(getPlaybackPaused);
        const containerRef = useRef(null);
        const scrollRef = useRef(null);
        const lastTrackUri = useRef(null);
        const loadingRef = useRef(false);
        const loadSeqRef = useRef(0);

        const isActiveLoad = useCallback((loadSeq, trackUri) => {
            return loadSeqRef.current === loadSeq && Spicetify.Player.data?.item?.uri === trackUri;
        }, []);

        // LyricsService Extension을 사용해서 가사 직접 불러오기
        // 1단계: 가사 먼저 로드 → 2단계: 발음/번역 따로 요청
        const loadLyricsFromExtension = useCallback(async (forceReload = false, requestedTrackUri = null) => {
            // 이미 로딩 중이면 스킵
            if (loadingRef.current && !forceReload) return;

            // LyricsService Extension이 로드될 때까지 대기
            let retries = 0;
            while (!window.LyricsService && retries < 20) {
                await new Promise(resolve => setTimeout(resolve, 300));
                retries++;
            }

            if (!window.LyricsService) {
                console.warn("[PanelLyrics] LyricsService Extension not loaded");
                return;
            }

            // 현재 트랙 정보 가져오기
            const item = Spicetify.Player.data?.item;
            if (!item) return;

            const trackUri = item.uri;

            // requestedTrackUri가 제공된 경우, 현재 재생 중인 트랙과 일치하는지 확인
            // (곡이 빠르게 변경될 때 이전 요청을 무시하기 위함)
            if (requestedTrackUri && requestedTrackUri !== trackUri) {
                panelDebug("[PanelLyrics] Track changed during delay, skipping load for:", requestedTrackUri);
                return;
            }

            // 같은 트랙이면 스킵 (forceReload가 아닌 경우)
            if (!forceReload && trackUri === lastTrackUri.current) {
                return;
            }

            loadingRef.current = true;
            lastTrackUri.current = trackUri;

            // 로딩 시작 시점의 트랙 URI를 캡처 (비동기 작업 완료 후 검증용)
            const loadingForTrackUri = trackUri;
            const loadSeq = ++loadSeqRef.current;

            const trackInfo = {
                uri: trackUri,
                title: item.name,
                artist: item.artists?.map(a => a.name).join(', ') || '',
                album: item.album?.name || '',
                duration: item.duration?.milliseconds || 0,
                trackId: trackUri?.split(':')[2]
            };

            panelDebug("[PanelLyrics] Loading lyrics for:", trackInfo.title);

            try {
                // ==========================================
                // 1단계: 가사만 먼저 로드 (빠르게 표시)
                // ==========================================
                // LyricsAddonManager를 통해 가사 로드
                const result = await window.LyricsService.getLyricsFromProviders(trackInfo);
                if (!isActiveLoad(loadSeq, loadingForTrackUri)) {
                    panelDebug("[PanelLyrics] Track changed during lyrics fetch, discarding result for:", loadingForTrackUri);
                    return;
                }

                if (result && !result.error) {
                    // 비동기 작업 완료 후 현재 재생 중인 트랙이 로딩을 시작한 트랙과 일치하는지 검증
                    const currentPlayingUri = Spicetify.Player.data?.item?.uri;
                    if (currentPlayingUri !== loadingForTrackUri || !isActiveLoad(loadSeq, loadingForTrackUri)) {
                        panelDebug("[PanelLyrics] Track changed during lyrics fetch, discarding result for:", loadingForTrackUri);
                        return;
                    }

                    // karaoke (노래방) → synced → unsynced 순서로 선택
                    let lyricsData = result.karaoke || result.synced || result.unsynced || [];
                    const isKaraoke = !!result.karaoke;
                    const nextKaraokeSource = result.karaokeSource || null;

                    if (lyricsData.length > 0) {
                        // endTime 계산 (없으면 다음 라인의 startTime 사용)
                        lyricsData = lyricsData.map((line, idx, arr) => {
                            if (!line.endTime && idx < arr.length - 1) {
                                return { ...line, endTime: arr[idx + 1].startTime };
                            }
                            if (!line.endTime && idx === arr.length - 1 && trackInfo.duration > line.startTime) {
                                return { ...line, endTime: trackInfo.duration };
                            }
                            return line;
                        });

                        panelDebug("[PanelLyrics] Got lyrics:", lyricsData.length, "lines, karaoke:", isKaraoke);
                        if (isKaraoke && lyricsData[0]) {
                            panelDebug("[PanelLyrics] Karaoke sample:", lyricsData[0].syllables || lyricsData[0].vocals);
                        }

                        setLyrics(lyricsData);
                        setKaraokeSource(nextKaraokeSource);
                        currentLyricsState.lyrics = lyricsData;
                        currentLyricsState.trackUri = loadingForTrackUri;
                        setCurrentIndex(0);
                        setActiveTrailingInterludeKey(null);

                        // 곡별 싱크 오프셋 가져오기
                        if (window.TrackSyncDB?.getOffset) {
                            const offset = await window.TrackSyncDB.getOffset(trackUri);
                            if (!isActiveLoad(loadSeq, loadingForTrackUri)) {
                                return;
                            }
                            setTrackOffset(offset || 0);
                            panelDebug("[PanelLyrics] Track offset:", offset || 0);
                        }

                        // ==========================================
                        // 2단계: 발음/번역 비동기 요청 (가사 표시 후)
                        // ==========================================
                        loadTranslationAsync(trackInfo, lyricsData, result.provider, loadSeq);
                    } else {
                        panelDebug("[PanelLyrics] No lyrics in result");
                        setLyrics([]);
                        setKaraokeSource(null);
                        currentLyricsState.lyrics = [];
                    }
                } else {
                    panelDebug("[PanelLyrics] No lyrics found:", result?.error);
                    setLyrics([]);
                    setKaraokeSource(null);
                    currentLyricsState.lyrics = [];
                }
            } catch (error) {
                console.error("[PanelLyrics] Failed to load lyrics:", error);
                if (isActiveLoad(loadSeq, loadingForTrackUri)) {
                    setLyrics([]);
                    setKaraokeSource(null);
                }
            } finally {
                if (loadSeqRef.current === loadSeq) {
                    loadingRef.current = false;
                }
            }
        }, []);

        // 발음/번역 비동기 로드 (가사 표시 후 백그라운드에서)
        // 사용자 설정에 따라 발음/번역 요청 여부 결정
        const loadTranslationAsync = useCallback(async (trackInfo, lyricsData, provider, loadSeq) => {
            if (!window.Translator?.callGemini) {
                panelDebug("[PanelLyrics] Translator not available");
                return;
            }

            try {
                if (!isActiveLoad(loadSeq, trackInfo.uri)) {
                    return;
                }

                // 가사 언어 감지
                const lyricsText = lyricsData.map(l => l.text || '').join('\n');
                const trackId = trackInfo.trackId;

                // 언어 감지 (LyricsService.detectLanguage 사용)
                // modeKey는 CONFIG의 translation-mode 키와 동일해야 함 (예: "japanese", "korean")
                // LyricsService.detectLanguage는 언어 코드(ja, ko, zh 등)를 반환
                const langCodeToKey = {
                    'ja': 'japanese',
                    'ko': 'korean',
                    'zh': 'chinese',
                    'ru': 'russian',
                    'vi': 'vietnamese',
                    'de': 'german',
                    'es': 'spanish',
                    'fr': 'french',
                    'it': 'italian',
                    'pt': 'portuguese',
                    'nl': 'dutch',
                    'pl': 'polish',
                    'tr': 'turkish',
                    'ar': 'arabic',
                    'hi': 'hindi',
                    'th': 'thai',
                    'id': 'indonesian',
                    'en': 'english'
                };

                let modeKey = 'english';
                try {
                    if (window.LyricsService?.detectLanguage) {
                        // LyricsService.detectLanguage는 배열을 받음
                        const detected = window.LyricsService.detectLanguage(lyricsData);
                        if (detected && langCodeToKey[detected]) {
                            modeKey = langCodeToKey[detected];
                        }
                        panelDebug(`[PanelLyrics] Detected language code: ${detected} -> modeKey: ${modeKey}`);
                    } else {
                        // 폴백: 간단한 유니코드 감지
                        if (/[\u3040-\u309F\u30A0-\u30FF]/.test(lyricsText)) {
                            modeKey = 'japanese';
                        } else if (/[\uAC00-\uD7AF]/.test(lyricsText)) {
                            modeKey = 'korean';
                        } else if (/[\u4E00-\u9FFF]/.test(lyricsText)) {
                            modeKey = 'chinese';
                        } else if (/[а-яА-ЯёЁ]/.test(lyricsText)) {
                            modeKey = 'russian';
                        }
                        panelDebug(`[PanelLyrics] Fallback language detection: ${modeKey}`);
                    }
                } catch (e) {
                    console.warn("[PanelLyrics] Language detection failed:", e);
                    // 폴백: 간단한 감지
                    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(lyricsText)) {
                        modeKey = 'japanese';
                    } else if (/[\uAC00-\uD7AF]/.test(lyricsText)) {
                        modeKey = 'korean';
                    } else if (/[\u4E00-\u9FFF]/.test(lyricsText)) {
                        modeKey = 'chinese';
                    }
                }

                // 사용자 설정에서 발음/번역 모드 확인
                const displayMode1 = window.CONFIG?.visual?.[`translation-mode:${modeKey}`] ||
                    localStorage.getItem(`ivLyrics:visual:translation-mode:${modeKey}`) || "none";
                const displayMode2 = window.CONFIG?.visual?.[`translation-mode-2:${modeKey}`] ||
                    localStorage.getItem(`ivLyrics:visual:translation-mode-2:${modeKey}`) || "none";

                panelDebug(`[PanelLyrics] Language: ${modeKey}, Mode1: ${displayMode1}, Mode2: ${displayMode2}`);

                // 발음/번역이 모두 비활성화되어 있으면 스킵
                if ((!displayMode1 || displayMode1 === "none") && (!displayMode2 || displayMode2 === "none")) {
                    panelDebug("[PanelLyrics] Translation/phonetic disabled for this language");
                    return;
                }

                // 발음이 필요한지, 번역이 필요한지 확인
                const needPhonetic = displayMode1 === "gemini_romaji" || displayMode2 === "gemini_romaji";
                const needTranslation = (displayMode1 && displayMode1 !== "none" && displayMode1 !== "gemini_romaji") ||
                    (displayMode2 && displayMode2 !== "none" && displayMode2 !== "gemini_romaji");

                panelDebug(`[PanelLyrics] Need phonetic: ${needPhonetic}, Need translation: ${needTranslation}`);

                let phoneticLines = [];
                let translationLines = [];

                // 발음 요청 (필요한 경우에만)
                if (needPhonetic) {
                    panelDebug("[PanelLyrics] Requesting phonetic...");
                    const phoneticResponse = await window.Translator.callGemini({
                        trackId,
                        artist: trackInfo.artist,
                        title: trackInfo.title,
                        text: lyricsText,
                        wantSmartPhonetic: true,
                        provider
                    });
                    if (!isActiveLoad(loadSeq, trackInfo.uri)) {
                        return;
                    }
                    phoneticLines = phoneticResponse?.phonetic || [];
                }

                // 번역 요청 (필요한 경우에만)
                if (needTranslation) {
                    if (!isActiveLoad(loadSeq, trackInfo.uri)) {
                        return;
                    }
                    panelDebug("[PanelLyrics] Requesting translation...");
                    const translationResponse = await window.Translator.callGemini({
                        trackId,
                        artist: trackInfo.artist,
                        title: trackInfo.title,
                        text: lyricsText,
                        wantSmartPhonetic: false,
                        provider
                    });
                    if (!isActiveLoad(loadSeq, trackInfo.uri)) {
                        return;
                    }
                    translationLines = translationResponse?.translation || [];
                }

                // 결과 병합 전에 현재 재생 중인 트랙이 변경되었는지 확인
                const currentPlayingUri = Spicetify.Player.data?.item?.uri;
                if (currentPlayingUri !== trackInfo.uri || !isActiveLoad(loadSeq, trackInfo.uri)) {
                    panelDebug("[PanelLyrics] Track changed during translation, discarding result for:", trackInfo.title);
                    return;
                }

                // 결과 병합
                if (phoneticLines.length > 0 || translationLines.length > 0) {
                    const updatedLyrics = lyricsData.map((line, idx) => {
                        const isKaraokeLine = Array.isArray(line?.syllables)
                            || Array.isArray(line?.vocals?.lead?.syllables);
                        const originalText = isKaraokeLine && line?.originalText
                            ? line.originalText
                            : (line?.text || line?.originalText || '');
                        const phoneticText = phoneticLines[idx] || line?.phoneticText || '';

                        return {
                            ...line,
                            originalText,
                            text: isKaraokeLine ? originalText : (phoneticText || line?.text || ''),
                            phoneticText,
                            text2: translationLines[idx] || line?.text2 || ''
                        };
                    });

                    panelDebug("[PanelLyrics] Applied translation:", phoneticLines.length, "phonetic,", translationLines.length, "translation");
                    setLyrics(updatedLyrics);
                    currentLyricsState.lyrics = updatedLyrics;
                }
            } catch (error) {
                console.warn("[PanelLyrics] Translation failed:", error);
                // 발음/번역 실패해도 가사는 이미 표시됨
            }
        }, []);

        // 가사 로드 및 곡 변경 리스너
        useEffect(() => {
            // 곡 변경 시 가사 로드
            const handleSongChange = () => {
                // 곡 변경 이벤트 발생 시점에 트랙 URI 캡처
                const capturedUri = Spicetify.Player.data?.item?.uri;

                // 이전 가사 상태 초기화 (새 곡 전환 중임을 표시)
                loadSeqRef.current += 1;
                loadingRef.current = false;
                lastTrackUri.current = null;
                setLyrics([]);
                setKaraokeSource(null);
                setCurrentIndex(0);
                setActiveTrailingInterludeKey(null);
                currentLyricsState.lyrics = [];
                currentLyricsState.currentIndex = 0;

                // 약간의 딜레이 후 로드 (트랙 정보가 완전히 업데이트될 때까지 대기)
                // 캡처한 URI를 전달하여 딜레이 중 곡이 변경되면 무시
                setTimeout(() => {
                    loadLyricsFromExtension(true, capturedUri);
                }, 300);
            };

            // 설정 변경 리스너
            const handleSettingsChange = (event) => {
                if (event.detail?.name === 'panel-lyrics-enabled') {
                    setIsEnabled(event.detail.value);
                }
                if (event.detail?.name === 'panel-lyrics-lines') {
                    setNumLines(normalizePanelVisibleLineCount(event.detail.value));
                }
                if (event.detail?.name === 'panel-font-scale') {
                    setFontScale(parseInt(event.detail.value, 10) || DEFAULT_FONT_SCALE);
                }
                if (event.detail?.name === 'pseudo-karaoke-render-advance') {
                    setPseudoKaraokeAdvanceMs(Number(event.detail.value) || 0);
                }
                if (event.detail?.name === 'karaoke-text-effects') {
                    setTextEffectRevision((revision) => revision + 1);
                }
                if (event.detail?.name === 'instrumental-break-icon' ||
                    event.detail?.name === 'instrumental-break-show-label' ||
                    event.detail?.name === 'instrumental-break-label-font-family' ||
                    event.detail?.name === 'instrumental-break-label-font-size' ||
                    event.detail?.name === 'instrumental-break-label-font-weight' ||
                    event.detail?.name === 'instrumental-break-label-opacity' ||
                    event.detail?.name === 'instrumental-break-animation-speed' ||
                    event.detail?.name === 'panel-lyrics-original-font' ||
                    event.detail?.name === 'panel-lyrics-original-size' ||
                    event.detail?.name === 'original-font-family' ||
                    event.detail?.name === 'original-font-size' ||
                    event.detail?.name === 'original-font-weight' ||
                    event.detail?.name === 'original-opacity' ||
                    event.detail?.name === 'original-letter-spacing') {
                    setInstrumentalBreakRevision((revision) => revision + 1);
                }
                // 새로운 설정들 처리 - CSS 변수 업데이트
                if (event.detail?.name === 'panel-lyrics-width' ||
                    event.detail?.name === 'panel-lyrics-font-family' ||
                    event.detail?.name === 'panel-lyrics-original-size' ||
                    event.detail?.name === 'panel-lyrics-phonetic-size' ||
                    event.detail?.name === 'panel-lyrics-translation-size') {
                    updateCSSVariables();
                }
            };

            // 싱크 오프셋 변경 리스너
            const handleOffsetChange = (event) => {
                const currentUri = Spicetify.Player.data?.item?.uri;
                if (event.detail?.trackUri === currentUri) {
                    setTrackOffset(event.detail.offset || 0);
                    panelDebug("[PanelLyrics] Offset changed:", event.detail.offset);
                }
            };

            // 곡 변경 리스너
            const handleGlobalOffsetChange = (event) => {
                setGlobalOffset(event.detail?.offset || 0);
                panelDebug("[PanelLyrics] Global offset changed:", event.detail?.offset || 0);
            };

            const handleSyncDataUpdated = (event) => {
                const currentUri = Spicetify.Player.data?.item?.uri;
                const currentTrackId = currentUri?.split(':')[2];
                const detail = event.detail || {};
                if (!currentUri || (detail.trackUri && detail.trackUri !== currentUri) || (detail.trackId && detail.trackId !== currentTrackId)) {
                    return;
                }
                loadSeqRef.current += 1;
                loadingRef.current = false;
                lastTrackUri.current = null;
                loadLyricsFromExtension(true, currentUri);
            };

            const handlePlaybackChange = () => {
                setIsPlaybackPaused(getPlaybackPaused());
            };

            handlePlaybackChange();
            Spicetify.Player.addEventListener('songchange', handleSongChange);
            Spicetify.Player?.addEventListener?.('onplaypause', handlePlaybackChange);
            Spicetify.Player?.addEventListener?.('songchange', handlePlaybackChange);
            window.addEventListener('ivLyrics', handleSettingsChange);
            window.addEventListener('ivLyrics:offset-changed', handleOffsetChange);
            window.addEventListener('ivLyrics:global-offset-changed', handleGlobalOffsetChange);
            window.addEventListener('ivLyrics:sync-data-updated', handleSyncDataUpdated);

            // 초기 로드 (현재 재생 중인 곡)
            loadLyricsFromExtension();

            return () => {
                Spicetify.Player.removeEventListener('songchange', handleSongChange);
                Spicetify.Player?.removeEventListener?.('onplaypause', handlePlaybackChange);
                Spicetify.Player?.removeEventListener?.('songchange', handlePlaybackChange);
                window.removeEventListener('ivLyrics', handleSettingsChange);
                window.removeEventListener('ivLyrics:offset-changed', handleOffsetChange);
                window.removeEventListener('ivLyrics:global-offset-changed', handleGlobalOffsetChange);
                window.removeEventListener('ivLyrics:sync-data-updated', handleSyncDataUpdated);
            };
        }, [loadLyricsFromExtension]);

        // 앨범 색상을 가져와서 카드 배경에 적용
        useEffect(() => {
            // Hex to RGB 변환 헬퍼
            const hexToRgb = (hex) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? {
                    r: parseInt(result[1], 16),
                    g: parseInt(result[2], 16),
                    b: parseInt(result[3], 16)
                } : { r: 80, g: 80, b: 80 };
            };

            const intToRgb = (colorInt) => ({
                r: (colorInt >> 16) & 255,
                g: (colorInt >> 8) & 255,
                b: colorInt & 255
            });

            const rgbaToRgb = (rgba) => {
                if (!rgba) return null;
                return {
                    r: Math.round((rgba.red ?? 0) * 255),
                    g: Math.round((rgba.green ?? 0) * 255),
                    b: Math.round((rgba.blue ?? 0) * 255)
                };
            };

            const scaleRgb = (rgb, scale) => ({
                r: Math.max(0, Math.min(255, Math.round(rgb.r * scale))),
                g: Math.max(0, Math.min(255, Math.round(rgb.g * scale))),
                b: Math.max(0, Math.min(255, Math.round(rgb.b * scale)))
            });

            const mixRgb = (a, b, ratio) => ({
                r: Math.round(a.r * (1 - ratio) + b.r * ratio),
                g: Math.round(a.g * (1 - ratio) + b.g * ratio),
                b: Math.round(a.b * (1 - ratio) + b.b * ratio)
            });

            const rgbString = (rgb) => `${rgb.r}, ${rgb.g}, ${rgb.b}`;

            const getCurrentCoverUrl = () => {
                const item = Spicetify.Player.data?.item;
                return item?.metadata?.image_xlarge_url ||
                    item?.metadata?.image_large_url ||
                    item?.metadata?.image_url ||
                    item?.album?.images?.[0]?.url ||
                    item?.album?.images?.[1]?.url ||
                    item?.album?.images?.[2]?.url ||
                    "";
            };

            // 앨범에서 색상 추출
            const getAlbumColor = async (trackUri) => {
                try {
                    if (!trackUri) return null;

                    // Spotify에서 앨범 색상 추출
                    try {
                        const { fetchExtractedColorForTrackEntity } = Spicetify.GraphQL.Definitions;
                        const { data } = await Spicetify.GraphQL.Request(
                            fetchExtractedColorForTrackEntity,
                            { uri: trackUri }
                        );
                        const { hex } = data.trackUnion.albumOfTrack.coverArt.extractedColors.colorDark;
                        return hexToRgb(hex);
                    } catch {
                        // GraphQL 실패 시 CosmosAsync 시도
                        try {
                            const colors = await Spicetify.CosmosAsync.get(
                                `https://spclient.wg.spotify.com/colorextractor/v1/extract-presets?uri=${trackUri}&format=json`
                            );
                            const colorInt = colors.entries[0].color_swatches.find(
                                (color) => color.preset === "VIBRANT_NON_ALARMING"
                            )?.color;
                            if (colorInt) {
                                return intToRgb(colorInt);
                            }
                        } catch {
                            // 색상 추출 실패
                        }
                    }
                } catch (error) {
                    console.error('[NowPlayingPanelLyrics] Failed to get album color:', error);
                }
                return null;
            };

            const getAlbumGradientColors = async (trackUri) => {
                try {
                    const coverUrl = getCurrentCoverUrl();
                    if (coverUrl && Spicetify.GraphQL?.Definitions?.getDynamicColorsByUris) {
                        const colorQuery = await Spicetify.GraphQL.Request(
                            Spicetify.GraphQL.Definitions.getDynamicColorsByUris,
                            { imageUris: [coverUrl] }
                        );
                        const colorData = colorQuery?.data?.getDynamicColorsByUris?.[0];
                        if (colorData) {
                            const c1 = rgbaToRgb(colorData.minContrast?.backgroundBase);
                            const c2 = rgbaToRgb(colorData.highContrast?.backgroundBase);
                            const c3 = rgbaToRgb(colorData.higherContrast?.backgroundBase);
                            if (c1 || c2 || c3) {
                                const fallback = c1 || c2 || c3 || { r: 30, g: 30, b: 40 };
                                return {
                                    c1: c1 || fallback,
                                    c2: c2 || scaleRgb(fallback, 0.72),
                                    c3: c3 || scaleRgb(fallback, 0.48)
                                };
                            }
                        }
                    }
                } catch (error) {
                    console.warn('[NowPlayingPanelLyrics] Failed to get dynamic album colors:', error);
                }

                const albumRgb = await getAlbumColor(trackUri);
                if (!albumRgb) {
                    return {
                        c1: { r: 30, g: 30, b: 40 },
                        c2: { r: 60, g: 40, b: 70 },
                        c3: { r: 20, g: 50, b: 60 }
                    };
                }

                return {
                    c1: scaleRgb(albumRgb, 0.78),
                    c2: mixRgb(scaleRgb(albumRgb, 1.12), { r: 70, g: 36, b: 120 }, 0.28),
                    c3: mixRgb(scaleRgb(albumRgb, 0.55), { r: 18, g: 74, b: 96 }, 0.32)
                };
            };

            const getCustomGradientColors = () => {
                const c1 = hexToRgb(getStorageValue(BG_GRADIENT_1_KEY, DEFAULT_BG_GRADIENT_1));
                const c2 = hexToRgb(getStorageValue(BG_GRADIENT_2_KEY, DEFAULT_BG_GRADIENT_2));
                return {
                    c1: scaleRgb(c1, 0.76),
                    c2,
                    c3: mixRgb(c1, c2, 0.55)
                };
            };

            let styleRequestSeq = 0;
            let disposed = false;

            const updatePanelStyles = async () => {
                const requestSeq = ++styleRequestSeq;
                const trackUri = Spicetify.Player.data?.item?.uri;
                const sections = Array.from(document.querySelectorAll('.ivlyrics-panel-lyrics-section'));
                if (!sections.length) return;

                // 설정값 읽기
                const bgType = getStorageValue(BG_TYPE_KEY, DEFAULT_BG_TYPE);
                const bgColor = getStorageValue(BG_COLOR_KEY, DEFAULT_BG_COLOR);
                const bgGradient1 = getStorageValue(BG_GRADIENT_1_KEY, DEFAULT_BG_GRADIENT_1);
                const bgGradient2 = getStorageValue(BG_GRADIENT_2_KEY, DEFAULT_BG_GRADIENT_2);
                const bgOpacity = getStorageValue(BG_OPACITY_KEY, DEFAULT_BG_OPACITY) / 100;
                const borderEnabled = getStorageValue(BORDER_ENABLED_KEY, DEFAULT_BORDER_ENABLED);
                const borderColor = getStorageValue(BORDER_COLOR_KEY, DEFAULT_BORDER_COLOR);
                const borderOpacity = getStorageValue(BORDER_OPACITY_KEY, DEFAULT_BORDER_OPACITY) / 100;

                let backgroundStyle = '';
                let gradientColors = null;

                // 배경 유형에 따른 스타일 계산
                if (bgType === 'album') {
                    gradientColors = await getAlbumGradientColors(trackUri);
                    backgroundStyle = `rgba(${rgbString(gradientColors.c1)}, ${bgOpacity})`;
                } else if (bgType === 'custom') {
                    // 사용자 지정 단색
                    const rgb = hexToRgb(bgColor);
                    backgroundStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${bgOpacity})`;
                } else if (bgType === 'gradient') {
                    gradientColors = getCustomGradientColors();
                    backgroundStyle = `rgba(${rgbString(gradientColors.c1)}, ${bgOpacity})`;
                }

                if (
                    disposed ||
                    requestSeq !== styleRequestSeq ||
                    (trackUri && Spicetify.Player.data?.item?.uri !== trackUri)
                ) {
                    return;
                }

                // 테두리 스타일 계산
                let borderStyle = 'none';
                if (borderEnabled) {
                    const rgb = hexToRgb(borderColor);
                    borderStyle = `1px solid rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${borderOpacity})`;
                }

                // CSS 변수 및 직접 스타일 적용
                sections.forEach((section) => {
                    const useBlurGradient = !!gradientColors && bgOpacity > 0;
                    const gradientOpacity = useBlurGradient ? Math.max(bgOpacity, 0.72) : bgOpacity;

                    section.classList.toggle('blur-gradient-bg', useBlurGradient);
                    section.style.setProperty('--ivlyrics-panel-bg', backgroundStyle);
                    section.style.setProperty('--ivlyrics-panel-border', borderStyle);
                    section.style.setProperty('--ivlyrics-panel-gradient-opacity', String(gradientOpacity));
                    if (gradientColors) {
                        section.style.setProperty('--ivlyrics-panel-c1', rgbString(gradientColors.c1));
                        section.style.setProperty('--ivlyrics-panel-c2', rgbString(gradientColors.c2));
                        section.style.setProperty('--ivlyrics-panel-c3', rgbString(gradientColors.c3));
                    }
                    section.style.background = backgroundStyle;
                    section.style.border = borderStyle;

                    // 불투명도가 0이면 backdrop-filter도 제거
                    if (bgOpacity === 0) {
                        section.style.backdropFilter = 'none';
                        section.style.webkitBackdropFilter = 'none';
                    } else {
                        section.style.backdropFilter = 'blur(20px) saturate(180%)';
                        section.style.webkitBackdropFilter = 'blur(20px) saturate(180%)';
                    }
                });
            };

            // 초기 스타일 적용
            updatePanelStyles();

            // 곡 변경 시 스타일 업데이트
            Spicetify.Player.addEventListener('songchange', updatePanelStyles);

            // 설정 변경 시 스타일 업데이트
            const handleSettingsUpdate = (event) => {
                const { name } = event.detail || {};
                if (name && (name.startsWith('panel-bg') || name.startsWith('panel-border') || name.startsWith('panel-lyrics-font') || name.startsWith('panel-lyrics-original') || name.startsWith('panel-lyrics-phonetic') || name.startsWith('panel-lyrics-translation'))) {
                    updatePanelStyles();
                    // 폰트 관련 설정 변경 시 CSS도 재주입
                    if (name.includes('font')) {
                        injectStyles();
                    }
                }
            };
            window.addEventListener('ivLyrics', handleSettingsUpdate);

            return () => {
                disposed = true;
                Spicetify.Player.removeEventListener('songchange', updatePanelStyles);
                window.removeEventListener('ivLyrics', handleSettingsUpdate);
            };
        }, []);

        // 현재 재생 위치 추적 및 노래방 가사 타이밍 업데이트
        // 최적화: setInterval 사용 (30ms), LocalStorage 캐싱, 이진 탐색
        useEffect(() => {
            let lastIndex = currentIndex;
            let lastTrailingInterludeKey = null;
            let lastEventTime = 0;
            let intervalId = null;
            let cachedDelay = null;
            let lastTrackUri = null;
            const UPDATE_INTERVAL = 30; // 업데이트 간격 (ms) - RAF보다 CPU 효율적
            const EVENT_THROTTLE = 80; // 이벤트 발생 간격 (ms) - 노래방 업데이트용

            // 이진 탐색으로 현재 라인 찾기 (O(log n))
            const findCurrentLine = (time) => {
                let left = 0;
                let right = lyrics.length - 1;
                let result = 0;

                while (left <= right) {
                    const mid = Math.floor((left + right) / 2);
                    const startTime = lyrics[mid].startTime;

                    if (startTime === undefined || startTime <= time) {
                        result = mid;
                        left = mid + 1;
                    } else {
                        right = mid - 1;
                    }
                }

                return result;
            };

            const updatePosition = () => {
                if (!lyrics || lyrics.length === 0) {
                    return;
                }

                const position = window.Utils?.getSafePlayerProgress?.()
                    ?? (Spicetify.Player.getProgress?.() || 0);

                // 곡별 딜레이: 트랙 변경 시에만 캐시 갱신
                const currentTrackUri = Spicetify.Player.data?.item?.uri;
                if (currentTrackUri !== lastTrackUri) {
                    lastTrackUri = currentTrackUri;
                    cachedDelay = null;
                    if (currentTrackUri) {
                        try {
                            const delayValue = Spicetify.LocalStorage.get(`lyrics-delay:${currentTrackUri}`);
                            cachedDelay = delayValue ? parseInt(delayValue, 10) || 0 : 0;
                        } catch (e) {
                            cachedDelay = 0;
                        }
                    }
                }

                // 곡별 딜레이 + 곡별 싱크 오프셋 + 가상 노래방 렌더 선행값 적용
                const pseudoAdvance = PSEUDO_KARAOKE_SOURCES.has(karaokeSource)
                    ? pseudoKaraokeAdvanceMs
                    : 0;
                const adjustedPosition = position + (cachedDelay || 0) + trackOffset + globalOffset + pseudoAdvance;

                // 전역 변수에 현재 시간 저장 (KaraokeWord에서 읽음)
                window._ivLyricsPanelCurrentTime = adjustedPosition;

                // 현재 라인 찾기 (이진 탐색)
                const newIndex = findCurrentLine(adjustedPosition);
                const trailingInterludeInfo = getTrailingKaraokeInterludeInfo(
                    lyrics[newIndex],
                    lyrics[newIndex + 1],
                    newIndex,
                    lyrics.length
                );
                const nextTrailingInterludeKey = trailingInterludeInfo.isInterlude &&
                    adjustedPosition >= trailingInterludeInfo.startTime &&
                    adjustedPosition < trailingInterludeInfo.endTime
                    ? getTrailingKaraokeInterludeKey(newIndex, trailingInterludeInfo)
                    : null;

                // 라인이 변경될 때만 상태 업데이트 (리렌더링 최소화)
                if (newIndex !== lastIndex) {
                    lastIndex = newIndex;
                    setCurrentIndex(newIndex);
                }
                if (nextTrailingInterludeKey !== lastTrailingInterludeKey) {
                    lastTrailingInterludeKey = nextTrailingInterludeKey;
                    setActiveTrailingInterludeKey(nextTrailingInterludeKey);
                }

                // 노래방 가사 업데이트 이벤트 발생 (throttled)
                const now = performance.now();
                if (now - lastEventTime >= EVENT_THROTTLE) {
                    lastEventTime = now;
                    window.dispatchEvent(new Event('ivlyrics-panel-time-update'));
                }
            };

            if (isEnabled && lyrics.length > 0) {
                // setInterval 사용 - RAF보다 CPU 사용량 낮음
                intervalId = setInterval(updatePosition, UPDATE_INTERVAL);
                // 초기 업데이트
                updatePosition();
            }

            return () => {
                if (intervalId) {
                    clearInterval(intervalId);
                }
                // 전역 변수 정리
                window._ivLyricsPanelCurrentTime = 0;
            };
        }, [lyrics, isEnabled, trackOffset, globalOffset, karaokeSource, pseudoKaraokeAdvanceMs]); // currentIndex 의존성 제거

        // 스크롤 애니메이션 비활성화 - Now Playing 탭 스크롤 문제 방지
        // useEffect(() => {
        //     if (!scrollRef.current || !isEnabled) return;
        //     const activeElement = scrollRef.current.querySelector('.ivlyrics-panel-line.active');
        //     if (activeElement) {
        //         activeElement.scrollIntoView({
        //             behavior: 'smooth',
        //             block: 'center'
        //         });
        //     }
        // }, [currentIndex, isEnabled]);

        const visibleLineCount = normalizePanelVisibleLineCount(numLines);

        // 표시할 가사 라인들 계산
        // 노래방 가사는 line 객체에 syllables 또는 vocals 포함
        // 항상 홀수 개수만큼 표시 (빈 줄은 투명 placeholder로)하여 현재 가사가 가운데에 오도록 함
        const visibleLines = useMemo(() => {
            if (!lyrics || lyrics.length === 0) return [];

            const halfLines = Math.floor(visibleLineCount / 2);
            const lines = [];
            const displayableLyrics = lyrics
                .map((line, index) => ({
                    line,
                    index,
                    interludeInfo: getInterludeInfo(line, index, lyrics.length)
                }))
                .filter((entry) => !entry.interludeInfo.isInterlude || entry.index === currentIndex)
                .flatMap((entry) => {
                    const trailingInterludeInfo = entry.index === currentIndex
                        ? getTrailingKaraokeInterludeInfo(entry.line, lyrics[entry.index + 1], entry.index, lyrics.length)
                        : null;
                    const trailingInterludeKey = getTrailingKaraokeInterludeKey(entry.index, trailingInterludeInfo);

                    if (!trailingInterludeKey || trailingInterludeKey !== activeTrailingInterludeKey) {
                        return [entry];
                    }

                    return [
                        entry,
                        {
                            line: {
                                startTime: trailingInterludeInfo.startTime,
                                endTime: trailingInterludeInfo.endTime,
                                text: '',
                                originalText: '',
                                text2: '',
                                interludeInfo: trailingInterludeInfo,
                                isVirtualTrailingInterlude: true
                            },
                            index: `trailing-interlude-${entry.index}-${trailingInterludeInfo.startTime}`,
                            sourceIndex: entry.index,
                            interludeInfo: trailingInterludeInfo,
                            isVirtualTrailingInterlude: true
                        }
                    ];
                });
            const currentDisplayIndex = Math.max(
                0,
                displayableLyrics.findIndex((entry) => activeTrailingInterludeKey
                    ? entry.isVirtualTrailingInterlude
                    : entry.index === currentIndex)
            );

            // 항상 visibleLineCount 개수만큼 표시
            for (let offset = -halfLines; offset <= halfLines; offset++) {
                const displayIndex = currentDisplayIndex + offset;
                const entry = displayableLyrics[displayIndex];

                if (!entry) {
                    // 범위 밖: 빈 placeholder 추가 (높이 유지)
                    lines.push({
                        index: `placeholder-${offset}`,
                        line: { text: '\u00A0' }, // non-breaking space
                        lineIndex: -1,
                        lineCount: lyrics.length,
                        originalText: '\u00A0',
                        phonetic: '',
                        translation: '',
                        isActive: false,
                        isPast: offset < 0,
                        isFuture: offset > 0,
                        isPlaceholder: true
                    });
                } else {
                    const i = entry.sourceIndex ?? entry.index;
                    const line = entry.line;
                    const isVirtualTrailingInterlude = entry.isVirtualTrailingInterlude === true;
                    // originalText = 원어, text = 발음, text2 = 번역
                    const originalText = line?.originalText || line?.text || '';
                    const phonetic = line?.phoneticText || ((line?.originalText && line?.text !== line?.originalText) ? line?.text : '');
                    const translation = line?.text2 || '';

                    lines.push({
                        index: entry.index,
                        line: line, // 노래방 가사용 전체 line 객체
                        lineIndex: i,
                        lineCount: lyrics.length,
                        originalText: originalText,
                        phonetic: phonetic,
                        translation: translation,
                        isActive: isVirtualTrailingInterlude || (i === currentIndex && !activeTrailingInterludeKey),
                        isPast: !isVirtualTrailingInterlude && (i < currentIndex || (i === currentIndex && !!activeTrailingInterludeKey)),
                        isFuture: i > currentIndex,
                        isPlaceholder: false
                    });

                }
            }

            return lines;
        }, [lyrics, currentIndex, visibleLineCount, activeTrailingInterludeKey]);

        // currentTime은 더 이상 상태로 관리하지 않음 (전역 변수 window._ivLyricsPanelCurrentTime 사용)

        // ivLyrics 페이지로 이동
        const handleContainerClick = useCallback(() => {
            Spicetify.Platform.History.push('/ivLyrics');
        }, []);

        const panelLineSlotHeight = useMemo(() => {
            const originalSize = Number(getStorageValue(ORIGINAL_SIZE_KEY, DEFAULT_ORIGINAL_SIZE)) || DEFAULT_ORIGINAL_SIZE;
            const scale = Number(fontScale) > 0 ? Number(fontScale) / 100 : 1;
            return Math.round(Math.max(34, Math.min(58, originalSize * scale * 2.05)));
        }, [fontScale, instrumentalBreakRevision]);

        // 폰트 스케일 스타일
        const containerStyle = useMemo(() => ({
            '--ivlyrics-font-scale': fontScale / 100,
            '--ivlyrics-panel-visible-lines': visibleLineCount,
            '--ivlyrics-panel-fixed-height': `${visibleLineCount * panelLineSlotHeight}px`,
            '--ivlyrics-panel-bar-fixed-height': `${Math.round(visibleLineCount * panelLineSlotHeight * 0.72)}px`
        }), [fontScale, panelLineSlotHeight, visibleLineCount]);
        const usesBlurGradientPanelBg = getStorageValue(BG_TYPE_KEY, DEFAULT_BG_TYPE) !== 'custom';
        const sectionClassName = `${PANEL_SECTION_CLASS}${isPlaybackPaused ? " playback-paused" : ""}${usesBlurGradientPanelBg ? " blur-gradient-bg" : ""}`;
        const panelBackgroundLayer = react.createElement("div", {
            className: "ivlyrics-panel-bg-gradient",
            "aria-hidden": "true"
        }, [1, 2, 3, 4, 5, 6].map((blobIndex) =>
            react.createElement("div", {
                key: `panel-bg-blob-${blobIndex}`,
                className: `ivlyrics-panel-bg-blob blob-${blobIndex}`
            })
        ));

        // 비활성화 또는 가사 없음
        if (!isEnabled) return null;
        if (!lyrics || lyrics.length === 0) {
            return react.createElement("div", {
                className: sectionClassName,
                ref: containerRef,
                onClick: handleContainerClick,
                style: containerStyle
            },
                panelBackgroundLayer,
                react.createElement("div", { className: "ivlyrics-panel-header" },
                    react.createElement("h2", null, "ivLyrics")
                ),
                react.createElement("div", { className: "ivlyrics-panel-empty" },
                    translatePanelText("syncCreator.loadingLyrics", "가사 불러오는 중")
                )
            );
        }

        return react.createElement("div", {
            className: sectionClassName,
            ref: containerRef,
            onClick: handleContainerClick,
            style: containerStyle
        },
            panelBackgroundLayer,
            // 헤더
            react.createElement("div", { className: "ivlyrics-panel-header" },
                react.createElement("h2", null, "ivLyrics")
            ),
            // 가사 컨테이너
            react.createElement("div", {
                className: "ivlyrics-panel-lyrics-wrapper",
                ref: scrollRef
            },
                visibleLines.map((visLine, idx) =>
                    react.createElement(LyricLine, {
                        key: `${visLine.index}-${idx}`,
                        line: visLine.line,
                        lineIndex: visLine.lineIndex,
                        lineCount: visLine.lineCount,
                        isActive: visLine.isActive,
                        isPast: visLine.isPast,
                        isFuture: visLine.isFuture,
                        translation: visLine.translation,
                        phonetic: visLine.phonetic,
                        isPlaceholder: visLine.isPlaceholder,
                        instrumentalBreakRevision,
                        textEffectRevision
                    })
                )
            )
        );
    };

    // ============================================
    // 패널 감지 및 삽입
    // ============================================
    const findNowPlayingPanel = () => {
        const panelRoot = document.querySelector('[data-testid="NPV_Panel_OpenDiv"], .main-nowPlayingView-panel');
        if (panelRoot) return panelRoot;

        const widget = document.querySelector('.main-nowPlayingView-nowPlayingWidget, .main-nowPlayingView-nowPlayingGrid');
        if (widget) {
            return widget.closest('[data-testid="NPV_Panel_OpenDiv"], .main-nowPlayingView-panel')
                || widget;
        }

        const section = document.querySelector('.main-nowPlayingView-section');
        if (section) {
            return section.closest('[data-testid="NPV_Panel_OpenDiv"], .main-nowPlayingView-panel, .main-nowPlayingView-nowPlayingWidget')
                || section.parentElement;
        }

        return document.querySelector('.iHa_q9pq4un3VNRQgwTx')?.parentElement || null;
    };

    // ============================================
    // Starry Night 테마 감지
    // ============================================
    const isStarryNightTheme = () => {
        return document.querySelector('.starrynight-bg-container') !== null;
    };

    // ============================================
    // Starry Night 테마용 - Root__now-playing-bar 하단에 가사 삽입
    // ============================================
    const insertNowPlayingBarLyrics = () => {
        // 이미 존재하면 스킵
        if (document.querySelector(`.${NOWPLAYING_BAR_CONTAINER_CLASS}`)) {
            return true;
        }

        const nowPlayingBar = document.querySelector('.Root__now-playing-bar');
        if (!nowPlayingBar) {
            panelDebug("[NowPlayingPanelLyrics] Root__now-playing-bar not found");
            return false;
        }

        // CSS 스타일 주입
        injectStyles();

        // 컨테이너 생성
        const container = document.createElement('div');
        container.className = NOWPLAYING_BAR_CONTAINER_CLASS;

        // Now Playing Bar에 삽입 (position: relative가 CSS로 적용됨)
        nowPlayingBar.appendChild(container);

        // React 렌더링
        try {
            const ReactDOM = Spicetify.ReactDOM;
            if (ReactDOM.createRoot) {
                starryNightBarRoot = ReactDOM.createRoot(container);
                starryNightBarRoot.render(react.createElement(PanelLyrics));
            } else {
                ReactDOM.render(react.createElement(PanelLyrics), container);
                starryNightBarRoot = container;
            }
            panelDebug("[NowPlayingPanelLyrics] Starry Night bar lyrics inserted successfully");
            return true;
        } catch (error) {
            console.error("[NowPlayingPanelLyrics] Failed to render Starry Night bar lyrics:", error);
            return false;
        }
    };

    const removeNowPlayingBarLyrics = () => {
        const container = document.querySelector(`.${NOWPLAYING_BAR_CONTAINER_CLASS}`);
        if (container) {
            try {
                if (starryNightBarRoot && typeof starryNightBarRoot.unmount === 'function') {
                    starryNightBarRoot.unmount();
                } else {
                    Spicetify.ReactDOM.unmountComponentAtNode(container);
                }
            } catch (e) {
                // Ignore unmount errors
            }
            container.remove();
            starryNightBarRoot = null;
        }
    };

    const verifyPanelContainerRendered = (container) => {
        setTimeout(() => {
            if (!container?.isConnected) return;
            if (container.querySelector(`.${PANEL_SECTION_CLASS}`)) return;

            panelDebug("[NowPlayingPanelLyrics] Empty panel container detected, retrying render");
            removePanelLyrics();
            if (!isIvLyricsPageActive()) {
                scheduleInsertPanelLyrics(100);
            }
        }, 300);
    };

    const renderPanelLyricsIntoContainer = (container) => {
        try {
            const ReactDOM = Spicetify.ReactDOM;
            if (ReactDOM.createRoot) {
                container.__ivLyricsPanelRoot = container.__ivLyricsPanelRoot || ReactDOM.createRoot(container);
                lyricsRoot = container.__ivLyricsPanelRoot;
                lyricsRoot.render(react.createElement(PanelLyrics));
            } else {
                ReactDOM.render(react.createElement(PanelLyrics), container);
                lyricsRoot = container;
            }

            verifyPanelContainerRendered(container);
            return true;
        } catch (error) {
            console.error("[NowPlayingPanelLyrics] Failed to render:", error);
            return false;
        }
    };

    const insertPanelLyrics = () => {
        // ivLyrics 페이지에 있으면 삽입하지 않음
        if (isIvLyricsPageActive()) {
            removePanelLyrics();
            return;
        }

        // ========================================
        // Starry Night 테마 감지 - Root__now-playing-bar에 삽입
        // ========================================
        if (isStarryNightTheme()) {
            if (document.querySelector(`.${PANEL_CONTAINER_CLASS}`)) {
                removePanelLyrics();
            }
            document.body.classList.add('ivlyrics-starrynight-theme');
            panelDebug("[NowPlayingPanelLyrics] Starry Night theme detected - inserting to now-playing-bar");
            if (insertNowPlayingBarLyrics()) {
                return; // 성공적으로 삽입됨
            }
            // 실패 시 기본 패널 삽입 시도
        } else {
            document.body.classList.remove('ivlyrics-starrynight-theme');
            removeNowPlayingBarLyrics();
        }

        // ========================================
        // 기본: Now Playing Panel에 삽입
        // ========================================
        const panel = findNowPlayingPanel();
        if (!panel) {
            return;
        }

        const existingContainer = document.querySelector(`.${PANEL_CONTAINER_CLASS}`);
        if (existingContainer) {
            if (!panel.contains(existingContainer)) {
                removePanelLyrics();
            } else {
                renderPanelLyricsIntoContainer(existingContainer);
                return;
            }
        }

        // CSS 스타일 주입 (처음 한 번만)
        injectStyles();

        // 컨테이너 생성
        const container = document.createElement('div');
        container.className = PANEL_CONTAINER_CLASS;

        // 곡 정보 (곡명, 아티스트) 바로 **아래**에 삽입
        // Now Playing 패널 구조:
        // main-nowPlayingView-nowPlayingGrid
        //   ├── main-nowPlayingView-coverArtContainer (동영상/앨범아트)
        //   ├── 동영상 전환 버튼
        //   ├── main-nowPlayingView-contextItemInfo (곡제목+아티스트+버튼들)
        //   └── main-nowPlayingView-section (관련 뮤직비디오 등)
        //
        // 가사는 main-nowPlayingView-contextItemInfo 바로 **다음**에 삽입해야 함

        // contextItemInfo 찾기 (곡제목, 아티스트, 버튼들을 포함하는 컨테이너)
        const contextItemInfo = panel.querySelector('.main-nowPlayingView-contextItemInfo');

        if (contextItemInfo && contextItemInfo.parentElement) {
            // contextItemInfo 바로 다음에 삽입
            const parent = contextItemInfo.parentElement;
            const nextSibling = contextItemInfo.nextElementSibling;
            if (nextSibling) {
                parent.insertBefore(container, nextSibling);
            } else {
                parent.appendChild(container);
            }
            panelDebug("[NowPlayingPanelLyrics] Inserted after contextItemInfo");
        } else {
            // 폴백: 관련 뮤직비디오 섹션 앞에 삽입
            const relatedSection = panel.querySelector('.main-nowPlayingView-section');
            if (relatedSection && relatedSection.parentElement) {
                relatedSection.parentElement.insertBefore(container, relatedSection);
                panelDebug("[NowPlayingPanelLyrics] Inserted before related section");
            } else {
                // 최종 폴백: 패널 끝에 삽입
                panel.appendChild(container);
                panelDebug("[NowPlayingPanelLyrics] Used fallback - appended to panel");
            }
        }

        if (renderPanelLyricsIntoContainer(container)) {
            panelDebug("[NowPlayingPanelLyrics] Panel lyrics inserted successfully");
        } else {
            container.remove();
        }
    };

    const removePanelLyrics = () => {
        // 기존 패널 가사 제거
        const container = document.querySelector(`.${PANEL_CONTAINER_CLASS}`);
        if (container) {
            try {
                const root = container.__ivLyricsPanelRoot || lyricsRoot;
                if (root && typeof root.unmount === 'function') {
                    root.unmount();
                } else {
                    Spicetify.ReactDOM.unmountComponentAtNode(container);
                }
            } catch (e) {
                // Ignore unmount errors
            }
            delete container.__ivLyricsPanelRoot;
            container.remove();
            lyricsRoot = null;
        }
        // Starry Night bar 가사도 제거
        removeNowPlayingBarLyrics();
    };

    // ============================================
    // MutationObserver 설정
    // ============================================
    const setupObserver = () => {
        if (panelObserver) {
            panelObserver.disconnect();
        }

        panelObserver = new MutationObserver((mutations) => {
            // 패널이 열렸는지 확인
            const panel = findNowPlayingPanel();
            const container = document.querySelector(`.${PANEL_CONTAINER_CLASS}`);
            const isOnIvLyricsPage = isIvLyricsPageActive();

            if (isOnIvLyricsPage) {
                if (container || document.querySelector(`.${NOWPLAYING_BAR_CONTAINER_CLASS}`)) {
                    removePanelLyrics();
                }
                return;
            }

            if (panel && (!container || !panel.contains(container) || !container.querySelector(`.${PANEL_SECTION_CLASS}`))) {
                // 패널이 있지만 가사가 없으면 삽입
                scheduleInsertPanelLyrics(100);
            } else if (!panel && container) {
                // 패널이 없지만 컨테이너가 있으면 제거
                removePanelLyrics();
            }
        });

        // body 전체 감시 (패널이 동적으로 생성됨)
        panelObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        moduleState.panelObserver = panelObserver;
    };

    const teardownObserver = () => {
        if (panelObserver) {
            panelObserver.disconnect();
            panelObserver = null;
            moduleState.panelObserver = null;
        }
    };

    // ============================================
    // 가사 데이터 수신 및 전달
    // ============================================
    const setupLyricsListener = () => {
        if (lyricsListener) {
            return;
        }

        // 트랙 변경 감지
        lyricsListener = () => {
            currentLyricsState.lyrics = [];
            currentLyricsState.currentIndex = 0;
            currentLyricsState.trackUri = Spicetify.Player.data?.item?.uri;
        };

        Spicetify.Player.addEventListener('songchange', lyricsListener);
        moduleState.lyricsListener = lyricsListener;
    };

    const teardownLyricsListener = () => {
        if (lyricsListener && typeof Spicetify.Player?.removeEventListener === 'function') {
            try {
                Spicetify.Player.removeEventListener('songchange', lyricsListener);
            } catch (e) {
                // Ignore remove errors
            }
        }

        lyricsListener = null;
        moduleState.lyricsListener = null;
    };

    // ============================================
    // ivLyrics 페이지 감지 및 body 클래스 관리
    // ============================================
    const updateIvLyricsPageState = () => {
        const isOnIvLyricsPage = isIvLyricsPageActive();

        if (isOnIvLyricsPage) {
            document.body.classList.add('ivlyrics-page-active');
        } else {
            document.body.classList.remove('ivlyrics-page-active');
        }

        return isOnIvLyricsPage;
    };

    const refreshPageStateAndPanel = () => {
        const isOnIvLyricsPage = updateIvLyricsPageState();
        if (isOnIvLyricsPage) {
            removePanelLyrics();
        } else {
            scheduleInsertPanelLyrics(150);
        }
    };

    const setupPageDetection = () => {
        if (pageObserver || historyUnlisten) {
            return;
        }

        // 초기 상태 확인
        updateIvLyricsPageState();

        // Spicetify History 변경 감지 (URL 변경)
        if (Spicetify.Platform?.History) {
            const unlisten = Spicetify.Platform.History.listen(() => {
                // 약간의 지연 후 확인 (DOM이 업데이트될 시간 확보)
                setTimeout(refreshPageStateAndPanel, 100);
            });
            historyUnlisten = typeof unlisten === 'function' ? unlisten : null;
            moduleState.historyUnlisten = historyUnlisten;
        }

        // MutationObserver로 DOM 변경 감지 (lyrics-lyricsContainer-LyricsContainer 클래스 포함)
        pageObserver = new MutationObserver((mutations) => {
            // 클래스 변경이나 새 요소 추가 시 상태 업데이트
            let shouldUpdate = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // 새로 추가된 노드 중 lyrics 컨테이너가 있는지 확인
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) { // Element node
                            if (node.classList?.contains('lyrics-lyricsContainer-LyricsContainer') ||
                                node.querySelector?.('.lyrics-lyricsContainer-LyricsContainer')) {
                                shouldUpdate = true;
                                break;
                            }
                        }
                    }
                    if (shouldUpdate) break;
                    // 제거된 노드 확인
                    for (const node of mutation.removedNodes) {
                        if (node.nodeType === 1) {
                            if (node.classList?.contains('lyrics-lyricsContainer-LyricsContainer') ||
                                node.querySelector?.('.lyrics-lyricsContainer-LyricsContainer')) {
                                shouldUpdate = true;
                                break;
                            }
                        }
                    }
                } else if (mutation.type === 'attributes') {
                    // data-testid 또는 class 변경 시 업데이트
                    if (mutation.attributeName === 'data-testid' || mutation.attributeName === 'class') {
                        shouldUpdate = true;
                    }
                }
                if (shouldUpdate) break;
            }
            // debounce로 빈번한 업데이트 방지
            if (shouldUpdate) {
                if (pageObserverTimeout) clearTimeout(pageObserverTimeout);
                pageObserverTimeout = setTimeout(refreshPageStateAndPanel, 50);
                moduleState.pageObserverTimeout = pageObserverTimeout;
            }
        });

        // main-view 영역 감시 (전체 body 감시로 확장)
        const mainView = document.querySelector('.Root__main-view') || document.body;
        pageObserver.observe(mainView, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-testid', 'class']
        });
        moduleState.pageObserver = pageObserver;
    };

    const teardownPageDetection = () => {
        if (pageObserverTimeout) {
            clearTimeout(pageObserverTimeout);
            pageObserverTimeout = null;
            moduleState.pageObserverTimeout = null;
        }

        if (pageObserver) {
            pageObserver.disconnect();
            pageObserver = null;
            moduleState.pageObserver = null;
        }

        if (typeof historyUnlisten === 'function') {
            try {
                historyUnlisten();
            } catch (e) {
                // Ignore unlisten errors
            }
        }

        historyUnlisten = null;
        moduleState.historyUnlisten = null;
    };

    const startRuntime = () => {
        if (moduleState.runtimeStarted) {
            return;
        }

        moduleState.runtimeStarted = true;
        setPanelActiveState(true);

        setupPageDetection();
        setupObserver();
        setupLyricsListener();
        updateCSSVariables();
        insertPanelLyrics();

        scheduleInsertPanelLyrics(1000);
    };

    const stopRuntime = () => {
        moduleState.runtimeStarted = false;
        clearInsertTimer();
        teardownObserver();
        teardownLyricsListener();
        teardownPageDetection();
        removePanelLyrics();
        setPanelActiveState(false);
        document.body.classList.remove('ivlyrics-page-active');
        document.body.classList.remove('ivlyrics-starrynight-theme');
    };

    const handleSettingsEvent = (event) => {
        if (event.detail?.name === 'panel-lyrics-enabled') {
            if (event.detail.value) {
                startRuntime();
            } else {
                stopRuntime();
            }
        }

        if (event.detail?.name === 'panel-lyrics-width' ||
            event.detail?.name === 'panel-lyrics-font-family' ||
            event.detail?.name === 'panel-lyrics-original-size' ||
            event.detail?.name === 'panel-lyrics-phonetic-size' ||
            event.detail?.name === 'panel-lyrics-translation-size') {
            updateCSSVariables();
        }
    };

    // ============================================
    // 초기화
    // ============================================
    const init = () => {
        panelDebug("[NowPlayingPanelLyrics] Initializing...");

        if (!settingsListener) {
            settingsListener = handleSettingsEvent;
            moduleState.settingsListener = settingsListener;
            window.addEventListener('ivLyrics', settingsListener);
        }

        if (getStorageValue(STORAGE_KEY, DEFAULT_ENABLED)) {
            startRuntime();
        } else {
            updateIvLyricsPageState();
            panelDebug("[NowPlayingPanelLyrics] Disabled by settings");
        }

        panelDebug("[NowPlayingPanelLyrics] Initialized successfully");
    };

    // 초기화 실행
    init();

    // 전역 접근용 (디버깅/설정)
    window.NowPlayingPanelLyrics = {
        insert: insertPanelLyrics,
        remove: removePanelLyrics,
        isEnabled: () => getStorageValue(STORAGE_KEY, DEFAULT_ENABLED),
        setEnabled: (enabled) => {
            setStorageValue(STORAGE_KEY, enabled);
            if (enabled) {
                startRuntime();
            } else {
                stopRuntime();
            }
        },
        updateLyrics: (lyrics, index) => {
            currentLyricsState.lyrics = lyrics || [];
            currentLyricsState.currentIndex = index || 0;
            window.dispatchEvent(new CustomEvent('ivlyrics-panel-lyrics-update', {
                detail: {
                    lyrics: currentLyricsState.lyrics,
                    currentIndex: currentLyricsState.currentIndex
                }
            }));
        },
        updateStyles: updateStyles,
        updateCSSVariables: updateCSSVariables,
        destroy: () => {
            if (settingsListener) {
                window.removeEventListener('ivLyrics', settingsListener);
                settingsListener = null;
                moduleState.settingsListener = null;
            }

            stopRuntime();
            moduleState.initialized = false;
            delete window[MODULE_KEY];
        }
    };

})();
