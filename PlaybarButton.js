(function PlaybarButton() {
	if (!Spicetify.Platform.History) {
		setTimeout(PlaybarButton, 300);
		return;
	}

	// 디버깅을 위한 Spicetify.Playbar API 확인
	window.__ivLyricsDebugLog?.("[ivLyrics] Spicetify.Playbar available:", !!Spicetify.Playbar);
	window.__ivLyricsDebugLog?.("[ivLyrics] Spicetify.Playbar.Button available:", !!Spicetify.Playbar?.Button);
	window.__ivLyricsDebugLog?.("[ivLyrics] Spicetify.Playbar.Widget available:", !!Spicetify.Playbar?.Widget);

	// ===== 가사 버튼 교체 (기존 기능) =====
	let button = null;
	let buttonRegistrationFailed = false;

	// Spicetify.Playbar.Button 또는 Widget API 사용 시도
	const PlaybarButtonClass = Spicetify.Playbar?.Button || Spicetify.Playbar?.Widget;
	const playbarLabel = window.I18n?.t("playbarButton.label") || "Lyrics Plus";
	const fullscreenLabel = window.I18n?.t("menu.fullscreen") || "Fullscreen";

	if (PlaybarButtonClass) {
		try {
			button = new PlaybarButtonClass(
				playbarLabel,
				`<svg role="img" height="16" width="16" aria-hidden="true" viewBox="0 0 16 16" data-encore-id="icon" fill="currentColor"><path d="M13.426 2.574a2.831 2.831 0 0 0-4.797 1.55l3.247 3.247a2.831 2.831 0 0 0 1.55-4.797zM10.5 8.118l-2.619-2.62A63303.13 63303.13 0 0 0 4.74 9.075L2.065 12.12a1.287 1.287 0 0 0 1.816 1.816l3.06-2.688 3.56-3.129zM7.12 4.094a4.331 4.331 0 1 1 4.786 4.786l-3.974 3.493-3.06 2.689a2.787 2.787 0 0 1-3.933-3.933l2.676-3.045 3.505-3.99z"></path></svg>`,
				() =>
					Spicetify.Platform.History.location.pathname !== "/ivLyrics"
						? Spicetify.Platform.History.push("/ivLyrics")
						: Spicetify.Platform.History.goBack(),
				false,
				Spicetify.Platform.History.location.pathname === "/ivLyrics",
				false
			);
			window.__ivLyricsDebugLog?.("[ivLyrics] Playbar.Button created successfully:", button);
		} catch (e) {
			console.warn("[ivLyrics] Failed to create Playbar.Button:", e);
			buttonRegistrationFailed = true;
		}
	} else {
		console.warn("[ivLyrics] Spicetify.Playbar.Button API not available");
		buttonRegistrationFailed = true;
	}

	const style = document.createElement("style");
	style.innerHTML = `
		/* Spotify 기본 가사 버튼만 숨김 (data-testid로 명확하게 지정) */
		button[data-testid="lyrics-button"] {
			display: none !important;
		}
		li[data-id="/ivLyrics"] {
			display: none;
		}
	`;
	style.classList.add("ivLyrics:visual:playbar-button");

	if (Spicetify.LocalStorage.get("ivLyrics:visual:playbar-button") === "true") setPlaybarButton();
	window.addEventListener("ivLyrics", (event) => {
		if (event.detail?.name === "playbar-button") event.detail.value ? setPlaybarButton() : removePlaybarButton();
	});

	if (button) {
		Spicetify.Platform.History.listen((location) => {
			button.active = location.pathname === "/ivLyrics";
		});
	}

	function verifyPlaybarButtonRegistration(selector, successMessage, failureMessage, callback, retries = 5) {
		// 버튼이 실제로 DOM에 추가되었는지 확인
		setTimeout(() => {
			const registeredButton = document.querySelector(selector);
			if (registeredButton) {
				window.__ivLyricsDebugLog?.(successMessage);
				callback(true);
			} else if (retries > 0) {
				verifyPlaybarButtonRegistration(selector, successMessage, failureMessage, callback, retries - 1);
			} else {
				console.warn(failureMessage);
				callback(false);
			}
		}, 200);
	}

	function verifyButtonRegistration(callback, retries = 5) {
		verifyPlaybarButtonRegistration(
			'.main-nowPlayingBar-extraControls button svg path[d*="M13.426 2.574"]',
			"[ivLyrics] Playbar button successfully registered",
			"[ivLyrics] Playbar button registration verification failed",
			callback,
			retries
		);
	}

	function setPlaybarButton() {
		if (buttonRegistrationFailed || !button) {
			console.warn("[ivLyrics] Cannot set playbar button - registration failed");
			return;
		}

		try {
			button.register();
			// 버튼이 성공적으로 등록되었는지 확인 후 CSS 적용
			verifyButtonRegistration((success) => {
				if (success) {
					document.head.appendChild(style);
				} else {
					// 버튼 등록 실패 시 deregister하고 로그 출력
					try {
						button.deregister();
					} catch (e) { /* ignore */ }
					console.warn("[ivLyrics] Playbar button not visible, keeping original lyrics button");
				}
			});
		} catch (e) {
			console.warn("[ivLyrics] Failed to register playbar button:", e);
		}
	}

	function removePlaybarButton() {
		style.remove();
		if (button) {
			try {
				button.deregister();
			} catch (e) { /* ignore */ }
		}
	}

	// ===== 전체화면 버튼 교체 (새 기능) =====
	let fullscreenButton = null;
	let fullscreenButtonRegistrationFailed = false;

	if (PlaybarButtonClass) {
		try {
			// 마지막 파라미터(right)를 true로 설정하여 기존 전체화면 버튼 위치(제일 오른쪽)에 배치
			fullscreenButton = new PlaybarButtonClass(
				fullscreenLabel,
				`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M0.25 3C0.25 2.0335 1.0335 1.25 2 1.25H5.375V2.75H2C1.86193 2.75 1.75 2.86193 1.75 3V5.42857H0.25V3ZM14 2.75H10.625V1.25H14C14.9665 1.25 15.75 2.0335 15.75 3V5.42857H14.25V3C14.25 2.86193 14.1381 2.75 14 2.75ZM1.75 10.5714V13C1.75 13.1381 1.86193 13.25 2 13.25H5.375V14.75H2C1.0335 14.75 0.25 13.9665 0.25 13V10.5714H1.75ZM14.25 13V10.5714H15.75V13C15.75 13.9665 14.9665 14.75 14 14.75H10.625V13.25H14C14.1381 13.25 14.25 13.1381 14.25 13Z" fill="currentColor"></path></svg>`,
				() => {
					// 전체화면 토글 이벤트 발송
					window.dispatchEvent(new CustomEvent("ivLyrics", {
						detail: { type: "fullscreen-toggle" }
					}));
				},
				false,
				false,
				true  // right=true: 오른쪽 그룹에 배치
			);
			window.__ivLyricsDebugLog?.("[ivLyrics] Fullscreen Playbar.Button created successfully:", fullscreenButton);
		} catch (e) {
			console.warn("[ivLyrics] Failed to create fullscreen Playbar.Button:", e);
			fullscreenButtonRegistrationFailed = true;
		}
	} else {
		console.warn("[ivLyrics] Spicetify.Playbar.Button API not available for fullscreen button");
		fullscreenButtonRegistrationFailed = true;
	}

	const fullscreenStyle = document.createElement("style");
	fullscreenStyle.innerHTML = `
		/* 기존 Spotify 전체화면 버튼 숨기기 */
		button[data-testid="fullscreen-mode-button"] {
			display: none !important;
		}
		/* ivLyrics 전체화면 버튼을 제일 오른쪽에 배치 (flexbox order 사용) */
		.main-nowPlayingBar-extraControls {
			display: flex !important;
		}
		.main-nowPlayingBar-extraControls > .ivlyrics-fullscreen-btn {
			order: 9999 !important;
		}
	`;
	fullscreenStyle.classList.add("ivLyrics:visual:fullscreen-button");

	if (Spicetify.LocalStorage.get("ivLyrics:visual:fullscreen-button") === "true") setFullscreenButton();
	window.addEventListener("ivLyrics", (event) => {
		if (event.detail?.name === "fullscreen-button") event.detail.value ? setFullscreenButton() : removeFullscreenButton();
	});

	function verifyFullscreenButtonRegistration(callback, retries = 5) {
		verifyPlaybarButtonRegistration(
			'.main-nowPlayingBar-extraControls button svg path[d*="M0.25 3C0.25"]',
			"[ivLyrics] Fullscreen button successfully registered",
			"[ivLyrics] Fullscreen button registration verification failed",
			callback,
			retries
		);
	}

	function setFullscreenButton() {
		if (fullscreenButtonRegistrationFailed || !fullscreenButton) {
			console.warn("[ivLyrics] Cannot set fullscreen button - registration failed");
			return;
		}

		try {
			fullscreenButton.register();
			// 버튼이 성공적으로 등록되었는지 확인 후 CSS 적용
			verifyFullscreenButtonRegistration((success) => {
				if (success) {
					document.head.appendChild(fullscreenStyle);
					// 버튼에 고유 클래스 추가하여 CSS로 위치 조정 가능하게 함
					setTimeout(() => {
						// Spicetify.Playbar.Button의 내부 element 속성 사용 시도
						if (fullscreenButton.element) {
							fullscreenButton.element.classList.add('ivlyrics-fullscreen-btn');
						} else {
							// fallback: SVG 내용으로 버튼 찾기
							const btns = document.querySelectorAll('.main-nowPlayingBar-extraControls button');
							for (const btn of btns) {
								// 전체화면 SVG의 특징적인 path를 찾음 (d 속성에 "M0.25 3C0.25" 포함)
								const path = btn.querySelector('svg path');
								if (path && path.getAttribute('d')?.includes('M0.25 3C0.25')) {
									btn.classList.add('ivlyrics-fullscreen-btn');
									break;
								}
							}
						}
					}, 100);
				} else {
					// 버튼 등록 실패 시 deregister하고 로그 출력
					try {
						fullscreenButton.deregister();
					} catch (e) { /* ignore */ }
					console.warn("[ivLyrics] Fullscreen button not visible, keeping original fullscreen button");
				}
			});
		} catch (e) {
			console.warn("[ivLyrics] Failed to register fullscreen button:", e);
		}
	}

	function removeFullscreenButton() {
		fullscreenStyle.remove();
		if (fullscreenButton) {
			try {
				fullscreenButton.deregister();
			} catch (e) { /* ignore */ }
		}
	}
})();
