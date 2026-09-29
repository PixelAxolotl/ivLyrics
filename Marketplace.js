/**
 * Marketplace UI Component for ivLyrics
 * 마켓플레이스 에드온 목록 표시, 상세 보기, 설치/제거 UI
 *
 * @author ivLis STUDIO
 */

const MarketplacePage = (() => {
    'use strict';

    const { useState, useEffect, useCallback, useMemo, useRef } = Spicetify.React;
    const react = Spicetify.React;

    // ============================================
    // Filter Constants
    // ============================================
    const FILTER_ALL = 'all';
    const FILTER_LYRICS = 'lyrics';
    const FILTER_AI = 'ai';
    const FILTER_STYLE = 'style';

    // Shared detail-header back button (identical markup in addon detail and developer profile views)
    function createMarketplaceBackButton(onBack) {
        return react.createElement('button', {
            className: 'ivlyrics-marketplace-detail-back',
            onClick: onBack,
        },
            react.createElement('svg', {
                width: 20, height: 20, viewBox: '0 0 24 24',
                fill: 'none', stroke: 'currentColor', strokeWidth: 2
            },
                react.createElement('path', { d: 'M19 12H5m0 0l7 7m-7-7l7-7' })
            ),
            I18n.t('marketplace.backToLyrics')
        );
    }

    // Shared cancel/confirm button row for the confirm and disclaimer modals
    function renderMarketplaceConfirmButtons(onCancel, okClassName, onOk, okLabelKey) {
        return react.createElement('div', { className: 'ivlyrics-marketplace-confirm-buttons' },
            react.createElement('button', {
                className: 'ivlyrics-marketplace-confirm-btn ivlyrics-marketplace-confirm-btn-cancel',
                onClick: onCancel
            }, I18n.t('buttons.cancel')),
            react.createElement('button', {
                className: okClassName,
                onClick: onOk
            }, I18n.t(okLabelKey))
        );
    }

    // ============================================
    // Markdown Renderer
    // ============================================

    const _mdCache = new Map();

    function renderMarkdownToHTML(md) {
        if (_mdCache.has(md)) return _mdCache.get(md);

        const result = Utils.renderSafeMarkdownToHTML(md, {
            allowTables: true,
            allowYouTubeEmbeds: true,
            codeBlockRenderer: ({ code, className, languageLabel, escapeHtml }) => {
                const languageHtml = languageLabel
                    ? `<span class="ivlyrics-marketplace-code-language">${escapeHtml(languageLabel)}</span>`
                    : '<span class="ivlyrics-marketplace-code-language is-empty"></span>';
                return `<div class="ivlyrics-marketplace-code-block"><div class="ivlyrics-marketplace-code-toolbar">${languageHtml}<button type="button" class="ivlyrics-marketplace-code-copy" data-copy-code="true">Copy</button></div><pre><code${className}>${code}</code></pre></div>`;
            }
        });

        _mdCache.set(md, result);
        return result;
    }

    function isUrl(str) {
        return typeof str === 'string' && /^https?:\/\//i.test(str.trim());
    }

    // ============================================
    // MarkdownDescription Component
    // ============================================

    const MarkdownDescription = react.memo(({ description }) => {
        const [content, setContent] = useState(null);
        const [loading, setLoading] = useState(false);
        const containerRef = useRef(null);
        const resetTimeoutRef = useRef(null);
        const copiedButtonRef = useRef(null);

        const copyLabel = tWithFallback('copyCommand', 'Copy');
        const copiedLabel = tWithFallback('settingsAdvanced.debugTab.copied', 'Copied');
        const copyFailedLabel = tWithFallback('notifications.copyFailed', 'Copy failed');

        const resetCopiedButton = useCallback(() => {
            if (copiedButtonRef.current) {
                copiedButtonRef.current.textContent = copyLabel;
                copiedButtonRef.current.removeAttribute('data-copied');
                copiedButtonRef.current = null;
            }
            if (resetTimeoutRef.current) {
                clearTimeout(resetTimeoutRef.current);
                resetTimeoutRef.current = null;
            }
        }, [copyLabel]);

        useEffect(() => () => {
            if (resetTimeoutRef.current) {
                clearTimeout(resetTimeoutRef.current);
            }
        }, []);

        useEffect(() => {
            if (!containerRef.current) return;
            containerRef.current.querySelectorAll('[data-copy-code]').forEach((button) => {
                if (!button.hasAttribute('data-copied')) {
                    button.textContent = copyLabel;
                }
            });
        }, [content, copyLabel]);

        const handleDescriptionClick = useCallback(async (event) => {
            const button = event.target.closest?.('[data-copy-code]');
            if (!button) return;

            event.preventDefault();
            event.stopPropagation();

            const codeElement = button.closest('.ivlyrics-marketplace-code-block')?.querySelector('code');
            const codeText = codeElement?.textContent || '';
            if (!codeText) return;

            const success = await Utils.copyToClipboard(codeText);
            if (!success) {
                Toast.error(copyFailedLabel);
                return;
            }

            resetCopiedButton();
            button.textContent = copiedLabel;
            button.setAttribute('data-copied', 'true');
            copiedButtonRef.current = button;
            resetTimeoutRef.current = setTimeout(() => {
                if (copiedButtonRef.current === button) {
                    button.textContent = copyLabel;
                    button.removeAttribute('data-copied');
                    copiedButtonRef.current = null;
                    resetTimeoutRef.current = null;
                }
            }, 1800);
        }, [copiedLabel, copyFailedLabel, copyLabel, resetCopiedButton]);

        useEffect(() => {
            if (!description) {
                setContent('');
                return;
            }

            if (!isUrl(description)) {
                // description 자체가 마크다운 텍스트
                setContent(renderMarkdownToHTML(description));
                return;
            }

            // URL인 경우 fetch
            let cancelled = false;
            setLoading(true);

            fetch(description.trim(), { cache: 'no-cache' })
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.text();
                })
                .then(md => {
                    if (!cancelled) {
                        setContent(renderMarkdownToHTML(md));
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        // URL 로드 실패 시 URL 자체를 링크로 표시
                        const safeUrl = Utils.sanitizeHttpUrl(description);
                        const safeLabel = Utils.escapeHtml(description);
                        setContent(safeUrl
                            ? `<a href="${Utils.escapeAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`
                            : safeLabel);
                    }
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });

            return () => { cancelled = true; };
        }, [description]);

        if (loading) {
            return react.createElement('div', { className: 'ivlyrics-marketplace-detail-description ivlyrics-marketplace-md-loading' },
                react.createElement('div', { className: 'ivlyrics-marketplace-spinner' }),
            );
        }

        if (!content) {
            return react.createElement('div', { className: 'ivlyrics-marketplace-detail-description' });
        }

        return react.createElement('div', {
            ref: containerRef,
            className: 'ivlyrics-marketplace-detail-description ivlyrics-marketplace-md',
            onClick: handleDescriptionClick,
            dangerouslySetInnerHTML: { __html: content }
        });
    });

    // ============================================
    // Star Count Helper
    // ============================================

    function formatStarCount(count) {
        if (typeof count !== 'number' || count < 0) return '0';
        if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(count);
    }

    function tWithFallback(key, fallbackValue) {
        const value = I18n.t(key);
        return !value || value === key ? fallbackValue : value;
    }

    function getAddonTypeLabel(type) {
        if (type === 'lyrics') return tWithFallback('marketplace.filterLyrics', 'Lyrics');
        if (type === 'ai') return tWithFallback('marketplace.filterAI', 'AI');
        if (type === 'style') return tWithFallback('marketplace.filterStyle', 'Style');
        return String(type || '').toUpperCase();
    }

    // ============================================
    // AddonCard Component
    // ============================================

    const AddonCard = react.memo(({ addon, onClick, onAuthorClick }) => {
        const handleAuthorClick = useCallback((e) => {
            e.stopPropagation();
            if (onAuthorClick && addon.authorLogin) {
                onAuthorClick(addon.authorLogin);
            }
        }, [addon.authorLogin, onAuthorClick]);

        return react.createElement('div', {
            className: 'ivlyrics-marketplace-card',
            onClick: () => onClick(addon),
            tabIndex: 0,
            role: 'button',
            'aria-label': addon.name,
            onKeyDown: (e) => {
                if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
                e.preventDefault();
                onClick(addon);
            }
        },
            // Preview Image
            react.createElement('div', { className: 'ivlyrics-marketplace-card-image' },
                addon.preview
                    ? react.createElement('img', {
                        src: addon.preview,
                        alt: addon.name,
                        loading: 'lazy',
                        onError: (e) => { e.target.style.display = 'none'; }
                    })
                    : react.createElement('div', { className: 'ivlyrics-marketplace-card-image-placeholder' },
                        react.createElement('svg', {
                            width: 48, height: 48, viewBox: '0 0 24 24',
                            fill: 'none', stroke: 'currentColor', strokeWidth: 1.5
                        },
                            react.createElement('path', {
                                d: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'
                            })
                        )
                    )
            ),
            // Card Info
            react.createElement('div', { className: 'ivlyrics-marketplace-card-info' },
                react.createElement('div', { className: 'ivlyrics-marketplace-card-title' }, addon.name),
                react.createElement('div', { className: 'ivlyrics-marketplace-card-author' },
                    addon.authorLogin
                        ? react.createElement('span', {
                            className: 'ivlyrics-marketplace-author-link',
                            onClick: handleAuthorClick,
                            role: 'button',
                            tabIndex: 0,
                            'aria-label': addon.author,
                            onKeyDown: (e) => {
                                if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
                                e.preventDefault();
                                handleAuthorClick(e);
                            }
                        }, I18n.t('marketplace.by', { author: addon.author }))
                        : I18n.t('marketplace.by', { author: addon.author })
                ),
                react.createElement('div', { className: 'ivlyrics-marketplace-card-meta' },
                    react.createElement('span', { className: 'ivlyrics-marketplace-card-version' },
                        I18n.t('marketplace.version', { version: addon.version })
                    )
                )
            ),
            addon.type && react.createElement('div', {
                className: `ivlyrics-marketplace-card-type ivlyrics-marketplace-card-type-${addon.type} ivlyrics-marketplace-card-type-overlay`
            }, getAddonTypeLabel(addon.type)),
            // Star Count (top-right)
            react.createElement('div', { className: 'ivlyrics-marketplace-stars' },
                react.createElement('svg', {
                    width: 14, height: 14, viewBox: '0 0 24 24',
                    fill: 'currentColor'
                },
                    react.createElement('path', {
                        d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
                    })
                ),
                react.createElement('span', null, formatStarCount(addon.stars))
            )
        );
    });

    // ============================================
    // AddonDetail Component
    // ============================================

    // ============================================
    // Sidebar Mini Card (for sidebar popular addons)
    // ============================================

    const SidebarMiniCard = react.memo(({ addon, onClick }) => {
        return react.createElement('div', {
            className: 'ivlyrics-marketplace-sidebar-minicard',
            onClick: () => onClick(addon),
            role: 'button',
            tabIndex: 0,
            'aria-label': addon.name,
            onKeyDown: (e) => {
                if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
                e.preventDefault();
                onClick(addon);
            }
        },
            addon.preview
                ? react.createElement('img', {
                    className: 'ivlyrics-marketplace-sidebar-minicard-img',
                    src: addon.preview,
                    alt: addon.name,
                    loading: 'lazy',
                    onError: (e) => { e.target.style.display = 'none'; }
                })
                : react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-minicard-img ivlyrics-marketplace-sidebar-minicard-placeholder' },
                    react.createElement('svg', {
                        width: 20, height: 20, viewBox: '0 0 24 24',
                        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5
                    },
                        react.createElement('path', {
                            d: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'
                        })
                    )
                ),
            react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-minicard-info' },
                react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-minicard-name' }, addon.name),
                react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-minicard-meta' },
                    react.createElement('svg', {
                        width: 11, height: 11, viewBox: '0 0 24 24',
                        fill: 'currentColor', style: { color: '#fbbf24' }
                    },
                        react.createElement('path', {
                            d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
                        })
                    ),
                    react.createElement('span', null, formatStarCount(addon.stars))
                )
            )
        );
    });

    // ============================================
    // ConfirmModal Component
    // ============================================

    const ConfirmModal = react.memo(({ message, onConfirm, onCancel }) => {
        const handleOverlayClick = useCallback((e) => {
            if (e.target === e.currentTarget) onCancel();
        }, [onCancel]);

        useEffect(() => {
            const handleKey = (e) => {
                if (e.key === 'Escape') onCancel();
                if (e.key === 'Enter') onConfirm();
            };
            window.addEventListener('keydown', handleKey);
            return () => window.removeEventListener('keydown', handleKey);
        }, [onConfirm, onCancel]);

        return react.createElement('div', {
            className: 'ivlyrics-marketplace-confirm-overlay',
            onClick: handleOverlayClick
        },
            react.createElement('div', { className: 'ivlyrics-marketplace-confirm-modal' },
                react.createElement('div', { className: 'ivlyrics-marketplace-confirm-message' }, message),
                renderMarketplaceConfirmButtons(
                    onCancel,
                    'ivlyrics-marketplace-confirm-btn ivlyrics-marketplace-confirm-btn-ok',
                    onConfirm,
                    'buttons.confirm'
                )
            )
        );
    });

    // ============================================
    // DisclaimerModal Component (install warning)
    // ============================================

    const DISCLAIMER_STORAGE_KEY = 'ivlyrics-marketplace-disclaimer-dismissed';

    const DisclaimerModal = react.memo(({ onConfirm, onCancel }) => {
        const [dontShowAgain, setDontShowAgain] = useState(false);

        const handleOverlayClick = useCallback((e) => {
            if (e.target === e.currentTarget) onCancel();
        }, [onCancel]);

        useEffect(() => {
            const handleKey = (e) => {
                if (e.key === 'Escape') onCancel();
            };
            window.addEventListener('keydown', handleKey);
            return () => window.removeEventListener('keydown', handleKey);
        }, [onCancel]);

        const handleConfirm = useCallback(() => {
            if (dontShowAgain) {
                try { localStorage.setItem(DISCLAIMER_STORAGE_KEY, '1'); } catch (e) {}
            }
            onConfirm();
        }, [dontShowAgain, onConfirm]);

        return react.createElement('div', {
            className: 'ivlyrics-marketplace-confirm-overlay',
            onClick: handleOverlayClick
        },
            react.createElement('div', { className: 'ivlyrics-marketplace-confirm-modal ivlyrics-marketplace-disclaimer-modal' },
                react.createElement('div', { className: 'ivlyrics-marketplace-disclaimer-icon' },
                    react.createElement('svg', {
                        width: 32, height: 32, viewBox: '0 0 24 24',
                        fill: 'none', stroke: '#f59e0b', strokeWidth: 2
                    },
                        react.createElement('path', { d: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z' }),
                        react.createElement('line', { x1: 12, y1: 9, x2: 12, y2: 13, stroke: '#f59e0b' }),
                        react.createElement('line', { x1: 12, y1: 17, x2: 12.01, y2: 17, stroke: '#f59e0b' })
                    )
                ),
                react.createElement('div', { className: 'ivlyrics-marketplace-disclaimer-title' },
                    I18n.t('marketplace.disclaimerTitle')
                ),
                react.createElement('div', { className: 'ivlyrics-marketplace-confirm-message' },
                    I18n.t('marketplace.disclaimerInstall')
                ),
                react.createElement('label', { className: 'ivlyrics-marketplace-disclaimer-checkbox' },
                    react.createElement('input', {
                        type: 'checkbox',
                        checked: dontShowAgain,
                        onChange: (e) => setDontShowAgain(e.target.checked)
                    }),
                    react.createElement('span', null, I18n.t('marketplace.dontShowAgain'))
                ),
                renderMarketplaceConfirmButtons(
                    onCancel,
                    'ivlyrics-marketplace-confirm-btn ivlyrics-marketplace-confirm-btn-ok ivlyrics-marketplace-confirm-btn-warn',
                    handleConfirm,
                    'marketplace.install'
                )
            )
        );
    });

    // ============================================
    // Direct URL Install Modal
    // ============================================

    function getDirectInstallErrorMessage(error) {
        const keyByCode = {
            INVALID_URL: 'marketplace.directErrorUrl',
            HTTPS_REQUIRED: 'marketplace.directErrorUrl',
            JS_REQUIRED: 'marketplace.directErrorUrl',
            DOWNLOAD_FAILED: 'marketplace.directErrorDownload',
            ADDON_TOO_LARGE: 'marketplace.directErrorDownload',
            EMPTY_ADDON: 'marketplace.directErrorDownload',
            NOT_JAVASCRIPT: 'marketplace.directErrorUrl',
            METADATA_INVALID: 'marketplace.directErrorMetadata',
            REGISTRATION_FAILED: 'marketplace.directErrorMetadata',
            ALREADY_INSTALLED: 'marketplace.directErrorDuplicate'
        };
        return I18n.t(keyByCode[error?.code] || 'marketplace.directErrorGeneric');
    }

    const DirectUrlInstallModal = react.memo(({ onInstall, onCancel }) => {
        const [url, setUrl] = useState('');
        const [consented, setConsented] = useState(false);
        const [installing, setInstalling] = useState(false);
        const [error, setError] = useState('');
        const inputRef = useRef(null);
        const titleId = 'ivlyrics-direct-url-title';

        useEffect(() => {
            inputRef.current?.focus();
            const handleKey = (event) => {
                if (event.key === 'Escape' && !installing) onCancel();
            };
            window.addEventListener('keydown', handleKey);
            return () => window.removeEventListener('keydown', handleKey);
        }, [installing, onCancel]);

        const handleOverlayClick = useCallback((event) => {
            if (event.target === event.currentTarget && !installing) onCancel();
        }, [installing, onCancel]);

        const handleSubmit = useCallback(async (event) => {
            event.preventDefault();
            if (!consented || !url.trim() || installing) return;

            setInstalling(true);
            setError('');
            try {
                await onInstall(url.trim());
            } catch (installError) {
                setError(getDirectInstallErrorMessage(installError));
                setInstalling(false);
            }
        }, [consented, installing, onInstall, url]);

        const renderDirectHeading = () => (
                react.createElement('div', { className: 'ivlyrics-marketplace-direct-heading' },
                    react.createElement('div', { className: 'ivlyrics-marketplace-disclaimer-icon' },
                        react.createElement('svg', {
                            width: 30, height: 30, viewBox: '0 0 24 24',
                            fill: 'none', stroke: '#f59e0b', strokeWidth: 2
                        },
                            react.createElement('path', { d: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z' }),
                            react.createElement('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
                            react.createElement('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 })
                        )
                    ),
                    react.createElement('div', null,
                        react.createElement('h2', { id: titleId, className: 'ivlyrics-marketplace-direct-title' },
                            I18n.t('marketplace.directUrlTitle')
                        )
                    )
                )
        );

        const renderDirectButtons = () => (
                react.createElement('div', { className: 'ivlyrics-marketplace-confirm-buttons' },
                    react.createElement('button', {
                        type: 'button',
                        className: 'ivlyrics-marketplace-confirm-btn ivlyrics-marketplace-confirm-btn-cancel',
                        disabled: installing,
                        onClick: onCancel
                    }, I18n.t('buttons.cancel')),
                    react.createElement('button', {
                        type: 'submit',
                        className: 'ivlyrics-marketplace-confirm-btn ivlyrics-marketplace-confirm-btn-ok ivlyrics-marketplace-confirm-btn-warn',
                        disabled: installing || !consented || !url.trim()
                    }, installing ? I18n.t('marketplace.installing') : I18n.t('marketplace.install'))
                )
        );

        return react.createElement('div', {
            className: 'ivlyrics-marketplace-confirm-overlay',
            onClick: handleOverlayClick
        },
            react.createElement('form', {
                className: 'ivlyrics-marketplace-confirm-modal ivlyrics-marketplace-direct-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': titleId,
                onSubmit: handleSubmit
            },
                renderDirectHeading(),
                react.createElement('div', { className: 'ivlyrics-marketplace-direct-warning', role: 'alert' },
                    react.createElement('strong', null, I18n.t('marketplace.directWarningTitle')),
                    react.createElement('p', null, I18n.t('marketplace.directWarningBody'))
                ),
                react.createElement('label', { className: 'ivlyrics-marketplace-direct-field' },
                    react.createElement('span', null, I18n.t('marketplace.directUrlLabel')),
                    react.createElement('input', {
                        ref: inputRef,
                        type: 'url',
                        inputMode: 'url',
                        autoComplete: 'off',
                        spellCheck: false,
                        required: true,
                        disabled: installing,
                        value: url,
                        placeholder: I18n.t('marketplace.directUrlPlaceholder'),
                        onChange: (event) => {
                            setUrl(event.target.value);
                            setError('');
                        }
                    })
                ),
                react.createElement('div', { className: 'ivlyrics-marketplace-direct-snapshot' },
                    I18n.t('marketplace.directSnapshotNotice')
                ),
                react.createElement('label', { className: 'ivlyrics-marketplace-direct-consent' },
                    react.createElement('input', {
                        type: 'checkbox',
                        checked: consented,
                        disabled: installing,
                        onChange: (event) => setConsented(event.target.checked)
                    }),
                    react.createElement('span', null, I18n.t('marketplace.directConsent'))
                ),
                error && react.createElement('div', {
                    className: 'ivlyrics-marketplace-direct-error',
                    role: 'alert'
                }, error),
                renderDirectButtons()
            )
        );
    });

    // ============================================
    // Installed Addon Management
    // ============================================

    function formatInstalledDate(value) {
        if (!value) return '';
        try {
            const language = window.I18n?.getCurrentLanguage?.() || 'en';
            return new Intl.DateTimeFormat(language, {
                year: 'numeric', month: 'short', day: 'numeric'
            }).format(new Date(value));
        } catch {
            return String(value).slice(0, 10);
        }
    }

    const InstalledAddonCard = react.memo(({ addon, marketplaceAddon, marketplaceStateKnown, removing, onRemove }) => {
        const isDirect = addon.source === 'direct-url';
        const isMissing = !isDirect && marketplaceStateKnown && !marketplaceAddon;
        const sourceUrl = addon.githubUrl || addon.downloadUrl || '';
        const openSource = useCallback(() => {
            const safeUrl = Utils.sanitizeHttpUrl(sourceUrl);
            if (safeUrl) window.open(safeUrl, '_blank', 'noopener,noreferrer');
        }, [sourceUrl]);

        return react.createElement('article', {
            className: `ivlyrics-marketplace-installed-card${addon.loadStatus === 'failed' ? ' has-error' : ''}`
        },
            react.createElement('div', { className: 'ivlyrics-marketplace-installed-icon' },
                addon.preview
                    ? react.createElement('img', { src: addon.preview, alt: '' })
                    : react.createElement('svg', {
                        width: 26, height: 26, viewBox: '0 0 24 24',
                        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8
                    },
                        react.createElement('path', { d: 'M8 9l3 3-3 3M13 15h3' }),
                        react.createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 4 })
                    )
            ),
            react.createElement('div', { className: 'ivlyrics-marketplace-installed-main' },
                react.createElement('div', { className: 'ivlyrics-marketplace-installed-title-row' },
                    react.createElement('h3', null, addon.name || addon.id),
                    react.createElement('span', {
                        className: `ivlyrics-marketplace-card-type ivlyrics-marketplace-card-type-${addon.type}`
                    }, getAddonTypeLabel(addon.type)),
                    react.createElement('span', {
                        className: `ivlyrics-marketplace-source-badge ${isDirect ? 'is-direct' : isMissing ? 'is-missing' : ''}`
                    }, I18n.t(isDirect
                        ? 'marketplace.sourceDirect'
                        : isMissing
                            ? 'marketplace.sourceUnavailable'
                            : 'marketplace.browseTab')),
                    addon.loadStatus === 'failed' && react.createElement('span', {
                        className: 'ivlyrics-marketplace-source-badge is-error'
                    }, I18n.t('marketplace.loadFailed'))
                ),
                react.createElement('div', { className: 'ivlyrics-marketplace-installed-meta' },
                    react.createElement('span', null, addon.author || '—'),
                    react.createElement('span', null, I18n.t('marketplace.version', { version: addon.version || '0.0.0' })),
                    addon.installedAt && react.createElement('span', null, formatInstalledDate(addon.installedAt))
                ),
                addon.loadStatus === 'failed' && react.createElement('p', { className: 'ivlyrics-marketplace-installed-warning' },
                    I18n.t('marketplace.loadError')
                ),
                sourceUrl && react.createElement('button', {
                    type: 'button',
                    className: 'ivlyrics-marketplace-source-link',
                    title: sourceUrl,
                    onClick: openSource
                },
                    react.createElement('span', null, I18n.t('marketplace.viewSource')),
                    react.createElement('svg', {
                        width: 13, height: 13, viewBox: '0 0 24 24',
                        fill: 'none', stroke: 'currentColor', strokeWidth: 2
                    },
                        react.createElement('path', { d: 'M14 3h7v7M10 14L21 3M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5' })
                    )
                )
            ),
            react.createElement('button', {
                type: 'button',
                className: 'ivlyrics-marketplace-installed-remove',
                disabled: removing,
                onClick: () => onRemove(addon),
                'aria-label': `${I18n.t('marketplace.uninstall')} ${addon.name || addon.id}`
            },
                react.createElement('svg', {
                    width: 17, height: 17, viewBox: '0 0 24 24',
                    fill: 'none', stroke: 'currentColor', strokeWidth: 2
                },
                    react.createElement('path', { d: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5' })
                ),
                react.createElement('span', null, removing ? I18n.t('marketplace.uninstalling') : I18n.t('marketplace.uninstall'))
            )
        );
    });

    // ============================================
    // AddonDetail Component
    // ============================================

    const AddonDetail = react.memo(({ addon, allAddons, onBack, onInstall, onUninstall, onUpdate, onAuthorClick, onAddonClick }) => {
        const [actionLoading, setActionLoading] = useState(false);
        const [showConfirm, setShowConfirm] = useState(false);
        const lang = window.I18n?.getCurrentLanguage?.() || 'en';
        const description = typeof addon.description === 'object'
            ? (addon.description[lang] || addon.description.en || '')
            : (addon.description || '');

        const handleInstall = useCallback(async () => {
            setActionLoading(true);
            try {
                await onInstall(addon);
            } finally {
                setActionLoading(false);
            }
        }, [addon, onInstall]);

        const handleUninstall = useCallback(() => {
            setShowConfirm(true);
        }, []);

        const handleConfirmUninstall = useCallback(async () => {
            setShowConfirm(false);
            setActionLoading(true);
            try {
                await onUninstall(addon.id);
            } finally {
                setActionLoading(false);
            }
        }, [addon, onUninstall]);

        const handleCancelUninstall = useCallback(() => {
            setShowConfirm(false);
        }, []);

        const handleUpdate = useCallback(async () => {
            setActionLoading(true);
            try {
                await onUpdate(addon);
            } finally {
                setActionLoading(false);
            }
        }, [addon, onUpdate]);

        const handleAuthorClick = useCallback(() => {
            if (onAuthorClick && addon.authorLogin) {
                onAuthorClick(addon.authorLogin);
            }
        }, [addon.authorLogin, onAuthorClick]);

        // Sidebar data
        const avatarUrl = addon.authorAvatar || (addon.authorLogin ? `https://github.com/${addon.authorLogin}.png?size=128` : '');

        const authorOtherAddons = useMemo(() => {
            if (!allAddons || !addon.authorLogin) return [];
            return allAddons.filter(a => a.authorLogin === addon.authorLogin && a.id !== addon.id);
        }, [allAddons, addon.authorLogin, addon.id]);

        const popularAddons = useMemo(() => {
            if (!allAddons) return [];
            return allAddons
                .filter(a => a.id !== addon.id)
                .sort((a, b) => (b.stars || 0) - (a.stars || 0))
                .slice(0, 5);
        }, [allAddons, addon.id]);

        const renderDetailSidebar = () => (
                react.createElement('div', { className: 'ivlyrics-marketplace-detail-sidebar' },
                    // Developer card
                    addon.authorLogin && react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-section' },
                        react.createElement('div', {
                            className: 'ivlyrics-marketplace-sidebar-dev',
                            onClick: handleAuthorClick,
                            role: 'button',
                            tabIndex: 0
                        },
                            avatarUrl && react.createElement('img', {
                                className: 'ivlyrics-marketplace-sidebar-dev-avatar',
                                src: avatarUrl,
                                alt: addon.authorLogin,
                                onError: (e) => { e.target.style.display = 'none'; }
                            }),
                            react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-dev-text' },
                                react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-dev-name' }, addon.authorLogin),
                                react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-dev-label' },
                                    I18n.t('marketplace.developer') || 'Developer'
                                )
                            )
                        ),
                        // Author's other addons
                        authorOtherAddons.length > 0 && react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-list' },
                            react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-title' },
                                I18n.t('marketplace.moreByDeveloper') || 'More by this developer'
                            ),
                            authorOtherAddons.slice(0, 4).map(a =>
                                react.createElement(SidebarMiniCard, {
                                    key: a.id,
                                    addon: a,
                                    onClick: onAddonClick
                                })
                            )
                        )
                    ),
                    // Popular addons
                    popularAddons.length > 0 && react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-section' },
                        react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-title' },
                            I18n.t('marketplace.popular') || 'Popular'
                        ),
                        popularAddons.map(a =>
                            react.createElement(SidebarMiniCard, {
                                key: a.id,
                                addon: a,
                                onClick: onAddonClick
                            })
                        )
                    )
                )
        );

        const renderDetailHeader = () => (
            react.createElement('div', { className: 'ivlyrics-marketplace-detail-header' },
                createMarketplaceBackButton(onBack),
                // Action Buttons in header
                react.createElement('div', { className: 'ivlyrics-marketplace-detail-header-actions' },
                    addon.hasUpdate && react.createElement('button', {
                        className: 'ivlyrics-marketplace-btn ivlyrics-marketplace-btn-update',
                        onClick: handleUpdate,
                        disabled: actionLoading
                    }, actionLoading ? I18n.t('marketplace.installing') : I18n.t('marketplace.update')),

                    addon.isInstalled
                        ? react.createElement('button', {
                            className: 'ivlyrics-marketplace-btn ivlyrics-marketplace-btn-uninstall',
                            onClick: handleUninstall,
                            disabled: actionLoading
                        }, actionLoading ? I18n.t('marketplace.uninstalling') : I18n.t('marketplace.uninstall'))
                        : react.createElement('button', {
                            className: 'ivlyrics-marketplace-btn ivlyrics-marketplace-btn-install',
                            onClick: handleInstall,
                            disabled: actionLoading
                        }, actionLoading ? I18n.t('marketplace.installing') : I18n.t('marketplace.install'))
                )
            )
        );

        const renderDetailMain = () => (
                react.createElement('div', { className: 'ivlyrics-marketplace-detail-main' },
                    // Preview
                    addon.preview && react.createElement('div', { className: 'ivlyrics-marketplace-detail-image' },
                        react.createElement('img', {
                            src: addon.preview,
                            alt: addon.name,
                            onError: (e) => { e.target.style.display = 'none'; }
                        })
                    ),
                    // Title + meta
                    react.createElement('h2', { className: 'ivlyrics-marketplace-detail-title' }, addon.name),
                    react.createElement('div', { className: 'ivlyrics-marketplace-detail-meta' },
                        addon.authorLogin
                            ? react.createElement('span', {
                                className: 'ivlyrics-marketplace-author-link',
                                onClick: handleAuthorClick,
                                role: 'button',
                                tabIndex: 0
                            }, I18n.t('marketplace.by', { author: addon.author }))
                            : react.createElement('span', null,
                                I18n.t('marketplace.by', { author: addon.author })
                            ),
                        react.createElement('span', null,
                            I18n.t('marketplace.version', { version: addon.version })
                        ),
                        addon.updated && react.createElement('span', null,
                            I18n.t('marketplace.updated', { date: addon.updated })
                        ),
                        addon.type && react.createElement('span', {
                            className: `ivlyrics-marketplace-card-type ivlyrics-marketplace-card-type-${addon.type}`
                        }, getAddonTypeLabel(addon.type)),
                        react.createElement('span', { className: 'ivlyrics-marketplace-detail-stars' },
                            react.createElement('svg', {
                                width: 14, height: 14, viewBox: '0 0 24 24',
                                fill: 'currentColor',
                                style: { verticalAlign: 'middle', marginRight: '4px' }
                            },
                                react.createElement('path', {
                                    d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
                                })
                            ),
                            formatStarCount(addon.stars)
                        )
                    ),
                    // Description (Markdown rendered)
                    react.createElement(MarkdownDescription, { description })
                )
        );

        return react.createElement('div', { className: 'ivlyrics-marketplace-detail' },
            // Header with back button + action buttons
            renderDetailHeader(),
            // Two-column layout: main content + sidebar
            react.createElement('div', { className: 'ivlyrics-marketplace-detail-layout' },
                // Left: main content (scrollable)
                renderDetailMain(),
                // Right: sidebar
                renderDetailSidebar()
            ),
            showConfirm && react.createElement(ConfirmModal, {
                message: I18n.t('marketplace.uninstallConfirm', { name: addon.name }),
                onConfirm: handleConfirmUninstall,
                onCancel: handleCancelUninstall
            })
        );
    });

    // ============================================
    // DeveloperProfile Component
    // ============================================

    const DeveloperProfile = react.memo(({ authorLogin, addons, onBack, onAddonClick }) => {
        const avatarUrl = useMemo(() => {
            const addonWithAvatar = addons.find(a => a.authorAvatar);
            if (addonWithAvatar?.authorAvatar) return addonWithAvatar.authorAvatar;
            return `https://github.com/${authorLogin}.png?size=200`;
        }, [authorLogin, addons]);

        const githubProfileUrl = `https://github.com/${authorLogin}`;

        return react.createElement('div', { className: 'ivlyrics-marketplace-detail' },
            // Header
            react.createElement('div', { className: 'ivlyrics-marketplace-detail-header' },
                createMarketplaceBackButton(onBack),
            ),
            // Developer Profile Content
            react.createElement('div', { className: 'ivlyrics-marketplace-detail-content' },
                react.createElement('div', { className: 'ivlyrics-marketplace-dev-profile' },
                    react.createElement('img', {
                        className: 'ivlyrics-marketplace-dev-avatar',
                        src: avatarUrl,
                        alt: authorLogin,
                        onError: (e) => { e.target.style.display = 'none'; }
                    }),
                    react.createElement('div', { className: 'ivlyrics-marketplace-dev-info' },
                        react.createElement('h2', { className: 'ivlyrics-marketplace-dev-name' }, authorLogin),
                        react.createElement('a', {
                            className: 'ivlyrics-marketplace-dev-github-link',
                            href: githubProfileUrl,
                            target: '_blank',
                            rel: 'noopener noreferrer',
                            onClick: (e) => e.stopPropagation()
                        },
                            react.createElement('svg', {
                                width: 14, height: 14, viewBox: '0 0 24 24',
                                fill: 'currentColor'
                            },
                                react.createElement('path', {
                                    d: 'M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z'
                                })
                            ),
                            'GitHub'
                        ),
                        react.createElement('span', { className: 'ivlyrics-marketplace-dev-addon-count' },
                            I18n.t('marketplace.addonCount', { count: addons.length }) || `${addons.length} addon(s)`
                        )
                    )
                ),
                react.createElement('h3', { className: 'ivlyrics-marketplace-dev-section-title' },
                    I18n.t('marketplace.developerAddons') || 'Addons'
                ),
                react.createElement('div', { className: 'ivlyrics-marketplace-grid' },
                    addons.map(addon =>
                        react.createElement(AddonCard, {
                            key: addon.id,
                            addon,
                            onClick: onAddonClick
                        })
                    )
                )
            )
        );
    });

    // ============================================
    // Main MarketplacePage Component
    // ============================================

    const MarketplacePageComponent = react.memo(({ onClose }) => {
        const [addons, setAddons] = useState([]);
        const [installedAddons, setInstalledAddons] = useState([]);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState(null);
        const [view, setView] = useState('browse');
        const [filter, setFilter] = useState(FILTER_ALL);
        const [searchQuery, setSearchQuery] = useState('');
        const [selectedAddon, setSelectedAddon] = useState(null);
        const [selectedAuthor, setSelectedAuthor] = useState(null);
        const [disclaimerAddon, setDisclaimerAddon] = useState(null);
        const [showDirectUrlModal, setShowDirectUrlModal] = useState(false);
        const [uninstallTarget, setUninstallTarget] = useState(null);
        const [uninstallingId, setUninstallingId] = useState(null);
        const searchInputRef = useRef(null);

        const refreshInstalledAddons = useCallback(() => {
            const installed = window.MarketplaceManager?.getInstalledAddons?.() || [];
            installed.sort((a, b) => String(b.installedAt || '').localeCompare(String(a.installedAt || '')));
            setInstalledAddons(installed);
        }, []);

        const loadAddons = useCallback(async (forceRefresh = false) => {
            setLoading(true);
            setError(null);
            try {
                const data = await window.MarketplaceManager.fetchAddonList(forceRefresh);
                setAddons(data.addons || []);
            } catch (loadError) {
                setError(loadError.message);
                setAddons([]);
            } finally {
                setLoading(false);
            }
        }, []);

        useEffect(() => {
            refreshInstalledAddons();
            loadAddons();

            const handleChange = () => {
                refreshInstalledAddons();
                loadAddons(true);
            };
            const handleInstallError = () => refreshInstalledAddons();
            const unsubscribers = [
                window.MarketplaceManager?.on('addon:installed', handleChange),
                window.MarketplaceManager?.on('addon:uninstalled', handleChange),
                window.MarketplaceManager?.on('addon:updated', handleChange),
                window.MarketplaceManager?.on('addon:install-error', handleInstallError)
            ];

            return () => unsubscribers.forEach(unsubscribe => {
                if (typeof unsubscribe === 'function') unsubscribe();
            });
        }, [loadAddons, refreshInstalledAddons]);

        const addonSearchTextById = useMemo(() => {
            return new Map(addons.map((addon) => {
                const descriptionText = typeof addon.description === 'string'
                    ? addon.description
                    : typeof addon.description === 'object' && addon.description
                        ? Object.values(addon.description).join(' ')
                        : '';
                return [addon.id, `${addon.name || ''} ${addon.author || ''} ${descriptionText}`.toLowerCase()];
            }));
        }, [addons]);

        const filteredAddons = useMemo(() => {
            let result = addons;
            if (filter !== FILTER_ALL) result = result.filter(addon => addon.type === filter);
            if (searchQuery.trim()) {
                const query = searchQuery.trim().toLowerCase();
                result = result.filter(addon => addonSearchTextById.get(addon.id)?.includes(query));
            }
            return result;
        }, [addonSearchTextById, addons, filter, searchQuery]);

        const filteredInstalledAddons = useMemo(() => {
            let result = installedAddons;
            if (filter !== FILTER_ALL) result = result.filter(addon => addon.type === filter);
            if (searchQuery.trim()) {
                const query = searchQuery.trim().toLowerCase();
                result = result.filter(addon =>
                    `${addon.name || ''} ${addon.author || ''} ${addon.runtimeId || ''} ${addon.downloadUrl || ''}`
                        .toLowerCase()
                        .includes(query)
                );
            }
            return result;
        }, [filter, installedAddons, searchQuery]);

        const marketplaceAddonsById = useMemo(() => new Map(addons.map(addon => [addon.id, addon])), [addons]);
        const marketplaceStateKnown = !loading && !error;
        const authorAddons = useMemo(() => {
            if (!selectedAuthor) return [];
            return addons.filter(addon => addon.authorLogin === selectedAuthor);
        }, [addons, selectedAuthor]);

        const handleAuthorClick = useCallback((authorLogin) => {
            setSelectedAuthor(authorLogin);
            setSelectedAddon(null);
        }, []);

        const handleViewChange = useCallback((nextView) => {
            setView(nextView);
            setSearchQuery('');
            setFilter(FILTER_ALL);
            setSelectedAddon(null);
            setSelectedAuthor(null);
        }, []);

        const doInstall = useCallback(async (addon) => {
            try {
                await window.MarketplaceManager.installAddon(addon);
                Toast.success(I18n.t('marketplace.installSuccess', { name: addon.name }));
            } catch {
                Toast.error(I18n.t('marketplace.installError'));
            }
        }, []);

        const handleInstall = useCallback((addon) => {
            const dismissed = localStorage.getItem(DISCLAIMER_STORAGE_KEY) === '1';
            if (dismissed) doInstall(addon);
            else setDisclaimerAddon(addon);
        }, [doInstall]);

        const handleDisclaimerConfirm = useCallback(() => {
            const addon = disclaimerAddon;
            setDisclaimerAddon(null);
            if (addon) doInstall(addon);
        }, [disclaimerAddon, doInstall]);

        const handleDirectUrlInstall = useCallback(async (url) => {
            const addon = await window.MarketplaceManager.installAddonFromUrl(url);
            Toast.success(I18n.t('marketplace.directInstallSuccess', { name: addon.name }));
            refreshInstalledAddons();
            setShowDirectUrlModal(false);
            handleViewChange('installed');
        }, [handleViewChange, refreshInstalledAddons]);

        const handleUninstall = useCallback(async (addonId) => {
            setUninstallingId(addonId);
            try {
                const addon = window.MarketplaceManager.getInstalledAddon(addonId);
                await window.MarketplaceManager.uninstallAddon(addonId);
                refreshInstalledAddons();
                Toast.success(I18n.t('marketplace.uninstallSuccess', { name: addon?.name || addonId }));
            } catch {
                Toast.error(I18n.t('marketplace.uninstallError'));
                throw new Error('uninstall-failed');
            } finally {
                setUninstallingId(null);
            }
        }, [refreshInstalledAddons]);

        const confirmInstalledUninstall = useCallback(async () => {
            const target = uninstallTarget;
            setUninstallTarget(null);
            if (!target) return;
            try { await handleUninstall(target.id); } catch {}
        }, [handleUninstall, uninstallTarget]);

        const handleUpdate = useCallback(async (addon) => {
            try {
                await window.MarketplaceManager.updateAddon(addon);
                Toast.success(I18n.t('marketplace.installSuccess', { name: addon.name }));
            } catch {
                Toast.error(I18n.t('marketplace.installError'));
            }
        }, []);

        const renderBrowseContent = () => {
            if (loading) {
                return react.createElement('div', { className: 'ivlyrics-marketplace-loading' },
                    react.createElement('div', { className: 'ivlyrics-marketplace-spinner' }),
                    react.createElement('span', null, I18n.t('marketplace.loading'))
                );
            }
            if (error) {
                return react.createElement('div', { className: 'ivlyrics-marketplace-error' },
                    react.createElement('p', null, I18n.t('marketplace.loadError')),
                    react.createElement('p', { className: 'ivlyrics-marketplace-error-detail' }, error),
                    react.createElement('button', {
                        className: 'ivlyrics-marketplace-btn ivlyrics-marketplace-btn-install',
                        onClick: () => loadAddons(true)
                    }, I18n.t('marketplace.retry'))
                );
            }
            if (filteredAddons.length === 0) {
                return react.createElement('div', { className: 'ivlyrics-marketplace-empty' },
                    react.createElement('p', null, I18n.t('marketplace.noAddons'))
                );
            }
            return react.createElement('div', { className: 'ivlyrics-marketplace-grid' },
                filteredAddons.map(addon => react.createElement(AddonCard, {
                    key: addon.id,
                    addon,
                    onClick: setSelectedAddon,
                    onAuthorClick: handleAuthorClick
                }))
            );
        };

        const renderInstalledContent = () => {
            if (installedAddons.length === 0) {
                return react.createElement('div', { className: 'ivlyrics-marketplace-installed-empty' },
                    react.createElement('div', { className: 'ivlyrics-marketplace-installed-empty-icon' },
                        react.createElement('svg', {
                            width: 32, height: 32, viewBox: '0 0 24 24',
                            fill: 'none', stroke: 'currentColor', strokeWidth: 1.7
                        },
                            react.createElement('path', { d: 'M12 3v12M7 10l5 5 5-5' }),
                            react.createElement('path', { d: 'M5 21h14' })
                        )
                    ),
                    react.createElement('p', null, I18n.t('marketplace.installedEmpty')),
                    react.createElement('button', {
                        className: 'ivlyrics-marketplace-direct-add-btn',
                        onClick: () => setShowDirectUrlModal(true)
                    }, I18n.t('marketplace.addFromUrl'))
                );
            }
            if (filteredInstalledAddons.length === 0) {
                return react.createElement('div', { className: 'ivlyrics-marketplace-empty' },
                    react.createElement('p', null, I18n.t('marketplace.noAddons'))
                );
            }
            return react.createElement('div', { className: 'ivlyrics-marketplace-installed-list' },
                filteredInstalledAddons.map(addon => react.createElement(InstalledAddonCard, {
                    key: addon.id,
                    addon,
                    marketplaceAddon: marketplaceAddonsById.get(addon.id),
                    marketplaceStateKnown,
                    removing: uninstallingId === addon.id,
                    onRemove: setUninstallTarget
                }))
            );
        };

        const renderMarketplaceBrowseHeader = () => (
                    react.createElement('div', { className: 'ivlyrics-marketplace-header' },
                        react.createElement('div', { className: 'ivlyrics-marketplace-header-left' },
                            react.createElement('button', {
                                className: 'ivlyrics-marketplace-back-btn',
                                onClick: onClose,
                                'aria-label': I18n.t('marketplace.backToLyrics')
                            },
                                react.createElement('svg', {
                                    width: 20, height: 20, viewBox: '0 0 24 24',
                                    fill: 'none', stroke: 'currentColor', strokeWidth: 2
                                }, react.createElement('path', { d: 'M19 12H5m0 0l7 7m-7-7l7-7' }))
                            ),
                            react.createElement('h1', { className: 'ivlyrics-marketplace-title' }, I18n.t('marketplace.title'))
                        ),
                        react.createElement('div', { className: 'ivlyrics-marketplace-header-actions' },
                            react.createElement('button', {
                                className: 'ivlyrics-marketplace-direct-add-btn',
                                onClick: () => setShowDirectUrlModal(true)
                            },
                                react.createElement('svg', {
                                    width: 16, height: 16, viewBox: '0 0 24 24',
                                    fill: 'none', stroke: 'currentColor', strokeWidth: 2
                                }, react.createElement('path', { d: 'M12 5v14M5 12h14' })),
                                react.createElement('span', null, I18n.t('marketplace.addFromUrl'))
                            ),
                            react.createElement('div', { className: 'ivlyrics-marketplace-search-wrapper' },
                                react.createElement('svg', {
                                    className: 'ivlyrics-marketplace-search-icon',
                                    width: 16, height: 16, viewBox: '0 0 24 24',
                                    fill: 'none', stroke: 'currentColor', strokeWidth: 2
                                },
                                    react.createElement('circle', { cx: 11, cy: 11, r: 8 }),
                                    react.createElement('path', { d: 'M21 21l-4.35-4.35' })
                                ),
                                react.createElement('input', {
                                    ref: searchInputRef,
                                    className: 'ivlyrics-marketplace-search-input',
                                    type: 'text',
                                    placeholder: I18n.t(view === 'installed' ? 'marketplace.searchInstalled' : 'marketplace.search'),
                                    value: searchQuery,
                                    onChange: event => setSearchQuery(event.target.value)
                                })
                            )
                        )
                    )
        );

        const renderMarketplacePrimaryTabs = () => (
                    react.createElement('div', {
                        className: 'ivlyrics-marketplace-primary-tabs',
                        role: 'tablist',
                        'aria-label': I18n.t('marketplace.title')
                    },
                        [
                            { key: 'browse', label: I18n.t('marketplace.browseTab') },
                            { key: 'installed', label: I18n.t('marketplace.installedTab'), count: installedAddons.length }
                        ].map(tab => react.createElement('button', {
                            key: tab.key,
                            role: 'tab',
                            'aria-selected': view === tab.key,
                            className: `ivlyrics-marketplace-primary-tab ${view === tab.key ? 'active' : ''}`,
                            onClick: () => handleViewChange(tab.key)
                        },
                            react.createElement('span', null, tab.label),
                            typeof tab.count === 'number' && react.createElement('span', {
                                className: 'ivlyrics-marketplace-primary-tab-count'
                            }, tab.count)
                        ))
                    )
        );

        const renderMarketplaceFilterTabs = () => (
                    react.createElement('div', { className: 'ivlyrics-marketplace-filter-tabs' },
                        [
                            { key: FILTER_ALL, label: I18n.t('marketplace.filterAll') },
                            { key: FILTER_LYRICS, label: I18n.t('marketplace.filterLyrics') },
                            { key: FILTER_AI, label: I18n.t('marketplace.filterAI') },
                            { key: FILTER_STYLE, label: getAddonTypeLabel(FILTER_STYLE) }
                        ].map(tab => react.createElement('button', {
                            key: tab.key,
                            className: `ivlyrics-marketplace-filter-tab ${filter === tab.key ? 'active' : ''}`,
                            onClick: () => setFilter(tab.key)
                        }, tab.label))
                    )
        );

        const renderMarketplaceBrowseLayout = () => react.createElement('div', { className: 'ivlyrics-marketplace-container' },
                react.createElement('div', { className: 'ivlyrics-marketplace-top' },
                    renderMarketplaceBrowseHeader(),
                    renderMarketplacePrimaryTabs(),
                    renderMarketplaceFilterTabs()
                ),
                react.createElement('div', { className: 'ivlyrics-marketplace-notice' },
                    react.createElement('svg', {
                        width: 16, height: 16, viewBox: '0 0 24 24',
                        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
                        className: 'ivlyrics-marketplace-notice-icon'
                    },
                        react.createElement('circle', { cx: 12, cy: 12, r: 10 }),
                        react.createElement('line', { x1: 12, y1: 16, x2: 12, y2: 12 }),
                        react.createElement('line', { x1: 12, y1: 8, x2: 12.01, y2: 8 })
                    ),
                    react.createElement('span', null, I18n.t(view === 'installed'
                        ? 'marketplace.installedNotice'
                        : 'marketplace.disclaimerNotice'))
                ),
                react.createElement('div', {
                    className: 'ivlyrics-marketplace-content',
                    role: 'tabpanel'
                }, view === 'installed' ? renderInstalledContent() : renderBrowseContent())
            );

        const renderPageContent = () => {
            if (selectedAddon) {
                const updatedAddon = addons.find(addon => addon.id === selectedAddon.id) || selectedAddon;
                return react.createElement(AddonDetail, {
                    addon: updatedAddon,
                    allAddons: addons,
                    onBack: () => setSelectedAddon(null),
                    onInstall: handleInstall,
                    onUninstall: handleUninstall,
                    onUpdate: handleUpdate,
                    onAuthorClick: handleAuthorClick,
                    onAddonClick: setSelectedAddon
                });
            }
            if (selectedAuthor) {
                return react.createElement(DeveloperProfile, {
                    authorLogin: selectedAuthor,
                    addons: authorAddons,
                    onBack: () => setSelectedAuthor(null),
                    onAddonClick: setSelectedAddon
                });
            }
            return renderMarketplaceBrowseLayout();
        };
        const pageContent = renderPageContent();

        return react.createElement('div', { className: 'ivlyrics-marketplace-root' },
            pageContent,
            disclaimerAddon && react.createElement(DisclaimerModal, {
                onConfirm: handleDisclaimerConfirm,
                onCancel: () => setDisclaimerAddon(null)
            }),
            showDirectUrlModal && react.createElement(DirectUrlInstallModal, {
                onInstall: handleDirectUrlInstall,
                onCancel: () => setShowDirectUrlModal(false)
            }),
            uninstallTarget && react.createElement(ConfirmModal, {
                message: I18n.t('marketplace.uninstallConfirm', { name: uninstallTarget.name || uninstallTarget.id }),
                onConfirm: confirmInstalledUninstall,
                onCancel: () => setUninstallTarget(null)
            })
        );
    });

    return MarketplacePageComponent;
})();
