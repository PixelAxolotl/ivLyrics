/**
 * ================================================================================
 * LRCLIB Lyrics Provider Addon
 * ================================================================================
 * 
 * 이 파일은 LRCLIB(https://lrclib.net) 오픈소스 가사 데이터베이스에서 
 * 가사를 검색하고 가져오는 Spicetify 애드온입니다.
 * 
 * 【주요 기능】
 * - 구조화 검색 중심 LRCLIB 검색 흐름 적용
 * - 제목 + 가수 + 앨범 구조화 검색 후 필요 시 다단계 자유검색 폴백
 * - Jaro-Winkler 알고리즘 기반 아티스트 유사도 매칭
 * - duration 기반 최근접 후보 선택 및 싱크/일반 가사 지원
 * - 네트워크 오류 시 자동 재시도 메커니즘
 * 
 * 【검색 전략】
 * - /api/search 구조화 검색(track_name + artist_name + album_name)
 * - 구조화 검색에서 적합한 후보가 없을 때 q=title+artist, q=title 순서로 자유검색 폴백
 * - 아티스트 유사도 또는 강한 제목 일치 + 정확한 duration 조건으로 후보 채택
 *
 * @addon-type lyrics        - 가사 제공자 타입의 애드온
 * @id lrclib               - 고유 식별자
 * @name LRCLIB             - 표시 이름
 * @version 1.0.0           - 버전 정보
 * @author ivLis STUDIO     - 제작자
 * @supports karaoke: false - 노래방 모드 미지원 (커뮤니티 sync-data 확장으로 지원 가능)
 * @supports synced: true   - 시간 동기화된 가사 지원
 * @supports unsynced: true - 시간 동기화 없는 일반 가사 지원
 */

