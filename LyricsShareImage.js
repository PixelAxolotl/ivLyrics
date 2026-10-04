// LyricsShareImage.js - 가사 이미지 공유 기능
const LyricsShareImage = (() => {
  // 기본 설정값
  const DEFAULT_SETTINGS = {
    // 배경
    backgroundType: 'coverBlur', // 'coverBlur', 'gradient', 'solid', 'transparent'
    backgroundColor: '#121212',
    backgroundOpacity: 0.6,
    backgroundBlur: 30, // 배경 블러 강도 (px)

    // 앨범 커버
    showCover: true,
    coverSize: 120,
    coverPosition: 'left', // 'left', 'center', 'hidden'
    coverRadius: 16,
    coverBlur: 0, // 앨범 커버 블러 강도 (px)

    // 곡 정보
    showTrackInfo: true,
    trackTitleSize: 26,
    trackTitleColor: '#ffffff',
    trackTitleWeight: '700',
    trackArtistSize: 18,
    trackArtistColor: '#ffffff',
    trackArtistOpacity: 0.65,
    trackArtistWeight: '500',

    // 가사
    lyricsDetail: 'line', // 'line', 'word'
    exportScale: 1, // 1, 2, 3 (Canva-style PNG scale)
    fontSource: 'default', // 'default', 'settings', 'custom' (앱 설정/직접 입력 글꼴 사용)
    customFontFamily: '',
    fontSize: 32, // 원어 크기 (px, 원어에만 적용)
    fontWeight: '600',
    lineHeight: 1.6,
    lyricsAlign: 'left', // 'left', 'center'
    showPronunciation: true,
    showTranslation: true,
    origColor: '#ffffff',
    origWeight: '600',
    pronColor: '#ffffff',
    pronOpacity: 0.5,
    pronSize: 20, // 줄 발음 크기 (px)
    wordReadingSize: 21, // 단어 발음 크기 (px, 단어 모드)
    wordReadingColor: '#ffffff',
    wordReadingWeight: '400',
    transColor: '#1DB954',
    transSize: 22, // 줄 번역 크기 (px)
    wordGlossSize: 21, // 단어 번역 크기 (px, 단어 모드)
    wordGlossColor: '#1DB954',
    wordGlossWeight: '500',
    pronWeight: '400',
    transWeight: '500',
    blockGap: 32, // 가사 블록 간 간격
    innerGap: 4, // 원어/발음/번역 간 간격

    // 레이아웃
    imageWidth: 1080, // 이미지 너비
    padding: 60,
    aspectRatio: null, // null = auto, 1 = square, 16/9 = landscape

    // 기타
    showWatermark: true,
  };

  // 프리셋 (템플릿)
  const PRESETS = {
    cover: {
      name: 'Cover Blur',
      settings: {
        lyricsDetail: 'line',
        backgroundType: 'coverBlur',
        backgroundOpacity: 0.55,
        backgroundBlur: 30,
        showCover: true,
        coverSize: 130,
        coverPosition: 'left',
        coverRadius: 16,
        coverBlur: 0,
        fontSize: 34,
        fontWeight: '600',
        origWeight: '600',
        pronSize: 21,
        transSize: 23,
        wordReadingSize: 22,
        wordGlossSize: 22,
        lyricsAlign: 'left',
        blockGap: 36,
        innerGap: 3,
        padding: 60,
        aspectRatio: null,
        showPronunciation: true,
        showTranslation: true,
        showTrackInfo: true,
        showWatermark: true,
      }
    },
    gradient: {
      name: 'Gradient',
      settings: {
        lyricsDetail: 'line',
        backgroundType: 'gradient',
        backgroundOpacity: 0.6,
        backgroundBlur: 0,
        showCover: true,
        coverSize: 100,
        coverPosition: 'left',
        coverRadius: 12,
        coverBlur: 0,
        fontSize: 32,
        fontWeight: '500',
        origWeight: '500',
        pronSize: 20,
        transSize: 22,
        wordReadingSize: 21,
        wordGlossSize: 21,
        lyricsAlign: 'left',
        blockGap: 32,
        innerGap: 4,
        padding: 65,
        aspectRatio: null,
        showPronunciation: true,
        showTranslation: true,
        showTrackInfo: true,
        showWatermark: true,
      }
    },
    minimal: {
      name: 'Minimal',
      settings: {
        lyricsDetail: 'line',
        backgroundType: 'solid',
        backgroundColor: '#0a0a0a',
        backgroundOpacity: 0.6,
        backgroundBlur: 0,
        showCover: false,
        coverSize: 120,
        coverPosition: 'left',
        coverRadius: 16,
        coverBlur: 0,
        showTrackInfo: true,
        fontSize: 36,
        fontWeight: '500',
        origWeight: '500',
        pronSize: 22,
        transSize: 24,
        wordReadingSize: 24,
        wordGlossSize: 24,
        lyricsAlign: 'center',
        blockGap: 40,
        innerGap: 5,
        padding: 80,
        aspectRatio: null,
        showPronunciation: true,
        showTranslation: true,
        showWatermark: true,
      }
    },
    glass: {
      name: 'Glass',
      settings: {
        lyricsDetail: 'line',
        backgroundType: 'coverBlur',
        backgroundOpacity: 0.7,
        backgroundBlur: 50,
        showCover: true,
        coverSize: 110,
        coverPosition: 'left',
        coverRadius: 20,
        coverBlur: 0,
        fontSize: 30,
        fontWeight: '500',
        origWeight: '500',
        pronSize: 19,
        transSize: 20,
        wordReadingSize: 21,
        wordGlossSize: 21,
        lyricsAlign: 'left',
        blockGap: 30,
        innerGap: 3,
        padding: 55,
        aspectRatio: null,
        showPronunciation: true,
        showTranslation: true,
        showTrackInfo: true,
        showWatermark: true,
      }
    },
    word: {
      name: 'Word Study',
      settings: {
        lyricsDetail: 'word',
        backgroundType: 'coverBlur',
        backgroundOpacity: 0.55,
        backgroundBlur: 30,
        showCover: true,
        coverSize: 120,
        coverPosition: 'left',
        coverRadius: 16,
        coverBlur: 0,
        fontSize: 30,
        fontWeight: '600',
        origWeight: '600',
        pronSize: 19,
        transSize: 20,
        wordReadingSize: 21,
        wordGlossSize: 21,
        lyricsAlign: 'center',
        blockGap: 36,
        innerGap: 4,
        padding: 70,
        aspectRatio: null,
        showPronunciation: true,
        showTranslation: true,
        showTrackInfo: true,
        showWatermark: true,
      }
    },
  };

  // TEMPLATES를 PRESETS로 export (하위 호환성)
  const TEMPLATES = Object.fromEntries(
    Object.entries(PRESETS).map(([key, preset]) => [key, { name: preset.name, ...preset.settings }])
  );

  // Spotify 이미지 URL 변환
  function convertImageUrl(url) {
    if (!url) return null;

    // spotify:image: 형식 처리
    if (url.startsWith('spotify:image:')) {
      const imageId = url.split(':')[2];
      return `https://i.scdn.co/image/${imageId}`;
    }

    // 이미 https URL이면 그대로
    if (url.startsWith('https://')) {
      return url;
    }

    // localfile 등은 사용 불가
    if (url.includes('localfile')) {
      return null;
    }

    return url;
  }

  // 앨범 커버에서 주요 색상 추출
  async function extractColors(imageUrl) {
    const convertedUrl = convertImageUrl(imageUrl);

    const fallbackColors = () => ({
      primary: '#1a1a1a',
      darker: '#000000',
      lighter: '#333333',
      isDark: true,
      textColor: '#ffffff',
      subTextColor: 'rgba(255,255,255,0.7)',
    });

    return new Promise((resolve) => {
      if (!convertedUrl) {
        resolve(fallbackColors());
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = 50;
          canvas.height = 50;
          ctx.drawImage(img, 0, 0, 50, 50);

          const imageData = ctx.getImageData(0, 0, 50, 50).data;
          let r = 0, g = 0, b = 0, count = 0;

        // 샘플링하여 평균 색상 계산
        for (let i = 0; i < imageData.length; i += 16) {
          r += imageData[i];
          g += imageData[i + 1];
          b += imageData[i + 2];
          count++;
        }

        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);

        // 밝기 계산
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const isDark = brightness < 128;

        resolve({
          primary: `rgb(${r}, ${g}, ${b})`,
          darker: `rgb(${Math.floor(r * 0.3)}, ${Math.floor(g * 0.3)}, ${Math.floor(b * 0.3)})`,
          lighter: `rgb(${Math.min(255, r + 50)}, ${Math.min(255, g + 50)}, ${Math.min(255, b + 50)})`,
          isDark,
          textColor: isDark ? '#ffffff' : '#000000',
          subTextColor: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
        });
        } catch (e) {
          console.warn('[LyricsShareImage] Color extraction failed:', e);
          resolve(fallbackColors());
        }
      };
      img.onerror = () => {
        console.warn('[LyricsShareImage] Image load failed for color extraction');
        resolve(fallbackColors());
      };
      img.src = convertedUrl;
    });
  }

  // 이미지 로드 헬퍼
  function loadImage(url) {
    const convertedUrl = convertImageUrl(url);

    return new Promise((resolve, reject) => {
      if (!convertedUrl) {
        reject(new Error('Invalid image URL'));
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => {
        console.warn('[LyricsShareImage] Image load failed:', convertedUrl);
        reject(e);
      };
      img.src = convertedUrl;
    });
  }

  // 텍스트 줄바꿈 처리
  function wrapText(ctx, text, maxWidth) {
    const tokens = String(text || '').match(/\S+|\s+/gu) || [];
    const lines = [];
    let currentLine = '';

    const pushOversizedToken = (token) => {
      for (const char of Array.from(token)) {
        const testLine = currentLine + char;
        if (currentLine && ctx.measureText(testLine).width > maxWidth) {
          lines.push(currentLine.trimEnd());
          currentLine = char;
        } else {
          currentLine = testLine;
        }
      }
    };

    for (const token of tokens) {
      if (!currentLine && /^\s+$/u.test(token)) continue;
      const testLine = currentLine + token;
      if (!currentLine || ctx.measureText(testLine).width <= maxWidth) {
        if (ctx.measureText(token).width > maxWidth) pushOversizedToken(token);
        else currentLine = testLine;
        continue;
      }

      if (currentLine.trim()) lines.push(currentLine.trimEnd());
      currentLine = '';
      if (/^\s+$/u.test(token)) continue;
      if (ctx.measureText(token).width > maxWidth) pushOversizedToken(token);
      else currentLine = token;
    }
    if (currentLine.trim()) lines.push(currentLine.trimEnd());
    return lines;
  }

  // 둥근 사각형 그리기
  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  // 기본 내보내기 글꼴 스택 (fontSource 'default')
  const DEFAULT_FONT_STACK = '"Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  function stackFor(name) {
    const value = String(name || '').trim().replace(/"/g, '');
    if (!value) return DEFAULT_FONT_STACK;
    if (value.includes(',')) return value;
    return `"${value}", ${DEFAULT_FONT_STACK}`;
  }

  // 글꼴 출처에 따라 타입별 글꼴 결정: 'settings'면 앱 설정(원어/발음/번역 글꼴),
  // 'custom'이면서 입력값이 있으면 직접 입력한 글꼴을 전부 적용
  function resolveExportFonts(cfg) {
    if (cfg.fontSource === 'custom' && String(cfg.customFontFamily || '').trim()) {
      const stack = stackFor(cfg.customFontFamily);
      return { original: stack, phonetic: stack, translation: stack };
    }
    if (cfg.fontSource !== 'settings') {
      return { original: DEFAULT_FONT_STACK, phonetic: DEFAULT_FONT_STACK, translation: DEFAULT_FONT_STACK };
    }
    let visual = {};
    try {
      visual = window.CONFIG?.visual || {};
    } catch { visual = {}; }
    return {
      original: stackFor(visual['original-font-family']),
      phonetic: stackFor(visual['phonetic-font-family']),
      translation: stackFor(visual['translation-font-family']),
    };
  }

  // 16진수 색상 + 투명도를 canvas rgba() 문자열로 변환
  function hexToRgba(hex, opacity) {
    const match = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
    if (!match) return `rgba(255, 255, 255, ${opacity})`;
    const int = parseInt(match[1], 16);
    return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${opacity})`;
  }

  // 단어별(word-level) 내보내기: 각 단어를 [원어/읽기/글로스] 미니 스택 컬럼으로 배치.
  // 라인 모드와 달리 줄바꿈 단위가 단어가 되며, 데이터가 없으면 라인 렌더링으로 폴백한다.
  function getWordEntries(line, cfg) {
    if (cfg.lyricsDetail !== 'word') return null;
    if (!line || !Array.isArray(line.words) || line.words.length === 0) return null;
    const entries = line.words.map((entry) => ({
      text: String(entry?.w ?? entry?.text ?? '').trim(),
      reading: cfg.showPronunciation ? String(entry?.reading ?? '').trim() : '',
      gloss: cfg.showTranslation ? String(entry?.gloss ?? '').trim() : '',
    })).filter((entry) => entry.text);
    return entries.length > 0 ? entries : null;
  }

  function layoutWordRows(ctx, entries, cfg, fonts, originalFontSize, maxTextWidth) {
    // 단어 주석 크기는 각 슬라이더를 따름 (절대 px)
    const readingFontSize = Math.max(8, Math.floor(cfg.wordReadingSize ?? 21));
    const glossFontSize = Math.max(8, Math.floor(cfg.wordGlossSize ?? 21));
    const wordGap = Math.floor(originalFontSize * 0.6);
    const innerWordGap = Math.max(2, Math.floor(cfg.innerGap / 2));
    const origLH = originalFontSize * cfg.lineHeight;
    const readingLH = readingFontSize * 1.3;
    const glossLH = glossFontSize * 1.3;

    const columns = entries.map((entry) => {
      ctx.font = `${cfg.origWeight} ${originalFontSize}px ${fonts.original}`;
      const origW = ctx.measureText(entry.text).width;
      let readingW = 0;
      if (entry.reading) {
        ctx.font = `${cfg.wordReadingWeight || '400'} ${readingFontSize}px ${fonts.phonetic}`;
        readingW = ctx.measureText(entry.reading).width;
      }
      let glossW = 0;
      if (entry.gloss) {
        ctx.font = `${cfg.wordGlossWeight || '500'} ${glossFontSize}px ${fonts.translation}`;
        glossW = ctx.measureText(entry.gloss).width;
      }
      return { entry, width: Math.max(origW, readingW, glossW) };
    });

    const rows = [];
    let current = [];
    let currentWidth = 0;
    for (const column of columns) {
      const needed = current.length === 0 ? column.width : currentWidth + wordGap + column.width;
      if (current.length > 0 && needed > maxTextWidth) {
        rows.push(current);
        current = [column];
        currentWidth = column.width;
      } else {
        current.push(column);
        currentWidth = needed;
      }
    }
    if (current.length > 0) rows.push(current);

    const rowHeight = (row) => {
      const hasReading = row.some((column) => column.entry.reading);
      const hasGloss = row.some((column) => column.entry.gloss);
      return origLH
        + (hasReading ? innerWordGap + readingLH : 0)
        + (hasGloss ? innerWordGap + glossLH : 0);
    };
    const blockHeight = rows.reduce((sum, row) => sum + rowHeight(row), 0)
      + (rows.length > 1 ? (rows.length - 1) * Math.floor(cfg.innerGap * 2) : 0);

    return { rows, blockHeight, readingFontSize, glossFontSize, wordGap, innerWordGap, rowHeight };
  }

  // 각 가사 블록을 줄바꿈 처리하고 높이를 계산 (렌더링 순서와 무관한 순수 측정 단계)
  function measureLyricsBlocks(ctx, lyrics, cfg, fonts, originalFontSize, pronFontSize, transFontSize, maxTextWidth) {
    let totalLyricsHeight = 0;
    const processedLyrics = lyrics.map((line, idx) => {
      const wordEntries = getWordEntries(line, cfg);
      if (wordEntries) {
        const layout = layoutWordRows(ctx, wordEntries, cfg, fonts, originalFontSize, maxTextWidth);
        ctx.font = `${cfg.transWeight || '500'} ${transFontSize}px ${fonts.translation}`;
        const trans = cfg.showTranslation ? (line.transText || null) : null;
        const wrappedTrans = trans ? wrapText(ctx, trans, maxTextWidth) : [];
        const transHeight = wrappedTrans.length > 0 ? wrappedTrans.length * (transFontSize * 1.4) + cfg.innerGap : 0;
        const blockHeight = layout.blockHeight + transHeight;
        totalLyricsHeight += blockHeight + (idx < lyrics.length - 1 ? cfg.blockGap : 0);
        return { isWordMode: true, wordLayout: layout, wrappedOrig: [], wrappedPron: [], wrappedTrans, blockHeight };
      }

      const orig = line.originalText || line.displayText || '';
      const pron = cfg.showPronunciation ? (line.pronText || null) : null;
      const trans = cfg.showTranslation ? (line.transText || null) : null;

      ctx.font = `${cfg.origWeight} ${originalFontSize}px ${fonts.original}`;
      const wrappedOrig = wrapText(ctx, orig, maxTextWidth);

      ctx.font = `${cfg.pronWeight || '400'} ${pronFontSize}px ${fonts.phonetic}`;
      const wrappedPron = pron ? wrapText(ctx, pron, maxTextWidth) : [];

      ctx.font = `${cfg.transWeight || '500'} ${transFontSize}px ${fonts.translation}`;
      const wrappedTrans = trans ? wrapText(ctx, trans, maxTextWidth) : [];

      // 블록 높이 계산 (원어 + 발음 + 번역 + 내부 간격)
      const origHeight = wrappedOrig.length * (originalFontSize * cfg.lineHeight);
      const pronHeight = wrappedPron.length > 0 ? wrappedPron.length * (pronFontSize * 1.4) + cfg.innerGap : 0;
      const transHeight = wrappedTrans.length > 0 ? wrappedTrans.length * (transFontSize * 1.4) + cfg.innerGap : 0;
      const blockHeight = origHeight + pronHeight + transHeight;

      totalLyricsHeight += blockHeight + (idx < lyrics.length - 1 ? cfg.blockGap : 0);

      return { wrappedOrig, wrappedPron, wrappedTrans, blockHeight };
    });
    return { totalLyricsHeight, processedLyrics };
  }

  // 측정된 가사 블록을 순서대로 캔버스에 그림 (원어 -> 발음 -> 번역)
  // 단어 모드에서는 단어 컬럼 행을 먼저 그린 뒤 전체 줄 번역을 보조로 덧붙인다.
  function drawLyricsBlocks(ctx, cfg, processedLyrics, fonts, originalFontSize, pronFontSize, transFontSize, textX, startY) {
    // 캔버스는 exportScale 배율로 커지지만 좌표계는 기본 크기 기준이므로 나눔
    const canvasWidth = (ctx.canvas?.width || 0) / (cfg.exportScale || 1);
    let currentY = startY;
    for (let i = 0; i < processedLyrics.length; i++) {
      const block = processedLyrics[i];

      if (block.isWordMode && block.wordLayout) {
        const layout = block.wordLayout;
        const centered = cfg.lyricsAlign === 'center';
        const rightAligned = cfg.lyricsAlign === 'right';
        const align = centered ? 'center' : rightAligned ? 'right' : 'left';
        for (let rowIndex = 0; rowIndex < layout.rows.length; rowIndex++) {
          const row = layout.rows[rowIndex];
          const rowWidth = row.reduce((sum, column) => sum + column.width, 0) + layout.wordGap * (row.length - 1);
          const rowStart = centered ? (canvasWidth / 2 - rowWidth / 2) : rightAligned ? textX - rowWidth : textX;
          let cursorX = rowStart;
          const hasReading = row.some((column) => column.entry.reading);
          const hasGloss = row.some((column) => column.entry.gloss);

          ctx.font = `${cfg.origWeight} ${originalFontSize}px ${fonts.original}`;
          ctx.fillStyle = cfg.origColor || '#ffffff';
          ctx.textAlign = align;
          for (const column of row) {
            const drawX = centered ? cursorX + column.width / 2 : rightAligned ? cursorX + column.width : cursorX;
            ctx.fillText(column.entry.text, drawX, currentY, column.width + 1);
            cursorX += column.width + layout.wordGap;
          }
          currentY += originalFontSize * cfg.lineHeight;

          if (hasReading) {
            currentY += layout.innerWordGap;
            ctx.fillStyle = hexToRgba(cfg.wordReadingColor, cfg.pronOpacity);
            ctx.font = `${cfg.wordReadingWeight || '400'} ${layout.readingFontSize}px ${fonts.phonetic}`;
            cursorX = rowStart;
            for (const column of row) {
              if (!column.entry.reading) {
                cursorX += column.width + layout.wordGap;
                continue;
              }
              const drawX = centered ? cursorX + column.width / 2 : rightAligned ? cursorX + column.width : cursorX;
              ctx.fillText(column.entry.reading, drawX, currentY, column.width + 1);
              cursorX += column.width + layout.wordGap;
            }
            currentY += layout.readingFontSize * 1.3;
          }

          if (hasGloss) {
            currentY += layout.innerWordGap;
            ctx.fillStyle = cfg.wordGlossColor || cfg.transColor;
            ctx.font = `${cfg.wordGlossWeight || '500'} ${layout.glossFontSize}px ${fonts.translation}`;
            cursorX = rowStart;
            for (const column of row) {
              if (!column.entry.gloss) {
                cursorX += column.width + layout.wordGap;
                continue;
              }
              const drawX = centered ? cursorX + column.width / 2 : rightAligned ? cursorX + column.width : cursorX;
              ctx.fillText(column.entry.gloss, drawX, currentY, column.width + 1);
              cursorX += column.width + layout.wordGap;
            }
            currentY += layout.glossFontSize * 1.3;
          }

          if (rowIndex < layout.rows.length - 1) {
            currentY += Math.floor(cfg.innerGap * 2);
          }
        }

        if (block.wrappedTrans.length > 0) {
          currentY += cfg.innerGap;
          ctx.fillStyle = cfg.transColor;
          ctx.font = `${cfg.transWeight || '500'} ${transFontSize}px ${fonts.translation}`;
          ctx.textAlign = align;
          const transX = centered ? canvasWidth / 2 : textX;
          for (const line of block.wrappedTrans) {
            ctx.fillText(line, transX, currentY);
            currentY += transFontSize * 1.4;
          }
        }

        if (i < processedLyrics.length - 1) {
          currentY += cfg.blockGap;
        }
        continue;
      }

      // 원어 텍스트
      ctx.textAlign = cfg.lyricsAlign;
      ctx.fillStyle = cfg.origColor || '#ffffff';
      ctx.font = `${cfg.origWeight} ${originalFontSize}px ${fonts.original}`;
      for (const line of block.wrappedOrig) {
        ctx.fillText(line, textX, currentY);
        currentY += originalFontSize * cfg.lineHeight;
      }

      // 발음 텍스트
      if (block.wrappedPron.length > 0) {
        currentY += cfg.innerGap;
        ctx.fillStyle = hexToRgba(cfg.pronColor, cfg.pronOpacity);
        ctx.font = `${cfg.pronWeight || '400'} ${pronFontSize}px ${fonts.phonetic}`;
        for (const line of block.wrappedPron) {
          ctx.fillText(line, textX, currentY);
          currentY += pronFontSize * 1.4;
        }
      }

      // 번역 텍스트
      if (block.wrappedTrans.length > 0) {
        currentY += cfg.innerGap;
        ctx.fillStyle = cfg.transColor;
        ctx.font = `${cfg.transWeight || '500'} ${transFontSize}px ${fonts.translation}`;
        for (const line of block.wrappedTrans) {
          ctx.fillText(line, textX, currentY);
          currentY += transFontSize * 1.4;
        }
      }

      // 블록 간 간격
      if (i < processedLyrics.length - 1) {
        currentY += cfg.blockGap;
      }
    }
    return currentY;
  }

  /**
   * 가사 이미지 생성
   * @param {Object} options - 옵션
   * @param {Array} options.lyrics - 가사 라인 배열 (line.words 지원: [{w, reading, gloss}])
   * @param {string} options.trackName - 곡 제목
   * @param {string} options.artistName - 아티스트 이름
   * @param {string} options.albumCover - 앨범 커버 URL
   * @param {string} options.template - 프리셋 이름 (cover, gradient, minimal, glass)
   * @param {Object} options.customSettings - 커스텀 설정 (템플릿 설정 덮어쓰기)
   * @param {number} options.width - 이미지 너비 (기본: 1080)
   * @param {'both'|'dataUrl'|'blob'} options.output - Encode only the requested output (default: both)
   * @returns {Promise<{canvas: HTMLCanvasElement, dataUrl: string|null, blob: Blob|null}>}
   */
  async function generateImage(options) {
    const {
      lyrics = [],
      trackName = '',
      artistName = '',
      albumCover = '',
      template = 'cover',
      customSettings = {},
      width: optionWidth,
      output = 'both',
    } = options;

    // 프리셋 + 커스텀 설정 병합
    const preset = PRESETS[template]?.settings || PRESETS.cover.settings;
    const cfg = { ...DEFAULT_SETTINGS, ...preset, ...customSettings };
    // Preserve callers using the previous original-lyric weight setting.
    cfg.origWeight = customSettings.origWeight ?? customSettings.fontWeight
      ?? preset.origWeight ?? preset.fontWeight ?? DEFAULT_SETTINGS.origWeight;

    // 이미지 너비: optionWidth > customSettings.imageWidth > cfg.imageWidth
    // exportScale 배율은 측정(기본 좌표) → 캔버스 확대 + setTransform 순서로 적용해
    // 벡터 텍스트가 깨지지 않는 진짜 고해상도 렌더링을 만든다.
    const exportScale = cfg.exportScale || 1;
    const width = optionWidth || cfg.imageWidth || 1080;

    const colors = await extractColors(albumCover);

    // 캔버스 생성
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // 폰트 설정 (글꼴 출처에 따라 앱 설정 글꼴 사용 가능)
    const fonts = resolveExportFonts(cfg);
    try {
      await document.fonts?.ready;
    } catch { /* 웹폰트 미로딩 시 기본 스택으로 폴백 */ }

    // 폰트 크기 (타입별 절대 px: 1번 슬라이더는 원어에만 영향)
    // 비율이 정해져 있고 내용이 넘치면 전체를 축소해 비율을 정확히 맞춤
    const FIT_KEYS = ['fontSize', 'coverSize', 'coverRadius', 'padding', 'blockGap', 'innerGap',
      'pronSize', 'transSize', 'wordReadingSize', 'wordGlossSize', 'trackTitleSize', 'trackArtistSize'];
    const measureAll = (active) => {
      const originalFontSize = active.fontSize;
      const pronFontSize = Math.max(8, active.pronSize ?? 20);
      const transFontSize = Math.max(8, active.transSize ?? 22);
      const maxTextWidth = width - active.padding * 2;
      const measured = measureLyricsBlocks(
        ctx, lyrics, active, fonts, originalFontSize, pronFontSize, transFontSize, maxTextWidth
      );
      const headerHeight = measureHeaderBlock(active);
      const footerHeight = active.showWatermark ? 60 : 30;
      const height = active.padding + headerHeight + measured.totalLyricsHeight + footerHeight + active.padding;
      return { ...measured, originalFontSize, pronFontSize, transFontSize, maxTextWidth, headerHeight, footerHeight, height };
    };

    let eff = cfg;
    let layout = measureAll(eff);
    let calculatedHeight = layout.height;
    if (cfg.aspectRatio) {
      const ratioHeight = width / cfg.aspectRatio;
      const chrome = layout.headerHeight + layout.footerHeight + eff.padding * 2;
      if (calculatedHeight > ratioHeight && layout.totalLyricsHeight > 0) {
        const fit = (ratioHeight - chrome) / layout.totalLyricsHeight;
        if (fit > 0 && fit < 1) {
          const scaled = { ...cfg };
          for (const key of FIT_KEYS) scaled[key] = (scaled[key] ?? 0) * fit;
          eff = scaled;
          layout = measureAll(eff);
          calculatedHeight = ratioHeight;
        } else {
          calculatedHeight = Math.max(calculatedHeight, ratioHeight);
        }
      } else {
        calculatedHeight = Math.max(calculatedHeight, ratioHeight);
      }
    }
    const { processedLyrics, originalFontSize, pronFontSize, transFontSize, maxTextWidth } = layout;

    canvas.width = Math.round(width * exportScale);
    canvas.height = Math.round(calculatedHeight * exportScale);
    if (exportScale !== 1 && typeof ctx.setTransform === 'function') {
      ctx.setTransform(exportScale, 0, 0, exportScale, 0, 0);
    }

    // ========== 배경 렌더링 ==========
    await drawBackground(ctx, eff, albumCover, colors, width, calculatedHeight);

    let currentY = eff.padding;

    // ========== 헤더 (앨범 커버 + 곡 정보) ==========
    currentY = await drawHeader(ctx, eff, albumCover, trackName, artistName, width, currentY, fonts.original);

    // ========== 가사 렌더링 ==========
    const textX = eff.lyricsAlign === 'center' ? width / 2 : eff.lyricsAlign === 'right' ? width - eff.padding : eff.padding;
    ctx.textAlign = eff.lyricsAlign;
    ctx.textBaseline = 'top';

    drawLyricsBlocks(ctx, eff, processedLyrics, fonts, originalFontSize, pronFontSize, transFontSize, textX, currentY);

    // ========== 워터마크 ==========
    const drawWatermark = () => {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = `500 13px ${fonts.original}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Spotify', width / 2, calculatedHeight - eff.padding + 10);
    };
    if (cfg.showWatermark) {
      drawWatermark();
    }

    // Blob 생성
    const dataUrl = output === 'blob' ? null : canvas.toDataURL('image/png');
    const blob = output === 'dataUrl'
      ? null
      : await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

    return { canvas, dataUrl, blob };
  }

  // 블러 이미지 생성 (OffscreenCanvas 사용)
  async function createBlurredImage(img, blurAmount, targetWidth, targetHeight) {
    if (blurAmount <= 0) return img;

    // 블러용 임시 캔버스 생성
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');

    // 블러를 위해 약간 더 크게 만들어서 가장자리 문제 방지
    const padding = blurAmount * 2;
    tempCanvas.width = targetWidth + padding * 2;
    tempCanvas.height = targetHeight + padding * 2;

    // 이미지를 확대해서 그림
    const scale = Math.max(tempCanvas.width / img.width, tempCanvas.height / img.height) * 1.1;
    const imgW = img.width * scale;
    const imgH = img.height * scale;
    tempCtx.drawImage(img, (tempCanvas.width - imgW) / 2, (tempCanvas.height - imgH) / 2, imgW, imgH);

    // CSS 블러 필터 적용
    tempCtx.filter = `blur(${blurAmount}px)`;
    tempCtx.drawImage(tempCanvas, 0, 0);
    tempCtx.filter = 'none';

    return tempCanvas;
  }

  // 배경 그리기
  async function drawBackground(ctx, cfg, albumCover, colors, width, height) {
    const bgType = cfg.backgroundType;
    const blurAmount = cfg.backgroundBlur || 30;

    if (bgType === 'coverBlur' && albumCover) {
      try {
        const coverImg = await loadImage(albumCover);

        // 블러가 적용된 배경 생성
        if (blurAmount > 0) {
          const blurredBg = await createBlurredImage(coverImg, blurAmount, width, height);
          // 블러된 이미지 중앙 부분만 사용
          const padding = blurAmount * 2;
          ctx.drawImage(blurredBg, padding, padding, width, height, 0, 0, width, height);
        } else {
          // 블러 없이 커버 이미지 배경
          const scale = Math.max(width / coverImg.width, height / coverImg.height) * 1.2;
          const imgW = coverImg.width * scale;
          const imgH = coverImg.height * scale;
          ctx.drawImage(coverImg, (width - imgW) / 2, (height - imgH) / 2, imgW, imgH);
        }

        ctx.fillStyle = `rgba(0, 0, 0, ${cfg.backgroundOpacity})`;
        ctx.fillRect(0, 0, width, height);
      } catch (e) {
        // 폴백
        ctx.fillStyle = cfg.backgroundColor || '#121212';
        ctx.fillRect(0, 0, width, height);
      }
    } else if (bgType === 'gradient') {
      const grad = ctx.createLinearGradient(0, 0, width * 0.3, height);
      grad.addColorStop(0, colors.darker);
      grad.addColorStop(0.5, colors.primary);
      grad.addColorStop(1, colors.darker);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = `rgba(0, 0, 0, ${cfg.backgroundOpacity * 0.5})`;
      ctx.fillRect(0, 0, width, height);
    } else if (bgType === 'solid') {
      ctx.fillStyle = cfg.backgroundColor || '#121212';
      ctx.fillRect(0, 0, width, height);
    } else if (bgType === 'transparent') {
      // 투명 배경 (아무것도 그리지 않음)
    } else {
      ctx.fillStyle = '#121212';
      ctx.fillRect(0, 0, width, height);
    }
  }

  // 트랙 제목/아티스트 실제 렌더링 크기와 헤더 블록 높이 (중앙 커버 겹침 방지)
  function trackTextSizes(cfg) {
    return {
      titleSize: Math.max(8, cfg.trackTitleSize ?? 26),
      artistSize: Math.max(8, cfg.trackArtistSize ?? 18),
    };
  }

  function measureHeaderBlock(cfg) {
    const { titleSize, artistSize } = trackTextSizes(cfg);
    if (cfg.showCover && cfg.coverPosition !== 'hidden') {
      if (!cfg.showTrackInfo) return cfg.coverSize + 30;
      if (cfg.coverPosition === 'center') {
        return cfg.coverSize + 16 + titleSize + 8 + artistSize + 24;
      }
      const infoCenter = cfg.coverSize / 2;
      return Math.max(cfg.coverSize + 40, infoCenter + 4 + artistSize + 28);
    }
    if (cfg.showTrackInfo) return titleSize + 8 + artistSize + 24;
    return 20;
  }

  // 헤더 그리기
  async function drawHeader(ctx, cfg, albumCover, trackName, artistName, width, startY, fontFamily) {
    let currentY = startY;

    if (cfg.showCover && cfg.coverPosition !== 'hidden' && albumCover) {
      try {
        const coverImg = await loadImage(albumCover);
        let coverX;

        if (cfg.coverPosition === 'center') {
          coverX = (width - cfg.coverSize) / 2;
        } else {
          coverX = cfg.padding;
        }

        // 그림자
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 25;
        ctx.shadowOffsetY = 12;

        // 둥근 커버
        ctx.save();
        roundRect(ctx, coverX, currentY, cfg.coverSize, cfg.coverSize, cfg.coverRadius);
        ctx.clip();

        // 커버 블러 적용
        if (cfg.coverBlur && cfg.coverBlur > 0) {
          const blurredCover = await createBlurredImage(coverImg, cfg.coverBlur, cfg.coverSize, cfg.coverSize);
          const padding = cfg.coverBlur * 2;
          ctx.drawImage(blurredCover, padding, padding, cfg.coverSize, cfg.coverSize, coverX, currentY, cfg.coverSize, cfg.coverSize);
        } else {
          ctx.drawImage(coverImg, coverX, currentY, cfg.coverSize, cfg.coverSize);
        }
        ctx.restore();

        // 그림자 초기화
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        // 곡 정보
        if (cfg.showTrackInfo) {
          const { titleSize, artistSize } = trackTextSizes(cfg);
          const titleFont = `${cfg.trackTitleWeight || '700'} ${titleSize}px ${fontFamily}`;
          const artistFont = `${cfg.trackArtistWeight || '500'} ${artistSize}px ${fontFamily}`;
          if (cfg.coverPosition === 'center') {
            // 커버 아래에 중앙 정렬 (제목/아티스트 실제 높이를 반영해 겹침 방지)
            const titleY = currentY + cfg.coverSize + 16;
            const artistY = titleY + titleSize + 8;
            ctx.fillStyle = cfg.trackTitleColor || '#ffffff';
            ctx.font = titleFont;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(trackName, width / 2, titleY, width - cfg.padding * 2);

            ctx.fillStyle = hexToRgba(cfg.trackArtistColor, cfg.trackArtistOpacity ?? 0.65);
            ctx.font = artistFont;
            ctx.fillText(artistName, width / 2, artistY, width - cfg.padding * 2);

            currentY += measureHeaderBlock(cfg);
          } else {
            // 커버 오른쪽에
            const infoX = coverX + cfg.coverSize + 24;
            const infoY = currentY + cfg.coverSize / 2;

            ctx.fillStyle = cfg.trackTitleColor || '#ffffff';
            ctx.font = titleFont;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(trackName, infoX, infoY - 4, width - infoX - cfg.padding);

            ctx.fillStyle = hexToRgba(cfg.trackArtistColor, cfg.trackArtistOpacity ?? 0.65);
            ctx.font = artistFont;
            ctx.textBaseline = 'top';
            ctx.fillText(artistName, infoX, infoY + 4, width - infoX - cfg.padding);

            currentY += measureHeaderBlock(cfg);
          }
        } else {
          currentY += cfg.coverSize + 30;
        }
      } catch (e) {
        // 커버 로드 실패 시 텍스트만
        if (cfg.showTrackInfo) {
          currentY = drawTrackInfoOnly(ctx, cfg, trackName, artistName, width, currentY, fontFamily);
        }
      }
    } else if (cfg.showTrackInfo) {
      currentY = drawTrackInfoOnly(ctx, cfg, trackName, artistName, width, currentY, fontFamily);
    }

    return currentY;
  }

  // 곡 정보만 그리기 (커버 없이)
  function drawTrackInfoOnly(ctx, cfg, trackName, artistName, width, startY, fontFamily) {
    const { titleSize, artistSize } = trackTextSizes(cfg);
    ctx.fillStyle = cfg.trackTitleColor || '#ffffff';
    ctx.font = `${cfg.trackTitleWeight || '700'} ${titleSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(trackName, width / 2, startY);

    ctx.fillStyle = hexToRgba(cfg.trackArtistColor, cfg.trackArtistOpacity ?? 0.65);
    ctx.font = `${cfg.trackArtistWeight || '500'} ${artistSize}px ${fontFamily}`;
    ctx.fillText(artistName, width / 2, startY + titleSize + 8);

    return startY + titleSize + 8 + artistSize + 24;
  }

  /**
   * 클립보드에 이미지 복사
   */
  async function copyToClipboard(blob) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      return true;
    } catch (e) {
      console.error('[LyricsShareImage] Clipboard copy failed:', e);
      return false;
    }
  }

  /**
   * 이미지 다운로드
   */
  function download(dataUrl, filename = 'lyrics.png') {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Web Share API로 공유
   */
  async function share(blob, trackName, artistName) {
    const file = new File([blob], `${trackName} - ${artistName}.png`, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: `${trackName} - ${artistName}`,
          text: `🎵 ${trackName} by ${artistName}\n#ivLyrics #Spotify`,
        });
        return true;
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('[LyricsShareImage] Share failed:', e);
        }
        return false;
      }
    }
    return false;
  }

  // Public API
  return {
    TEMPLATES,
    PRESETS,
    DEFAULT_SETTINGS,
    generateImage,
    copyToClipboard,
    download,
    share,
    extractColors,
  };
})();

// 전역 등록
window.LyricsShareImage = LyricsShareImage;
