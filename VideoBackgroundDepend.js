(function youtubeAdBlockerEntry() {
    const MODULE_KEY = "__ivLyricsVideoBackgroundDepend";
    const moduleState = window[MODULE_KEY] || (window[MODULE_KEY] = {
        initialized: false,
        waitTimer: null,
        playerPatchTimer: null,
        iframeObserver: null,
        restoreCallbacks: new Map()
    });

    if (moduleState.initialized) {
        return;
    }

    const registerRestore = (key, restore) => {
        if (!moduleState.restoreCallbacks.has(key)) {
            moduleState.restoreCallbacks.set(key, restore);
        }
    };

    const restoreAll = () => {
        if (moduleState.waitTimer) {
            clearTimeout(moduleState.waitTimer);
            moduleState.waitTimer = null;
        }
        if (moduleState.playerPatchTimer) {
            clearTimeout(moduleState.playerPatchTimer);
            moduleState.playerPatchTimer = null;
        }
        if (moduleState.iframeObserver) {
            moduleState.iframeObserver.disconnect();
            moduleState.iframeObserver = null;
        }

        [...moduleState.restoreCallbacks.values()].reverse().forEach((restore) => {
            try {
                restore();
            } catch (err) {
                // Ignore restore failures
            }
        });

        moduleState.restoreCallbacks.clear();
        moduleState.initialized = false;
        delete window[MODULE_KEY];
    };

    window.VideoBackgroundDepend = {
        restore: restoreAll
    };

    // Request muted playback through the iframe API so the server omits ad slots.
    // Parent-window request hooks cannot filter a cross-origin iframe response.
    const waitForSpicetify = () => {
        if (!window.Spicetify || !Spicetify.Player || !document.body) {
            if (!moduleState.waitTimer) {
                moduleState.waitTimer = setTimeout(() => {
                    moduleState.waitTimer = null;
                    waitForSpicetify();
                }, 250);
            }
            return;
        }
        moduleState.waitTimer = null;
        initialize();
    };

    const logPrefix = "[ivLyrics VBD]";

    const blockedPatterns = [
        /doubleclick\.net/i,
        /googlesyndication\.com/i,
        /googleads\.g\.doubleclick\.net/i,
        /pagead(?!.*youtube\.com\/iframe)/i,
        /pagead2\.googlesyndication\.com/i,
        /tpc\.googlesyndication\.com/i,
        /pubads\.g\.doubleclick\.net/i,
        /securepubads\.g\.doubleclick\.net/i,
        /gvt\d+\.com\/ads/i,
        /manifest\.googlevideo\.com\/api\/manifest\/ads/i,
        /googlevideo\.com\/videoplayback.*[&?](ctier|oad|adformat)=/i,
        /googlevideo\.com\/initplayback.*[&?](ctier|oad|adformat)=/i,
        /youtube\.com\/pagead/i,
        /youtube\.com\/ptracking/i,
        /youtube\.com\/api\/stats\/(ads|qoe|watchtime|playback)/i,
        /youtubei\/v1\/log_event/i,
        /youtubei\/v1\/player.*adformat/i,
        /youtube\.com\/get_video_info.*adformat/i,
        /youtube\.com\/yva_/i,
        /yt\d?\.ggpht\.com\/ad/i,
        /ytimg\.com\/.*ad/i,
        /yt3\.ggpht\.com\/ytc\/.*ad/i,
        /s0\.2mdn\.net/i,
        /gstaticadssl\.googleapis\.com/i
    ];
    const blockedUrlPattern = new RegExp(blockedPatterns.map((pattern) => pattern.source).join("|"), "i");

    const normalizeUrlString = (candidate) => {
        if (!candidate) return "";
        if (typeof candidate === "string") return candidate;
        if (candidate?.url) return candidate.url;
        if (candidate?.href) return candidate.href;
        return String(candidate);
    };

    const matchesAdUrl = (candidate) => {
        if (!candidate) return false;
        try {
            const ref = normalizeUrlString(candidate);
            if (!ref) return false;
            if (typeof ref === "string") return blockedUrlPattern.test(ref);
            return blockedPatterns.some((pattern) => pattern.test(ref));
        } catch (err) {
            return false;
        }
    };

    const blockRequest = (label, url) => {
        console.info(`${logPrefix} blocked ${label}: ${url}`);
    };

    const mergeFeatureFlags = (existing = "", forcedFlags = []) => {
        const map = new Map();
        const pushFlag = (flag) => {
            if (!flag) return;
            const [key, value = "true"] = flag.split("=");
            if (!key) return;
            map.set(key.trim(), value.trim());
        };
        existing.split("&").forEach(pushFlag);
        forcedFlags.forEach(pushFlag);
        return [...map.entries()].map(([key, value]) => `${key}=${value}`).join("&");
    };

    const patchFetch = () => {
        if (window.fetch.__ytAdBlockWrapped) return;
        const originalFetch = window.fetch;
        const wrappedFetch = function patchedFetch(resource, init) {
            const target = typeof resource === "string" ? resource : resource?.url;
            if (matchesAdUrl(target)) {
                blockRequest("fetch", target);
                return Promise.resolve(new Response(null, { status: 204, statusText: "No Content" }));
            }
            return originalFetch.call(this, resource, init);
        };
        wrappedFetch.__ytAdBlockWrapped = true;
        window.fetch = wrappedFetch;
        registerRestore("fetch", () => {
            if (window.fetch === wrappedFetch) {
                window.fetch = originalFetch;
            }
        });
    };

    const patchXHR = () => {
        if (XMLHttpRequest.prototype.__ytAdBlockWrapped) return;
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
            this.__ytAdBlockUrl = url;
            return originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function patchedSend(body) {
            if (matchesAdUrl(this.__ytAdBlockUrl)) {
                blockRequest("xhr", this.__ytAdBlockUrl);
                setTimeout(() => {
                    const errorEvent = new Event("error");
                    this.dispatchEvent(errorEvent);
                    if (typeof this.onerror === "function") {
                        this.onerror(errorEvent);
                    }
                }, 0);
                return undefined;
            }
            return originalSend.apply(this, arguments);
        };

        XMLHttpRequest.prototype.__ytAdBlockWrapped = true;
        registerRestore("xhr", () => {
            XMLHttpRequest.prototype.open = originalOpen;
            XMLHttpRequest.prototype.send = originalSend;
            delete XMLHttpRequest.prototype.__ytAdBlockWrapped;
        });
    };

    const patchSendBeacon = () => {
        if (!navigator.sendBeacon || navigator.sendBeacon.__ytAdBlockWrapped) return;
        const originalSendBeacon = navigator.sendBeacon.bind(navigator);
        const wrappedBeacon = (url, data) => {
            if (matchesAdUrl(url)) {
                blockRequest("beacon", url);
                return true;
            }
            return originalSendBeacon(url, data);
        };
        wrappedBeacon.__ytAdBlockWrapped = true;
        navigator.sendBeacon = wrappedBeacon;
        registerRestore("sendBeacon", () => {
            if (navigator.sendBeacon === wrappedBeacon) {
                navigator.sendBeacon = originalSendBeacon;
            }
        });
    };

    const patchScriptElements = () => {
        if (!window.HTMLScriptElement || HTMLScriptElement.prototype.__ytAdBlockWrapped) return;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
        const originalSetAttribute = HTMLScriptElement.prototype.setAttribute;
        if (descriptor?.set) {
            Object.defineProperty(HTMLScriptElement.prototype, "src", {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: descriptor.get,
                set(value) {
                    if (matchesAdUrl(value)) {
                        blockRequest("script", value);
                        descriptor.set.call(this, "");
                        return;
                    }
                    descriptor.set.call(this, value);
                }
            });
        }
        HTMLScriptElement.prototype.setAttribute = function patchedSetAttribute(name, value) {
            if (typeof name === "string" && name.toLowerCase() === "src" && matchesAdUrl(value)) {
                blockRequest("script", value);
                return undefined;
            }
            return originalSetAttribute.apply(this, arguments);
        };
        HTMLScriptElement.prototype.__ytAdBlockWrapped = true;
        registerRestore("script-elements", () => {
            if (descriptor) {
                Object.defineProperty(HTMLScriptElement.prototype, "src", descriptor);
            }
            HTMLScriptElement.prototype.setAttribute = originalSetAttribute;
            delete HTMLScriptElement.prototype.__ytAdBlockWrapped;
        });
    };

    const patchLinkElements = () => {
        if (!window.HTMLLinkElement || HTMLLinkElement.prototype.__ytAdBlockWrapped) return;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, "href");
        const originalSetAttribute = HTMLLinkElement.prototype.setAttribute;
        if (descriptor?.set) {
            Object.defineProperty(HTMLLinkElement.prototype, "href", {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: descriptor.get,
                set(value) {
                    if (matchesAdUrl(value)) {
                        blockRequest("link", value);
                        descriptor.set.call(this, "about:blank");
                        return;
                    }
                    descriptor.set.call(this, value);
                }
            });
        }
        HTMLLinkElement.prototype.setAttribute = function patchedSetAttribute(name, value) {
            if (typeof name === "string" && ["href", "data-href"].includes(name.toLowerCase()) && matchesAdUrl(value)) {
                blockRequest("link", value);
                return undefined;
            }
            return originalSetAttribute.apply(this, arguments);
        };
        HTMLLinkElement.prototype.__ytAdBlockWrapped = true;
        registerRestore("link-elements", () => {
            if (descriptor) {
                Object.defineProperty(HTMLLinkElement.prototype, "href", descriptor);
            }
            HTMLLinkElement.prototype.setAttribute = originalSetAttribute;
            delete HTMLLinkElement.prototype.__ytAdBlockWrapped;
        });
    };

    const patchDocumentCreateElement = () => {
        if (Document.prototype.__ytAdBlockWrappedCreateElement) return;
        const originalCreateElement = Document.prototype.createElement;
        Document.prototype.createElement = function patchedCreateElement(tagName, options) {
            const element = originalCreateElement.call(this, tagName, options);
            const upper = typeof tagName === "string" ? tagName.toUpperCase() : "";
            if (upper === "IFRAME") {
                setTimeout(() => sanitizeIframe(element), 0);
            }
            return element;
        };
        Document.prototype.__ytAdBlockWrappedCreateElement = true;
        registerRestore("document-create-element", () => {
            Document.prototype.createElement = originalCreateElement;
            delete Document.prototype.__ytAdBlockWrappedCreateElement;
        });
    };

    const patchServiceWorkers = () => {
        const scope = navigator.serviceWorker;
        if (!scope || scope.__ytAdBlockWrapped) return;
        const originalRegister = scope.register.bind(scope);
        scope.register = function patchedRegister(url, options) {
            if (matchesAdUrl(url)) {
                blockRequest("serviceworker", url);
                return Promise.reject(new DOMException("Blocked ad service worker", "SecurityError"));
            }
            return originalRegister(url, options);
        };
        scope.__ytAdBlockWrapped = true;
        registerRestore("service-workers", () => {
            scope.register = originalRegister;
            delete scope.__ytAdBlockWrapped;
        });
    };

    const patchWindowOpen = () => {
        if (!window.open || window.open.__ytAdBlockWrapped) return;
        const originalOpen = window.open;
        const wrappedOpen = function patchedOpen(url, target, features) {
            if (matchesAdUrl(url)) {
                blockRequest("window.open", url);
                return null;
            }
            return originalOpen.call(this, url, target, features);
        };
        wrappedOpen.__ytAdBlockWrapped = true;
        window.open = wrappedOpen;
        registerRestore("window-open", () => {
            if (window.open === wrappedOpen) {
                window.open = originalOpen;
            }
        });
    };

    const patchImageElements = () => {
        if (!window.HTMLImageElement || HTMLImageElement.prototype.__ytAdBlockWrapped) return;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
        const originalSetAttribute = HTMLImageElement.prototype.setAttribute;
        if (descriptor && descriptor.set) {
            Object.defineProperty(HTMLImageElement.prototype, "src", {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: descriptor.get,
                set(value) {
                    if (matchesAdUrl(value)) {
                        blockRequest("image", value);
                        descriptor.set.call(this, "");
                        return;
                    }
                    descriptor.set.call(this, value);
                }
            });
        }
        HTMLImageElement.prototype.setAttribute = function patchedSetAttribute(name, value) {
            if (typeof name === "string" && name.toLowerCase() === "src" && matchesAdUrl(value)) {
                blockRequest("image", value);
                return undefined;
            }
            return originalSetAttribute.apply(this, arguments);
        };
        HTMLImageElement.prototype.__ytAdBlockWrapped = true;
        registerRestore("image-elements", () => {
            if (descriptor) {
                Object.defineProperty(HTMLImageElement.prototype, "src", descriptor);
            }
            HTMLImageElement.prototype.setAttribute = originalSetAttribute;
            delete HTMLImageElement.prototype.__ytAdBlockWrapped;
        });
    };

    const patchIframeSetter = () => {
        if (!window.HTMLIFrameElement || HTMLIFrameElement.prototype.__ytAdBlockWrapped) return;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
        if (descriptor && descriptor.set) {
            Object.defineProperty(HTMLIFrameElement.prototype, "src", {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: descriptor.get,
                set(value) {
                    const sanitized = sanitizeYoutubeSrc(value);
                    if (sanitized && sanitized !== value) {
                        descriptor.set.call(this, sanitized);
                        return;
                    }
                    if (matchesAdUrl(value)) {
                        blockRequest("iframe", value);
                        descriptor.set.call(this, "about:blank");
                        return;
                    }
                    descriptor.set.call(this, value);
                }
            });
        }
        HTMLIFrameElement.prototype.__ytAdBlockWrapped = true;
        registerRestore("iframe-setter", () => {
            if (descriptor) {
                Object.defineProperty(HTMLIFrameElement.prototype, "src", descriptor);
            }
            delete HTMLIFrameElement.prototype.__ytAdBlockWrapped;
        });
    };

    const patchWebSocket = () => {
        if (!window.WebSocket || window.WebSocket.__ytAdBlockWrapped) return;
        const OriginalWebSocket = window.WebSocket;
        const createBlockedSocket = (url) => {
            blockRequest("websocket", url);
            const listeners = new Map();
            const socket = {
                readyState: OriginalWebSocket.CLOSED,
                bufferedAmount: 0,
                extensions: "",
                protocol: "",
                url: normalizeUrlString(url),
                binaryType: "blob",
                addEventListener(type, handler) {
                    if (!listeners.has(type)) listeners.set(type, new Set());
                    if (handler) listeners.get(type).add(handler);
                },
                removeEventListener(type, handler) {
                    listeners.get(type)?.delete(handler);
                },
                dispatchEvent(event) {
                    listeners.get(event.type)?.forEach((fn) => {
                        try {
                            fn.call(this, event);
                        } catch (err) {
                            console.error(err);
                        }
                    });
                    const handlerName = `on${event.type}`;
                    if (typeof this[handlerName] === "function") {
                        this[handlerName](event);
                    }
                    return true;
                },
                close() { },
                send() { }
            };
            setTimeout(() => {
                const errorEvent = new Event("error");
                socket.dispatchEvent(errorEvent);
            }, 0);
            return socket;
        };
        const PatchedWebSocket = function wrappedWebSocket(url, protocols) {
            if (matchesAdUrl(url)) {
                return createBlockedSocket(url);
            }
            return new OriginalWebSocket(url, protocols);
        };
        PatchedWebSocket.prototype = OriginalWebSocket.prototype;
        Object.setPrototypeOf(PatchedWebSocket, OriginalWebSocket);
        PatchedWebSocket.__ytAdBlockWrapped = true;
        window.WebSocket = PatchedWebSocket;
        registerRestore("websocket", () => {
            if (window.WebSocket === PatchedWebSocket) {
                window.WebSocket = OriginalWebSocket;
            }
        });
    };

    const patchEventSource = () => {
        if (!window.EventSource || window.EventSource.__ytAdBlockWrapped) return;
        const OriginalEventSource = window.EventSource;
        const PatchedEventSource = function wrappedEventSource(url, config) {
            if (matchesAdUrl(url)) {
                blockRequest("eventsource", url);
                const dummy = {
                    readyState: OriginalEventSource.CLOSED,
                    url: normalizeUrlString(url),
                    withCredentials: Boolean(config?.withCredentials),
                    close() { },
                    addEventListener() { },
                    removeEventListener() { }
                };
                setTimeout(() => {
                    const errorEvent = new Event("error");
                    dummy.onerror?.(errorEvent);
                }, 0);
                return dummy;
            }
            return new OriginalEventSource(url, config);
        };
        PatchedEventSource.prototype = OriginalEventSource.prototype;
        Object.setPrototypeOf(PatchedEventSource, OriginalEventSource);
        PatchedEventSource.__ytAdBlockWrapped = true;
        window.EventSource = PatchedEventSource;
        registerRestore("eventsource", () => {
            if (window.EventSource === PatchedEventSource) {
                window.EventSource = OriginalEventSource;
            }
        });
    };

    const patchWorkers = () => {
        const wrapConstructor = (Ctor, label) => {
            if (!Ctor || Ctor.__ytAdBlockWrapped) return;
            const Patched = function wrappedWorker(url, options) {
                if (matchesAdUrl(url)) {
                    blockRequest(label, url);
                    throw new DOMException("Blocked ad worker", "SecurityError");
                }
                return new Ctor(url, options);
            };
            Patched.prototype = Ctor.prototype;
            Object.setPrototypeOf(Patched, Ctor);
            Patched.__ytAdBlockWrapped = true;
            return Patched;
        };

        if (window.Worker) {
            const OriginalWorker = window.Worker;
            const patchedWorker = wrapConstructor(window.Worker, "worker");
            if (patchedWorker) {
                window.Worker = patchedWorker;
                registerRestore("worker", () => {
                    if (window.Worker === patchedWorker) {
                        window.Worker = OriginalWorker;
                    }
                });
            }
        }
        if (window.SharedWorker) {
            const OriginalSharedWorker = window.SharedWorker;
            const patchedSharedWorker = wrapConstructor(window.SharedWorker, "sharedworker");
            if (patchedSharedWorker) {
                window.SharedWorker = patchedSharedWorker;
                registerRestore("shared-worker", () => {
                    if (window.SharedWorker === patchedSharedWorker) {
                        window.SharedWorker = OriginalSharedWorker;
                    }
                });
            }
        }
    };

    const sanitizeYoutubeSrc = (src) => {
        if (!src || !/youtu(be\.com|\.be|be-nocookie\.com|be\.googleapis\.com)/i.test(src)) {
            return src;
        }
        try {
            const url = new URL(src, window.location.origin);
            if (/youtu\.be$/i.test(url.hostname)) {
                const videoIdFromPath = url.pathname.replace(/^\//, "");
                url.hostname = "www.youtube-nocookie.com";
                url.pathname = `/embed/${videoIdFromPath}`;
            } else if (/youtube\.com$/i.test(url.hostname) && url.pathname === "/watch") {
                const videoId = url.searchParams.get("v");
                if (videoId) {
                    url.pathname = `/embed/${videoId}`;
                }
            }
            url.hostname = "www.youtube-nocookie.com";
            url.searchParams.set("rel", "0");
            url.searchParams.set("iv_load_policy", "3");
            url.searchParams.set("modestbranding", "1");
            url.searchParams.set("playsinline", "1");
            url.searchParams.set("fs", "0");
            url.searchParams.set("disablekb", "1");
            url.searchParams.set("cc_load_policy", "0");
            url.searchParams.set("origin", window.location.origin);
            return url.toString();
        } catch (err) {
            return src;
        }
    };

    const sanitizeIframe = (iframe) => {
        if (!iframe || iframe.__ytAdBlockSanitized) return;
        const currentSrc = iframe.getAttribute("src");
        if (!currentSrc) return;
        if (!/youtu(be\.com|\.be|be-nocookie\.com|be\.googleapis\.com)/i.test(currentSrc)) return;
        const sanitizedSrc = sanitizeYoutubeSrc(currentSrc);
        if (sanitizedSrc && sanitizedSrc !== currentSrc) {
            iframe.setAttribute("src", sanitizedSrc);
        }
        iframe.setAttribute("referrerpolicy", "origin");
        iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
        iframe.__ytAdBlockSanitized = true;
    };

    const observeIframes = () => {
        if (moduleState.iframeObserver) {
            return;
        }

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes?.forEach((node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    if (node.tagName === "IFRAME") {
                        sanitizeIframe(node);
                    }
                    node.querySelectorAll?.("iframe").forEach(sanitizeIframe);
                });
                if (mutation.type === "attributes" && mutation.target.tagName === "IFRAME") {
                    sanitizeIframe(mutation.target);
                }
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src"]
        });
        document.querySelectorAll("iframe").forEach(sanitizeIframe);
        moduleState.iframeObserver = observer;
        registerRestore("iframe-observer", () => {
            if (moduleState.iframeObserver === observer) {
                observer.disconnect();
                moduleState.iframeObserver = null;
            }
        });
    };

    // The iframe API reports content time/duration even while an ad is playing.
    // Use forwarded ad events; seeking to getDuration() would skip the music video.
    const AD_STATE_CODES = new Set([105, 106, 107, 108, 109, 110, 111]);
    const ACTIVE_AD_STATES = new Set([1, 2, 3, 5]);
    const getPlayerControlState = (player) => {
        if (!player.__ytAdControlState) {
            player.__ytAdControlState = {
                adActive: false,
                adEventsInConfig: false,
                adCpn: null,
                mutedPlayback: false,
                mutedLoadOptions: null,
                mutedPlaybackIntent: null,
                cuePlayRequested: false,
                mutedLoadKind: "ById",
                pendingMutedSeek: null,
                requestedEndSeconds: 0,
                previewLimitTimers: new Set(),
                previewLimitGeneration: 0,
                previousMuted: null,
                hiddenIframe: null,
                previousOpacity: "",
                previousOpacityPriority: "",
                pendingSeek: null,
                restoreTimer: null,
                captionTimers: new Set(),
                wrappedMethods: new Map(),
                listeners: new Map(),
                disposed: false,
                cleanup: null,
            };
        }
        return player.__ytAdControlState;
    };

    const isAdPlayback = (player) => {
        if (!player) return false;
        if (player.__ytAdControlState?.adActive) return true;
        try {
            if (typeof player.getAdState === "function" && player.getAdState() === 1) return true;
            return AD_STATE_CODES.has(player.getPlayerState?.());
        } catch (err) {
            return false;
        }
    };
    window.VideoBackgroundDepend.isAdPlayback = isAdPlayback;

    const restoreIframeOpacity = (state) => {
        const iframe = state.hiddenIframe;
        if (!iframe) return;
        // Leave a newer owner's style alone.
        if (iframe.style.getPropertyValue("opacity") === "0" &&
            iframe.style.getPropertyPriority("opacity") === "important") {
            if (state.previousOpacity) {
                iframe.style.setProperty("opacity", state.previousOpacity, state.previousOpacityPriority);
            } else {
                iframe.style.removeProperty("opacity");
            }
        }
        state.hiddenIframe = null;
    };

    const restoreMutedState = (player, state) => {
        if (state.previousMuted === false) {
            try { player.unMute?.(); } catch (err) { }
        }
        state.previousMuted = null;
    };

    const suppressAdPlayback = (player) => {
        const state = getPlayerControlState(player);
        if (state.disposed) return;
        if (state.restoreTimer !== null) {
            clearTimeout(state.restoreTimer);
            state.restoreTimer = null;
        }
        if (state.previousMuted === null) {
            try { state.previousMuted = player.isMuted?.() ?? null; } catch (err) { }
        }
        try { player.mute?.(); } catch (err) { }
        const iframe = player.getIframe?.();
        if (iframe?.style && state.hiddenIframe !== iframe) {
            restoreIframeOpacity(state);
            state.hiddenIframe = iframe;
            state.previousOpacity = iframe.style.getPropertyValue("opacity");
            state.previousOpacityPriority = iframe.style.getPropertyPriority("opacity");
        }
        // Opacity leaves the embed running so unskippable ads can finish. The
        // background's existing artwork/gradient layer stays visible underneath.
        if (state.hiddenIframe) state.hiddenIframe.style.setProperty("opacity", "0", "important");
        // Only use a real skip API when supplied by the player. The public iframe
        // API has no such method, nor does its seekTo() address the ad timeline.
        try { player.skipAd?.(); } catch (err) { }
    };

    const restoreNormalPlayback = (player) => {
        const state = getPlayerControlState(player);
        if (state.disposed || isAdPlayback(player)) return;
        const pendingSeek = state.pendingSeek;
        state.pendingSeek = null;
        if (pendingSeek) {
            try { player.seekTo?.(...pendingSeek); } catch (err) { }
        }
        if (!state.hiddenIframe && state.previousMuted === null) return;
        if (state.restoreTimer !== null) return;
        state.restoreTimer = setTimeout(() => {
            state.restoreTimer = null;
            if (state.disposed || isAdPlayback(player)) return;
            restoreMutedState(player, state);
            restoreIframeOpacity(state);
        }, 250);
    };

    const handleAdEvent = (player, name, event) => {
        if (!player) return;
        const state = getPlayerControlState(player);
        if (state.disposed) return;
        if (name === "onAdStart" ||
            (name === "onAdStateChange" && ACTIVE_AD_STATES.has(event?.data))) {
            state.adActive = true;
            if (name === "onAdStart") state.adCpn = typeof event?.data === "string" ? event.data : null;
            suppressAdPlayback(player);
        } else if (name === "onAdEnd" || name === "onAdStateChange" && event?.data === -1) {
            if (name === "onAdEnd" && state.adCpn && typeof event?.data === "string" &&
                state.adCpn !== event.data) return;
            state.adActive = false;
            state.adCpn = null;
            restoreNormalPlayback(player);
        }
    };

    const mutedVideoArgs = (method, args) => {
        const value = args[0];
        const key = method.endsWith("ByUrl") ? "mediaContentUrl" : "videoId";
        if (!value || typeof value !== "string" && typeof value !== "object") return null;
        const options = typeof value === "string"
            ? { [key]: value, startSeconds: args[1], suggestedQuality: args[2] }
            : { ...value };
        if (!options[key]) return null;
        options.playmuted = true;
        return options;
    };

    const seekMutedVideo = (player, state, target) => {
        const time = Number(target);
        if (!state.mutedLoadOptions || !Number.isFinite(time) || time < 0) return false;
        const now = Date.now();
        const pending = state.pendingMutedSeek;
        if (pending && now - pending.requestedAt < 5000) {
            const expected = pending.target + (pending.playing ? (now - pending.requestedAt) / 1000 : 0);
            if (Math.abs(time - expected) < 0.75) return true;
        }
        // Muted-autoplay embeds ignore seekTo. A positioned muted load preserves
        // the ad-free response. Coalesce sync ticks while that load is buffering.
        const playing = state.mutedPlaybackIntent ?? ![2, 5].includes(player.getPlayerState?.());
        const method = (playing ? "loadVideo" : "cueVideo") + state.mutedLoadKind;
        if (typeof player[method] !== "function") return false;
        const options = { ...state.mutedLoadOptions, startSeconds: time, playmuted: true };
        player[method](options);
        state.pendingMutedSeek = { target: time, requestedAt: now, playing };
        return true;
    };

    const applyMutedPlaybackIntent = (player, playerState) => {
        if (!player) return;
        const state = getPlayerControlState(player);
        if (state.disposed || !state.mutedPlayback || isAdPlayback(player)) return;
        // A play/pause sent during an asynchronous positioned cue can be ignored.
        // Reapply it once the new cue has actually arrived, without another load.
        if (state.mutedPlaybackIntent === true && playerState === 5 && !state.cuePlayRequested) {
            state.cuePlayRequested = true;
            player.playVideo?.();
        } else if (state.mutedPlaybackIntent === false && playerState === 1) {
            player.pauseVideo?.();
        }
    };

    const clearMutedPreviewTimers = (state) => {
        state.previewLimitGeneration++;
        state.previewLimitTimers.forEach(clearTimeout);
        state.previewLimitTimers.clear();
    };

    const scheduleMutedPreviewLimitRemoval = (player) => {
        if (!player) return;
        const state = getPlayerControlState(player);
        clearMutedPreviewTimers(state);
        if (state.disposed || !state.mutedPlayback || state.requestedEndSeconds > 0 ||
            isAdPlayback(player) || player.getPlayerState?.() !== 1 || typeof player.removeCueRange !== "function") return;
        const generation = state.previewLimitGeneration;
        // The embed does not consistently forward cue metadata. After PLAYING,
        // its unnamed muted-preview stop cue exists; removing it leaves the video
        // stream and named chapter/user cues unchanged. Never seek or reload here.
        for (const delay of [100, 500]) {
            const timer = setTimeout(() => {
                state.previewLimitTimers.delete(timer);
                if (state.disposed || generation !== state.previewLimitGeneration || !state.mutedPlayback ||
                    state.requestedEndSeconds > 0 || isAdPlayback(player) || player.getPlayerState?.() !== 1) return;
                try { player.removeCueRange(""); } catch (err) { }
            }, delay);
            state.previewLimitTimers.add(timer);
        }
    };

    const removeMutedPreviewLimit = (player, event) => {
        if (!player) return;
        const state = getPlayerControlState(player);
        if (state.disposed || !state.mutedPlayback || state.requestedEndSeconds > 0 || isAdPlayback(player)) return;
        // Muted autoplay carries an unnamed end cue (usually at 30 seconds).
        // Remove only this open-ended stop cue, preserving chapters and user cues.
        for (const range of Array.isArray(event?.data) ? event.data : []) {
            if (range?.id === "" && Number.isFinite(range.start) && range.start >= 0 && range.end === 0x7ffffffffffff) {
                try { player.removeCueRange?.(range.id); } catch (err) { }
            }
        }
    };

    const attachAdSkipper = (player, adEventsInConfig = false) => {
        if (!player) return;
        const state = getPlayerControlState(player);
        if (state.disposed) return;
        state.adEventsInConfig ||= adEventsInConfig;
        // Methods arrive with initialDelivery, after YT.Player returns. Revisit
        // them onReady instead of marking an incomplete instance as fully wrapped.
        for (const method of ["seekTo", "loadVideoById", "cueVideoById", "loadVideoByUrl", "cueVideoByUrl", "loadPlaylist", "cuePlaylist", "playVideo", "pauseVideo"]) {
            const original = player[method];
            if (typeof original !== "function" || state.wrappedMethods.has(method)) continue;
            const wrapped = function (...args) {
                if (method === "playVideo" || method === "pauseVideo") {
                    state.mutedPlaybackIntent = method === "playVideo";
                    if (method === "pauseVideo") state.cuePlayRequested = false;
                    return original.apply(this, args);
                }
                if (method === "seekTo" && isAdPlayback(player)) {
                    state.pendingSeek = args;
                    return undefined;
                }
                if (method === "seekTo" && state.mutedPlayback && seekMutedVideo(player, state, args[0])) return undefined;
                if (method !== "seekTo") {
                    clearMutedPreviewTimers(state);
                    state.pendingMutedSeek = null;
                    state.adActive = false;
                    state.adCpn = null;
                    state.pendingSeek = null;
                    if (state.restoreTimer !== null) clearTimeout(state.restoreTimer);
                    state.restoreTimer = null;
                    restoreMutedState(player, state);
                    restoreIframeOpacity(state);
                    const options = method.endsWith("ById") || method.endsWith("ByUrl") ? mutedVideoArgs(method, args) : null;
                    state.mutedPlayback = Boolean(options);
                    state.mutedLoadOptions = options;
                    state.mutedPlaybackIntent = options ? method.startsWith("load") : null;
                    state.cuePlayRequested = false;
                    state.mutedLoadKind = method.endsWith("ByUrl") ? "ByUrl" : "ById";
                    state.requestedEndSeconds = Number(options?.endSeconds) || 0;
                    if (options) {
                        player.mute?.();
                        return original.call(this, options);
                    }
                }
                return original.apply(this, args);
            };
            state.wrappedMethods.set(method, { original, wrapped });
            player[method] = wrapped;
        }
        if (player.__ytAdSkipperAttached) return;
        player.__ytAdSkipperAttached = true;
        const listen = (name, callback) => {
            if (typeof player.addEventListener !== "function") return;
            player.addEventListener(name, callback);
            state.listeners.set(name, callback);
        };
        // Cover players constructed before our API patch (the iframe API ready
        // callback can create a background before our retry timer runs).
        if (!state.adEventsInConfig) {
            listen("onCueRangesAdded", event => removeMutedPreviewLimit(player, event));
            for (const name of ["onAdStart", "onAdEnd", "onAdStateChange"]) {
                listen(name, event => handleAdEvent(player, name, event));
            }
        }
        listen("onStateChange", event => {
            if (state.disposed) return;
            applyMutedPlaybackIntent(player, event?.data);
            scheduleMutedPreviewLimitRemoval(player);
            if (isAdPlayback(player)) suppressAdPlayback(player);
            else restoreNormalPlayback(player);
        });
        listen("onError", () => {
            state.adActive = false;
            state.adCpn = null;
            state.pendingSeek = null;
            restoreNormalPlayback(player);
        });
        const pollTimer = setInterval(() => {
            if (state.disposed) return;
            const iframe = player.getIframe?.();
            if (!iframe || !document.body.contains(iframe)) {
                state.cleanup();
                return;
            }
            attachAdSkipper(player);
            if (isAdPlayback(player)) suppressAdPlayback(player);
            else restoreNormalPlayback(player);
        }, 400);
        const originalDestroy = player.destroy;
        const cleanup = (destroying = false) => {
            if (state.disposed) return;
            state.disposed = true;
            clearInterval(pollTimer);
            if (state.restoreTimer !== null) clearTimeout(state.restoreTimer);
            clearMutedPreviewTimers(state);
            state.captionTimers.forEach(clearTimeout);
            state.captionTimers.clear();
            state.listeners.forEach((callback, name) => {
                try { player.removeEventListener?.(name, callback); } catch (err) { }
            });
            state.wrappedMethods.forEach(({ original, wrapped }, method) => {
                if (player[method] === wrapped) player[method] = original;
            });
            if (player.destroy === patchedDestroy) player.destroy = originalDestroy;
            if (!destroying) restoreMutedState(player, state);
            restoreIframeOpacity(state);
            state.adActive = false;
            state.pendingSeek = null;
            state.pendingMutedSeek = null;
            state.mutedLoadOptions = null;
            delete player.__ytAdSkipperAttached;
            moduleState.restoreCallbacks.delete(player);
        };
        function patchedDestroy(...args) {
            cleanup(true);
            return originalDestroy.apply(this, args);
        }
        state.cleanup = cleanup;
        if (typeof originalDestroy === "function") player.destroy = patchedDestroy;
        registerRestore(player, cleanup);
    };

    const disableYouTubeCaptions = (player) => {
        if (!player) return;

        try {
            if (typeof player.unloadModule === "function") {
                player.unloadModule("captions");
                player.unloadModule("cc");
            }
        } catch (e) { }

        try {
            if (typeof player.setOption === "function") {
                player.setOption("captions", "track", {});
                player.setOption("cc", "track", {});
            }
        } catch (e) { }
    };

    const scheduleCaptionDisable = (player) => {
        if (!player) return;
        const state = getPlayerControlState(player);
        if (state.disposed) return;
        disableYouTubeCaptions(player);
        [250, 1000, 2500].forEach((delay) => {
            const timer = setTimeout(() => {
                state.captionTimers.delete(timer);
                if (!state.disposed) disableYouTubeCaptions(player);
            }, delay);
            state.captionTimers.add(timer);
        });
    };

    const patchYouTubeApiReady = () => {
        const key = "onYouTubeIframeAPIReady";
        const descriptor = Object.getOwnPropertyDescriptor(window, key);
        if (descriptor && (!descriptor.configurable || !("value" in descriptor))) return;
        let callback = window[key];
        const wrap = original => function (...args) {
            if (moduleState.initialized) patchYouTubePlayer();
            if (typeof original === "function") return original.apply(this, args);
        };
        let handler = wrap(callback);
        const get = () => handler;
        const set = next => { callback = next; handler = wrap(next); };
        Object.defineProperty(window, key, { configurable: true, enumerable: descriptor?.enumerable ?? true, get, set });
        registerRestore("youtube-api-ready", () => {
            if (Object.getOwnPropertyDescriptor(window, key)?.get !== get) return;
            if (descriptor) Object.defineProperty(window, key, { ...descriptor, value: callback });
            else {
                delete window[key];
                if (callback !== undefined) window[key] = callback;
            }
        });
    };

    const patchYouTubePlayer = () => {
        if (window.YT?.Player?.__ytAdBlockWrapped) {
            if (moduleState.playerPatchTimer) clearTimeout(moduleState.playerPatchTimer);
            moduleState.playerPatchTimer = null;
            return;
        }
        if (!window.YT || !window.YT.Player) {
            if (!moduleState.playerPatchTimer) {
                moduleState.playerPatchTimer = setTimeout(() => {
                    moduleState.playerPatchTimer = null;
                    patchYouTubePlayer();
                }, 500);
            }
            return;
        }

        if (moduleState.playerPatchTimer) clearTimeout(moduleState.playerPatchTimer);
        moduleState.playerPatchTimer = null;
        const OriginalPlayer = window.YT.Player;
        const PatchedPlayer = function patchedPlayer(element, config = {}) {
            const mergedConfig = { ...config };
            mergedConfig.host = "https://www.youtube-nocookie.com";
            // Bootstrap an empty embed. The first real video request is made with
            // playmuted onReady, before an ordinary load can acquire pre-roll ads.
            const initialVideoId = config.videoId;
            const hasInitialVideo = typeof initialVideoId === "string" && initialVideoId.length > 0;
            if (hasInitialVideo) mergedConfig.videoId = "";
            const forcedPlayerVars = {
                rel: 0,
                iv_load_policy: 3,
                modestbranding: 1,
                playsinline: 1,
                disablekb: 1,
                fs: 0,
                origin: window.location.origin,
                enablecastapi: 0,
                cc_load_policy: 0,
                hl: navigator.language || "en",
                host_language: navigator.language || "en",
                adformat: "0_0",
                allowfullscreen: 0,
                disable_polymer: 1,
                suppress_ads: 1
            };
            mergedConfig.playerVars = {
                ...forcedPlayerVars,
                ...config.playerVars,
                cc_load_policy: 0,
                playmuted: 1,
                mute: 1
            };
            const forcedFeatureFlags = [
                "disable_persistent_ads=true",
                "kevlar_allow_multistep_video_ads=false",
                "enable_desktop_ad_controls=false",
                "html5_disable_ads=true",
                "disable_new_pause_state3_player_ads=true",
                "player_ads_enable_gcf=false",
                "web_player_disable_afa=true",
                "kevlar_miniplayer_play_pause_on_scrim=true",
                "preskip_button_style_ads_backend=false",
                "html5_player_enable_ads_client=false"
            ];
            mergedConfig.playerVars.fflags = mergeFeatureFlags(mergedConfig.playerVars.fflags, forcedFeatureFlags);
            mergedConfig.events = { ...config.events };
            for (const name of ["onAdStart", "onAdEnd", "onAdStateChange"]) {
                const original = mergedConfig.events[name];
                mergedConfig.events[name] = function (event) {
                    attachAdSkipper(event?.target, true);
                    handleAdEvent(event?.target, name, event);
                    if (typeof original === "function") return original.call(this, event);
                };
            }
            const originalOnCueRangesAdded = mergedConfig.events.onCueRangesAdded;
            mergedConfig.events.onCueRangesAdded = function (event) {
                removeMutedPreviewLimit(event?.target, event);
                if (typeof originalOnCueRangesAdded === "function") return originalOnCueRangesAdded.call(this, event);
            };
            let initialVideoLoaded = false;
            const originalOnReady = mergedConfig.events.onReady;
            mergedConfig.events.onReady = function (event) {
                attachAdSkipper(event?.target, true);
                scheduleCaptionDisable(event?.target);
                const player = event?.target;
                if (player && hasInitialVideo && !initialVideoLoaded && !getPlayerControlState(player).disposed) {
                    initialVideoLoaded = true;
                    const options = {
                        videoId: initialVideoId,
                        startSeconds: Number(config.playerVars?.start) || 0,
                        endSeconds: Number(config.playerVars?.end) || undefined,
                        playmuted: true,
                    };
                    const method = Number(config.playerVars?.autoplay) === 1 ? "loadVideoById" : "cueVideoById";
                    player[method]?.(options);
                }
                if (typeof originalOnReady === "function") {
                    originalOnReady.call(this, event);
                }
            };
            const originalOnStateChange = mergedConfig.events.onStateChange;
            mergedConfig.events.onStateChange = function (event) {
                const state = event?.data;
                if (state === window.YT?.PlayerState?.PLAYING || state === window.YT?.PlayerState?.CUED) {
                    disableYouTubeCaptions(event?.target);
                }
                attachAdSkipper(event?.target, true);
                applyMutedPlaybackIntent(event?.target, state);
                scheduleMutedPreviewLimitRemoval(event?.target);
                if (typeof originalOnStateChange === "function") {
                    return originalOnStateChange.call(this, event);
                }
                return undefined;
            };

            const instance = new OriginalPlayer(element, mergedConfig);
            attachAdSkipper(instance, true);
            scheduleCaptionDisable(instance);
            return instance;
        };

        PatchedPlayer.prototype = OriginalPlayer.prototype;
        Object.setPrototypeOf(PatchedPlayer, OriginalPlayer);
        PatchedPlayer.__ytAdBlockWrapped = true;
        window.YT.Player = PatchedPlayer;
        registerRestore("youtube-player", () => {
            if (window.YT?.Player === PatchedPlayer) {
                window.YT.Player = OriginalPlayer;
            }
        });
        document.querySelectorAll("iframe").forEach(iframe => {
            try {
                const url = new URL(iframe.getAttribute("src"), window.location.origin);
                if (!/(^|\.)youtube(?:-nocookie)?\.com$/.test(url.hostname)) return;
                attachAdSkipper(window.YT.get?.(iframe.id));
            } catch (err) { }
        });
    };

    const initialize = () => {
        if (moduleState.initialized) {
            return;
        }

        moduleState.initialized = true;
        patchFetch();
        patchXHR();
        patchSendBeacon();
        patchScriptElements();
        patchLinkElements();
        patchImageElements();
        patchIframeSetter();
        patchWebSocket();
        patchEventSource();
        patchWorkers();
        patchDocumentCreateElement();
        patchServiceWorkers();
        patchWindowOpen();
        observeIframes();
        patchYouTubeApiReady();
        patchYouTubePlayer();
        window.__ivLyricsDebugLog?.(`${logPrefix} initialized`);
    };

    waitForSpicetify();
})();
