/**
 * SyncDataCreator - 노래방 싱크 데이터 생성 UI
 */

const SyncDataCreator = ({ trackInfo, initialData, onClose }) => {
	const { useState, useEffect, useRef, useCallback, useMemo } = react;

	const roundSyncTime = (time) => Math.round(time * 1000) / 1000;
	const EDGE_INTERPOLATION_GAP_SEC = 0.045;
	const SYNC_CREATOR_SHORTCUTS = {
		charForward: { primary: 'sync-creator-char-forward-key', secondary: 'sync-creator-char-forward-alt-key', defaultPrimary: 'right' },
		charBack: { primary: 'sync-creator-char-back-key', secondary: 'sync-creator-char-back-alt-key', defaultPrimary: 'left' },
		wordForward: { primary: 'sync-creator-word-forward-key', secondary: 'sync-creator-word-forward-alt-key', defaultPrimary: '.' },
		wordBack: { primary: 'sync-creator-word-back-key', secondary: 'sync-creator-word-back-alt-key', defaultPrimary: ',' },
		syllable: { primary: 'sync-creator-syllable-key', secondary: 'sync-creator-syllable-alt-key', defaultPrimary: ';' },
	};
	const normalizeHotkeyToken = (value) => {
		if (value === null || value === undefined) return '';
		const normalized = String(value).trim().toLowerCase();
		if (!normalized) return '';

		const aliases = {
			arrowright: 'right',
			arrowleft: 'left',
			arrowup: 'up',
			arrowdown: 'down',
			' ': 'space',
			spacebar: 'space',
			escape: 'esc',
			return: 'enter',
			del: 'delete',
			control: 'ctrl',
			command: 'meta',
			cmd: 'meta',
		};

		return aliases[normalized] || normalized;
	};
	const readSyncCreatorShortcutSetting = (settingKey, fallback = '') => {
		try {
			const fullKey = `ivLyrics:visual:${settingKey}`;
			const stored = localStorage.getItem(fullKey) ?? Spicetify.LocalStorage?.get(fullKey);
			const effectiveValue = stored !== null && stored !== undefined ? stored : fallback;
			return normalizeHotkeyToken(effectiveValue);
		} catch (e) {
			return normalizeHotkeyToken(fallback);
		}
	};
	const getSyncCreatorShortcutBindings = () => Object.entries(SYNC_CREATOR_SHORTCUTS).reduce((acc, [action, config]) => {
		const primary = readSyncCreatorShortcutSetting(config.primary, config.defaultPrimary);
		const secondary = readSyncCreatorShortcutSetting(config.secondary, '');
		acc[action] = [primary, secondary].filter(Boolean);
		return acc;
	}, {});
	const getNormalizedHotkeyFromEvent = (event) => {
		const parts = [];
		if (event.ctrlKey) parts.push('ctrl');
		if (event.altKey) parts.push('alt');
		if (event.shiftKey && normalizeHotkeyToken(event.key) !== 'shift') parts.push('shift');
		if (event.metaKey) parts.push('meta');

		const baseKey = normalizeHotkeyToken(event.key);
		if (!['ctrl', 'alt', 'shift', 'meta'].includes(baseKey)) {
			parts.push(baseKey);
		}
		return parts.join('+');
	};
	const formatHotkeyToken = (value) => {
		const token = normalizeHotkeyToken(value);
		const displayMap = {
			right: '→',
			left: '←',
			up: '↑',
			down: '↓',
			enter: 'Enter',
			backspace: '⌫',
			space: 'Space',
			esc: 'Esc',
			ctrl: 'Ctrl',
			alt: 'Alt',
			shift: 'Shift',
			meta: 'Meta',
		};
		if (displayMap[token]) return displayMap[token];
		return token.length === 1 ? token.toUpperCase() : token;
	};
	const formatHotkeyBinding = (binding) => binding
		.split('+')
		.filter(Boolean)
		.map(formatHotkeyToken)
		.join('+');
	const getSyncCreatorShortcutDisplay = (action) => {
		const bindings = getSyncCreatorShortcutBindings()[action] || [];
		return bindings.length ? bindings.map(formatHotkeyBinding).join(' / ') : '';
	};

	const isWordChar = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);
	const isLatinChar = (ch) => !!ch && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(ch);
	const isLatinVowel = (ch) => !!ch && /[AEIOUYaeiouyÀ-ÖØ-öø-ÿ]/.test(ch);
	const isInternalJoiner = (chars, index) => {
		const ch = chars[index];
		if (!ch || !/['’"]/u.test(ch)) return false;
		return isWordChar(chars[index - 1]) && isWordChar(chars[index + 1]);
	};
	const isWordBoundary = (chars, index) => {
		const ch = chars[index];
		if (!ch) return false;
		if (isInternalJoiner(chars, index)) return false;
		return /[\s\-–—]/u.test(ch);
	};
	const isLeadingChar = (chars, index) => {
		const ch = chars[index];
		if (!ch) return false;
		if (isInternalJoiner(chars, index)) return false;
		return /[\(\[\{「『【〈《¿¡'"“”‘’]/u.test(ch);
	};
	const isTrailingChar = (chars, index) => {
		const ch = chars[index];
		if (!ch) return false;
		if (isInternalJoiner(chars, index)) return false;
		return /[\s!?\.,;:\)\]\}」』】〉》'"“”‘’]/u.test(ch);
	};
	const isValidOnsetCluster = (cluster) => /^(bl|br|ch|chr|cl|cr|dr|fl|fr|gl|gr|ph|pl|pr|qu|sc|sch|scr|sh|sk|sl|sm|sn|sp|spl|spr|st|str|sw|th|thr|tr|tw|wh|wr)$/i.test(cluster);
	const edgeInterpolation = (progress) => {
		if (progress <= 0) return 0;
		if (progress >= 1) return 1;
		if (progress < 0.5) {
			const scaled = progress * 2;
			return 0.5 * (1 - Math.pow(1 - scaled, 3));
		}
		const scaled = (progress - 0.5) * 2;
		return 0.5 + (0.5 * Math.pow(scaled, 3));
	};
	const smoothStepInterpolation = (progress) => {
		if (progress <= 0) return 0;
		if (progress >= 1) return 1;
		return progress * progress * (3 - (2 * progress));
	};
	const applyInterpolatedRangeToCharTimes = (target, startIdx, endIdx, startTime, endTime, interpolationFn = edgeInterpolation) => {
		if (!target || startIdx > endIdx || startIdx < 0) return;
		const count = endIdx - startIdx + 1;
		const safeEndTime = Math.max(startTime, endTime);
		if (count <= 1) {
			target[startIdx] = roundSyncTime(startTime);
			return;
		}
		for (let i = 0; i < count; i++) {
			const progress = count === 1 ? 1 : i / (count - 1);
			target[startIdx + i] = roundSyncTime(startTime + ((safeEndTime - startTime) * interpolationFn(progress)));
		}
	};
	const estimateSegmentDuration = (startIdx, endIdx, scale = 0.055, maxDuration = 0.26) =>
		Math.min(maxDuration, Math.max(0.07, (endIdx - startIdx + 1) * scale));
	const estimateWordInterpolationDuration = (startIdx, endIdx) => {
		const charCount = Math.max(1, endIdx - startIdx + 1);
		const preferredDuration = charCount * 0.085;
		const minimumDuration = 0.11 + Math.max(0, charCount - 1) * 0.05;
		return Math.min(0.42, Math.max(minimumDuration, preferredDuration));
	};
	const buildLatinWordSyllables = (chars, wordStart, wordEnd) => {
		const nuclei = [];
		let index = wordStart;

		while (index <= wordEnd) {
			if (!isLatinVowel(chars[index])) {
				index++;
				continue;
			}

			const nucleusStart = index;
			index++;
			while (index <= wordEnd && isLatinVowel(chars[index])) {
				index++;
			}
			nuclei.push({ start: nucleusStart, end: index - 1 });
		}

		if (nuclei.length > 1) {
			const lastNucleus = nuclei[nuclei.length - 1];
			if (lastNucleus.start === lastNucleus.end &&
				lastNucleus.end === wordEnd &&
				/[eE]/.test(chars[lastNucleus.start]) &&
				isWordChar(chars[lastNucleus.start - 1])) {
				nuclei.pop();
			}
		}

		if (!nuclei.length) {
			return [{ start: wordStart, end: wordEnd }];
		}

		const syllables = [];
		let currentStart = wordStart;

		for (let i = 0; i < nuclei.length; i++) {
			const nucleus = nuclei[i];
			const nextNucleus = nuclei[i + 1];

			if (!nextNucleus) {
				syllables.push({ start: currentStart, end: wordEnd });
				break;
			}

			const consonantRunStart = nucleus.end + 1;
			const consonantRunEnd = nextNucleus.start - 1;
			let splitAfter = nucleus.end;

			if (consonantRunEnd >= consonantRunStart) {
				const runLength = consonantRunEnd - consonantRunStart + 1;
				if (runLength === 1) {
					splitAfter = nucleus.end;
				} else {
					splitAfter = consonantRunEnd - 1;
					const onsetCluster = chars.slice(splitAfter + 1, consonantRunEnd + 1).join('').toLowerCase();
					if (runLength > 2 && isValidOnsetCluster(onsetCluster)) {
						splitAfter = consonantRunStart - 1;
					}
				}
			}

			syllables.push({ start: currentStart, end: splitAfter });
			currentStart = splitAfter + 1;
		}

		return syllables.filter(segment => segment.start <= segment.end);
	};
	const buildLineSyllableSegments = (chars) => {
		if (!Array.isArray(chars) || !chars.length) return [];
		const segments = [];
		let index = 0;
		let pendingPrefixStart = 0;

		while (index < chars.length) {
			while (index < chars.length && isWordBoundary(chars, index)) {
				index++;
			}

			if (index >= chars.length) {
				break;
			}

			const prefixStart = pendingPrefixStart;
			let wordStart = index;
			while (wordStart < chars.length && isLeadingChar(chars, wordStart) && !isWordBoundary(chars, wordStart)) {
				wordStart++;
			}

			let wordEnd = wordStart;
			while (wordEnd < chars.length && !isWordBoundary(chars, wordEnd)) {
				wordEnd++;
			}
			wordEnd--;

			if (wordEnd < wordStart) {
				index++;
				pendingPrefixStart = index;
				continue;
			}

			let trailingEnd = wordEnd;
			while (trailingEnd >= wordStart && isTrailingChar(chars, trailingEnd) && !isInternalJoiner(chars, trailingEnd)) {
				trailingEnd--;
			}

			const coreEnd = Math.max(wordStart, trailingEnd);
			let wordSegments;

			if (!isLatinChar(chars[wordStart])) {
				wordSegments = [];
				for (let i = wordStart; i <= coreEnd; i++) {
					wordSegments.push({ start: i, end: i });
				}
			} else if (chars.slice(wordStart, coreEnd + 1).every(ch => isLatinChar(ch) || /['’]/u.test(ch))) {
				wordSegments = buildLatinWordSyllables(chars, wordStart, coreEnd);
			} else {
				wordSegments = [];
				for (let i = wordStart; i <= coreEnd; i++) {
					wordSegments.push({ start: i, end: i });
				}
			}

			if (!wordSegments.length) {
				wordSegments = [{ start: wordStart, end: coreEnd }];
			}

			wordSegments = wordSegments.map((segment, segmentIndex) => ({
				start: segmentIndex === 0 ? prefixStart : segment.start,
				end: segmentIndex === wordSegments.length - 1 ? wordEnd : segment.end,
			}));

			segments.push(...wordSegments.filter(segment => segment.start <= segment.end));
			index = wordEnd + 1;
			pendingPrefixStart = index;
		}

		if (!segments.length && chars.length) {
			segments.push({ start: 0, end: chars.length - 1 });
		}

		return segments;
	};

	// 상태 관리
	const [provider, setProvider] = useState('');   // 상세 provider (sync-data 매칭용, 예: spotify-MusixMatch)
	const [addonId, setAddonId] = useState('');     // 실제 addon ID (가사 로드용, 예: spotify)
	const [lyrics, setLyrics] = useState(null);
	const [lyricsText, setLyricsText] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState(null);
	const [currentLineIndex, setCurrentLineIndex] = useState(0);
	const [syncData, setSyncData] = useState(null);
	const [mode, setMode] = useState('idle');
	const [position, setPosition] = useState(0);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [recordingCharIndex, setRecordingCharIndex] = useState(-1);
	const [dragStartTime, setDragStartTime] = useState(null);
	const [dragStartCharIndex, setDragStartCharIndex] = useState(-1);
	const [isDragging, setIsDragging] = useState(false);
	const [globalOffset, setGlobalOffset] = useState(0);
	const [showLrcLibPublish, setShowLrcLibPublish] = useState(false);
	const [manualLyricsInput, setManualLyricsInput] = useState('');
	const [isPublishingToLrcLib, setIsPublishingToLrcLib] = useState(false);
	const [lrcLibPublishProgress, setLrcLibPublishProgress] = useState('');
	const [publishCancelled, setPublishCancelled] = useState(false);
	const [availableProviders, setAvailableProviders] = useState([]);
	const [lrclibCandidates, setLrclibCandidates] = useState([]);
	const [selectedLrclibCandidateKey, setSelectedLrclibCandidateKey] = useState('');
	const [previewLrclibCandidateKey, setPreviewLrclibCandidateKey] = useState('');
	const [lrclibSearchMeta, setLrclibSearchMeta] = useState(null);
	const [showLrclibCandidates, setShowLrclibCandidates] = useState(true);

	// Refs
	const containerRef = useRef(null);
	const lyricsScrollRef = useRef(null);
	const animationRef = useRef(null);
	const charTimesRef = useRef([]);
	const charElementsRef = useRef([]);
	const preventNextTrackRef = useRef(false);
	const publishWorkersRef = useRef([]);

	// 트랙 정보
	const trackId = trackInfo?.uri?.split(':')[2] || '';
	const trackUri = trackInfo?.uri || Spicetify.Player?.data?.item?.uri;
	const trackName = trackInfo?.name || Spicetify.Player?.data?.item?.name || '';
	const artistName = trackInfo?.artists?.map(a => a.name).join(', ') ||
		Spicetify.Player?.data?.item?.artists?.map(a => a.name).join(', ') || '';
	const isVirtualKaraokeSource =
		lyrics?.karaokeSource === 'spotify-audio-analysis' ||
		lyrics?.karaokeSource === 'audio-analysis-pseudo';
	const albumArt = trackInfo?.album?.images?.[0]?.url ||
		Spicetify.Player?.data?.item?.album?.images?.[0]?.url || '';

	const stripLrclibTimestamp = useCallback((text) => {
		if (!text || typeof text !== 'string') return '';
		return text.replace(/^\[\d+:\d+(?:[.,]\d+)?\]\s*/, '').trim();
	}, []);

	const extractLyricsText = useCallback((lyricsSource) => {
		let text = '';

		if (Array.isArray(lyricsSource)) {
			text = lyricsSource.map(line => {
				if (typeof line === 'string') return line;
				if (line.originalText && typeof line.originalText === 'string' && line.originalText.trim().length > 0) return line.originalText;
				if (line.text) return typeof line.text === 'string' ? line.text : '';
				return '';
			}).filter(t => t.trim().length > 0).join('\n');
		} else if (typeof lyricsSource === 'string') {
			text = lyricsSource;
		}

		return text ? text.normalize('NFC') : '';
	}, []);

	const buildLineObjectsFromText = useCallback((text) => {
		if (!text || typeof text !== 'string') return [];
		return text
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean)
			.map(line => ({ text: line.normalize('NFC') }));
	}, []);

	const getLrclibCandidateText = useCallback((candidate) => {
		if (!candidate) return '';

		const usePlain = candidate.preferredLyricsSource === 'plain' && candidate.plainLyrics;
		const sourceText = usePlain
			? candidate.plainLyrics
			: (candidate.syncedLyrics || candidate.plainLyrics || '');

		if (!sourceText) return '';

		if (usePlain || !candidate.syncedLyrics) {
			return sourceText.normalize('NFC');
		}

		return sourceText
			.split('\n')
			.map(line => stripLrclibTimestamp(line))
			.filter(Boolean)
			.join('\n')
			.normalize('NFC');
	}, [stripLrclibTimestamp]);

	const buildSyntheticLrclibResult = useCallback((candidate) => {
		const text = getLrclibCandidateText(candidate);
		const lines = buildLineObjectsFromText(text);
		return {
			provider: 'lrclib',
			synced: candidate?.preferredLyricsSource === 'synced' ? lines : null,
			unsynced: lines
		};
	}, [buildLineObjectsFromText, getLrclibCandidateText]);

	const clearLrclibCandidateState = useCallback(() => {
		setLrclibCandidates([]);
		setSelectedLrclibCandidateKey('');
		setPreviewLrclibCandidateKey('');
		setLrclibSearchMeta(null);
	}, []);

	const applyLoadedLyricsResult = useCallback(async (result, usedProvider) => {
		let finalProvider = result.provider || usedProvider;

		if ((finalProvider === 'Spotify' || finalProvider === 'spotify') && result.spotifyLyricsProvider) {
			finalProvider = `spotify-${result.spotifyLyricsProvider}`;
		}

		setProvider(finalProvider);
		setAddonId(usedProvider);
		setLyrics(result);

		if (window.SyncDataService && trackId) {
			try {
				const existingSyncData = await window.SyncDataService.getSyncData(trackId, finalProvider);
				if (existingSyncData && existingSyncData.syncData && existingSyncData.syncData.lines) {
					window.__ivLyricsDebugLog?.('[SyncDataCreator] Found matching existing sync data');
					setSyncData(existingSyncData.syncData);
					Toast.success(I18n.t('syncCreator.loadedExistingSyncData') || '기존 싱크 데이터를 불러왔습니다');
				}
			} catch (e) {
				console.warn('[SyncDataCreator] Failed to load existing sync data:', e);
			}
		}

		const text = extractLyricsText(result.synced || result.unsynced);
		if (text.trim().length > 0) {
			setLyricsText(text);
			setError(null);
		} else {
			setError(I18n.t('syncCreator.noLyrics'));
		}
	}, [extractLyricsText, trackId]);

	const previewLrclibCandidate = useMemo(() => {
		if (!lrclibCandidates.length) return null;
		return lrclibCandidates.find(candidate => candidate.candidateKey === previewLrclibCandidateKey)
			|| lrclibCandidates.find(candidate => candidate.candidateKey === selectedLrclibCandidateKey)
			|| lrclibCandidates[0]
			|| null;
	}, [lrclibCandidates, previewLrclibCandidateKey, selectedLrclibCandidateKey]);

	const applySelectedLrclibCandidate = useCallback(async (candidateKey) => {
		const candidate = lrclibCandidates.find(item => item.candidateKey === candidateKey);
		if (!candidate) return;

		setIsLoading(true);
		setError(null);
		setLyrics(null);
		setLyricsText('');
		setSyncData(null);
		setCurrentLineIndex(0);
		setMode('idle');

		try {
			const syntheticResult = buildSyntheticLrclibResult(candidate);
			await applyLoadedLyricsResult(syntheticResult, 'lrclib');
			setSelectedLrclibCandidateKey(candidate.candidateKey);
			setPreviewLrclibCandidateKey(candidate.candidateKey);
		} catch (e) {
			console.error('[SyncDataCreator] Failed to apply LRCLIB candidate:', e);
			setError(I18n.t('syncCreator.loadError'));
		}

		setIsLoading(false);
	}, [applyLoadedLyricsResult, buildSyntheticLrclibResult, lrclibCandidates]);

	// 가사를 줄 단위로 파싱
	// NFC 정규화를 적용하여 결합 문자(NFD)를 합성 문자로 변환
	// 예: "e" + 결합 액센트 -> "é" (1개 코드포인트)
	const lyricsLines = useMemo(() => {
		if (!lyricsText) return [];
		return lyricsText.split('\n')
			.filter(line => line.trim().length > 0)
			.map(line => line.normalize('NFC'));
	}, [lyricsText]);

	const totalChars = useMemo(() => {
		// NFC 정규화된 lyricsLines를 사용하므로 Array.from()이 정확한 문자 수를 반환
		return lyricsLines.reduce((sum, line) => sum + Array.from(line).length, 0);
	}, [lyricsLines]);

	const syncedChars = useMemo(() => {
		if (!syncData || !syncData.lines) return 0;
		return syncData.lines.reduce((sum, line) => sum + (line.chars?.length || 0), 0);
	}, [syncData]);

	const lineCharOffsets = useMemo(() => {
		const offsets = [];
		let total = 0;
		lyricsLines.forEach((line) => {
			offsets.push(total);
			total += Array.from(line).length;
		});
		return offsets;
	}, [lyricsLines]);

	const currentLineChars = useMemo(() => {
		if (currentLineIndex < 0 || currentLineIndex >= lyricsLines.length) return [];
		return Array.from(lyricsLines[currentLineIndex]);
	}, [lyricsLines, currentLineIndex]);

	const currentLineSyllableSegments = useMemo(
		() => buildLineSyllableSegments(currentLineChars),
		[currentLineChars]
	);

	const completedLines = useMemo(() => {
		if (!syncData || !syncData.lines) return 0;
		return syncData.lines.length;
	}, [syncData]);

	// 현재 줄이 싱크되어 있는지
	const isCurrentLineSynced = useMemo(() => {
		if (!syncData || !syncData.lines) return false;
		const lineStart = lineCharOffsets[currentLineIndex];
		return syncData.lines.some(l => l.start === lineStart);
	}, [syncData, lineCharOffsets, currentLineIndex]);

	// Visibility tracking for robust lock handling
	const isVisibleRef = useRef(false);

	// Visibility Observer
	useEffect(() => {
		if (!containerRef.current) return;

		const observer = new IntersectionObserver(([entry]) => {
			isVisibleRef.current = entry.isIntersecting;
			preventNextTrackRef.current = entry.isIntersecting;
			// console.log("[SyncDataCreator] Visibility changed:", entry.isIntersecting);
		}, { threshold: 0 });

		observer.observe(containerRef.current);

		return () => observer.disconnect();
	}, []);

	// 다음 곡 방지 - 싱크 생성기가 보일 때만 활성화
	useEffect(() => {
		// 초기 마운트/업데이트 시 visibility 상태 동기화
		preventNextTrackRef.current = isVisibleRef.current;

		const handleSongChange = () => {
			// 화면에 보이지 않으면 동작하지 않음
			if (!isVisibleRef.current) return;
			// preventNextTrackRef가 false여도 동작하지 않음 (이중 체크)
			if (!preventNextTrackRef.current) return;

			const currentTrackUri = Spicetify.Player?.data?.item?.uri;
			if (currentTrackUri && currentTrackUri !== trackUri) {
				Spicetify.Player.playUri(trackUri);
			}
		};

		const handleProgress = () => {
			// 화면에 보이지 않으면 동작하지 않음
			if (!isVisibleRef.current) return;
			if (!preventNextTrackRef.current) return;

			const duration = Spicetify.Player?.data?.item?.duration?.milliseconds || 0;
			const progress = Spicetify.Player.getProgress();
			if (duration > 0 && progress >= duration - 250) {
				Spicetify.Player.seek(0);
			}
		};

		const progressInterval = setInterval(handleProgress, 200);
		Spicetify.Player.addEventListener('songchange', handleSongChange);

		return () => {
			// 언마운트 시 해제 (단, 숨김 상태일 뿐이면 observer가 false로 설정함)
			preventNextTrackRef.current = false;
			clearInterval(progressInterval);
			Spicetify.Player.removeEventListener('songchange', handleSongChange);
		};
	}, [trackUri]);

	// Provider 목록 로드 (활성화된 Provider만, 사용자 설정 순서대로)
	useEffect(() => {
		const loadProviders = () => {
			if (window.LyricsAddonManager) {
				const enabledAddons = window.LyricsAddonManager.getEnabledProviders();
				setAvailableProviders(enabledAddons);
			} else {
				setAvailableProviders([]);
			}
		};
		loadProviders();

		// 리스너 등록 (Addon이 나중에 로드될 수 있음, 활성화 상태/순서 변경도 반영)
		if (window.LyricsAddonManager) {
			const unsub1 = window.LyricsAddonManager.on('addon:registered', loadProviders);
			const unsub2 = window.LyricsAddonManager.on('provider:enabled:changed', loadProviders);
			const unsub3 = window.LyricsAddonManager.on('provider:order:changed', loadProviders);
			return () => { unsub1(); unsub2(); unsub3(); };
		}
	}, []);

	// 가사 로드 (Spotify -> LRCLIB 순서로 자동 시도)
	// 가사 로드 (Spotify -> LRCLIB 순서로 자동 시도)
	const loadLyrics = useCallback(async (preferredProvider = null) => {
		setIsLoading(true);
		setError(null);
		setLyrics(null);
		setLyricsText('');
		setSyncData(null);
		setCurrentLineIndex(0);
		setMode('idle');
		clearLrclibCandidateState();

		try {
			const firstArtist = trackInfo?.artists?.[0]?.name ||
				Spicetify.Player?.data?.item?.artists?.[0]?.name ||
				artistName.split(',')[0].trim();

			// 만약 preferredProvider가 지정되어 있다면 그것만 시도, 아니면 LyricsAddonManager의 순서대로
			let providersToTry = preferredProvider ? [preferredProvider] : [];

			if (!preferredProvider) {
				if (window.LyricsAddonManager) {
					// 활성화된 Provider 순서대로 시도
					const addons = window.LyricsAddonManager.getEnabledProviders();
					providersToTry = addons.map(addon => addon.id);
				} else {
					// Manager가 없으면 빈 배열 (또는 로드될 때까지 대기해야 함)
					providersToTry = [];
				}
			}

			let result = null;
			let usedProvider = null;

			for (const tryProvider of providersToTry) {
				const info = {
					uri: trackInfo?.uri || Spicetify.Player?.data?.item?.uri,
					title: trackName,
					name: trackName,
					artist: tryProvider === 'lrclib' ? firstArtist : artistName,
					album: trackInfo?.album?.name || Spicetify.Player?.data?.item?.album?.name || '',
					duration: Spicetify.Player?.data?.item?.duration?.milliseconds || 0
				};

				// Provider ID 그대로 사용
				let realProvider = tryProvider;

				// Legacy compatibility for spotify-xxx IDs if needed, but per user request, we trust the ID.
				// However, if the old Providers object is used, we might need adjustment. 
				// But we prioritize LyricsAddonManager now.

				window.__ivLyricsDebugLog?.('[SyncDataCreator] Trying provider:', tryProvider);

				try {
					if (realProvider === 'lrclib' && window.LyricsAddonManager?.getAddon) {
						const lrclibAddon = window.LyricsAddonManager.getAddon(realProvider);
						if (typeof lrclibAddon?.searchCandidates === 'function') {
							const searchResult = await lrclibAddon.searchCandidates(info);
							if (!searchResult?.success) {
								throw new Error(searchResult?.error || 'No lyrics found');
							}

							const candidates = Array.isArray(searchResult.candidates) ? searchResult.candidates : [];
							const selectedCandidate = candidates.find(candidate => candidate.candidateKey === searchResult.selectedCandidateKey)
								|| candidates[0]
								|| null;

							if (!selectedCandidate) {
								throw new Error('No ranked LRCLIB candidates');
							}

							setLrclibCandidates(candidates);
							setSelectedLrclibCandidateKey(selectedCandidate.candidateKey);
							setPreviewLrclibCandidateKey(selectedCandidate.candidateKey);
							setLrclibSearchMeta(searchResult);
							setShowLrclibCandidates(true);
							result = buildSyntheticLrclibResult(selectedCandidate);
						} else {
							result = await window.LyricsAddonManager.getLyricsFrom(realProvider, info);
						}
						if (result && result.error) throw new Error(result.error);
					} else if (window.LyricsAddonManager) {
						result = await window.LyricsAddonManager.getLyricsFrom(realProvider, info);
						if (result && result.error) throw new Error(result.error);
					} else if (typeof Providers !== 'undefined' && Providers[realProvider]) {
						result = await Providers[realProvider](info);
					} else if (typeof LyricsService !== 'undefined' && LyricsService.getLyrics) {
						result = await LyricsService.getLyrics(info, realProvider);
					}

					if (result && (result.synced || result.unsynced)) {
						usedProvider = tryProvider;
						window.__ivLyricsDebugLog?.('[SyncDataCreator] Found lyrics from:', tryProvider);
						break;
					}
				} catch (providerError) {
					window.__ivLyricsDebugLog?.('[SyncDataCreator] Provider', tryProvider, 'failed:', providerError.message);
				}
			}

			if (result && (result.synced || result.unsynced)) {
				await applyLoadedLyricsResult(result, usedProvider);
			} else {
				// 만약 수동 선택했는데 실패했으면 provider는 그 선택한걸로 유지해서 UI에 보여줌? 
				// 아니면 실패 메시지 띄우고 provider는 유지
				if (preferredProvider) setProvider(preferredProvider);
				setError(I18n.t('syncCreator.noLyrics'));
			}
		} catch (e) {
			console.error('[SyncDataCreator] Load lyrics error:', e);
			setError(I18n.t('syncCreator.loadError'));
		}

		setIsLoading(false);
	}, [trackInfo, trackName, artistName, applyLoadedLyricsResult, buildSyntheticLrclibResult, clearLrclibCandidateState]);



	// 컴포넌트 마운트 시 자동 가사 로드 + 기존 싱크 데이터 불러오기
	useEffect(() => {
		const initWithExistingSyncData = async () => {
			// 0. initialData가 있으면 그것을 우선 사용
			// Auto loading from initialData disabled per user request
			if (false && initialData && initialData.provider && initialData.lyrics) {
				window.__ivLyricsDebugLog?.('[SyncDataCreator] Using initial data:', initialData.provider);
				let finalProvider = initialData.provider;
				const inputLyrics = initialData.lyrics;

				// Spotify provider normalization
				if ((finalProvider === 'Spotify' || finalProvider === 'spotify') && inputLyrics.spotifyLyricsProvider) {
					finalProvider = `spotify-${inputLyrics.spotifyLyricsProvider}`;
				}

				let lyricsSource;

				// inputLyrics가 배열이면(LyricsContainer에서 직접 넘긴 경우) 객체로 감쌈
				if (Array.isArray(inputLyrics)) {
					setLyrics({
						provider: finalProvider,
						synced: inputLyrics,
						unsynced: inputLyrics
					});
					lyricsSource = inputLyrics;
				} else {
					setLyrics(inputLyrics);
					lyricsSource = inputLyrics.synced || inputLyrics.unsynced;
				}

				setProvider(finalProvider);

				let text = '';

				if (Array.isArray(lyricsSource)) {
					text = lyricsSource.map(line => {
						if (typeof line === 'string') return line;
						if (line.originalText && typeof line.originalText === 'string' && line.originalText.trim().length > 0) return line.originalText;
						if (line.text) return typeof line.text === 'string' ? line.text : '';
						return '';
					}).filter(t => t.trim().length > 0).join('\n');
				} else if (typeof lyricsSource === 'string') {
					text = lyricsSource;
				}

				// NFC 정규화 적용
				text = text ? text.normalize('NFC') : '';

				if (text.trim().length > 0) {
					setLyricsText(text);
				} else {
					setError(I18n.t('syncCreator.noLyrics'));
				}

				// 기존 싱크 데이터가 있는지 확인
				if (window.SyncDataService && trackId) {
					try {
						const existingSyncData = await window.SyncDataService.getSyncData(trackId, finalProvider);
						if (existingSyncData && existingSyncData.syncData && existingSyncData.syncData.lines) {
							window.__ivLyricsDebugLog?.('[SyncDataCreator] Found matching existing sync data');
							setSyncData(existingSyncData.syncData);
							Toast.success(I18n.t('syncCreator.loadedExistingSyncData') || '기존 싱크 데이터를 불러왔습니다');
						}
					} catch (e) {
						console.warn('[SyncDataCreator] Failed to load existing sync data:', e);
					}
				}
				return;
			}

			// initialData가 없으면 자동으로 로드하지 않음 (유저가 '로드' 버튼을 눌러야 함)
		};

		initWithExistingSyncData();
	}, []);

	// 재생 위치 업데이트 + 미리보기 자동 줄 이동
	useEffect(() => {
		const updatePosition = () => {
			const pos = Spicetify.Player.getProgress();
			setPosition(pos);

			if (mode === 'preview' && syncData && syncData.lines) {
				const currentTimeSec = pos / 1000;

				for (let i = syncData.lines.length - 1; i >= 0; i--) {
					const lineData = syncData.lines[i];
					if (lineData.chars && lineData.chars[0] <= currentTimeSec) {
						const lineIdx = lyricsLines.findIndex((_, idx) => {
							const lineStart = lineCharOffsets[idx];
							return lineData.start === lineStart;
						});

						if (lineIdx >= 0 && lineIdx !== currentLineIndex) {
							setCurrentLineIndex(lineIdx);
							if (lyricsScrollRef.current) {
								lyricsScrollRef.current.scrollLeft = 0;
							}
						}
						break;
					}
				}
			}

			animationRef.current = requestAnimationFrame(updatePosition);
		};

		animationRef.current = requestAnimationFrame(updatePosition);

		return () => {
			if (animationRef.current) {
				cancelAnimationFrame(animationRef.current);
			}
		};
	}, [mode, syncData, lyricsLines, lineCharOffsets, currentLineIndex]);

	const autoScroll = useCallback((charIndex) => {
		if (!lyricsScrollRef.current || charIndex < 0) return;
		const scrollContainer = lyricsScrollRef.current;
		const charElement = charElementsRef.current[charIndex];
		if (!charElement) return;

		const containerRect = scrollContainer.getBoundingClientRect();
		const charRect = charElement.getBoundingClientRect();
		const charCenter = charRect.left + charRect.width / 2;
		const containerCenter = containerRect.left + containerRect.width / 2;
		const scrollOffset = charCenter - containerCenter;

		if (Math.abs(scrollOffset) > 50) {
			scrollContainer.scrollLeft += scrollOffset * 0.3;
		}
	}, []);

	const getCharIndexFromPoint = useCallback((clientX, clientY) => {
		for (let i = 0; i < charElementsRef.current.length; i++) {
			const el = charElementsRef.current[i];
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
				return i;
			}
		}

		if (charElementsRef.current.length > 0) {
			const firstEl = charElementsRef.current[0];
			const lastEl = charElementsRef.current[charElementsRef.current.length - 1];
			if (firstEl && lastEl) {
				const firstRect = firstEl.getBoundingClientRect();
				const lastRect = lastEl.getBoundingClientRect();
				if (clientX < firstRect.left) return 0;
				if (clientX > lastRect.right) return charElementsRef.current.length - 1;

				let closestIndex = 0;
				let closestDist = Infinity;
				for (let i = 0; i < charElementsRef.current.length; i++) {
					const el = charElementsRef.current[i];
					if (!el) continue;
					const rect = el.getBoundingClientRect();
					const centerX = rect.left + rect.width / 2;
					const dist = Math.abs(clientX - centerX);
					if (dist < closestDist) {
						closestDist = dist;
						closestIndex = i;
					}
				}
				return closestIndex;
			}
		}
		return 0;
	}, []);

	const handleDragStart = useCallback((charIndex, e) => {
		if (mode !== 'record' || currentLineIndex >= lyricsLines.length) return;
		e.preventDefault();
		e.stopPropagation();

		const currentTime = Spicetify.Player.getProgress() / 1000;
		const startIndex = charIndex < 0 ? 0 : charIndex;

		setDragStartTime(currentTime);
		setDragStartCharIndex(startIndex);
		setRecordingCharIndex(startIndex);
		setIsDragging(true);

		charTimesRef.current = new Array(currentLineChars.length).fill(null);
		for (let i = 0; i <= startIndex; i++) {
			charTimesRef.current[i] = currentTime;
		}
	}, [mode, currentLineIndex, lyricsLines.length, currentLineChars.length]);

	const handleDragMove = useCallback((charIndex, e) => {
		if (mode !== 'record' || !isDragging || dragStartTime === null) return;
		e.preventDefault();
		const currentTime = Spicetify.Player.getProgress() / 1000;

		// 마우스를 너무 위/아래로 움직였거나 영역을 벗어났을 때도 처리가 필요할 수 있음
		// 현재는 index 기반으로만 처리

		if (charIndex < 0) {
			// 영역 왼쪽 밖으로 나감 - 전체 취소 아님, 그냥 인덱스 0 처리?
			// 아니면 드래그 시작점보다 왼쪽으로 가면 그만큼 취소
			// 여기서는 -1이면 아무것도 안함
			return;
		}

		if (charIndex >= recordingCharIndex) {
			// 정방향 진행
			for (let i = recordingCharIndex + 1; i <= charIndex; i++) {
				if (charTimesRef.current[i] === null) {
					charTimesRef.current[i] = currentTime;
				}
			}
			setRecordingCharIndex(charIndex);
			autoScroll(charIndex);
		} else {
			// 역방향 진행 (취소)
			// 현재 recordingCharIndex에서 charIndex+1 까지의 기록을 지움
			for (let i = charIndex + 1; i <= recordingCharIndex; i++) {
				charTimesRef.current[i] = null;
			}
			setRecordingCharIndex(charIndex);
		}
	}, [mode, isDragging, dragStartTime, recordingCharIndex, autoScroll]);

	// Commit-time normalization keeps the client aligned with backend validation:
	// chars must be non-decreasing and a line must not start before the previous line ends.
	const normalizeCommittedLineChars = useCallback((rawChars, previousLineEndTime = -1) => {
		const normalizedChars = [];
		let minimumAllowedTime = previousLineEndTime >= 0 ? previousLineEndTime : 0;

		for (let i = 0; i < rawChars.length; i++) {
			const rawTime = typeof rawChars[i] === 'number' ? rawChars[i] : minimumAllowedTime;
			const normalizedTime = roundSyncTime(Math.max(minimumAllowedTime, rawTime));
			normalizedChars.push(normalizedTime);
			minimumAllowedTime = normalizedTime;
		}

		return normalizedChars;
	}, []);

	const commitCurrentLineSync = useCallback((rawChars) => {
		const lineStart = lineCharOffsets[currentLineIndex];
		const lineEnd = lineStart + currentLineChars.length - 1;
		const nextLines = syncData?.lines
			? syncData.lines.map((line) => ({
				...line,
				chars: Array.isArray(line.chars) ? [...line.chars] : []
			}))
			: [];
		const existingIndex = nextLines.findIndex((line) => line.start === lineStart);
		const lineData = {
			start: lineStart,
			end: lineEnd,
			chars: rawChars.map((time) => roundSyncTime(time))
		};

		if (existingIndex >= 0) {
			nextLines[existingIndex] = lineData;
		} else {
			nextLines.push(lineData);
		}

		nextLines.sort((a, b) => a.start - b.start);

		const committedLineIndex = nextLines.findIndex((line) => line.start === lineStart);
		const previousLine = committedLineIndex > 0 ? nextLines[committedLineIndex - 1] : null;
		const previousLineEndTime = previousLine?.chars?.[previousLine.chars.length - 1] ?? -1;
		const normalizedLineData = {
			...lineData,
			chars: normalizeCommittedLineChars(lineData.chars, previousLineEndTime)
		};
		const normalizedLastCharTime = normalizedLineData.chars[normalizedLineData.chars.length - 1];

		nextLines[committedLineIndex] = normalizedLineData;

		const validLines = nextLines.filter((line, index) => {
			if (index <= committedLineIndex) return true;
			return !(line.chars && line.chars[0] < normalizedLastCharTime);
		});

		setSyncData(validLines.length > 0 ? { lines: validLines } : null);
		return normalizedLineData;
	}, [syncData, lineCharOffsets, currentLineIndex, currentLineChars.length, normalizeCommittedLineChars]);

	const handleDragEnd = useCallback((e) => {
		if (mode !== 'record' || !isDragging || dragStartTime === null || recordingCharIndex === -1) {
			setIsDragging(false);
			return;
		}

		e.preventDefault();

		// 드래그가 시작점보다 왼쪽에서 끝났으면 취소로 간주할 수도 있으나,
		// 여기서는 recordingCharIndex가 유효한 마지막 지점이므로 거기까지만 저장

		const endTime = Spicetify.Player.getProgress() / 1000;
		const endCharIndex = recordingCharIndex;
		const charCount = currentLineChars.length;

		// 유효성 체크: 만약 드래그 시작하자마자 바로 끝나거나 이상한 경우
		if (endCharIndex < dragStartCharIndex) {
			// 시작점보다 뒤로 가서 끝났으면 해당 부분은 싱크 안함 (혹은 이전 싱크 유지)
			// 여기서는 그냥 저장 진행 (지워진 상태로)
			// 만약 전체를 취소하고 싶다면 별도 처리가 필요하지만, 
			// UX상 왼쪽으로 가서 놓으면 그 부분은 싱크가 안 된 상태가 됨.
		}

		const chars = [];
		for (let i = 0; i < charCount; i++) {
			let time;
			if (charTimesRef.current[i] !== null) {
				time = charTimesRef.current[i];
			} else if (i <= endCharIndex) {
				// 중간에 빈 곳이 있으면 채움 (보간)
				const prevTime = chars[chars.length - 1] || dragStartTime;
				time = prevTime + 0.02;
			} else {
				// 끝부분 이후는 자동 채움 (보간)
				const remainingCount = charCount - endCharIndex - 1;
				const perCharDuration = 0.5 / Math.max(1, remainingCount);
				time = endTime + ((i - endCharIndex) * perCharDuration);
			}
			// 소수점 3자리로 반올림
			chars.push(Math.round(time * 1000) / 1000);
		}

		commitCurrentLineSync(chars);

		const isComplete = endCharIndex >= charCount - 1;
		if (isComplete && currentLineIndex < lyricsLines.length - 1) {
			setCurrentLineIndex(prev => prev + 1);
			if (lyricsScrollRef.current) lyricsScrollRef.current.scrollLeft = 0;
		}

		setDragStartTime(null);
		setDragStartCharIndex(-1);
		setRecordingCharIndex(-1);
		setIsDragging(false);
		charTimesRef.current = [];
	}, [mode, isDragging, dragStartTime, recordingCharIndex, currentLineIndex, currentLineChars, lyricsLines.length, dragStartCharIndex, commitCurrentLineSync]);

	// 키보드 싱크 상태 ref (isDragging과 별개로 키보드용)
	const isKeyboardSyncingRef = useRef(false);
	const keyboardCharIndexRef = useRef(-1);

	// 드래그 키(/) 연속 입력을 위한 인터벌 ref
	const keyboardDragIntervalRef = useRef(null);
	const isKeyboardDraggingRef = useRef(false);

	// 이전 라인 인덱스 추적 (라인 변경 감지용)
	const prevLineIndexRef = useRef(currentLineIndex);

	// 동적 보간 모드를 위한 ref
	// pendingWordSync: 이전 단어의 시작 시간과 인덱스 범위를 저장
	// 다음 단어가 탭되면 이전 단어의 글자들에 보간된 시간 적용
	const pendingWordSyncRef = useRef(null);
	const pendingSyllableSyncRef = useRef(null);
	// 단어 간 최소 간격 (ms) - 단어가 즉시 전환되지 않도록
	const WORD_GAP_MS = 80;
	// 단어 내 보간 활성화 여부
	const interpolationEnabledRef = useRef(true);

	// 키보드 이벤트 리스너 등록
	useEffect(() => {
		// 라인이 변경되었는지 확인
		const lineChanged = prevLineIndexRef.current !== currentLineIndex;
		if (lineChanged) {
			prevLineIndexRef.current = currentLineIndex;
		}

		// record 모드가 아니거나 라인이 변경되면 키보드 싱크 상태 초기화
		const shouldReset = mode !== 'record' || lineChanged;
		if (shouldReset && (isKeyboardSyncingRef.current || isKeyboardDraggingRef.current)) {
			window.__ivLyricsDebugLog?.('[SyncDataCreator] Resetting keyboard sync state, mode:', mode, 'lineChanged:', lineChanged);
			// 진행 중인 키보드 싱크 초기화
			isKeyboardSyncingRef.current = false;
			keyboardCharIndexRef.current = -1;
			charTimesRef.current = [];
			pendingWordSyncRef.current = null; // 보간 대기 상태도 초기화
			pendingSyllableSyncRef.current = null;
			setDragStartTime(null);
			setRecordingCharIndex(-1);
			// 드래그 모드도 초기화
			if (isKeyboardDraggingRef.current) {
				isKeyboardDraggingRef.current = false;
				if (keyboardDragIntervalRef.current) {
					clearInterval(keyboardDragIntervalRef.current);
					keyboardDragIntervalRef.current = null;
				}
			}
		}

		const finishKeyboardSync = () => {
			if (!isKeyboardSyncingRef.current) return;

			const endTime = Spicetify.Player.getProgress() / 1000;
			const endCharIndex = keyboardCharIndexRef.current;
			const charCount = currentLineChars.length;

			const chars = [];
			const startTime = charTimesRef.current[0] || endTime;
			for (let i = 0; i < charCount; i++) {
				let time;
				if (charTimesRef.current[i] !== null) {
					time = charTimesRef.current[i];
				} else if (i <= endCharIndex) {
					const prevTime = chars[chars.length - 1] || startTime;
					time = prevTime + 0.02;
				} else {
					const remainingCount = charCount - endCharIndex - 1;
					const perCharDuration = 0.5 / Math.max(1, remainingCount);
					time = endTime + ((i - endCharIndex) * perCharDuration);
				}
				chars.push(Math.round(time * 1000) / 1000);
			}

			commitCurrentLineSync(chars);

			// 다음 라인으로 이동
			if (currentLineIndex < lyricsLines.length - 1) {
				setCurrentLineIndex(prev => prev + 1);
				if (lyricsScrollRef.current) lyricsScrollRef.current.scrollLeft = 0;
			}

			// 키보드 싱크 상태 초기화
			isKeyboardSyncingRef.current = false;
			keyboardCharIndexRef.current = -1;
			charTimesRef.current = [];
			pendingWordSyncRef.current = null;
			pendingSyllableSyncRef.current = null;
			setDragStartTime(null);
			setRecordingCharIndex(-1);
		};

		const handleKeyDown = (e) => {
			const normalizedHotkey = getNormalizedHotkeyFromEvent(e);
			const shortcutBindings = getSyncCreatorShortcutBindings();
			const shortcutAction = Object.entries(shortcutBindings)
				.find(([, bindings]) => bindings.includes(normalizedHotkey))?.[0] || null;
			const staticHotkeys = new Set(['enter', 'backspace', '/', 'z', 'x']);
			if (!shortcutAction && !staticHotkeys.has(normalizedHotkey)) return;

			// record 모드가 아니면 처리하지 않음
			if (mode !== 'record') return;

			window.__ivLyricsDebugLog?.('[SyncDataCreator] KeyDown:', e.key, 'normalized:', normalizedHotkey, 'mode:', mode, 'lineIndex:', currentLineIndex);

			if (currentLineIndex >= lyricsLines.length) return;

			// 한 글자 앞으로 진행하는 헬퍼 함수
			const advanceOneChar = (currentTime) => {
				if (!isKeyboardSyncingRef.current) {
					// 키보드 싱크 시작
					isKeyboardSyncingRef.current = true;
					let startIndex = 0;
					charTimesRef.current = new Array(currentLineChars.length).fill(null);
					pendingWordSyncRef.current = null;
					pendingSyllableSyncRef.current = null;
					charTimesRef.current[0] = currentTime;

					// 첫 글자가 여는 괄호면 다음 글자까지 포함
					if (isLeadingChar(currentLineChars, 0)) {
						while (startIndex + 1 < currentLineChars.length && isLeadingChar(currentLineChars, startIndex)) {
							startIndex++;
							charTimesRef.current[startIndex] = currentTime;
						}
					}

					// 다음 글자가 구두점/닫는괄호/공백이면 함께 처리
					while (startIndex + 1 < currentLineChars.length && isTrailingChar(currentLineChars, startIndex + 1)) {
						startIndex++;
						charTimesRef.current[startIndex] = currentTime;
					}

					keyboardCharIndexRef.current = startIndex;
					setDragStartTime(currentTime);
					setRecordingCharIndex(startIndex);
					window.__ivLyricsDebugLog?.('[SyncDataCreator] Started keyboard sync, chars:', currentLineChars.length, 'startIndex:', startIndex);
					return startIndex;
				} else {
					// 다음 글자로 진행
					let nextIndex = keyboardCharIndexRef.current + 1;
					if (nextIndex < currentLineChars.length) {
						charTimesRef.current[nextIndex] = currentTime;

						// 현재 글자가 여는 괄호면 다음 글자까지 포함
						while (nextIndex + 1 < currentLineChars.length && isLeadingChar(currentLineChars, nextIndex)) {
							nextIndex++;
							charTimesRef.current[nextIndex] = currentTime;
						}

						// 다음 글자가 구두점/닫는괄호/공백이면 함께 처리
						while (nextIndex + 1 < currentLineChars.length && isTrailingChar(currentLineChars, nextIndex + 1)) {
							nextIndex++;
							charTimesRef.current[nextIndex] = currentTime;
						}

						keyboardCharIndexRef.current = nextIndex;
						setRecordingCharIndex(nextIndex);
						autoScroll(nextIndex);
						window.__ivLyricsDebugLog?.('[SyncDataCreator] Advanced to char:', nextIndex);
					}

					// 마지막 글자면 라인 완료
					if (keyboardCharIndexRef.current >= currentLineChars.length - 1) {
						finishKeyboardSync();
						window.__ivLyricsDebugLog?.('[SyncDataCreator] Line completed');
						return -1; // 완료됨
					}
					return keyboardCharIndexRef.current;
				}
			};

			// 이전 단어에 보간 적용하는 헬퍼 함수
			const applyInterpolationToPendingWord = (nextWordStartTime) => {
				if (!pendingWordSyncRef.current || !interpolationEnabledRef.current) return;

				const { startIdx, endIdx, startTime } = pendingWordSyncRef.current;
				const charCount = endIdx - startIdx + 1;

				if (charCount <= 1) {
					// 한 글자 단어는 보간 불필요
					pendingWordSyncRef.current = null;
					return;
				}

				// 단어 간 최소 간격을 뺀 시간 내에서 보간
				const wordEndTime = nextWordStartTime - (WORD_GAP_MS / 1000);
				const duration = Math.max(0, wordEndTime - startTime);

				applyInterpolatedRangeToCharTimes(
					charTimesRef.current,
					startIdx,
					endIdx,
					startTime,
					startTime + duration,
					smoothStepInterpolation
				);

				window.__ivLyricsDebugLog?.('[SyncDataCreator] Applied interpolation to word:', startIdx, '-', endIdx, 'duration:', duration.toFixed(3));
				pendingWordSyncRef.current = null;
			};

			const applyInterpolationToPendingSyllable = (nextSyllableStartTime) => {
				if (!pendingSyllableSyncRef.current || !interpolationEnabledRef.current) return;

				const { startIdx, endIdx, startTime } = pendingSyllableSyncRef.current;
				const endTime = Math.max(startTime, nextSyllableStartTime - EDGE_INTERPOLATION_GAP_SEC);
				applyInterpolatedRangeToCharTimes(
					charTimesRef.current,
					startIdx,
					endIdx,
					startTime,
					endTime
				);

				window.__ivLyricsDebugLog?.('[SyncDataCreator] Applied interpolation to syllable:', startIdx, '-', endIdx, 'duration:', (endTime - startTime).toFixed(3));
				pendingSyllableSyncRef.current = null;
			};

			// 한 단어 앞으로 진행하는 헬퍼 함수
			const advanceOneWord = (currentTime) => {
				// 싱크가 시작되지 않은 경우: 첫 단어만 처리
				if (!isKeyboardSyncingRef.current) {
					isKeyboardSyncingRef.current = true;
					charTimesRef.current = new Array(currentLineChars.length).fill(null);
					setDragStartTime(currentTime);

					let startIdx = 0;
					charTimesRef.current[0] = currentTime;

					// 첫 글자가 여는 괄호면 다음 글자까지 포함
					while (startIdx + 1 < currentLineChars.length && isLeadingChar(currentLineChars, startIdx)) {
						startIdx++;
						charTimesRef.current[startIdx] = currentTime;
					}

					// 첫 단어의 끝까지 진행 (단어 경계 만나면 멈춤)
					let endIdx = startIdx;
					while (endIdx + 1 < currentLineChars.length &&
						!isWordBoundary(currentLineChars, endIdx + 1) &&
						!isTrailingChar(currentLineChars, endIdx + 1)) {
						endIdx++;
						charTimesRef.current[endIdx] = currentTime;
					}

					// trailing 문자들(구두점 등) 포함
					while (endIdx + 1 < currentLineChars.length &&
						isTrailingChar(currentLineChars, endIdx + 1) &&
						!isWordBoundary(currentLineChars, endIdx + 1)) {
						endIdx++;
						charTimesRef.current[endIdx] = currentTime;
					}

					keyboardCharIndexRef.current = endIdx;
					setRecordingCharIndex(endIdx);
					autoScroll(endIdx);

					window.__ivLyricsDebugLog?.('[SyncDataCreator] Word sync started, first word ends at:', endIdx);

					// 마지막 글자면 라인 완료 (보간 적용 후)
					if (keyboardCharIndexRef.current >= currentLineChars.length - 1) {
						// 첫 단어이자 마지막 단어인 경우에도 보간 적용
						if (interpolationEnabledRef.current && endIdx > 0) {
							const duration = estimateWordInterpolationDuration(0, endIdx);
							applyInterpolatedRangeToCharTimes(charTimesRef.current, 0, endIdx, currentTime, currentTime + duration, smoothStepInterpolation);
							window.__ivLyricsDebugLog?.('[SyncDataCreator] Applied interpolation to single word line');
						}
						finishKeyboardSync();
						window.__ivLyricsDebugLog?.('[SyncDataCreator] Line completed by word');
					} else {
						// 보간을 위해 현재 단어 정보 저장 (보간 활성화 시)
						if (interpolationEnabledRef.current) {
							pendingWordSyncRef.current = {
								startIdx: 0,
								endIdx: endIdx,
								startTime: currentTime
							};
						}
					}
					return;
				}

				// 이미 싱크 중인 경우: 이전 단어에 보간 적용 후 다음 단어로 진행
				applyInterpolationToPendingWord(currentTime);

				const startIdx = keyboardCharIndexRef.current;
				let endIdx = startIdx + 1;

				// 먼저 현재 공백들 건너뛰기
				while (endIdx < currentLineChars.length && isWordBoundary(currentLineChars, endIdx)) {
					// 공백에는 이전 단어 끝 시간 + 갭 적용
					charTimesRef.current[endIdx] = currentTime - (WORD_GAP_MS / 2000);
					endIdx++;
				}

				// 다음 단어의 시작 인덱스
				const nextWordStartIdx = endIdx;

				// 다음 단어 경계까지 진행
				while (endIdx < currentLineChars.length && !isWordBoundary(currentLineChars, endIdx) && !isTrailingChar(currentLineChars, endIdx)) {
					charTimesRef.current[endIdx] = currentTime;
					endIdx++;
				}

				// trailing 문자들도 함께 처리
				while (endIdx < currentLineChars.length && isTrailingChar(currentLineChars, endIdx) && !isWordBoundary(currentLineChars, endIdx)) {
					charTimesRef.current[endIdx] = currentTime;
					endIdx++;
				}

				// 최소 한 글자는 진행했는지 확인
				if (endIdx <= startIdx + 1) {
					endIdx = Math.min(startIdx + 1, currentLineChars.length - 1);
					charTimesRef.current[endIdx] = currentTime;
				}

				// endIdx는 마지막으로 처리된 글자의 다음 인덱스이므로 -1
				const finalEndIdx = endIdx - 1;
				keyboardCharIndexRef.current = Math.max(0, finalEndIdx);

				setRecordingCharIndex(keyboardCharIndexRef.current);
				autoScroll(keyboardCharIndexRef.current);

				// 보간을 위해 현재 단어 정보 저장
				if (interpolationEnabledRef.current && nextWordStartIdx < currentLineChars.length) {
					pendingWordSyncRef.current = {
						startIdx: nextWordStartIdx,
						endIdx: keyboardCharIndexRef.current,
						startTime: currentTime
					};
				}

				window.__ivLyricsDebugLog?.('[SyncDataCreator] Word advanced to char:', keyboardCharIndexRef.current);

				// 마지막 글자면 라인 완료
				if (keyboardCharIndexRef.current >= currentLineChars.length - 1) {
					// 마지막 단어에도 보간 적용 (현재 시간 기준으로 약간의 지속시간 부여)
					if (pendingWordSyncRef.current && interpolationEnabledRef.current) {
						const { startIdx, endIdx, startTime } = pendingWordSyncRef.current;
						const charCount = endIdx - startIdx + 1;
						if (charCount > 1) {
							// 마지막 단어는 시작 시간으로부터 글자 수에 비례한 짧은 지속시간 부여
							const duration = estimateWordInterpolationDuration(startIdx, endIdx);
							applyInterpolatedRangeToCharTimes(charTimesRef.current, startIdx, endIdx, startTime, startTime + duration, smoothStepInterpolation);
							window.__ivLyricsDebugLog?.('[SyncDataCreator] Applied interpolation to last word:', startIdx, '-', endIdx);
						}
					}
					pendingWordSyncRef.current = null;
					finishKeyboardSync();
					window.__ivLyricsDebugLog?.('[SyncDataCreator] Line completed by word');
				}
			};

			// 한 단어 뒤로 취소하는 헬퍼 함수 (첫 글자도 취소 가능)
			const revertOneWord = () => {
				if (!isKeyboardSyncingRef.current || keyboardCharIndexRef.current < 0) return;

				// 보간 대기 중인 단어 취소
				pendingWordSyncRef.current = null;

				let targetIdx = keyboardCharIndexRef.current - 1;

				// trailing 문자들 건너뛰기
				while (targetIdx >= 0 && isTrailingChar(currentLineChars, targetIdx)) {
					charTimesRef.current[targetIdx + 1] = null;
					targetIdx--;
				}

				// 단어 경계까지 뒤로 가기
				while (targetIdx >= 0 && !isWordBoundary(currentLineChars, targetIdx)) {
					charTimesRef.current[targetIdx + 1] = null;
					targetIdx--;
				}

				// 공백들 건너뛰기
				while (targetIdx >= 0 && isWordBoundary(currentLineChars, targetIdx)) {
					charTimesRef.current[targetIdx + 1] = null;
					targetIdx--;
				}

				// 현재 위치부터 targetIdx+1까지의 타임 null 처리
				for (let i = targetIdx + 1; i <= keyboardCharIndexRef.current; i++) {
					charTimesRef.current[i] = null;
				}

				keyboardCharIndexRef.current = targetIdx;
				setRecordingCharIndex(keyboardCharIndexRef.current);
				window.__ivLyricsDebugLog?.('[SyncDataCreator] Word reverted to char:', keyboardCharIndexRef.current);

				// 모든 글자 취소시 싱크 상태 초기화
				if (keyboardCharIndexRef.current < 0) {
					isKeyboardSyncingRef.current = false;
					setDragStartTime(null);
					window.__ivLyricsDebugLog?.('[SyncDataCreator] All chars reverted by word, sync reset');
				}
			};

			// 오른쪽 방향키: 한 글자 싱크
			if (shortcutAction === 'charForward') {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				const currentTime = Spicetify.Player.getProgress() / 1000;
				advanceOneChar(currentTime);
			}

			// 왼쪽 방향키: 한 글자 취소 (첫 글자도 취소 가능)
			if (shortcutAction === 'charBack') {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				if (isKeyboardSyncingRef.current && keyboardCharIndexRef.current >= 0) {
					pendingWordSyncRef.current = null;
					pendingSyllableSyncRef.current = null;
					charTimesRef.current[keyboardCharIndexRef.current] = null;
					keyboardCharIndexRef.current--;
					setRecordingCharIndex(keyboardCharIndexRef.current);
					window.__ivLyricsDebugLog?.('[SyncDataCreator] Reverted to char:', keyboardCharIndexRef.current);
					// 모든 글자 취소시 싱크 상태 초기화
					if (keyboardCharIndexRef.current < 0) {
						isKeyboardSyncingRef.current = false;
						setDragStartTime(null);
						window.__ivLyricsDebugLog?.('[SyncDataCreator] All chars reverted, sync reset');
					}
				}
			}

			// . (> 키): 한 단어 싱크
			if (shortcutAction === 'wordForward') {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				const currentTime = Spicetify.Player.getProgress() / 1000;
				advanceOneWord(currentTime);
			}

			// , (< 키): 한 단어 취소
			if (shortcutAction === 'wordBack') {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				pendingSyllableSyncRef.current = null;
				revertOneWord();
			}

			// ; 키: 음절 단위 싱크 (다음 모음까지 진행)
			if (shortcutAction === 'syllable') {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				const currentTime = Spicetify.Player.getProgress() / 1000;

				if (!currentLineSyllableSegments.length) {
					return;
				}

				if (!isKeyboardSyncingRef.current) {
					isKeyboardSyncingRef.current = true;
					charTimesRef.current = new Array(currentLineChars.length).fill(null);
					pendingSyllableSyncRef.current = null;
					setDragStartTime(currentTime);
					pendingWordSyncRef.current = null;

					const firstSegment = currentLineSyllableSegments[0];
					for (let i = firstSegment.start; i <= firstSegment.end; i++) {
						charTimesRef.current[i] = currentTime;
					}

					keyboardCharIndexRef.current = firstSegment.end;
					setRecordingCharIndex(firstSegment.end);
					autoScroll(firstSegment.end);
					window.__ivLyricsDebugLog?.('[SyncDataCreator] Syllable sync started, segment:', firstSegment.start, '-', firstSegment.end);

					if (firstSegment.end >= currentLineChars.length - 1) {
						const duration = estimateSegmentDuration(firstSegment.start, firstSegment.end, 0.05, 0.22);
						applyInterpolatedRangeToCharTimes(charTimesRef.current, firstSegment.start, firstSegment.end, currentTime, currentTime + duration);
						finishKeyboardSync();
						window.__ivLyricsDebugLog?.('[SyncDataCreator] Line completed by syllable');
						return;
					}

					pendingSyllableSyncRef.current = {
						startIdx: firstSegment.start,
						endIdx: firstSegment.end,
						startTime: currentTime
					};
					return;
				}

				const currentSegmentIndex = currentLineSyllableSegments.findIndex(
					(segment) => keyboardCharIndexRef.current >= segment.start && keyboardCharIndexRef.current <= segment.end
				);
				const nextSegment = currentLineSyllableSegments[(currentSegmentIndex >= 0 ? currentSegmentIndex : -1) + 1];

				if (!nextSegment) {
					applyInterpolationToPendingSyllable(currentTime);
					finishKeyboardSync();
					return;
				}

				applyInterpolationToPendingSyllable(currentTime);
				for (let i = nextSegment.start; i <= nextSegment.end; i++) {
					charTimesRef.current[i] = currentTime;
				}

				keyboardCharIndexRef.current = nextSegment.end;
				setRecordingCharIndex(nextSegment.end);
				autoScroll(nextSegment.end);
				window.__ivLyricsDebugLog?.('[SyncDataCreator] Syllable advanced to segment:', nextSegment.start, '-', nextSegment.end);

				if (nextSegment.end >= currentLineChars.length - 1) {
					const duration = estimateSegmentDuration(nextSegment.start, nextSegment.end, 0.05, 0.22);
					applyInterpolatedRangeToCharTimes(charTimesRef.current, nextSegment.start, nextSegment.end, currentTime, currentTime + duration);
					pendingSyllableSyncRef.current = null;
					finishKeyboardSync();
					window.__ivLyricsDebugLog?.('[SyncDataCreator] Line completed by syllable');
					return;
				}

				pendingSyllableSyncRef.current = {
					startIdx: nextSegment.start,
					endIdx: nextSegment.end,
					startTime: currentTime
				};
			}

			// / 키: 드래그 모드 시작 (누르고 있으면 연속으로 빠르게 진행)
			if (e.key === '/' && !e.repeat) {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();

				// 이미 드래그 중이면 무시
				if (isKeyboardDraggingRef.current) return;

				isKeyboardDraggingRef.current = true;

				// 첫 번째 글자 즉시 처리
				const currentTime = Spicetify.Player.getProgress() / 1000;
				const result = advanceOneChar(currentTime);

				// 라인이 완료되었으면 드래그 시작하지 않음
				if (result === -1) {
					isKeyboardDraggingRef.current = false;
					return;
				}

				// 30ms 간격으로 연속 진행 (딜레이 없이 즉시 시작)
				keyboardDragIntervalRef.current = setInterval(() => {
					if (!isKeyboardDraggingRef.current) {
						clearInterval(keyboardDragIntervalRef.current);
						keyboardDragIntervalRef.current = null;
						return;
					}

					const time = Spicetify.Player.getProgress() / 1000;
					const res = advanceOneChar(time);

					// 라인 완료시 드래그 종료
					if (res === -1) {
						isKeyboardDraggingRef.current = false;
						clearInterval(keyboardDragIntervalRef.current);
						keyboardDragIntervalRef.current = null;
					}
				}, 30);
			}

			// Enter: 현재 라인 완료 (중간에서도 완료 가능, 키보드 싱크 중일 때만)
			if (e.key === 'Enter') {
				// 키보드 싱크 중일 때만 처리 (글자를 하나라도 맞췄을 때)
				if (isKeyboardSyncingRef.current && keyboardCharIndexRef.current >= 0) {
					e.preventDefault();
					e.stopPropagation();
					e.stopImmediatePropagation();
					finishKeyboardSync();
				}
				// 싱크 중이 아닐 때는 기본 동작 허용 (다른 버튼 클릭 등)
			}

			// Backspace: 현재 라인 싱크 취소
			if (e.key === 'Backspace' && isKeyboardSyncingRef.current) {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				isKeyboardSyncingRef.current = false;
				keyboardCharIndexRef.current = -1;
				charTimesRef.current = [];
				pendingWordSyncRef.current = null;
				pendingSyllableSyncRef.current = null;
				setDragStartTime(null);
				setRecordingCharIndex(-1);

				// 드래그 모드도 취소
				if (isKeyboardDraggingRef.current) {
					isKeyboardDraggingRef.current = false;
					if (keyboardDragIntervalRef.current) {
						clearInterval(keyboardDragIntervalRef.current);
						keyboardDragIntervalRef.current = null;
					}
				}
			}

			// z: 3초 뒤로
			if (e.key === 'z') {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				const currentPos = Spicetify.Player.getProgress();
				Spicetify.Player.seek(Math.max(0, currentPos - 3000));
			}

			// x: 3초 앞으로
			if (e.key === 'x') {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				const currentPos = Spicetify.Player.getProgress();
				const duration = Spicetify.Player.getDuration();
				Spicetify.Player.seek(Math.min(duration, currentPos + 3000));
			}
		};

		// / 키 keyup 이벤트 핸들러 (드래그 종료)
		const handleKeyUp = (e) => {
			if (e.key === '/') {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();

				isKeyboardDraggingRef.current = false;
				if (keyboardDragIntervalRef.current) {
					clearInterval(keyboardDragIntervalRef.current);
					keyboardDragIntervalRef.current = null;
				}
			}
		};

		window.__ivLyricsDebugLog?.('[SyncDataCreator] Registering keydown/keyup listeners, mode:', mode);
		document.addEventListener('keydown', handleKeyDown, true); // capture phase
		document.addEventListener('keyup', handleKeyUp, true); // capture phase
		return () => {
			window.__ivLyricsDebugLog?.('[SyncDataCreator] Removing keydown/keyup listeners');
			document.removeEventListener('keydown', handleKeyDown, true);
			document.removeEventListener('keyup', handleKeyUp, true);
			// 정리시 드래그 인터벌도 정리
			if (keyboardDragIntervalRef.current) {
				clearInterval(keyboardDragIntervalRef.current);
				keyboardDragIntervalRef.current = null;
			}
			isKeyboardDraggingRef.current = false;
		};
	}, [mode, currentLineIndex, lyricsLines.length, currentLineChars, currentLineSyllableSegments, lineCharOffsets, autoScroll, commitCurrentLineSync]);

	const handleContainerMouseDown = useCallback((e) => {
		if (mode !== 'record' || currentLineIndex >= lyricsLines.length) return;
		const touch = e.touches ? e.touches[0] : e;
		const charIndex = getCharIndexFromPoint(touch.clientX, touch.clientY);
		if (charIndex >= 0) handleDragStart(charIndex, e);
	}, [mode, currentLineIndex, lyricsLines.length, getCharIndexFromPoint, handleDragStart]);

	useEffect(() => {
		if (!isDragging) return;

		const handleGlobalMove = (e) => {
			if (!isDragging) return;
			const touch = e.touches ? e.touches[0] : e;
			const charIndex = getCharIndexFromPoint(touch.clientX, touch.clientY);
			if (charIndex !== null) handleDragMove(charIndex, e);
		};

		const handleGlobalEnd = (e) => {
			if (isDragging) handleDragEnd(e);
		};

		document.addEventListener('mousemove', handleGlobalMove);
		document.addEventListener('mouseup', handleGlobalEnd);
		document.addEventListener('touchmove', handleGlobalMove, { passive: false });
		document.addEventListener('touchend', handleGlobalEnd);

		return () => {
			document.removeEventListener('mousemove', handleGlobalMove);
			document.removeEventListener('mouseup', handleGlobalEnd);
			document.removeEventListener('touchmove', handleGlobalMove);
			document.removeEventListener('touchend', handleGlobalEnd);
		};
	}, [isDragging, getCharIndexFromPoint, handleDragMove, handleDragEnd]);

	// 현재 줄 싱크 삭제
	const deleteCurrentLineSync = useCallback(() => {
		if (!syncData || !syncData.lines) return;
		const lineStart = lineCharOffsets[currentLineIndex];

		setSyncData(prev => {
			const newLines = prev.lines.filter(l => l.start !== lineStart);
			return newLines.length > 0 ? { lines: newLines } : null;
		});
	}, [syncData, lineCharOffsets, currentLineIndex]);

	const toggleMode = useCallback((newMode) => {
		if (mode === newMode) {
			setMode('idle');
		} else {
			setMode(newMode);
			if (newMode === 'preview') Spicetify.Player.seek(0);
			if (!Spicetify.Player.isPlaying()) Spicetify.Player.play();
		}
	}, [mode]);

	const adjustGlobalOffset = useCallback((deltaMs) => {
		const deltaSec = deltaMs / 1000;

		setSyncData(prev => {
			if (!prev || !prev.lines) return prev;
			return {
				lines: prev.lines.map(line => ({
					...line,
					chars: line.chars.map(t => Math.round((t + deltaSec) * 1000) / 1000)
				}))
			};
		});
		setGlobalOffset(prev => prev + deltaMs);
	}, []);

	const resetFromStart = useCallback(() => {
		setCurrentLineIndex(0);
		setSyncData(null);
		setGlobalOffset(0);
		setMode('idle');
		Spicetify.Player.seek(0);
		if (lyricsScrollRef.current) lyricsScrollRef.current.scrollLeft = 0;
	}, []);

	const goToPrevLine = useCallback(() => {
		if (currentLineIndex > 0) {
			setCurrentLineIndex(prev => prev - 1);
			if (lyricsScrollRef.current) lyricsScrollRef.current.scrollLeft = 0;
		}
	}, [currentLineIndex]);

	const goToNextLine = useCallback(() => {
		if (currentLineIndex < lyricsLines.length - 1) {
			setCurrentLineIndex(prev => prev + 1);
			if (lyricsScrollRef.current) lyricsScrollRef.current.scrollLeft = 0;
		}
	}, [currentLineIndex, lyricsLines.length]);

	const goToFirstLine = useCallback(() => {
		setCurrentLineIndex(0);
		if (lyricsScrollRef.current) lyricsScrollRef.current.scrollLeft = 0;
	}, []);

	const handleSeek = useCallback((e) => {
		const rect = e.currentTarget.getBoundingClientRect();
		const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
		const percent = Math.max(0, Math.min(1, x / rect.width));
		const duration = Spicetify.Player?.data?.item?.duration?.milliseconds || 0;
		Spicetify.Player.seek(duration * percent);
	}, []);

	const handleSeekOffset = useCallback((offsetMs) => {
		Spicetify.Player.seek(Math.max(0, Spicetify.Player.getProgress() + offsetMs));
	}, []);

	const handleSubmit = useCallback(async () => {
		if (!syncData || !syncData.lines || syncData.lines.length === 0) {
			Toast.error(I18n.t('syncCreator.noSyncData'));
			return;
		}

		if (syncData.lines.length < lyricsLines.length) {
			if (!confirm(I18n.t('syncCreator.incompleteConfirm'))) return;
		}

		setIsSubmitting(true);

		try {
			const submitMetadata = {
				title: trackName,
				artist: artistName
			};
			if (typeof SyncDataService !== 'undefined' && SyncDataService.submitSyncData) {
				const result = await SyncDataService.submitSyncData(trackId, provider, syncData, submitMetadata);
				if (result) {
					Toast.success(I18n.t('syncCreator.submitSuccess'));
					// 캐시 무효화
					window.SyncDataService?.clearCache(trackId);
					// 가사 페이지 새로고침
					setTimeout(() => {
						if (typeof window.reloadLyrics === 'function') {
							window.reloadLyrics(true);
						} else if (typeof window.lyricContainer?.reloadLyrics === 'function') {
							window.lyricContainer.reloadLyrics(true);
						}
					}, 500);
					if (onClose) onClose();
				} else {
					Toast.error(I18n.t('syncCreator.submitError'));
				}
			} else {
					const response = await fetch('https://lyrics.api.ivl.is/lyrics/sync-data', {
						method: 'POST',
						headers: Utils.getApiHeaders({ 'Content-Type': 'application/json' }),
						body: JSON.stringify({ trackId, provider, syncData, ...submitMetadata })
					});

				if (response.ok) {
					Toast.success(I18n.t('syncCreator.submitSuccess'));
					// 캐시 무효화
					window.SyncDataService?.clearCache(trackId);
					// 가사 페이지 새로고침
					setTimeout(() => {
						if (typeof window.reloadLyrics === 'function') {
							window.reloadLyrics(true);
						} else if (typeof window.lyricContainer?.reloadLyrics === 'function') {
							window.lyricContainer.reloadLyrics(true);
						}
					}, 500);
					if (onClose) onClose();
				} else {
					Toast.error((await response.json()).error || I18n.t('syncCreator.submitError'));
				}
			}
		} catch (e) {
			console.error('[SyncDataCreator] Submit error:', e);
			Toast.error(e?.message || I18n.t('syncCreator.submitError'));
		}

		setIsSubmitting(false);
	}, [syncData, lyricsLines.length, trackId, provider, trackName, artistName, onClose]);

	// 싱크 데이터 내보내기 (JSON 파일로 저장)
	const exportSyncData = useCallback(() => {
		if (!syncData || !syncData.lines || syncData.lines.length === 0) {
			Toast.error(I18n.t('syncCreator.noSyncData') || '내보낼 싱크 데이터가 없습니다');
			return;
		}

		const blob = new Blob([JSON.stringify(syncData, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `sync-${trackId}-${Date.now()}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		Toast.success(I18n.t('syncCreator.exportSuccess') || '싱크 데이터를 내보냈습니다');
	}, [syncData, trackId]);

	// 싱크 데이터 불러오기 (JSON 파일에서)
	const importSyncData = useCallback(() => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json';
		input.onchange = async (e) => {
			const file = e.target.files[0];
			if (!file) return;

			try {
				const text = await file.text();
				const importedData = JSON.parse(text);

				// 형식 검증 - lines 배열이 있는지 확인
				if (!importedData.lines || !Array.isArray(importedData.lines)) {
					throw new Error('Invalid sync data format');
				}

				// 싱크 데이터 적용
				setSyncData(importedData);

				Toast.success(I18n.t('syncCreator.importSuccess') || '싱크 데이터를 불러왔습니다');
			} catch (err) {
				console.error('[SyncDataCreator] Import error:', err);
				Toast.error((I18n.t('syncCreator.importError') || '불러오기 실패') + ': ' + err.message);
			}
		};
		input.click();
	}, []);

	// 가사 전체 복사
	const copyAllLyrics = useCallback(async () => {
		if (!lyricsText) {
			Toast.error(I18n.t('syncCreator.noLyrics') || '복사할 가사가 없습니다');
			return;
		}

		try {
			await navigator.clipboard.writeText(lyricsText);
			Toast.success(I18n.t('syncCreator.lyricsCopied') || '가사를 클립보드에 복사했습니다');
		} catch (err) {
			console.error('[SyncDataCreator] Copy error:', err);
			Toast.error((I18n.t('syncCreator.copyError') || '복사 실패') + ': ' + err.message);
		}
	}, [lyricsText]);

	// LRCLIB 등록 취소
	const cancelLrcLibPublish = useCallback(() => {
		setPublishCancelled(true);
		publishWorkersRef.current.forEach(w => w.terminate());
		publishWorkersRef.current = [];
		setIsPublishingToLrcLib(false);
		setLrcLibPublishProgress('');
		Toast.warning(I18n.t('syncCreator.lrclib.publishCancelled') || '등록이 취소되었습니다');
	}, []);

	// LRCLIB Proof-of-Work 솔버 (Web Worker 사용)
	const solveLrcLibChallenge = useCallback((prefix, targetHex) => {
		return new Promise((resolve, reject) => {
			const workerCount = navigator.hardwareConcurrency || 4;
			const workers = [];
			let solved = false;
			let totalProgress = 0;

			// Web Worker 코드를 Blob으로 생성
			const workerCode = `
				self.onmessage = async function(e) {
					const { prefix, targetHex, start, step } = e.data;
					const target = new Uint8Array(targetHex.match(/.{2}/g).map(b => parseInt(b, 16)));

					const isHashLessThanTarget = (hash) => {
						for (let i = 0; i < 32; i++) {
							if (hash[i] < target[i]) return true;
							if (hash[i] > target[i]) return false;
						}
						return false;
					};

					const encoder = new TextEncoder();
					let nonce = start;
					let count = 0;

					while (true) {
						const data = encoder.encode(prefix + nonce);
						const hashBuffer = await crypto.subtle.digest('SHA-256', data);
						const hash = new Uint8Array(hashBuffer);

						if (isHashLessThanTarget(hash)) {
							self.postMessage({ found: true, nonce });
							return;
						}

						nonce += step;
						count++;

						if (count % 10000 === 0) {
							self.postMessage({ found: false, count });
						}
					}
				};
			`;

			const blob = new Blob([workerCode], { type: 'application/javascript' });
			const workerUrl = URL.createObjectURL(blob);

			for (let i = 0; i < workerCount; i++) {
				const worker = new Worker(workerUrl);
				workers.push(worker);

				worker.onmessage = (e) => {
					if (e.data.found && !solved) {
						solved = true;
						window.__ivLyricsDebugLog?.('[SyncDataCreator] PoW solved! nonce:', e.data.nonce);
						workers.forEach(w => w.terminate());
						publishWorkersRef.current = [];
						URL.revokeObjectURL(workerUrl);
						resolve(e.data.nonce.toString());
					} else if (!e.data.found && !solved) {
						totalProgress += e.data.count;
						setLrcLibPublishProgress(
							I18n.t('syncCreator.lrclib.solving').replace('{nonce}', totalProgress.toLocaleString())
						);
					}
				};

				worker.postMessage({ prefix, targetHex, start: i, step: workerCount });
			}

			// Worker들을 ref에 저장하여 취소 가능하게 함
			publishWorkersRef.current = workers;
		});
	}, []);

	// LRCLIB에 가사 발행
	const publishToLrcLib = useCallback(async () => {
		if (!manualLyricsInput.trim()) {
			Toast.error(I18n.t('syncCreator.lrclib.noLyricsInput'));
			return;
		}

		setPublishCancelled(false);
		setIsPublishingToLrcLib(true);
		setLrcLibPublishProgress(I18n.t('syncCreator.lrclib.requestingChallenge'));

		try {
			// 1. Challenge 요청 - 직접 호출 먼저 시도
			const challengeUrl = 'https://lrclib.net/api/request-challenge';
			let challengeRes;
			try {
				challengeRes = await fetch(challengeUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' }
				});
			} catch (corsError) {
				// CORS 오류 시 프록시 사용
				window.__ivLyricsDebugLog?.('[SyncDataCreator] Direct challenge request failed, trying proxy...');
				challengeRes = await fetch('https://corsproxy.io/?url=' + encodeURIComponent(challengeUrl), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' }
				});
			}

			if (!challengeRes.ok) {
				throw new Error('Failed to request challenge');
			}

			const challenge = await challengeRes.json();
			setLrcLibPublishProgress(I18n.t('syncCreator.lrclib.solvingChallenge'));

			// 2. Proof-of-Work 솔브
			const nonce = await solveLrcLibChallenge(challenge.prefix, challenge.target);

			// 취소 확인
			if (publishCancelled) {
				return;
			}

			const publishToken = `${challenge.prefix}:${nonce}`;

			setLrcLibPublishProgress(I18n.t('syncCreator.lrclib.publishing'));

			// 3. 가사 발행
			const duration = Math.round((Spicetify.Player?.data?.item?.duration?.milliseconds || 0) / 1000);
			const albumName = trackInfo?.album?.name || Spicetify.Player?.data?.item?.album?.name || '';

			// syncData가 있으면 싱크된 가사로 변환
			let syncedLyrics = '';
			if (syncData && syncData.lines && syncData.lines.length > 0) {
				const lines = manualLyricsInput.split('\n').filter(l => l.trim());
				syncedLyrics = syncData.lines.map(lineData => {
					const lineIdx = lyricsLines.findIndex((_, idx) => lineCharOffsets[idx] === lineData.start);
					if (lineIdx >= 0 && lines[lineIdx]) {
						const startTime = lineData.chars[0];
						const mins = Math.floor(startTime / 60);
						const secs = (startTime % 60).toFixed(2);
						return `[${mins.toString().padStart(2, '0')}:${secs.padStart(5, '0')}] ${lines[lineIdx]}`;
					}
					return null;
				}).filter(Boolean).join('\n');
			}

			// 백엔드 프록시를 통해 발행 (LRCLIB은 CORS를 허용하지 않음)
			const publishRes = await fetch('https://lyrics.api.ivl.is/lyrics/lrclib/publish', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					publishToken: publishToken,
					trackName: trackName,
					artistName: trackInfo?.artists?.[0]?.name || Spicetify.Player?.data?.item?.artists?.[0]?.name || artistName.split(',')[0].trim(),
					albumName: albumName,
					duration: duration,
					plainLyrics: manualLyricsInput.trim(),
					syncedLyrics: syncedLyrics || ''
				})
			});

			if (publishRes.ok) {
				Toast.success(I18n.t('syncCreator.lrclib.publishSuccess'));
				setShowLrcLibPublish(false);
				setManualLyricsInput('');

				// LRCLIB에 가사가 반영될 때까지 잠시 대기 후 자동 로드
				setLrcLibPublishProgress(I18n.t('syncCreator.lrclib.loadingAfterPublish') || '가사를 불러오는 중...');
				setProvider('lrclib');

				// 2초 후 가사 로드 (LRCLIB 서버 반영 대기)
				setTimeout(async () => {
					await loadLyrics();
					setLrcLibPublishProgress('');
					setIsPublishingToLrcLib(false);
				}, 2000);

				// 가사 페이지 새로고침
				setTimeout(() => {
					if (typeof window.reloadLyrics === 'function') {
						window.reloadLyrics(true);
					} else if (typeof window.lyricContainer?.reloadLyrics === 'function') {
						window.lyricContainer.reloadLyrics(true);
					}
				}, 3000);
				return; // isPublishingToLrcLib는 위에서 처리
			} else {
				const errData = await publishRes.json().catch(() => ({}));
				throw new Error(errData.message || 'Publish failed');
			}
		} catch (e) {
			if (!publishCancelled) {
				console.error('[SyncDataCreator] LRCLIB publish error:', e);
				Toast.error(I18n.t('syncCreator.lrclib.publishError') + ': ' + e.message);
			}
		}

		setIsPublishingToLrcLib(false);
		setLrcLibPublishProgress('');
	}, [manualLyricsInput, trackName, artistName, trackInfo, syncData, lyricsLines, lineCharOffsets, solveLrcLibChallenge, loadLyrics, publishCancelled]);

	const formatTime = useCallback((ms) => {
		const totalSeconds = Math.floor(ms / 1000);
		return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
	}, []);

	const formatSeconds = useCallback((seconds) => `${seconds.toFixed(1)}s`, []);
	const syncLinesByStart = useMemo(() => {
		if (!Array.isArray(syncData?.lines) || syncData.lines.length === 0) return null;
		return new Map(syncData.lines.map((line) => [line.start, line]));
	}, [syncData]);

	const isCharSynced = useCallback((lineIndex, charIndex) => {
		if (!syncLinesByStart) return false;
		const lineStart = lineCharOffsets[lineIndex];
		const lineData = syncLinesByStart.get(lineStart);
		return lineData && lineData.chars && lineData.chars.length > charIndex;
	}, [syncLinesByStart, lineCharOffsets]);

	const getCharSyncTime = useCallback((lineIndex, charIndex) => {
		if (!syncLinesByStart) return null;
		const lineStart = lineCharOffsets[lineIndex];
		const lineData = syncLinesByStart.get(lineStart);
		return lineData?.chars?.[charIndex] ?? null;
	}, [syncLinesByStart, lineCharOffsets]);

	const getPreviewCharIndex = useCallback((lineIndex) => {
		if (!syncLinesByStart) return -1;
		const currentTimeSec = position / 1000;
		const lineStart = lineCharOffsets[lineIndex];
		const lineData = syncLinesByStart.get(lineStart);
		if (!lineData || !lineData.chars) return -1;
		for (let i = lineData.chars.length - 1; i >= 0; i--) {
			if (currentTimeSec >= lineData.chars[i]) return i;
		}
		return -1;
	}, [syncLinesByStart, position, lineCharOffsets]);

	useEffect(() => { charElementsRef.current = []; }, [currentLineIndex, lyricsText]);

	const getModeStyle = () => {
		if (mode === 'record') return { background: '#e53935', color: '#fff' };
		if (mode === 'preview') return { background: '#2196f3', color: '#fff' };
		return { background: 'var(--spice-misc)', color: 'var(--spice-subtext)' };
	};

	const getModeLabel = () => {
		if (mode === 'record') return I18n.t('syncCreator.recordMode');
		if (mode === 'preview') return I18n.t('syncCreator.previewMode');
		return I18n.t('syncCreator.idleMode');
	};

	// 스타일
	const s = {
		overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--spice-main, #121212)', zIndex: 10000, display: 'flex', flexDirection: 'column' },
		header: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '12px 20px', borderBottom: '1px solid var(--spice-misc)', flexShrink: 0 },
		backBtn: { background: 'var(--spice-misc)', border: 'none', color: 'var(--spice-text)', cursor: 'pointer', padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '600' },
		title: { fontSize: '16px', fontWeight: '700', margin: 0, color: 'var(--spice-text)' },
		modeBadge: { padding: '4px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: '600' },
		submitBtn: { background: 'var(--spice-button)', color: 'var(--spice-button-text, #000)', border: 'none', padding: '10px 20px', borderRadius: '20px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' },
		trackRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', background: 'var(--spice-card)', flexShrink: 0 },
		albumArt: { width: '48px', height: '48px', borderRadius: '6px', objectFit: 'cover' },
		trackMeta: { flex: 1 },
		trackName: { fontSize: '14px', fontWeight: '600', color: 'var(--spice-text)' },
		artistName: { fontSize: '12px', color: 'var(--spice-subtext)' },
		providerRow: { display: 'flex', alignItems: 'center', gap: '8px' },
		virtualKaraokeBadge: { background: 'rgba(29, 185, 84, 0.18)', color: '#1db954', border: '1px solid rgba(29, 185, 84, 0.35)', borderRadius: '999px', padding: '4px 10px', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' },
		select: { background: 'var(--spice-card)', color: 'var(--spice-text)', border: '1px solid var(--spice-misc)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px' },
		loadBtn: { background: 'var(--spice-button)', color: 'var(--spice-button-text, #000)', border: 'none', padding: '6px 12px', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '12px' },
		candidatePanelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px', gridColumn: '1 / -1' },
		candidatePanelTitle: { fontSize: '12px', fontWeight: '700', color: 'var(--spice-text)' },
		candidatePanel: { display: 'grid', gridTemplateColumns: 'minmax(260px, 360px) minmax(0, 1fr)', gap: '12px', padding: '12px 20px', background: 'var(--spice-card)', borderTop: '1px solid var(--spice-misc)', flexShrink: 0 },
		candidateList: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '230px', overflowY: 'auto', paddingRight: '4px' },
		candidateItem: { background: 'var(--spice-main)', border: '1px solid var(--spice-misc)', borderRadius: '10px', padding: '10px 12px', cursor: 'pointer', textAlign: 'left' },
		candidateItemActive: { border: '1px solid var(--spice-button)', boxShadow: '0 0 0 1px rgba(var(--spice-rgb-button), 0.25)' },
		candidateItemApplied: { background: 'rgba(var(--spice-rgb-button), 0.12)' },
		candidateTitle: { fontSize: '13px', fontWeight: '700', color: 'var(--spice-text)' },
		candidateSubtitle: { fontSize: '11px', color: 'var(--spice-subtext)', marginTop: '2px' },
		candidateMetaRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' },
		candidateBadge: { display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: '700', background: 'rgba(255,255,255,0.08)', color: 'var(--spice-text)' },
		candidatePreview: { minHeight: '0', background: 'var(--spice-main)', border: '1px solid var(--spice-misc)', borderRadius: '12px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' },
		candidatePreviewHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
		candidatePreviewTitle: { fontSize: '14px', fontWeight: '700', color: 'var(--spice-text)' },
		candidatePreviewSubtitle: { fontSize: '11px', color: 'var(--spice-subtext)', marginTop: '3px' },
		candidatePreviewActions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
		candidatePreviewText: { margin: 0, whiteSpace: 'pre-wrap', fontSize: '12px', lineHeight: 1.55, color: 'var(--spice-text)', maxHeight: '180px', overflowY: 'auto' },
		candidateEmpty: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '180px', fontSize: '12px', color: 'var(--spice-subtext)' },
		secondaryBtn: { background: 'var(--spice-misc)', color: 'var(--spice-text)', border: 'none', padding: '8px 12px', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '12px' },
		playbackRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: 'var(--spice-card)', flexShrink: 0 },
		playbackTime: { fontSize: '11px', color: 'var(--spice-subtext)', minWidth: '40px', fontVariantNumeric: 'tabular-nums' },
		playbackBar: { flex: 1, height: '6px', background: 'var(--spice-misc)', borderRadius: '3px', cursor: 'pointer' },
		playbackFill: { height: '100%', background: 'var(--spice-button)', borderRadius: '3px' },
		seekBtn: { background: 'var(--spice-misc)', color: 'var(--spice-text)', border: 'none', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer' },
		offsetRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '8px 20px', background: 'var(--spice-card)', borderTop: '1px solid var(--spice-misc)', flexShrink: 0 },
		offsetLabel: { fontSize: '11px', color: 'var(--spice-subtext)' },
		offsetValue: { fontSize: '11px', color: 'var(--spice-text)', fontWeight: '600', minWidth: '50px', textAlign: 'center' },
		offsetBtn: { background: 'var(--spice-misc)', color: 'var(--spice-text)', border: 'none', padding: '3px 6px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer' },
		lyricsArea: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '16px 20px', overflow: 'hidden' },
		lineNav: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px' },
		navBtn: { background: 'var(--spice-misc)', color: 'var(--spice-text)', border: 'none', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' },
		lineInfo: { textAlign: 'center' },
		lineCount: { fontSize: '20px', fontWeight: '700', color: 'var(--spice-text)' },
		lineStatus: { fontSize: '11px', color: 'var(--spice-subtext)' },
		lyricsBox: { background: 'var(--spice-card)', borderRadius: '12px', padding: '32px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: mode === 'record' ? 'pointer' : 'default', userSelect: 'none', marginBottom: '12px' },
		lyricsScroll: { width: '100%', overflowX: 'auto', overflowY: 'hidden', paddingBottom: '28px', display: 'flex', justifyContent: 'center' },
		lyricsLine: { display: 'inline-flex', flexWrap: 'nowrap', gap: '0px', paddingLeft: '32px', paddingRight: '32px', justifyContent: 'center' },
		charSpan: { padding: '10px 1px', borderRadius: '4px', cursor: mode === 'record' ? 'pointer' : 'default', position: 'relative', fontSize: '32px', fontWeight: '600', minWidth: '6px', textAlign: 'center', flexShrink: 0, color: 'var(--spice-text)', letterSpacing: '-1px' },
		charSynced: { background: 'rgba(var(--spice-rgb-button), 0.2)' },
		charPlayed: { background: 'var(--spice-button)', color: 'var(--spice-button-text, #000)' },
		charRecording: { background: 'rgba(255, 152, 0, 0.6)' },
		charTime: { position: 'absolute', bottom: '-20px', left: '50%', transform: 'translateX(-50%)', fontSize: '9px', color: 'var(--spice-subtext)', whiteSpace: 'nowrap' },
		nextLineBox: { textAlign: 'center', padding: '8px', opacity: 0.6 },
		nextLineLabel: { fontSize: '10px', color: 'var(--spice-subtext)', marginBottom: '4px', textTransform: 'uppercase' },
		nextLineText: { fontSize: '14px', color: 'var(--spice-subtext)' },
		hint: { fontSize: '12px', color: 'var(--spice-subtext)', textAlign: 'center', padding: '8px', fontStyle: 'italic' },
		progressRow: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', padding: '6px 20px', fontSize: '12px', color: 'var(--spice-subtext)', flexShrink: 0 },
		controls: { display: 'flex', flexWrap: 'wrap', gap: '10px', padding: '12px 20px', justifyContent: 'center', borderTop: '1px solid var(--spice-misc)', flexShrink: 0 },
		ctrlBtn: { background: 'var(--spice-card)', color: 'var(--spice-text)', border: '1px solid var(--spice-misc)', padding: '10px 16px', borderRadius: '10px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' },
		modeBtn: { border: 'none', padding: '12px 24px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', fontSize: '14px', minWidth: '100px' },
		deleteBtn: { background: 'transparent', color: '#f44336', border: '1px solid #f44336', padding: '10px 16px', borderRadius: '10px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' },
		loading: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--spice-subtext)' },
		error: { textAlign: 'center', padding: '40px', color: '#e53935' },
		// LRCLIB 발행 모달 스타일
		lrcLibModal: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' },
		lrcLibContent: { background: 'var(--spice-card)', borderRadius: '16px', padding: '24px', width: '90%', maxWidth: '600px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: '16px' },
		lrcLibTitle: { fontSize: '18px', fontWeight: '700', color: 'var(--spice-text)', margin: 0 },
		lrcLibDesc: { fontSize: '13px', color: 'var(--spice-subtext)', lineHeight: 1.5 },
		lrcLibTextarea: { width: '100%', height: '300px', background: 'var(--spice-main)', color: 'var(--spice-text)', border: '1px solid var(--spice-misc)', borderRadius: '8px', padding: '12px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' },
		lrcLibBtnRow: { display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' },
		lrcLibBtn: { background: 'var(--spice-button)', color: 'var(--spice-button-text, #000)', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' },
		lrcLibBtnSecondary: { background: 'var(--spice-misc)', color: 'var(--spice-text)', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' },
		lrcLibBtnCancel: { background: 'transparent', color: 'var(--spice-subtext)', border: '1px solid var(--spice-misc)', padding: '10px 20px', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' },
		lrcLibProgress: { fontSize: '12px', color: 'var(--spice-subtext)', textAlign: 'center', padding: '8px' },
		publishBtn: { background: '#4caf50', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px', marginTop: '12px' },
		wrongWarning: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 15px', background: 'rgba(255, 152, 0, 0.1)', border: '1px solid rgba(255, 152, 0, 0.3)', borderRadius: '8px', marginBottom: '15px', marginTop: '-5px', fontSize: '13px', gap: '10px' },
		publishBtnSmall: { background: 'var(--spice-button)', color: 'var(--spice-button-text, #000)', border: 'none', padding: '6px 12px', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '12px', flexShrink: 0 },
		// 키보드 단축키 스타일
		shortcutsContainer: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px', padding: '12px 16px', background: 'var(--spice-card)', borderRadius: '10px', marginTop: '12px' },
		shortcutItem: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--spice-subtext)' },
		shortcutKey: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '24px', height: '22px', padding: '0 6px', background: 'var(--spice-misc)', color: 'var(--spice-text)', borderRadius: '4px', fontSize: '10px', fontWeight: '700', fontFamily: 'monospace', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 2px 0 rgba(0,0,0,0.3)' },
		shortcutDesc: { color: 'var(--spice-subtext)' },
	};

	return react.createElement('div', { style: s.overlay, ref: containerRef },
		// Header - 유저 요청대로 가운데 정렬 (윈도우 컨트롤과 겹치지 않게)
		react.createElement('div', { style: s.header },
			react.createElement('button', {
				style: s.backBtn, onClick: () => {
					preventNextTrackRef.current = false;
					if (onClose) onClose();
				}
			},
				react.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'currentColor' },
					react.createElement('path', { d: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z' })
				),
				I18n.t('syncCreator.back') || '닫기'
			),
			react.createElement('h2', { style: s.title }, I18n.t('syncCreator.title')),
			react.createElement('span', { style: { ...s.modeBadge, ...getModeStyle() } }, getModeLabel()),

			react.createElement('button', {
				style: { ...s.submitBtn, opacity: isSubmitting || !syncData ? 0.5 : 1, cursor: isSubmitting || !syncData ? 'not-allowed' : 'pointer' },
				onClick: handleSubmit,
				disabled: isSubmitting || !syncData
			}, isSubmitting ? I18n.t('syncCreator.submitting') : I18n.t('syncCreator.submit'))
		),

		// Track + Provider
		react.createElement('div', { style: s.trackRow },
			albumArt && react.createElement('img', { src: albumArt, style: s.albumArt, alt: trackName }),
			react.createElement('div', { style: s.trackMeta },
				react.createElement('div', { style: s.trackName }, trackName),
				react.createElement('div', { style: s.artistName }, artistName)
			),
			react.createElement('div', { style: s.providerRow },
				// LRCLIB Upload Button
				react.createElement('button', {
					style: { ...s.publishBtnSmall, marginRight: '10px', background: 'rgba(255, 152, 0, 0.8)', color: '#fff', fontSize: '11px', padding: '4px 8px' },
					onClick: () => setShowLrcLibPublish(true),
					title: I18n.t('syncCreator.lrclib.wrongLyricsWarning')
				}, I18n.t('syncCreator.lrclib.registerLyrics')),

				react.createElement('span', { style: { fontSize: '12px', color: 'var(--spice-subtext)' } }, 'Provider:'),
				react.createElement('select', {
					style: s.select,
					value: addonId || '',
					onChange: (e) => {
						const newAddonId = e.target.value;
						if (newAddonId) {
							setAddonId(newAddonId);
							loadLyrics(newAddonId);
						}
					}
				},
					[
						react.createElement('option', { key: 'default', value: '', disabled: true }, I18n.t('syncCreator.selectProvider') || '제공자 선택...'),
						...availableProviders.map(p =>
							react.createElement('option', { key: p.id, value: p.id }, p.name)
						)
					]
				),
				react.createElement('button', { style: { ...s.loadBtn, opacity: isLoading ? 0.5 : 1 }, onClick: () => loadLyrics(addonId), disabled: isLoading },
					isLoading ? I18n.t('syncCreator.loading') : I18n.t('syncCreator.reload') || '다시 로드'
				),
				isVirtualKaraokeSource && react.createElement('span', { style: s.virtualKaraokeBadge },
					I18n.t('syncCreator.virtualKaraoke') || '가상 노래방 데이터'
				)
			)
		),

		addonId === 'lrclib' && react.createElement('div', { style: s.candidatePanel },
			react.createElement('div', { style: s.candidatePanelHeader },
				react.createElement('div', { style: s.candidatePanelTitle },
					`${I18n.t('syncCreator.lrclibSearchResults') || 'LRCLIB Search Results'} ${(lrclibSearchMeta?.totalResults || lrclibCandidates.length || 0) > 0 ? `(${lrclibSearchMeta?.totalResults || lrclibCandidates.length})` : ''}`
				),
				react.createElement('button', {
					type: 'button',
					style: s.secondaryBtn,
					onClick: () => setShowLrclibCandidates(prev => !prev)
				}, showLrclibCandidates
					? (I18n.t('syncCreator.hideLrclibSearchResults') || 'Hide Search Results')
					: (I18n.t('syncCreator.showLrclibSearchResults') || 'Show Search Results'))
			),
			showLrclibCandidates && react.createElement('div', { style: s.candidateList },
				isLoading && lrclibCandidates.length === 0 && react.createElement('div', { style: s.candidateEmpty },
					I18n.t('syncCreator.loadingLyrics') || '가사를 불러오는 중...'
				),
				!isLoading && lrclibCandidates.length === 0 && react.createElement('div', { style: s.candidateEmpty },
					lrclibSearchMeta?.error || (I18n.t('syncCreator.lrclibNoCandidates') || 'No LRCLIB candidates found')
				),
				lrclibCandidates.map((candidate, index) => {
					const isPreviewing = previewLrclibCandidate?.candidateKey === candidate.candidateKey;
					const isApplied = selectedLrclibCandidateKey === candidate.candidateKey;
					let itemStyle = { ...s.candidateItem };
					if (isPreviewing) itemStyle = { ...itemStyle, ...s.candidateItemActive };
					if (isApplied) itemStyle = { ...itemStyle, ...s.candidateItemApplied };

					return react.createElement('button', {
						key: candidate.candidateKey,
						type: 'button',
						style: itemStyle,
						onClick: () => setPreviewLrclibCandidateKey(candidate.candidateKey)
					},
						react.createElement('div', { style: s.candidateTitle }, `${index + 1}. ${candidate.trackName || candidate.name || trackName}`),
						react.createElement('div', { style: s.candidateSubtitle },
							`${candidate.artistName || artistName} · ${formatSeconds(Number(candidate.duration || 0))}`
						),
						react.createElement('div', { style: s.candidateMetaRow },
							candidate.syncLineExactMatch && react.createElement('span', { style: { ...s.candidateBadge, color: '#4caf50' } }, I18n.t('syncCreator.lrclibBadgeExact') || 'Exact'),
							candidate.hasSyncedLyrics && react.createElement('span', { style: s.candidateBadge }, I18n.t('syncCreator.lrclibBadgeSynced') || 'Synced'),
							candidate.hasPlainLyrics && react.createElement('span', { style: s.candidateBadge }, I18n.t('syncCreator.lrclibBadgePlain') || 'Plain'),
							candidate.searchSource === 'primary' && react.createElement('span', { style: s.candidateBadge }, I18n.t('syncCreator.lrclibBadgePrimary') || 'Primary'),
							candidate.searchSource === 'english' && react.createElement('span', { style: s.candidateBadge }, I18n.t('syncCreator.lrclibBadgeEnglish') || 'English'),
							isApplied && react.createElement('span', { style: { ...s.candidateBadge, color: '#1db954' } }, I18n.t('syncCreator.lrclibLoaded') || 'Loaded')
						)
					);
				})
			),
			showLrclibCandidates && react.createElement('div', { style: s.candidatePreview },
				previewLrclibCandidate
					? react.createElement(react.Fragment, null,
						react.createElement('div', { style: s.candidatePreviewHeader },
							react.createElement('div', null,
								react.createElement('div', { style: s.candidatePreviewTitle }, previewLrclibCandidate.trackName || previewLrclibCandidate.name || trackName),
								react.createElement('div', { style: s.candidatePreviewSubtitle },
									`${previewLrclibCandidate.artistName || artistName} · ${previewLrclibCandidate.albumName || ''}`.replace(/\s·\s$/, '')
								)
							),
							react.createElement('div', { style: s.candidatePreviewActions },
								react.createElement('button', {
									type: 'button',
									style: { ...s.secondaryBtn, opacity: selectedLrclibCandidateKey === previewLrclibCandidate.candidateKey ? 0.7 : 1 },
									onClick: () => applySelectedLrclibCandidate(previewLrclibCandidate.candidateKey),
									disabled: isLoading
								}, selectedLrclibCandidateKey === previewLrclibCandidate.candidateKey
									? (I18n.t('syncCreator.lrclibLoaded') || 'Loaded')
									: (I18n.t('syncCreator.lrclibApplyCandidate') || 'Load This Lyrics'))
							)
						),
						react.createElement('div', { style: s.candidateMetaRow },
							react.createElement('span', { style: s.candidateBadge }, `${I18n.t('syncCreator.lrclibMetricArtist') || 'artist'} ${Number(previewLrclibCandidate.artistScore || 0).toFixed(3)}`),
							react.createElement('span', { style: s.candidateBadge }, `${I18n.t('syncCreator.lrclibMetricTitle') || 'title'} ${Number(previewLrclibCandidate.titleScore || 0).toFixed(3)}`),
							react.createElement('span', { style: s.candidateBadge }, `${I18n.t('syncCreator.lrclibMetricDiff') || 'diff'} ${formatSeconds(Number(previewLrclibCandidate.durationDiff || 0))}`),
							previewLrclibCandidate.preferredLyricsSource === 'synced' && react.createElement('span', { style: s.candidateBadge }, I18n.t('syncCreator.lrclibBadgeSynced') || 'Synced'),
							previewLrclibCandidate.preferredLyricsSource === 'plain' && react.createElement('span', { style: s.candidateBadge }, I18n.t('syncCreator.lrclibBadgePlain') || 'Plain')
						),
						react.createElement('pre', { style: s.candidatePreviewText }, previewLrclibCandidate.previewText || '')
					)
					: react.createElement('div', { style: s.candidateEmpty },
						I18n.t('syncCreator.lrclibSelectCandidate') || 'Select a candidate'
					)
			)
		),

		// Playback
		lyricsText && react.createElement('div', { style: s.playbackRow },
			react.createElement('button', { style: s.seekBtn, onClick: () => handleSeekOffset(-3000) }, '-3s'),
			react.createElement('button', { style: s.seekBtn, onClick: () => handleSeekOffset(-1000) }, '-1s'),
			react.createElement('span', { style: s.playbackTime }, formatTime(position)),
			react.createElement('div', { style: s.playbackBar, onClick: handleSeek },
				react.createElement('div', { style: { ...s.playbackFill, width: `${(position / (Spicetify.Player?.data?.item?.duration?.milliseconds || 1)) * 100}%` } })
			),
			react.createElement('span', { style: s.playbackTime }, formatTime(Spicetify.Player?.data?.item?.duration?.milliseconds || 0)),
			react.createElement('button', { style: s.seekBtn, onClick: () => handleSeekOffset(1000) }, '+1s'),
			react.createElement('button', { style: s.seekBtn, onClick: () => handleSeekOffset(3000) }, '+3s')
		),

		// Offset
		lyricsText && syncData && react.createElement('div', { style: s.offsetRow },
			react.createElement('span', { style: s.offsetLabel }, I18n.t('syncCreator.globalOffset')),
			react.createElement('button', { style: s.offsetBtn, onClick: () => adjustGlobalOffset(-100) }, '-100ms'),
			react.createElement('button', { style: s.offsetBtn, onClick: () => adjustGlobalOffset(-10) }, '-10ms'),
			react.createElement('span', { style: s.offsetValue }, `${globalOffset >= 0 ? '+' : ''}${globalOffset}ms`),
			react.createElement('button', { style: s.offsetBtn, onClick: () => adjustGlobalOffset(10) }, '+10ms'),
			react.createElement('button', { style: s.offsetBtn, onClick: () => adjustGlobalOffset(100) }, '+100ms')
		),

		// Lyrics Area
		react.createElement('div', { style: s.lyricsArea },
			isLoading && react.createElement('div', { style: s.loading }, I18n.t('syncCreator.loadingLyrics')),
			error && react.createElement('div', { style: { ...s.error, display: 'flex', flexDirection: 'column', alignItems: 'center' } },
				react.createElement('div', null, error),
				react.createElement('button', {
					style: s.publishBtn,
					onClick: () => setShowLrcLibPublish(true)
				}, I18n.t('syncCreator.lrclib.registerLyrics'))
			),
			!isLoading && !error && !lyricsText && react.createElement('div', { style: s.loading }, I18n.t('syncCreator.selectProvider')),

			lyricsText && lyricsLines.length > 0 && react.createElement(react.Fragment, null,
				// Line Navigation (이전/다음 버튼)
				react.createElement('div', { style: s.lineNav },
					react.createElement('button', { style: { ...s.navBtn, opacity: currentLineIndex <= 0 ? 0.3 : 1 }, onClick: goToPrevLine, disabled: currentLineIndex <= 0 }, '◀'),
					react.createElement('div', { style: s.lineInfo },
						react.createElement('div', { style: s.lineCount }, `${currentLineIndex + 1} / ${lyricsLines.length}`),
						react.createElement('div', { style: s.lineStatus }, isCurrentLineSynced ? '✓ ' + I18n.t('syncCreator.synced') : I18n.t('syncCreator.notSynced'))
					),
					react.createElement('button', { style: { ...s.navBtn, opacity: currentLineIndex >= lyricsLines.length - 1 ? 0.3 : 1 }, onClick: goToNextLine, disabled: currentLineIndex >= lyricsLines.length - 1 }, '▶')
				),

				// Lyrics Box
				react.createElement('div', { style: s.lyricsBox, onMouseDown: handleContainerMouseDown, onTouchStart: handleContainerMouseDown, ref: lyricsScrollRef },
					react.createElement('div', { style: s.lyricsLine },
						currentLineChars.map((char, i) => {
							const isSynced = isCharSynced(currentLineIndex, i);
							const isRec = mode === 'record' && recordingCharIndex >= 0 && i <= recordingCharIndex;
							const previewIdx = getPreviewCharIndex(currentLineIndex);
							const isPlayed = isSynced && previewIdx >= i;
							const charTime = getCharSyncTime(currentLineIndex, i);

							let style = { ...s.charSpan };
							if (isRec) style = { ...style, ...s.charRecording };
							else if (isSynced) style = isPlayed ? { ...style, ...s.charPlayed } : { ...style, ...s.charSynced };

							return react.createElement('span', { key: i, style, ref: (el) => { charElementsRef.current[i] = el; }, 'data-char-index': i },
								char === ' ' ? '\u00A0' : char,
								isSynced && charTime !== null && react.createElement('span', { style: s.charTime }, formatSeconds(charTime))
							);
						})
					)
				),

				// Next Line
				currentLineIndex < lyricsLines.length - 1 && react.createElement('div', { style: s.nextLineBox },
					react.createElement('div', { style: s.nextLineLabel }, I18n.t('syncCreator.nextLine')),
					react.createElement('div', { style: s.nextLineText }, lyricsLines[currentLineIndex + 1])
				),

				mode === 'record' && react.createElement('div', { style: s.hint }, I18n.t('syncCreator.dragHint')),

				// 키보드 단축키 가이드 (record 모드일 때만 표시)
				mode === 'record' && react.createElement('div', { style: s.shortcutsContainer },
					// 한 글자
					react.createElement('div', { style: s.shortcutItem },
						react.createElement('span', { style: s.shortcutKey }, getSyncCreatorShortcutDisplay('charForward')),
						react.createElement('span', { style: s.shortcutDesc }, I18n.t('syncCreator.shortcuts.charForward') || '한 글자')
					),
					react.createElement('div', { style: s.shortcutItem },
						react.createElement('span', { style: s.shortcutKey }, getSyncCreatorShortcutDisplay('charBack')),
						react.createElement('span', { style: s.shortcutDesc }, I18n.t('syncCreator.shortcuts.charBack') || '한 글자 취소')
					),
					// 한 단어
					react.createElement('div', { style: s.shortcutItem },
						react.createElement('span', { style: s.shortcutKey }, getSyncCreatorShortcutDisplay('wordForward')),
						react.createElement('span', { style: s.shortcutDesc }, I18n.t('syncCreator.shortcuts.wordForward') || '한 단어')
					),
					react.createElement('div', { style: s.shortcutItem },
						react.createElement('span', { style: s.shortcutKey }, getSyncCreatorShortcutDisplay('wordBack')),
						react.createElement('span', { style: s.shortcutDesc }, I18n.t('syncCreator.shortcuts.wordBack') || '한 단어 취소')
					),
					// 음절
					react.createElement('div', { style: s.shortcutItem },
						react.createElement('span', { style: s.shortcutKey }, getSyncCreatorShortcutDisplay('syllable')),
						react.createElement('span', { style: s.shortcutDesc }, I18n.t('syncCreator.shortcuts.syllable') || '음절')
					),
					// 드래그
					react.createElement('div', { style: s.shortcutItem },
						react.createElement('span', { style: s.shortcutKey }, '/'),
						react.createElement('span', { style: s.shortcutDesc }, I18n.t('syncCreator.shortcuts.drag') || '누르고 있으면 드래그')
					),
					// 완료/취소
					react.createElement('div', { style: s.shortcutItem },
						react.createElement('span', { style: s.shortcutKey }, 'Enter'),
						react.createElement('span', { style: s.shortcutDesc }, I18n.t('syncCreator.shortcuts.finish') || '라인 완료')
					),
					react.createElement('div', { style: s.shortcutItem },
						react.createElement('span', { style: s.shortcutKey }, '⌫'),
						react.createElement('span', { style: s.shortcutDesc }, I18n.t('syncCreator.shortcuts.cancel') || '취소')
					),
					// 재생 컨트롤
					react.createElement('div', { style: s.shortcutItem },
						react.createElement('span', { style: s.shortcutKey }, 'Space'),
						react.createElement('span', { style: s.shortcutDesc }, I18n.t('syncCreator.shortcuts.playPause') || '재생/일시정지')
					),
					react.createElement('div', { style: s.shortcutItem },
						react.createElement('span', { style: s.shortcutKey }, 'Z'),
						react.createElement('span', { style: s.shortcutDesc }, I18n.t('syncCreator.shortcuts.seekBack') || '-3초')
					),
					react.createElement('div', { style: s.shortcutItem },
						react.createElement('span', { style: s.shortcutKey }, 'X'),
						react.createElement('span', { style: s.shortcutDesc }, I18n.t('syncCreator.shortcuts.seekForward') || '+3초')
					)
				)
			)
		),

		// Progress
		lyricsText && react.createElement('div', { style: s.progressRow },
			`${completedLines} / ${lyricsLines.length} ${I18n.t('syncCreator.linesCompleted')}`,
			react.createElement('span', { style: { opacity: 0.5 } }, '|'),
			`${syncedChars} / ${totalChars} ${I18n.t('syncCreator.chars')}`
		),

		// Controls
		lyricsText && react.createElement('div', { style: s.controls },
			react.createElement('button', { style: s.ctrlBtn, onClick: resetFromStart }, I18n.t('syncCreator.reset')),
			react.createElement('button', { style: s.ctrlBtn, onClick: goToFirstLine, disabled: currentLineIndex <= 0 }, I18n.t('syncCreator.firstLine')),

			// 기록 모드
			react.createElement('button', {
				style: { ...s.modeBtn, background: mode === 'record' ? '#e53935' : 'var(--spice-button)', color: mode === 'record' ? '#fff' : 'var(--spice-button-text, #000)' },
				onClick: () => toggleMode('record')
			}, mode === 'record' ? I18n.t('syncCreator.stopRecord') : I18n.t('syncCreator.recordMode')),

			// 미리보기 모드
			react.createElement('button', {
				style: { ...s.modeBtn, background: mode === 'preview' ? '#2196f3' : 'var(--spice-misc)', color: mode === 'preview' ? '#fff' : 'var(--spice-text)' },
				onClick: () => toggleMode('preview'),
				disabled: !syncData || syncData.lines.length === 0
			}, mode === 'preview' ? I18n.t('syncCreator.stopPreview') : I18n.t('syncCreator.previewMode')),

			// 가사 복사 버튼
			react.createElement('button', { style: s.ctrlBtn, onClick: copyAllLyrics, disabled: !lyricsText },
				I18n.t('syncCreator.copyLyrics') || '가사 복사'
			),

			// 싱크 데이터 내보내기
			react.createElement('button', { style: s.ctrlBtn, onClick: exportSyncData, disabled: !syncData || !syncData.lines || syncData.lines.length === 0 },
				I18n.t('syncCreator.export') || '내보내기'
			),

			// 싱크 데이터 불러오기
			react.createElement('button', { style: s.ctrlBtn, onClick: importSyncData },
				I18n.t('syncCreator.import') || '불러오기'
			),

			// 현재 줄 삭제
			isCurrentLineSynced && react.createElement('button', { style: s.deleteBtn, onClick: deleteCurrentLineSync },
				I18n.t('syncCreator.deleteLine')
			)
		),

		// LRCLIB 발행 모달
		showLrcLibPublish && react.createElement('div', { style: s.lrcLibModal, onClick: (e) => e.target === e.currentTarget && !isPublishingToLrcLib && setShowLrcLibPublish(false) },
			react.createElement('div', { style: s.lrcLibContent },
				react.createElement('h3', { style: s.lrcLibTitle }, I18n.t('syncCreator.lrclib.title')),
				react.createElement('p', { style: s.lrcLibDesc }, I18n.t('syncCreator.lrclib.description')),
				react.createElement('div', { style: { fontSize: '12px', color: '#ff9800', padding: '10px', background: 'rgba(255, 152, 0, 0.1)', borderRadius: '6px', marginBottom: '8px', border: '1px solid rgba(255, 152, 0, 0.3)' } },
					I18n.t('syncCreator.lrclib.timeWarning') || '⚠️ LRCLIB은 무분별한 가사 등록을 막기 위해 암호화 토큰 해석 작업을 요구합니다. 이 과정은 컴퓨터 성능에 따라 약 5분 정도 소요될 수 있습니다.'
				),
				react.createElement('div', { style: { fontSize: '12px', color: 'var(--spice-subtext)', padding: '8px', background: 'var(--spice-main)', borderRadius: '6px' } },
					react.createElement('div', null, `${I18n.t('syncCreator.lrclib.trackInfo')}:`),
					react.createElement('div', { style: { fontWeight: '600', color: 'var(--spice-text)' } }, `${trackName} - ${artistName}`)
				),
				react.createElement('textarea', {
					style: s.lrcLibTextarea,
					placeholder: I18n.t('syncCreator.lrclib.placeholder'),
					value: manualLyricsInput,
					onChange: (e) => setManualLyricsInput(e.target.value),
					disabled: isPublishingToLrcLib
				}),
				lrcLibPublishProgress && react.createElement('div', { style: s.lrcLibProgress }, lrcLibPublishProgress),
				react.createElement('div', { style: s.lrcLibBtnRow },
					react.createElement('button', {
						style: { ...s.lrcLibBtnCancel, ...(isPublishingToLrcLib ? { background: '#f44336', color: '#fff', borderColor: '#f44336' } : {}) },
						onClick: isPublishingToLrcLib ? cancelLrcLibPublish : () => { setShowLrcLibPublish(false); setManualLyricsInput(''); }
					}, isPublishingToLrcLib ? (I18n.t('syncCreator.lrclib.cancelPublish') || '등록 취소') : I18n.t('cancel')),
					react.createElement('button', {
						style: { ...s.lrcLibBtn, opacity: isPublishingToLrcLib || !manualLyricsInput.trim() ? 0.5 : 1 },
						onClick: publishToLrcLib,
						disabled: isPublishingToLrcLib || !manualLyricsInput.trim()
					}, isPublishingToLrcLib ? I18n.t('syncCreator.lrclib.publishing') : I18n.t('syncCreator.lrclib.publishToLrcLib'))
				)
			)
		)
	);
};

window.SyncDataCreator = SyncDataCreator;
