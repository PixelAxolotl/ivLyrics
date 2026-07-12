/**
 * Spotify Lyrics Provider Addon
 * Spotify의 내장 가사 서비스를 통해 가사를 제공합니다.
 * 
 * Original Code is from https://github.com/spicetify/cli/tree/main/CustomApps/lyrics-plus
 *
 * @addon-type lyrics
 * @id spotify
 * @name Spotify
 * @version 1.0.0
 * @author Spicetify
 * @supports karaoke: false (커뮤니티 sync-data를 통해 지원 가능)
 * @supports synced: true
 * @supports unsynced: true
 */

(() => {
    'use strict';

    // ============================================
    // Addon Metadata
    // ============================================

    const ADDON_INFO = {
        id: 'spotify',
        name: 'Spotify',
        author: 'default',
        version: '1.0.0',
        description: {
            en: 'Get lyrics from Spotify\'s built-in lyrics service',
            ko: 'Spotify 내장 가사 서비스에서 가사를 가져옵니다'
        },
        // 지원하는 가사 유형
        supports: {
            karaoke: false,   // 기본적으로 노래방 가사 미지원 (sync-data로 확장 가능)
            synced: true,     // 싱크 가사 지원
            unsynced: true    // 일반 가사 지원
        },
        // ivLyrics Sync 데이터 자동 적용 여부
        useIvLyricsSync: true,
        // 아이콘 (SVG path)
        icon: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z'
    };

    // ============================================
    // API Endpoints
    // ============================================

    const LYRICS_API_BASE = 'https://spclient.wg.spotify.com/color-lyrics/v2/track/';

    // ============================================
    // Addon Implementation
    // ============================================

    const SpotifyLyricsAddon = {
        ...ADDON_INFO,

        /**
         * 초기화
         */
        async init() {
            window.__ivLyricsDebugLog?.(`[Spotify Lyrics Addon] Initialized (v${ADDON_INFO.version})`);
        },

        /**
         * 설정 UI
         */
        getSettingsUI() {
            const React = Spicetify.React;

            return function SpotifyLyricsSettings() {
                return React.createElement('div', { className: 'ai-addon-settings spotify-settings' },
                    React.createElement('div', { className: 'ai-addon-setting', style: { marginTop: '20px' } },
                        React.createElement('div', { className: 'ai-addon-info-box' },
                            React.createElement('p', { style: { fontWeight: 'bold', marginBottom: '8px' } }, 'Spotify Premium Features'),
                            React.createElement('p', null, 'This addon retrieves lyrics directly from Spotify.'),
                            React.createElement('ul', { style: { paddingLeft: '20px', marginTop: '8px', opacity: 0.8 } },
                                React.createElement('li', null, 'Requires Spotify Premium'),
                                React.createElement('li', null, 'Supports multiple providers'),
                                React.createElement('li', null, 'High accuracy & sync quality')
                            )
                        )
                    )
                );
            };
        },

        /**
         * 가사 가져오기
         * @param {Object} info - 트랙 정보 { uri, title, artist, album, duration }
         * @returns {Promise<LyricsResult>}
         */
        async getLyrics(info) {
            const result = {
                uri: info.uri,
                provider: 'spotify',
                karaoke: null,
                synced: null,
                unsynced: null,
                copyright: null,
                error: null,
                // Spotify 내부 가사 provider 정보
                spotifyLyricsProvider: null
            };

            const trackId = window.LyricsService?.extractTrackId?.(info.uri)
                || window.ivLyricsTrackIdentity?.extractTrackId?.(info.uri);
            if (!trackId) {
                result.error = 'Missing Spotify track ID';
                return result;
            }

            // Spotify API 호출
            let body;
            try {
                body = await Spicetify.CosmosAsync.get(
                    `${LYRICS_API_BASE}${trackId}?format=json&vocalRemoval=false&market=from_token`
                );
            } catch (e) {
                result.error = 'Request error';
                return result;
            }

            const lyrics = body?.lyrics;
            if (!lyrics) {
                result.error = 'No lyrics';
                return result;
            }

            // Spotify 내부 가사 provider 추출
            const spotifyLyricsProvider = lyrics.provider || 'unknown';
            result.spotifyLyricsProvider = spotifyLyricsProvider;

            // provider 필드를 세분화 (예: spotify-abc)
            result.provider = `spotify-${spotifyLyricsProvider}`;

            // 가사 파싱
            const lines = lyrics.lines;

            // To support karaoke in ivLyrics, you must convert to this format:
            // [
            //   {
            //     "startTime": 1000,
            //     "endTime": 3000,
            //     "text": "I see the light",
            //     "syllables": [
            //       { "text": "I ", "startTime": 1000, "endTime": 1490 },
            //       { "text": "see ", "startTime": 1500, "endTime": 1990 },
            //       { "text": "the ", "startTime": 2000, "endTime": 2490 },
            //       { "text": "light", "startTime": 2500, "endTime": 3000 }
            //     ]
            //   },
            //   {
            //     "startTime": 4000,
            //     "endTime": 6000,
            //     "text": "It calls me",
            //     "syllables": [
            //       { "text": "It ", "startTime": 4000, "endTime": 4490 },
            //       { "text": "calls ", "startTime": 4500, "endTime": 4990 },
            //       { "text": "me", "startTime": 5000, "endTime": 6000 }
            //     ]
            //   },
            //   {
            //     "startTime": 7000,
            //     "endTime": 9000,
            //     "text": "And I run",
            //     "syllables": [
            //       { "text": "And ", "startTime": 7000, "endTime": 7490 },
            //       { "text": "I ", "startTime": 7500, "endTime": 7990 },
            //       { "text": "run", "startTime": 8000, "endTime": 9000 }
            //     ]
            //   }
            // ]
            if (lyrics.syncType === 'LINE_SYNCED' || lyrics.syncType === 'SYLLABLE_SYNCED') {
                result.synced = lines.map(line => {
                    // Start Time: try line.startTimeMs first, then first syllable's time
                    let startTime = parseInt(line.startTimeMs, 10);
                    if (isNaN(startTime) && line.syllables && line.syllables.length > 0) {
                        startTime = parseInt(line.syllables[0].startTimeMs, 10);
                    }

                    return {
                        startTime: startTime || 0,
                        text: line.words || ''
                    };
                });
                result.unsynced = result.synced;
            } else {
                result.unsynced = lines.map(line => ({
                    text: line.words || ''
                }));
            }

            return result;
        }
    };

    // ============================================
    // Registration
    // ============================================

    const registerAddon = () => {
        if (window.LyricsAddonManager) {
            window.LyricsAddonManager.register(SpotifyLyricsAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();

    window.__ivLyricsDebugLog?.('[Spotify Lyrics Addon] Module loaded');
})();