// ================================================================================
// IIFE (Immediately Invoked Function Expression) 패턴
// ================================================================================
// 전역 스코프 오염을 방지하고, 모든 변수와 함수를 캡슐화합니다.
// 애드온 로드 시 즉시 실행되어 LyricsAddonManager에 자신을 등록합니다.
(() => {
    'use strict';  // 엄격 모드 활성화: 잠재적 오류를 사전에 방지

    // ============================================
    // Addon Metadata (애드온 메타데이터)
    // ============================================
    // LyricsAddonManager가 이 애드온을 식별하고 관리하는 데 사용하는 정보입니다.
    // UI에 표시되는 이름, 설명, 아이콘 등이 포함됩니다.

    const ADDON_INFO = {
        id: 'lrclib',           // 【고유 ID】 다른 애드온과 구분하기 위한 식별자
        name: 'LRCLIB',         // 【표시 이름】 UI에 표시되는 애드온 이름
        author: 'ivLis STUDIO', // 【제작자】 애드온 개발자 정보
        version: '1.0.0',       // 【버전】 시맨틱 버저닝 (Major.Minor.Patch)
        cacheVersion: '2026-03-19-search-flow-rework-3',

        // 【다국어 설명】 사용자 언어 설정에 따라 표시
        description: {
            en: 'Get lyrics from LRCLIB open-source lyrics database',
            ko: 'LRCLIB 오픈소스 가사 데이터베이스에서 가사를 가져옵니다'
        },

        // 【지원 가사 유형】 이 애드온이 제공할 수 있는 가사 형식
        supports: {
            karaoke: false,   // 노래방 모드 (단어별 하이라이트) - 현재 미지원
            synced: true,     // 싱크 가사 (타임스탬프 포함 LRC 형식) - 지원
            unsynced: true    // 일반 가사 (텍스트만) - 지원
        },

        // 【ivLyrics Sync 통합】 true면 커뮤니티 싱크 데이터 자동 적용
        useIvLyricsSync: true,

        // 【아이콘】 SVG path 데이터 - LRC 파일을 나타내는 문서 아이콘
        icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 12h8v2H8v-2zm0 4h8v2H8v-2zm0-8h3v2H8V8z'
    };

    // ============================================
    // API Endpoints (API 엔드포인트)
    // ============================================
    // LRCLIB 서버의 기본 API 주소입니다.
    // 모든 API 요청은 이 주소를 기반으로 구성됩니다.
    // 
    // 【사용 가능한 엔드포인트】
    // - GET /api/search?track_name=...&artist_name=... : 구조화된 검색
    // - GET /api/search?q=... : 자유 텍스트 검색
    // - GET /api/get?...      : 특정 가사 직접 조회

    const LRCLIB_API_BASE = 'https://lrclib.net/api';
    const LRCLIB_DURATION_TOLERANCE_SEC = 15;
    const LRCLIB_ARTIST_MATCH_THRESHOLD = 0.9;
    const LRCLIB_FALLBACK_TITLE_MATCH_THRESHOLD = 0.98;
    const LRCLIB_ENABLE_INEXACT_SEARCH = true;
    const LRCLIB_CACHE_VERSION_BASE = '2026-03-19-search-flow-rework-3';
    const LRCLIB_SETTING_KEYS = {
        fallbackTitleArtist: 'enable_fallback_title_artist',
        fallbackTitleOnly: 'enable_fallback_title_only'
    };
    const LRCLIB_DEFAULT_SETTINGS = {
        [LRCLIB_SETTING_KEYS.fallbackTitleArtist]: true,
        [LRCLIB_SETTING_KEYS.fallbackTitleOnly]: true
    };

    /**
     * LRCLIB 설정용 LocalStorage 키를 반환합니다.
     *
     * @param {string} key - 설정 키
     * @returns {string} 저장소 키
     */
    function getAddonStorageKey(key) {
        return `ivLyrics:lyrics:addon:${ADDON_INFO.id}:${key}`;
    }

    /**
     * LRCLIB 설정값을 읽습니다.
     * LyricsAddonManager가 있으면 그 경로를 우선 사용하고,
     * 없으면 LocalStorage에서 직접 읽습니다.
     *
     * @param {string} key - 설정 키
     * @param {*} defaultValue - 기본값
     * @returns {*} 저장된 값 또는 기본값
     */
    function getProviderSetting(key, defaultValue) {
        if (window.LyricsAddonManager?.getAddonSetting) {
            return window.LyricsAddonManager.getAddonSetting(ADDON_INFO.id, key, defaultValue);
        }

        const value = Spicetify.LocalStorage?.get?.(getAddonStorageKey(key));
        if (value === null || value === undefined) return defaultValue;

        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    /**
     * LRCLIB 설정값을 저장합니다.
     * LyricsAddonManager가 있으면 설정 변경 이벤트와 새로고침을 함께 활용합니다.
     *
     * @param {string} key - 설정 키
     * @param {*} value - 저장할 값
     */
    function setProviderSetting(key, value) {
        if (window.LyricsAddonManager?.setAddonSetting) {
            window.LyricsAddonManager.setAddonSetting(ADDON_INFO.id, key, value);
            return;
        }

        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        Spicetify.LocalStorage?.set?.(getAddonStorageKey(key), serialized);
    }

    /**
     * 현재 활성화된 LRCLIB 자유검색 설정을 반환합니다.
     *
     * @returns {{ enableFallbackTitleArtist: boolean, enableFallbackTitleOnly: boolean }}
     */
    function getSearchSettings() {
        return {
            enableFallbackTitleArtist: getProviderSetting(
                LRCLIB_SETTING_KEYS.fallbackTitleArtist,
                LRCLIB_DEFAULT_SETTINGS[LRCLIB_SETTING_KEYS.fallbackTitleArtist]
            ) !== false,
            enableFallbackTitleOnly: getProviderSetting(
                LRCLIB_SETTING_KEYS.fallbackTitleOnly,
                LRCLIB_DEFAULT_SETTINGS[LRCLIB_SETTING_KEYS.fallbackTitleOnly]
            ) !== false
        };
    }

    /**
     * 현재 LRCLIB 설정을 반영한 캐시 버전을 생성합니다.
     *
     * @returns {string} 설정 상태가 포함된 캐시 버전 문자열
     */
    function buildCacheVersion() {
        const settings = getSearchSettings();
        return `${LRCLIB_CACHE_VERSION_BASE}:fta=${settings.enableFallbackTitleArtist ? 1 : 0}:fto=${settings.enableFallbackTitleOnly ? 1 : 0}`;
    }

    /**
     * 애드온 객체와 결과에 사용할 캐시 버전을 최신 설정에 맞춰 갱신합니다.
     *
     * @returns {string} 최신 캐시 버전
     */
    function syncAddonCacheVersion() {
        const version = buildCacheVersion();
        ADDON_INFO.cacheVersion = version;
        if (typeof LrclibLyricsAddon !== 'undefined') {
            LrclibLyricsAddon.cacheVersion = version;
        }
        return version;
    }

    // ============================================
    // Helper Functions (헬퍼 함수)
    // ============================================
    // 가사 검색 및 매칭에 필요한 유틸리티 함수들입니다.
    // 문자열 정규화, 유사도 계산, 네트워크 요청, 가사 파싱 등을 담당합니다.

    /**
     * ────────────────────────────────────────────────────────────────────────────
     * 문자열 정규화 함수 (normalize)
     * ────────────────────────────────────────────────────────────────────────────
     * 
     * 【목적】
     * 서로 다른 형식의 문자열을 비교하기 위해 통일된 형태로 변환합니다.
     * 예: "Hello  World" vs "hello world" → 동일하게 처리
     * 
     * 【정규화 단계】
     * 1. NFKC 유니코드 정규화 - 호환 문자를 표준 형태로 통일
     *    예: ＡＢＣ(전각) → ABC(반각), ｶﾅ(반각) → カナ(전각)
     * 2. 소문자 변환 - 대소문자 구분 제거
     * 3. 양끝 공백 제거 (trim)
     * 4. 스마트 따옴표를 일반 따옴표로 변환
     *    예: '' "" → ' "
     * 5. 모든 종류의 괄호 제거 - 부가 정보(feat., remix 등) 무시
     * 6. 연속 공백을 단일 공백으로 치환
     * 
     * @param {string} s - 정규화할 원본 문자열
     * @returns {string} 정규화된 문자열 (비어있으면 빈 문자열 반환)
     */
    function normalize(s) {
        if (!s) return '';  // null/undefined 처리
        return s.normalize('NFKC')       // 유니코드 NFKC 정규화
            .toLowerCase()               // 소문자 변환
            .trim()                      // 앞뒤 공백 제거
            .replace(/[\u2018\u2019]/g, "'")   // ''(스마트 작은따옴표) → '
            .replace(/[\u201c\u201d]/g, '"')   // ""(스마트 큰따옴표) → "
            .replace(/[()[\]{}]/g, '')   // 모든 괄호류 제거: () [] {}
            .replace(/\s+/g, ' ');       // 연속 공백 → 단일 공백
    }

    /**
     * ────────────────────────────────────────────────────────────────────────────
     * Jaro-Winkler 유사도 계산 함수
     * ────────────────────────────────────────────────────────────────────────────
     * 
     * 【알고리즘 개요】
     * Jaro-Winkler는 두 문자열 간의 유사도를 0.0 ~ 1.0 사이 값으로 반환합니다.
     * 특히 짧은 문자열이나 오타 검출에 효과적이며, 제목/아티스트 매칭에 적합합니다.
     * 
     * 【계산 과정】
     * 1단계: Jaro 유사도 (dj) 계산
     *   - 일치 윈도우 = max(len1, len2) / 2 - 1
     *   - 윈도우 내에서 일치하는 문자 수 계산
     *   - 순서가 다른 일치(transposition) 계산
     *   - dj = (m/l1 + m/l2 + (m-t)/m) / 3
     * 
     * 2단계: Winkler 보정
     *   - 공통 접두사(최대 4자)에 가중치 부여
     *   - 최종 점수 = dj + prefix * 0.1 * (1 - dj)
     * 
     * 【예시】
     * - "MARTHA" vs "MARHTA" → 약 0.96 (철자 오류에도 높은 유사도)
     * - "DWAYNE" vs "DUANE" → 약 0.84
     * - "ABC" vs "XYZ" → 0.0 (완전 불일치)
     * 
     * @param {string} s1 - 비교할 첫 번째 문자열
     * @param {string} s2 - 비교할 두 번째 문자열
     * @returns {number} 유사도 점수 (0.0 = 완전 불일치, 1.0 = 완전 일치)
     */
    function jaroWinkler(s1, s2) {
        // 먼저 두 문자열을 정규화하여 공정한 비교 수행
        s1 = normalize(s1);
        s2 = normalize(s2);

        // Edge case 처리
        if (!s1 || !s2) return 0;  // 빈 문자열은 유사도 0
        if (s1 === s2) return 1;   // 완전 일치는 유사도 1

        const l1 = s1.length;  // 첫 번째 문자열 길이
        const l2 = s2.length;  // 두 번째 문자열 길이

        // 【일치 윈도우 계산】
        // 두 문자가 "일치"로 간주되려면 위치 차이가 윈도우 이내여야 함
        const matchWindow = Math.floor(Math.max(l1, l2) / 2) - 1;

        // 각 문자열에서 어떤 문자가 일치로 표시되었는지 추적
        const s1Matches = new Array(l1).fill(false);
        const s2Matches = new Array(l2).fill(false);

        // 【1단계: 일치하는 문자 찾기】
        let matches = 0;
        for (let i = 0; i < l1; i++) {
            // 현재 문자 s1[i]와 일치할 수 있는 s2의 범위 계산
            const start = Math.max(0, i - matchWindow);
            const end = Math.min(i + matchWindow + 1, l2);

            for (let j = start; j < end; j++) {
                if (s2Matches[j]) continue;  // 이미 매칭된 문자는 스킵
                if (s1[i] === s2[j]) {
                    s1Matches[i] = true;
                    s2Matches[j] = true;
                    matches++;
                    break;  // 이 문자에 대한 매칭 완료
                }
            }
        }

        // 일치하는 문자가 하나도 없으면 유사도 0
        if (matches === 0) return 0;

        // 【2단계: Transposition(순서 차이) 계산】
        // 일치한 문자들의 순서가 다른 경우를 계산
        let t = 0;  // transposition 카운트
        let k = 0;  // s2에서의 현재 위치
        for (let i = 0; i < l1; i++) {
            if (!s1Matches[i]) continue;  // 일치하지 않은 문자는 스킵
            while (!s2Matches[k]) k++;     // s2에서 다음 일치 문자 찾기
            if (s1[i] !== s2[k]) t++;       // 순서가 다르면 transposition
            k++;
        }
        t /= 2;  // transposition은 쌍으로 계산되므로 2로 나눔

        // 【3단계: Jaro 유사도 계산】
        // dj = (일치율_s1 + 일치율_s2 + 순서일치율) / 3
        const dj = (matches / l1 + matches / l2 + (matches - t) / matches) / 3;

        // 【4단계: Winkler 보정 - 공통 접두사 가중치】
        // 앞부분이 같으면 추가 점수 (최대 4자까지만 고려)
        let prefix = 0;
        for (let i = 0; i < Math.min(l1, l2, 4); i++) {
            if (s1[i] === s2[i]) prefix++;
            else break;  // 첫 불일치에서 중단
        }

        // 최종 Jaro-Winkler 점수 반환
        // 접두사가 같을수록 점수가 높아짐 (최대 0.1 * 4 = 0.4 보너스)
        return dj + prefix * 0.1 * (1 - dj);
    }

    /**
     * 아티스트 문자열을 비교 가능한 단위로 분리합니다.
     * 예: "Artist A, Artist B & Artist C" -> ["Artist A", "Artist B", "Artist C"]
     *
     * @param {string} artistText - 원본 아티스트 문자열
     * @returns {string[]} 정리된 아티스트 배열
     */
    function splitArtists(artistText) {
        if (!artistText || typeof artistText !== 'string') return [];
        return artistText
            .split(/[&,]/g)
            .map(part => part.trim())
            .filter(Boolean);
    }

    /**
     * 제목 문자열 사이의 비교 점수를 계산합니다.
     * 완전 일치나 포함 관계가 있으면 높은 점수를 주고,
     * 그 외에는 Jaro-Winkler 점수를 사용합니다.
     *
     * @param {string} expectedTitle - 현재 트랙 제목
     * @param {string} candidateTitle - LRCLIB 후보 제목
     * @returns {number} 제목 유사도 점수
     */
    function getTitleScore(expectedTitle, candidateTitle) {
        const normalizedExpected = normalize(expectedTitle);
        const normalizedCandidate = normalize(candidateTitle);

        if (!normalizedExpected || !normalizedCandidate) return 0;
        if (normalizedExpected === normalizedCandidate) return 1;
        if (normalizedCandidate.includes(normalizedExpected) || normalizedExpected.includes(normalizedCandidate)) return 0.99;

        return jaroWinkler(normalizedExpected, normalizedCandidate);
    }

    /**
     * 자유검색에서 제목 기반으로 후보를 허용할 수 있을 만큼
     * 재생 시간이 충분히 정확하게 일치하는지 확인합니다.
     * LRCLIB와 Spotify의 길이 표기가 초 단위인 경우가 많아 반올림 후 비교합니다.
     *
     * @param {number} expectedDurationSec - 현재 트랙 길이(초)
     * @param {number} candidateDurationSec - LRCLIB 후보 길이(초)
     * @returns {boolean} 초 단위 반올림 기준 정확히 일치하면 true
     */
    function hasExactDurationMatch(expectedDurationSec, candidateDurationSec) {
        if (!Number.isFinite(expectedDurationSec) || !Number.isFinite(candidateDurationSec)) return false;
        return Math.round(expectedDurationSec) === Math.round(candidateDurationSec);
    }

    /**
     * 기대 아티스트 목록과 후보 아티스트 목록 사이의 최고 Jaro-Winkler 점수를 계산합니다.
     *
     * @param {string[]} expectedArtists - 현재 트랙의 아티스트 목록
     * @param {string[]} candidateArtists - LRCLIB 후보의 아티스트 목록
     * @returns {number} 최고 유사도 점수
     */
    function getBestArtistScore(expectedArtists, candidateArtists) {
        if (!Array.isArray(expectedArtists) || !Array.isArray(candidateArtists)) return 0;
        if (expectedArtists.length === 0 || candidateArtists.length === 0) return 0;

        let bestScore = 0;
        for (const expectedArtist of expectedArtists) {
            for (const candidateArtist of candidateArtists) {
                bestScore = Math.max(bestScore, jaroWinkler(expectedArtist, candidateArtist));
            }
        }
        return bestScore;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────────
     * 타임아웃 및 재시도 지원 Fetch 함수
     * ────────────────────────────────────────────────────────────────────────────
     * 
     * 【목적】
     * 네트워크 요청에 타임아웃을 적용하고, 실패 시 자동으로 1회 재시도합니다.
     * LRCLIB 서버의 간헐적 장애나 네트워크 불안정에 대응합니다.
     * 
     * 【동작 방식】
     * 1. AbortController를 사용하여 타임아웃 구현
     * 2. 첫 번째 시도 실패 시 500ms 대기 후 재시도
     * 3. 재시도도 실패하면 null 반환 (에러 throw 대신)
     * 
     * 【설계 결정】
     * - null 반환: UI에 에러 메시지를 노출하지 않기 위함
     * - 500ms 대기: 서버 부하 완화 및 네트워크 복구 시간 확보
     * - 35초 타임아웃: LRCLIB 서버 응답 시간을 고려한 값
     * 
     * @param {string} url - 요청할 URL
     * @param {Object} options - fetch 옵션 (headers 등)
     * @param {number} timeoutMs - 타임아웃 시간 (기본 35초)
     * @returns {Promise<Response|null>} Response 객체 또는 실패 시 null
     */
    async function fetchWithTimeout(url, options = {}, timeoutMs = 35000) {
        // 최대 2회 시도 (첫 시도 + 1회 재시도)
        for (let attempt = 0; attempt < 2; attempt++) {
            // AbortController: fetch 요청을 강제 중단할 수 있게 해주는 Web API
            const controller = new AbortController();

            // 타임아웃 설정: timeoutMs 후 요청 강제 중단
            const id = setTimeout(() => controller.abort(), timeoutMs);

            try {
                // fetch 요청 실행 (signal 연결로 abort 가능하게 함)
                const response = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(id);  // 성공 시 타임아웃 타이머 정리
                return response;   // 응답 반환 (성공)
            } catch (error) {
                clearTimeout(id);  // 실패 시에도 타이머 정리

                if (attempt === 0) {
                    // 첫 번째 시도 실패: 500ms 대기 후 재시도
                    await new Promise(r => setTimeout(r, 500));
                    window.__ivLyricsDebugLog?.(`[LR-DEBUG] 네트워크 오류, 재시도 중...`);
                }
                // attempt === 1이면 재시도도 실패 → 루프 종료
            }
        }

        // 모든 재시도 실패 → null 반환 (에러 메시지 노출 방지)
        window.__ivLyricsDebugLog?.(`[LR-DEBUG] 네트워크 재시도 실패, 스킵`);
        return null;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────────
     * LRC 형식 파싱 함수 (Ultra-Flexible)
     * ────────────────────────────────────────────────────────────────────────────
     * 
     * 【목적】
     * LRC(Lyrics) 형식의 문자열을 파싱하여 구조화된 가사 객체로 변환합니다.
     * 
     * 【LRC 형식 예시】
     * [00:12.34]첫 번째 가사
     * [00:15.67]두 번째 가사
     * [01:00,89]쉼표 구분자도 지원
     * 
     * 【지원하는 형식】
     * - [MM:SS.xx] 또는 [MM:SS,xx]: 밀리초 포함
     * - [MM:SS]: 밀리초 없는 형식
     * - 타임스탬프 없는 일반 텍스트도 unsynced에 포함
     * 
     * 【반환 객체 구조】
     * {
     *   synced: [{ startTime: 12340, text: "첫 번째 가사" }, ...] 또는 null,
     *   unsynced: [{ text: "첫 번째 가사" }, ...]
     * }
     * 
     * @param {string} lrc - LRC 형식의 가사 문자열
     * @returns {Object} { synced: Array|null, unsynced: Array }
     */
    function parseLRC(lrc) {
        // 입력 유효성 검사
        if (!lrc || typeof lrc !== 'string') return { synced: null, unsynced: [] };

        const lines = lrc.split('\n');  // 줄 단위로 분리
        const synced = [];    // 타임스탬프가 있는 가사
        const unsynced = [];  // 텍스트만 있는 가사

        for (const line of lines) {
            // LRC 타임스탬프 패턴 매칭
            // 그룹: [1]=분, [2]=초, [3]=밀리초(선택), [4]=가사 텍스트
            const match = line.match(/\[(\d+):(\d+)(?:[.,](\d+))?\](.*)/);

            if (match) {
                // 타임스탬프가 있는 경우
                const minutes = parseInt(match[1], 10);    // 분
                const seconds = parseInt(match[2], 10);    // 초
                const msPart = match[3] ? parseFloat('0.' + match[3]) : 0;  // 밀리초 부분

                // 시작 시간을 밀리초로 변환
                const startTime = Math.floor((minutes * 60 + seconds + msPart) * 1000);
                const text = match[4].trim();  // 가사 텍스트 (공백 제거)

                synced.push({ startTime, text });  // 싱크 가사에 추가
                unsynced.push({ text });           // 일반 가사에도 추가
            } else if (line.trim() && !line.startsWith('[')) {
                // 타임스탬프 없는 일반 텍스트 (메타데이터 태그 제외)
                unsynced.push({ text: line.trim() });
            }
        }

        // synced가 비어있으면 null로 반환
        return { synced: synced.length > 0 ? synced : null, unsynced };
    }

    // ============================================
    // Addon Implementation (애드온 구현부)
    // ============================================
    // LyricsAddonManager에 등록될 실제 애드온 객체입니다.
    // ADDON_INFO를 스프레드하여 메타데이터를 포함하고,
    // init(), getSettingsUI(), getLyrics() 메서드를 구현합니다.

    const LrclibLyricsAddon = {
        ...ADDON_INFO,  // 메타데이터 병합 (id, name, version 등)

        /**
         * 【초기화 메서드】
         * 애드온이 로드될 때 호출됩니다.
         * 현재 설정 상태를 반영한 캐시 버전을 동기화합니다.
         */
        async init() {
            syncAddonCacheVersion();
        },

        /**
         * 【설정 UI 메서드】
         * 사용자 설정 화면에 표시될 React 컴포넌트를 반환합니다.
         * 자유검색 폴백 단계를 개별적으로 켜고 끌 수 있습니다.
         * 
         * @returns {Function} React 함수형 컴포넌트
         */
        getSettingsUI() {
            const React = Spicetify.React;  // Spicetify 내장 React 사용
            const { useState, useCallback } = React;

            return function LrclibLyricsSettings() {
                const [enableFallbackTitleArtist, setEnableFallbackTitleArtist] = useState(() =>
                    getProviderSetting(
                        LRCLIB_SETTING_KEYS.fallbackTitleArtist,
                        LRCLIB_DEFAULT_SETTINGS[LRCLIB_SETTING_KEYS.fallbackTitleArtist]
                    ) !== false
                );
                const [enableFallbackTitleOnly, setEnableFallbackTitleOnly] = useState(() =>
                    getProviderSetting(
                        LRCLIB_SETTING_KEYS.fallbackTitleOnly,
                        LRCLIB_DEFAULT_SETTINGS[LRCLIB_SETTING_KEYS.fallbackTitleOnly]
                    ) !== false
                );

                const handleToggle = useCallback((key, setter) => (e) => {
                    const checked = !!e.target.checked;
                    setter(checked);
                    setProviderSetting(key, checked);
                    syncAddonCacheVersion();
                }, []);

                return React.createElement('div', { className: 'lyrics-addon-settings ai-addon-settings lrclib-settings' },
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('div', {
                            style: {
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '12px'
                            }
                        },
                            React.createElement('div', { style: { flex: '1 1 auto' } },
                                React.createElement('label', null, '1st Fallback (title + artist)'),
                                React.createElement('small', null, '구조화 검색 실패 시 q=title+artist 자유검색을 사용합니다.')
                            ),
                            React.createElement('input', {
                                type: 'checkbox',
                                checked: enableFallbackTitleArtist,
                                onChange: handleToggle(LRCLIB_SETTING_KEYS.fallbackTitleArtist, setEnableFallbackTitleArtist)
                            })
                        )
                    ),
                    React.createElement('div', { className: 'ai-addon-setting' },
                        React.createElement('div', {
                            style: {
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '12px'
                            }
                        },
                            React.createElement('div', { style: { flex: '1 1 auto' } },
                                React.createElement('label', null, '2nd Fallback (title only)'),
                                React.createElement('small', null, '1차 자유검색에서도 못 찾았을 때 q=title 자유검색을 사용합니다.')
                            ),
                            React.createElement('input', {
                                type: 'checkbox',
                                checked: enableFallbackTitleOnly,
                                onChange: handleToggle(LRCLIB_SETTING_KEYS.fallbackTitleOnly, setEnableFallbackTitleOnly)
                            })
                        )
                    )
                );
            };
        },

        /**
         * ────────────────────────────────────────────────────────────────────────────
         * 가사 가져오기 메서드 (getLyrics) - 핵심 메서드
         * ────────────────────────────────────────────────────────────────────────────
         * 
         * 【목적】
         * Spotify에서 재생 중인 트랙의 가사를 LRCLIB API에서 검색하여 반환합니다.
         * 
         * 【입력 파라미터】
         * @param {Object} info - 트랙 정보 객체
         *   - uri: Spotify URI (예: "spotify:track:abc123")
         *   - title: 곡 제목
         *   - artist: 아티스트 이름
         *   - album: 앨범 이름 (구조화 검색에 사용)
         *   - duration: 곡 길이 (밀리초)
         * 
         * 【반환값】
         * @returns {Promise<LyricsResult>} 가사 결과 객체
         *   - uri: 트랙 URI
         *   - provider: 'lrclib'
         *   - karaoke: 노래방 가사 (현재 null)
         *   - synced: 싱크 가사 배열 또는 null
         *   - unsynced: 일반 가사 배열 또는 null
         *   - copyright: 저작권 정보 (현재 null)
         *   - error: 에러 메시지 또는 null
         * 
         * 【검색 전략】
         * 구조화 검색 + 자유검색 폴백 + 아티스트/재생시간 검증
         */
        async getLyrics(info) {
            const startTotal = performance.now();
            const cacheVersion = syncAddonCacheVersion();
            const result = {
                uri: info.uri,
                provider: 'lrclib',
                cacheVersion,
                karaoke: null,
                synced: null,
                unsynced: null,
                copyright: null,
                error: null
            };

            const logDebug = (status, extra = {}) => {
                const endTotal = performance.now();
                window.__ivLyricsDebugLog?.(`[LR-DEBUG] ========================================`);
                window.__ivLyricsDebugLog?.(`[LR-DEBUG] Track: ${info.title} - ${info.artist}`);
                window.__ivLyricsDebugLog?.(`[LR-DEBUG] Status: ${status}`);
                Object.entries(extra).forEach(([key, value]) => {
                    if (value !== undefined && value !== null) {
                        window.__ivLyricsDebugLog?.(`[LR-DEBUG] ${key}: ${value}`);
                    }
                });
                window.__ivLyricsDebugLog?.(`[LR-DEBUG] Time - Total: ${(endTotal - startTotal).toFixed(2)}ms`);
                window.__ivLyricsDebugLog?.(`[LR-DEBUG] ========================================`);
            };

            try {
                const title = info?.title?.trim?.();
                const artist = info?.artist?.trim?.();
                const album = info?.album?.trim?.();
                const searchSettings = getSearchSettings();
                const trackDuration = Number(info?.duration || 0);
                const trackDurationSec = trackDuration > 0 ? trackDuration / 1000 : 0;
                const expectedArtists = splitArtists(artist);

                if (!title || !artist || !trackDurationSec) {
                    result.error = 'Missing track metadata';
                    logDebug('Failed', { error: result.error });
                    return result;
                }

                const headers = { 'x-user-agent': `spicetify v${Spicetify.Config?.version || 'unknown'}` };

                const runSearch = async (params, label) => {
                    const query = new URLSearchParams();
                    if (params.track_name) query.set('track_name', params.track_name);
                    if (params.artist_name) query.set('artist_name', params.artist_name);
                    if (params.album_name && params.album_name !== 'undefined') query.set('album_name', params.album_name);
                    if (params.q) query.set('q', params.q);

                    const searchUrl = `${LRCLIB_API_BASE}/search?${query.toString()}`;
                    const response = await fetchWithTimeout(searchUrl, { headers }, 35000);

                    if (!response) {
                        return {
                            fatal: true,
                            error: 'Network request failed',
                            searchLabel: label,
                            totalResults: 0,
                            candidates: []
                        };
                    }

                    if (!response.ok) {
                        if (response.status === 429) {
                            return {
                                fatal: true,
                                error: 'Rate limit exceeded (429)',
                                searchLabel: label,
                                totalResults: 0,
                                candidates: []
                            };
                        }
                        if (response.status === 404) {
                            return {
                                fatal: false,
                                error: 'No lyrics found',
                                searchLabel: label,
                                totalResults: 0,
                                candidates: []
                            };
                        }
                        return {
                            fatal: true,
                            error: `API error: ${response.status}`,
                            searchLabel: label,
                            totalResults: 0,
                            candidates: []
                        };
                    }

                    const data = await response.json();
                    if (!Array.isArray(data)) {
                        return {
                            fatal: true,
                            error: 'Invalid LRCLIB response',
                            searchLabel: label,
                            totalResults: 0,
                            candidates: []
                        };
                    }

                    return {
                        fatal: false,
                        error: data.length === 0 ? 'No lyrics found' : null,
                        searchLabel: label,
                        totalResults: data.length,
                        candidates: data
                    };
                };

                const rankCandidates = (candidates, { allowTitleDrivenMatch = false } = {}) => {
                    return candidates
                        .map(item => {
                            const candidateArtists = splitArtists(item?.artistName || '');
                            const candidateTitle = item?.trackName || item?.name || '';
                            const titleScore = getTitleScore(title, candidateTitle);
                            const artistScore = getBestArtistScore(expectedArtists, candidateArtists);
                            const durationDiff = Math.abs(Number(item?.duration || 0) - trackDurationSec);
                            const exactDurationMatch = hasExactDurationMatch(trackDurationSec, Number(item?.duration || 0));
                            const artistMatched = artistScore > LRCLIB_ARTIST_MATCH_THRESHOLD;
                            const titleDrivenMatch = allowTitleDrivenMatch
                                && titleScore >= LRCLIB_FALLBACK_TITLE_MATCH_THRESHOLD
                                && exactDurationMatch;

                            return {
                                ...item,
                                artistScore,
                                titleScore,
                                durationDiff,
                                exactDurationMatch,
                                artistMatched,
                                titleDrivenMatch,
                                matchReason: artistMatched ? 'artist' : (titleDrivenMatch ? 'title' : 'rejected')
                            };
                        })
                        .filter(item => {
                            if (!item?.syncedLyrics && !item?.plainLyrics && !item?.instrumental) return false;
                            if (item.artistMatched) return true;
                            if (allowTitleDrivenMatch && item.titleDrivenMatch) return true;
                            return false;
                        })
                        .sort((a, b) => {
                            if (a.artistMatched !== b.artistMatched) {
                                return Number(b.artistMatched) - Number(a.artistMatched);
                            }
                            if (b.titleScore !== a.titleScore) {
                                return b.titleScore - a.titleScore;
                            }
                            if (a.durationDiff !== b.durationDiff) {
                                return a.durationDiff - b.durationDiff;
                            }
                            return b.artistScore - a.artistScore;
                        });
                };

                const structuredSearch = await runSearch({
                    track_name: title,
                    artist_name: artist,
                    album_name: album
                }, 'structured');

                if (structuredSearch.fatal) {
                    result.error = structuredSearch.error;
                    logDebug('Failed', {
                        error: result.error,
                        searchMode: structuredSearch.searchLabel
                    });
                    return result;
                }

                let resolvedSearch = structuredSearch;
                let rankedCandidates = rankCandidates(structuredSearch.candidates);
                let usedFallbackQuery = false;

                if (rankedCandidates.length === 0 && LRCLIB_ENABLE_INEXACT_SEARCH) {
                    const fallbackAttempts = [];
                    if (searchSettings.enableFallbackTitleArtist && title && artist) {
                        fallbackAttempts.push({ params: { q: `${title} ${artist}` }, label: 'q:title+artist' });
                    }
                    if (searchSettings.enableFallbackTitleOnly && title) {
                        fallbackAttempts.push({ params: { q: title }, label: 'q:title' });
                    }

                    for (const attempt of fallbackAttempts) {
                        const fallbackSearch = await runSearch(attempt.params, attempt.label);
                        usedFallbackQuery = true;

                        if (fallbackSearch.fatal) {
                            result.error = fallbackSearch.error;
                            logDebug('Failed', {
                                error: result.error,
                                searchMode: fallbackSearch.searchLabel
                            });
                            return result;
                        }

                        resolvedSearch = fallbackSearch;
                        rankedCandidates = rankCandidates(fallbackSearch.candidates, { allowTitleDrivenMatch: true });

                        if (rankedCandidates.length > 0) {
                            break;
                        }
                    }
                }

                const body = rankedCandidates[0];
                if (!body) {
                    result.error = resolvedSearch.totalResults > 0
                        ? 'Low confidence metadata match'
                        : (resolvedSearch.error || 'No lyrics found');
                    logDebug('Failed', {
                        error: result.error,
                        searchMode: resolvedSearch.searchLabel,
                        totalResults: resolvedSearch.totalResults,
                        usedFallbackQuery
                    });
                    return result;
                }

                if (body.durationDiff > LRCLIB_DURATION_TOLERANCE_SEC) {
                    result.error = `No LRCLIB results within ±${LRCLIB_DURATION_TOLERANCE_SEC}s`;
                    logDebug('Failed', {
                        error: result.error,
                        durationDiff: body.durationDiff.toFixed(2),
                        searchMode: resolvedSearch.searchLabel,
                        usedFallbackQuery
                    });
                    return result;
                }

                if (body.instrumental) {
                    result.synced = [{ startTime: 0, text: '♪ Instrumental ♪' }];
                    result.unsynced = [{ text: '♪ Instrumental ♪' }];
                    logDebug('Success', {
                        instrumental: true,
                        matchedCandidates: rankedCandidates.length,
                        durationDiff: body.durationDiff.toFixed(2),
                        exactDurationMatch: body.exactDurationMatch,
                        artistScore: body.artistScore.toFixed(3),
                        titleScore: body.titleScore.toFixed(3),
                        matchReason: body.matchReason,
                        searchMode: resolvedSearch.searchLabel,
                        usedFallbackQuery
                    });
                    return result;
                }

                if (body.syncedLyrics) {
                    const parsed = parseLRC(body.syncedLyrics);
                    result.synced = parsed.synced;
                    if (!result.unsynced) {
                        result.unsynced = parsed.unsynced;
                    }
                }
                else if (body.plainLyrics) {
                    result.unsynced = body.plainLyrics.split('\n').map(line => ({ text: line.trim() })).filter(l => l.text);
                }

                if (!result.synced && body.plainLyrics && !result.unsynced) {
                    result.unsynced = body.plainLyrics.split('\n').map(line => ({ text: line.trim() })).filter(l => l.text);
                }

                if (!result.synced && !result.unsynced) {
                    result.error = 'No lyrics';
                    logDebug('Failed', {
                        error: result.error,
                        matchedCandidates: rankedCandidates.length,
                        searchMode: resolvedSearch.searchLabel,
                        usedFallbackQuery
                    });
                    return result;
                }

                logDebug('Success', {
                    totalResults: resolvedSearch.totalResults,
                    matchedCandidates: rankedCandidates.length,
                    artistScore: body.artistScore.toFixed(3),
                    titleScore: body.titleScore.toFixed(3),
                    durationDiff: body.durationDiff.toFixed(2),
                    exactDurationMatch: body.exactDurationMatch,
                    hasSynced: !!result.synced,
                    hasUnsynced: !!result.unsynced,
                    matchReason: body.matchReason,
                    searchMode: resolvedSearch.searchLabel,
                    usedFallbackQuery
                });
                return result;

            } catch (e) {
                result.error = e.message;
                logDebug('Fatal Error', { error: e.message });
                return result;
            }

        }
    };

    syncAddonCacheVersion();

    // ============================================
    // Registration (애드온 등록)
    // ============================================
    // LyricsAddonManager에 이 애드온을 등록합니다.
    // Spicetify 로딩 순서에 따라 Manager가 아직 준비되지 않았을 수 있으므로
    // 준비될 때까지 100ms 간격으로 재시도합니다.

    /**
     * 【애드온 등록 함수】
     * window.LyricsAddonManager가 존재하면 애드온을 등록하고,
     * 없으면 100ms 후에 다시 시도합니다 (Polling 패턴).
     */
    const registerAddon = () => {
        if (window.LyricsAddonManager) {
            // Manager 준비됨 → 애드온 등록
            window.LyricsAddonManager.register(LrclibLyricsAddon);
        } else {
            // Manager 미준비 → 100ms 후 재시도
            setTimeout(registerAddon, 100);
        }
    };

    // IIFE 실행 시 즉시 등록 시도 시작
    registerAddon();
})();
