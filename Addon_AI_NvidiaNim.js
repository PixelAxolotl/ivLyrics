/** NVIDIA hosted NIM APIs use the OpenAI-compatible chat protocol. */
(() => {
    'use strict';
    const register = () => {
        if (!window.createOpenAICompatibleAddon) {
            setTimeout(register, 100);
            return;
        }
        window.createOpenAICompatibleAddon({
            baseUrl: 'https://integrate.api.nvidia.com/v1',
            requestDefaults: { max_tokens: 16000, temperature: 0.3 },
            info: {
                id: 'nvidia-nim',
                name: 'NVIDIA NIM',
                author: 'default',
                version: '1.0.0',
                apiKeyUrl: 'https://build.nvidia.com/',
                description: {
                    ko: 'NVIDIA NIM 모델을 사용하는 번역, 발음 및 가사 학습',
                    en: 'Translation, pronunciation and lyrics study using NVIDIA NIM models'
                },
                supports: {
                    translate: true, metadata: true, tmi: true,
                    researchWebSearch: false, lyricsStudy: true,
                    characterPronunciation: true, culturalAnnotations: true,
                    lyricsAlignment: true
                },
                models: []
            }
        });
    };
    register();
})();
