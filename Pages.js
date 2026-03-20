function getCreatorProfileCopy() {
	return {
		title: I18n.t("creatorProfile.title") || "Sync Creator",
		anonymous: I18n.t("creatorProfile.anonymous") || "Anonymous",
		openProfile: I18n.t("creatorProfile.openProfile") || "Open creator profile",
		loading: I18n.t("creatorProfile.loading") || "Loading creator profile...",
		loadFailed: I18n.t("creatorProfile.loadFailed") || "Failed to load creator profile.",
		back: I18n.t("creatorProfile.back") || "Back",
		contributions: I18n.t("creatorProfile.contributions") || "Sync Contributions",
		tracks: I18n.t("creatorProfile.tracks") || "Synced tracks",
		likes: I18n.t("creatorProfile.likes") || "Likes",
		like: I18n.t("creatorProfile.like") || "Like",
		liked: I18n.t("creatorProfile.liked") || "Liked",
		likeActionFailed: I18n.t("creatorProfile.likeActionFailed") || "Failed to update creator like.",
		likeLoginRequired: I18n.t("creatorProfile.likeLoginRequired") || "Discord login is required to like creators.",
		ownProfile: I18n.t("creatorProfile.ownProfile") || "This is your profile.",
		loadMore: I18n.t("creatorProfile.loadMore") || "Load more",
		loadingMore: I18n.t("creatorProfile.loadingMore") || "Loading more...",
		noContributions: I18n.t("creatorProfile.noContributions") || "No sync contributions yet.",
		unknownTrack: I18n.t("creatorProfile.unknownTrack") || "Unknown Track",
		updated: I18n.t("creatorProfile.updated") || "Updated",
		topArtists: I18n.t("creatorProfile.topArtists") || "Top Artists",
		artistGroups: I18n.t("creatorProfile.artistGroups") || "Artist Groups",
		noArtistStats: I18n.t("creatorProfile.noArtistStats") || "No artist stats yet.",
		sortLabel: I18n.t("creatorProfile.sortLabel") || "Sort",
		sortRecent: I18n.t("creatorProfile.sortRecent") || "Recent",
		sortTitle: I18n.t("creatorProfile.sortTitle") || "Title",
		sortArtist: I18n.t("creatorProfile.sortArtist") || "Artist",
		clearArtistFilter: I18n.t("creatorProfile.clearArtistFilter") || "Clear artist filter",
		filteredArtist: I18n.t("creatorProfile.filteredArtist") || "Filtered artist"
	};
}

function mergeCreatorProfileContributions(currentItems, nextItems) {
	const merged = [];
	const seen = new Set();

	const appendUniqueItems = (items) => {
		if (!Array.isArray(items)) {
			return;
		}

		for (const item of items) {
			if (!item || typeof item !== "object") {
				continue;
			}

			const key = `${item.trackId || "unknown"}:${item.provider || "unknown"}`;
			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			merged.push(item);
		}
	};

	appendUniqueItems(currentItems);
	appendUniqueItems(nextItems);

	return merged;
}

function normalizeContributorEntry(contributor) {
	if (!contributor) {
		return null;
	}

	if (typeof contributor === "string") {
		const name = contributor.trim() || "Anonymous";
		return {
			key: `name:${name.toLowerCase()}`,
			userHash: null,
			name,
			avatarUrl: null,
			linked: false,
			profileAvailable: false
		};
	}

	if (typeof contributor !== "object") {
		return null;
	}

	const name = String(contributor.name || contributor.nickname || contributor.displayName || "Anonymous").trim() || "Anonymous";
	const userHash = typeof contributor.userHash === "string" && contributor.userHash.trim()
		? contributor.userHash.trim()
		: null;

	return {
		key: userHash || `name:${name.toLowerCase()}`,
		userHash,
		name,
		avatarUrl: typeof contributor.avatarUrl === "string" ? contributor.avatarUrl : null,
		linked: !!contributor.linked,
		profileAvailable: contributor.profileAvailable ?? !!userHash
	};
}

function getDisplayContributors(contributors, limit = 3) {
	if (!Array.isArray(contributors) || contributors.length === 0) {
		return [];
	}

	const result = [];
	const seen = new Set();
	let anonymousAdded = false;

	for (const rawContributor of contributors) {
		const contributor = normalizeContributorEntry(rawContributor);
		if (!contributor) {
			continue;
		}

		const isAnonymous = contributor.name.toLowerCase() === "anonymous" && !contributor.profileAvailable;
		if (isAnonymous) {
			if (anonymousAdded) {
				continue;
			}
			anonymousAdded = true;
			result.push(contributor);
		} else {
			const key = contributor.userHash || contributor.key;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			result.push(contributor);
		}

		if (limit > 0 && result.length >= limit) {
			break;
		}
	}

	return result;
}

function formatContributorTimestamp(epochSeconds) {
	if (!epochSeconds) {
		return null;
	}

	try {
		return new Date(epochSeconds * 1000).toLocaleDateString();
	} catch (error) {
		return null;
	}
}

function getCreatorProfileUiTheme() {
	try {
		return localStorage.getItem("ivLyrics:settings-ui-theme") === "light"
			? "light"
			: "dark";
	} catch (error) {
		return "dark";
	}
}

const CREATOR_PROFILE_PAGE_SIZE = 12;

function createCreatorProfileShell(contributor, options = {}) {
	const sort = typeof options.sort === "string" && options.sort.trim() ? options.sort.trim() : "recent";
	const artist = typeof options.artist === "string" && options.artist.trim() ? options.artist.trim() : null;
	const displayName = contributor?.name || "Anonymous";

	return {
		userHash: contributor?.userHash || null,
		displayName,
		account: contributor?.avatarUrl
			? {
				profileImage: contributor.avatarUrl,
				displayName
			}
			: null,
		stats: null,
		viewer: {
			authenticated: false,
			isOwnProfile: false,
			canLike: false,
			liked: false
		},
		artistStats: {
			items: []
		},
		filters: {
			sort,
			artist
		},
		contributions: [],
		pagination: {
			offset: 0,
			limit: CREATOR_PROFILE_PAGE_SIZE,
			returnedCount: 0,
			totalCount: 0,
			hasMore: false,
			nextOffset: null
		}
	};
}

const SyncCreatorProfileModal = react.memo(({
	contributor,
	profile,
	loading,
	error,
	likePending,
	loadMorePending,
	listRefreshing,
	onClose,
	onToggleLike,
	onLoadMore,
	onTrackClick,
	activeSortMode,
	activeArtistFilter,
	onSortChange,
	onArtistFilterChange
}) => {
	const copy = getCreatorProfileCopy();
	const uiTheme = getCreatorProfileUiTheme();
	const profileData = profile || {};
	const contributions = Array.isArray(profileData.contributions) ? profileData.contributions : [];
	const displayName = profileData.displayName || contributor?.name || copy.anonymous;
	const account = profileData.account || null;
	const handle = account?.username ? `@${account.username}` : null;
	const avatarUrl = account?.profileImage || contributor?.avatarUrl || null;
	const initial = (displayName || copy.anonymous).charAt(0).toUpperCase();
	const trackCount = Number(profileData.stats?.trackCount || 0);
	const likeCount = Number(profileData.stats?.likeCount || 0);
	const artistGroupCount = Number(profileData.stats?.artistGroupCount || 0);
	const totalContributionCount = Number(profileData.pagination?.totalCount || trackCount || 0);
	const loadedContributionCount = contributions.length;
	const hasMoreContributions = !!profileData.pagination?.hasMore;
	const bodyRef = react.useRef(null);
	const loadMoreLockRef = react.useRef(false);
	const canLike = !!profileData.viewer?.canLike;
	const liked = !!profileData.viewer?.liked;
	const isOwnProfile = !!profileData.viewer?.isOwnProfile;
	const subtitle = handle || (account?.displayName && account.displayName !== displayName ? account.displayName : null);
	const likeButtonLabel = likePending ? "..." : liked ? copy.liked : copy.like;
	const likeButtonTitle = !profileData.viewer?.authenticated && !isOwnProfile
		? copy.likeLoginRequired
		: copy.like;
	const artistStats = Array.isArray(profileData.artistStats?.items) ? profileData.artistStats.items : [];
	const sortMode = activeSortMode || profileData.filters?.sort || "recent";
	const artistFilter = activeArtistFilter ?? profileData.filters?.artist ?? null;
	const hasLoadedProfileData = !!profileData.stats;
	const showSectionLoading = loading && !error && !hasLoadedProfileData;
	const sortOptions = [
		{ key: "recent", label: copy.sortRecent },
		{ key: "title", label: copy.sortTitle },
		{ key: "artist", label: copy.sortArtist }
	];
	const closeIcon = react.createElement(
		"svg",
		{
			width: 16,
			height: 16,
			viewBox: "0 0 16 16",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.8,
			strokeLinecap: "round"
		},
		react.createElement("path", { d: "M3 3l10 10" }),
		react.createElement("path", { d: "M13 3L3 13" })
	);
	const likeIcon = react.createElement(
		"svg",
		{
			width: 14,
			height: 14,
			viewBox: "0 0 16 16",
			fill: liked ? "currentColor" : "none",
			stroke: "currentColor",
			strokeWidth: 1.5,
			strokeLinecap: "round",
			strokeLinejoin: "round",
			"aria-hidden": "true"
		},
		react.createElement("path", { d: "M8 13.4 2.9 8.6a3.2 3.2 0 0 1 4.5-4.5L8 4.7l.6-.6a3.2 3.2 0 1 1 4.5 4.5L8 13.4Z" })
	);

	const maybeLoadMore = react.useCallback(() => {
		const body = bodyRef.current;
		if (!body || !hasMoreContributions || loadMorePending || loading || error || typeof onLoadMore !== "function") {
			return;
		}

		const remaining = body.scrollHeight - body.scrollTop - body.clientHeight;
		if (remaining > 160 || loadMoreLockRef.current) {
			return;
		}

		loadMoreLockRef.current = true;
		onLoadMore();
	}, [error, hasMoreContributions, loadMorePending, loading, onLoadMore]);

	react.useEffect(() => {
		if (!loadMorePending) {
			loadMoreLockRef.current = false;
		}
	}, [loadMorePending, loadedContributionCount]);

	react.useEffect(() => {
		maybeLoadMore();
	}, [maybeLoadMore, loadedContributionCount]);

	const content = react.createElement(
		react.Fragment,
		null,
		react.createElement(
			"div",
			{ className: "lyrics-creator-profile-hero" },
			avatarUrl
				? react.createElement("img", {
					className: "lyrics-creator-profile-avatar",
					src: avatarUrl,
					alt: displayName,
					onError: (event) => {
						event.currentTarget.style.display = "none";
					}
				})
				: react.createElement(
					"div",
					{ className: "lyrics-creator-profile-avatar lyrics-creator-profile-avatar-fallback" },
					initial
				),
			react.createElement(
				"div",
				{ className: "lyrics-creator-profile-info" },
				react.createElement(
					"div",
					{ className: "lyrics-creator-profile-name-row" },
					react.createElement("h2", { className: "lyrics-creator-profile-name" }, displayName),
					react.createElement(
						"button",
						{
							type: "button",
							className: `lyrics-creator-profile-like-inline ${liked ? "is-liked" : ""} ${likePending ? "is-loading" : ""}`.trim(),
							onClick: onToggleLike,
							disabled: likePending || !canLike,
							title: likeButtonTitle,
							"aria-label": likeButtonLabel
						},
						likeIcon,
						react.createElement("span", null, likeButtonLabel)
					)
				),
				subtitle && react.createElement("div", { className: "lyrics-creator-profile-handle" }, subtitle),
				hasLoadedProfileData
					? react.createElement(
						"div",
						{ className: "lyrics-creator-profile-stats" },
						react.createElement(
							"div",
							{ className: "lyrics-creator-profile-stat" },
							react.createElement("strong", null, trackCount),
							react.createElement("span", null, copy.tracks)
						),
						react.createElement(
							"div",
							{ className: "lyrics-creator-profile-stat" },
							react.createElement("strong", null, likeCount),
							react.createElement("span", null, copy.likes)
						),
						react.createElement(
							"div",
							{ className: "lyrics-creator-profile-stat" },
							react.createElement("strong", null, artistGroupCount),
							react.createElement("span", null, copy.artistGroups)
						)
					)
					: react.createElement(
						"div",
						{ className: "lyrics-creator-profile-inline-state" },
						copy.loading
					)
			)
		),
		error
			? react.createElement(
				"div",
				{ className: "lyrics-creator-profile-state lyrics-creator-profile-error" },
				error
			)
			: showSectionLoading
				? react.createElement(
					"div",
					{ className: "lyrics-creator-profile-state lyrics-creator-profile-state-compact" },
					copy.loading
				)
				: react.createElement(
					react.Fragment,
					null,
					react.createElement(
						"div",
						{ className: "lyrics-creator-profile-section-header lyrics-creator-profile-section-header-tight" },
						react.createElement("h3", { className: "lyrics-creator-profile-section-title" }, copy.topArtists),
						profileData.stats?.artistGroupCount > 0 && react.createElement(
							"div",
							{ className: "lyrics-creator-profile-section-meta" },
							String(profileData.stats.artistGroupCount)
						)
					),
					artistStats.length
						? react.createElement(
							"div",
							{ className: "lyrics-creator-profile-artist-stats" },
							...artistStats.map((item) => react.createElement(
								"button",
								{
									type: "button",
									key: item.name,
									className: `lyrics-creator-profile-artist-chip ${artistFilter === item.name ? "is-active" : ""}`.trim(),
									onClick: () => onArtistFilterChange?.(artistFilter === item.name ? null : item.name)
								},
								react.createElement("span", { className: "lyrics-creator-profile-artist-chip-name" }, item.name),
								react.createElement("span", { className: "lyrics-creator-profile-artist-chip-count" }, item.count)
							))
						)
						: react.createElement(
							"div",
							{ className: "lyrics-creator-profile-empty lyrics-creator-profile-empty-compact" },
							copy.noArtistStats
						),
					react.createElement(
						"div",
						{ className: "lyrics-creator-profile-toolbar" },
						react.createElement(
							"div",
							{ className: "lyrics-creator-profile-toolbar-group" },
							react.createElement("span", { className: "lyrics-creator-profile-toolbar-label" }, copy.sortLabel),
							react.createElement(
								"div",
								{ className: "lyrics-creator-profile-sort-controls" },
								...sortOptions.map((option) => react.createElement(
									"button",
									{
										type: "button",
										key: option.key,
										className: `lyrics-creator-profile-sort-btn ${sortMode === option.key ? "is-active" : ""}`.trim(),
										onClick: () => onSortChange?.(option.key),
										disabled: loadMorePending || listRefreshing
									},
									option.label
								))
							)
						),
						artistFilter && react.createElement(
							"button",
							{
								type: "button",
								className: "lyrics-creator-profile-filter-badge",
								onClick: () => onArtistFilterChange?.(null),
								disabled: loadMorePending || listRefreshing
							},
							`${copy.filteredArtist}: ${artistFilter} ×`
						)
					),
					react.createElement(
						"div",
						{ className: "lyrics-creator-profile-section-header" },
						react.createElement("h3", { className: "lyrics-creator-profile-section-title" }, copy.contributions),
						totalContributionCount > 0 && react.createElement(
							"div",
							{ className: "lyrics-creator-profile-section-meta" },
							`${loadedContributionCount}/${totalContributionCount}`
						)
					),
					listRefreshing && react.createElement(
						"div",
						{ className: "lyrics-creator-profile-list-status" },
						copy.loadingMore
					),
					contributions.length
						? react.createElement(
							react.Fragment,
							null,
							react.createElement(
								"div",
								{ className: `lyrics-creator-profile-grid ${listRefreshing ? "is-refreshing" : ""}`.trim() },
								...contributions.map((item) => {
									const updatedLabel = formatContributorTimestamp(item.updatedAt || item.createdAt);
									return react.createElement(
										"button",
										{
											type: "button",
											key: `${item.trackId}:${item.provider}`,
											className: "lyrics-creator-profile-track",
											onClick: () => onTrackClick(item.trackId)
										},
										react.createElement(
											"div",
											{ className: "lyrics-creator-profile-track-main" },
											react.createElement("div", { className: "lyrics-creator-profile-track-title" }, item.trackName || copy.unknownTrack),
											react.createElement("div", { className: "lyrics-creator-profile-track-artist" }, item.artists || item.trackId)
										),
										react.createElement(
											"div",
											{ className: "lyrics-creator-profile-track-side" },
											react.createElement("span", { className: "lyrics-creator-profile-track-provider" }, item.provider),
											updatedLabel && react.createElement("span", { className: "lyrics-creator-profile-track-updated" }, `${copy.updated} ${updatedLabel}`)
										)
									);
								})
							),
							hasMoreContributions && react.createElement(
								"div",
								{ className: "lyrics-creator-profile-grid-footer" },
								loadMorePending
									? react.createElement(
										"div",
										{ className: "lyrics-creator-profile-load-more is-loading" },
										copy.loadingMore
									)
									: null
							)
						)
						: react.createElement(
							"div",
							{ className: "lyrics-creator-profile-empty" },
							copy.noContributions
						)
				)
	);

	return react.createElement(
		"div",
		{
			className: "lyrics-creator-profile-overlay",
			"data-ui-theme": uiTheme,
			onClick: onClose
		},
		react.createElement(
			"div",
			{
				className: "lyrics-creator-profile-modal",
				"data-ui-theme": uiTheme,
				onClick: (event) => event.stopPropagation()
			},
			react.createElement(
				"div",
				{ className: "lyrics-creator-profile-header" },
				react.createElement(
					"div",
					{ className: "lyrics-creator-profile-title-wrap" },
					react.createElement("h2", { className: "lyrics-creator-profile-header-title" }, copy.title)
				),
				react.createElement(
					"button",
					{
						type: "button",
						className: "lyrics-creator-profile-close",
						onClick: onClose,
						title: copy.back
					},
					closeIcon
				)
			),
			react.createElement(
				"div",
				{
					className: "lyrics-creator-profile-body",
					ref: bodyRef,
					onScroll: maybeLoadMore
				},
				content
			),
			react.createElement(
				"div",
				{ className: "lyrics-creator-profile-footer" },
				react.createElement(
					"button",
					{
						type: "button",
						className: "lyrics-creator-profile-footer-btn",
						onClick: onClose
					},
					copy.back
				)
			)
		)
	);
});

// CreditFooter implementing provider and contributor display
const CreditFooter = react.memo(({ provider, contributors }) => {
	const copy = getCreatorProfileCopy();
	const reactDom = window.Spicetify?.ReactDOM ?? window.ReactDOM ?? null;
	const visibleContributors = useMemo(() => getDisplayContributors(contributors, 3), [contributors]);
	const [activeContributor, setActiveContributor] = useState(null);
	const [creatorProfile, setCreatorProfile] = useState(null);
	const [profileLoading, setProfileLoading] = useState(false);
	const [profileError, setProfileError] = useState(null);
	const [likePending, setLikePending] = useState(false);
	const [profileLoadingMore, setProfileLoadingMore] = useState(false);
	const [profileListRefreshing, setProfileListRefreshing] = useState(false);
	const [profileSort, setProfileSort] = useState("recent");
	const [profileArtistFilter, setProfileArtistFilter] = useState(null);
	const requestIdRef = useRef(0);

	const closeProfile = useCallback(() => {
		requestIdRef.current += 1;
		setActiveContributor(null);
		setCreatorProfile(null);
		setProfileLoading(false);
		setProfileError(null);
		setLikePending(false);
		setProfileLoadingMore(false);
		setProfileListRefreshing(false);
		setProfileSort("recent");
		setProfileArtistFilter(null);
	}, []);

	useEffect(() => {
		if (!activeContributor) {
			return undefined;
		}

		const onKeyDown = (event) => {
			if (event.key === "Escape") {
				closeProfile();
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [activeContributor, closeProfile]);

	const loadCreatorProfile = useCallback(async (contributor, options = {}) => {
		if (!contributor?.profileAvailable || !contributor.userHash) {
			return;
		}

		const {
			offset = 0,
			sort = "recent",
			artist = null,
			append = false,
			preserveProfile = false
		} = options;
		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		if (append) {
			setProfileLoadingMore(true);
		} else if (preserveProfile) {
			setProfileListRefreshing(true);
		} else {
			setProfileLoading(true);
			setProfileError(null);
			setProfileLoadingMore(false);
		}

		try {
			const data = await Utils.fetchSyncCreatorProfile(contributor.userHash, {
				limit: CREATOR_PROFILE_PAGE_SIZE,
				offset,
				sort,
				artist
			});
			if (requestIdRef.current !== requestId) {
				return;
			}

			setCreatorProfile((currentProfile) => {
				if (!append || !currentProfile || currentProfile.userHash !== data.userHash) {
					if (preserveProfile && currentProfile && currentProfile.userHash === data.userHash) {
						return {
							...currentProfile,
							...data,
							account: data.account || currentProfile.account,
							displayName: data.displayName || currentProfile.displayName
						};
					}

					return data;
				}

				return {
					...data,
					contributions: mergeCreatorProfileContributions(
						currentProfile.contributions,
						data.contributions
					),
					stats: {
						...currentProfile.stats,
						...data.stats
					},
					viewer: {
						...currentProfile.viewer,
						...data.viewer
					},
					artistStats: data.artistStats || currentProfile.artistStats,
					filters: data.filters || currentProfile.filters
				};
			});
		} catch (error) {
			if (requestIdRef.current !== requestId) {
				return;
			}
			if (append) {
				Toast.error(error.message || copy.loadFailed);
			} else if (preserveProfile) {
				Toast.error(error.message || copy.loadFailed);
			} else {
				setProfileError(error.message || copy.loadFailed);
			}
		} finally {
			if (requestIdRef.current === requestId) {
				if (append) {
					setProfileLoadingMore(false);
				} else if (preserveProfile) {
					setProfileListRefreshing(false);
				} else {
					setProfileLoading(false);
				}
			}
		}
	}, [copy.loadFailed]);

	const openCreatorProfile = useCallback(async (contributor) => {
		if (!contributor?.profileAvailable || !contributor.userHash) {
			return;
		}

		setActiveContributor(contributor);
		setProfileError(null);
		setLikePending(false);
		setProfileSort("recent");
		setProfileArtistFilter(null);
		setProfileListRefreshing(false);
		setCreatorProfile(createCreatorProfileShell(contributor, {
			sort: "recent",
			artist: null
		}));
		void loadCreatorProfile(contributor, {
			offset: 0,
			sort: "recent",
			artist: null,
			append: false
		});
	}, [loadCreatorProfile]);

	const handleLoadMore = useCallback(async () => {
		if (!activeContributor?.userHash || !creatorProfile?.pagination?.hasMore || profileLoadingMore) {
			return;
		}

		await loadCreatorProfile(activeContributor, {
			offset: Number(creatorProfile.pagination?.nextOffset || creatorProfile.contributions?.length || 0),
			sort: profileSort,
			artist: profileArtistFilter,
			append: true
		});
	}, [activeContributor, creatorProfile, loadCreatorProfile, profileArtistFilter, profileLoadingMore, profileSort]);

	const handleSortChange = useCallback(async (nextSort) => {
		if (!activeContributor?.userHash || !nextSort || nextSort === profileSort) {
			return;
		}

		setProfileSort(nextSort);
		void loadCreatorProfile(activeContributor, {
			offset: 0,
			sort: nextSort,
			artist: profileArtistFilter,
			append: false,
			preserveProfile: true
		});
	}, [activeContributor, loadCreatorProfile, profileArtistFilter, profileSort]);

	const handleArtistFilterChange = useCallback(async (nextArtist) => {
		if (!activeContributor?.userHash) {
			return;
		}

		const normalizedArtist = typeof nextArtist === "string" && nextArtist.trim()
			? nextArtist.trim()
			: null;

		if (normalizedArtist === profileArtistFilter) {
			return;
		}

		setProfileArtistFilter(normalizedArtist);
		void loadCreatorProfile(activeContributor, {
			offset: 0,
			sort: profileSort,
			artist: normalizedArtist,
			append: false,
			preserveProfile: true
		});
	}, [activeContributor, loadCreatorProfile, profileArtistFilter, profileSort]);

	const handleToggleLike = useCallback(async () => {
		if (!creatorProfile?.userHash) {
			return;
		}

		if (!creatorProfile.viewer?.authenticated) {
			Toast.error(copy.likeLoginRequired);
			return;
		}

		setLikePending(true);
		try {
			const result = await Utils.setSyncCreatorLike(creatorProfile.userHash, !creatorProfile.viewer?.liked);
			setCreatorProfile((currentProfile) => currentProfile
				? {
					...currentProfile,
					stats: {
						...currentProfile.stats,
						likeCount: result.likeCount
					},
					viewer: {
						...currentProfile.viewer,
						liked: result.liked
					}
				}
				: currentProfile
			);
		} catch (error) {
			Toast.error(error.message || copy.likeActionFailed);
		} finally {
			setLikePending(false);
		}
	}, [copy.likeActionFailed, copy.likeLoginRequired, creatorProfile]);

	const handleTrackClick = useCallback((trackId) => {
		if (!trackId) {
			return;
		}

		closeProfile();
		Spicetify?.Platform?.History?.push?.(`/track/${trackId}`);
	}, [closeProfile]);

	if (!provider) {
		return null;
	}

	const footer = react.createElement(
		"div",
		{
			className: "lyrics-credit-footer",
			style: {
				position: "absolute",
				bottom: "40px",
				left: "50%",
				transform: "translateX(-50%)",
				width: "max-content",
				maxWidth: "min(92%, 980px)",
				fontSize: "12px",
				color: "var(--lyrics-color-inactive)",
				opacity: 0.7,
				textAlign: "center",
				zIndex: 200,
				textShadow: "0 0 10px rgba(0,0,0,0.5)",
				pointerEvents: "auto"
			}
		},
		react.createElement(
			"div",
			{
				className: "lyrics-credit-footer-content",
				onPointerDown: (event) => event.stopPropagation(),
				onClick: (event) => event.stopPropagation(),
				onMouseDown: (event) => event.stopPropagation()
			},
			react.createElement(
				"span",
				{ className: "lyrics-credit-footer-group" },
				react.createElement(
					"span",
					{ className: "lyrics-credit-footer-label" },
					I18n.t("misc.lyricsProvider") || "Lyrics Provider"
				),
				react.createElement(
					"span",
					{ className: "lyrics-credit-footer-value" },
					provider
				)
			),
			visibleContributors.length > 0 && react.createElement(
				react.Fragment,
				null,
				react.createElement("span", { className: "lyrics-credit-footer-divider", "aria-hidden": "true" }, "•"),
				react.createElement(
					"span",
					{ className: "lyrics-credit-footer-group" },
					react.createElement(
						"span",
						{ className: "lyrics-credit-footer-label" },
						I18n.t("misc.syncContributor") || "Sync Contributor"
					),
					react.createElement(
						"span",
						{ className: "lyrics-credit-footer-value lyrics-credit-footer-contributors" },
						...visibleContributors.flatMap((contributor, index) => {
							const node = contributor.profileAvailable
								? react.createElement(
									"button",
									{
										type: "button",
										key: contributor.key,
										className: "lyrics-credit-footer-link",
										onPointerDown: (event) => event.stopPropagation(),
										onMouseDown: (event) => event.stopPropagation(),
										onClick: (event) => {
											event.stopPropagation();
											openCreatorProfile(contributor);
										},
										title: copy.openProfile
									},
									contributor.name
								)
								: react.createElement(
									"span",
									{
										key: contributor.key,
										className: "lyrics-credit-footer-name"
									},
									contributor.name
								);

							return index < visibleContributors.length - 1
								? [node, react.createElement("span", { key: `${contributor.key}:comma`, className: "lyrics-credit-footer-separator" }, ", ")]
								: [node];
						})
					)
				)
			)
		)
	);

	const modal = activeContributor
		? react.createElement(SyncCreatorProfileModal, {
			contributor: activeContributor,
			profile: creatorProfile,
			loading: profileLoading,
			error: profileError,
			likePending,
			loadMorePending: profileLoadingMore,
			listRefreshing: profileListRefreshing,
			onClose: closeProfile,
			onToggleLike: handleToggleLike,
			onLoadMore: handleLoadMore,
			onTrackClick: handleTrackClick,
			activeSortMode: profileSort,
			activeArtistFilter: profileArtistFilter,
			onSortChange: handleSortChange,
			onArtistFilterChange: handleArtistFilterChange
		})
		: null;

	return react.createElement(
		react.Fragment,
		null,
		footer,
		modal && reactDom?.createPortal && document.body
			? reactDom.createPortal(modal, document.body)
			: modal
	);
});
window.CreditFooter = CreditFooter;

// Optimized IdlingIndicator with memoization and performance improvements
const IdlingIndicator = react.memo(({ isActive = false, progress = 0, delay = 0 }) => {
	const className = useMemo(() =>
		`lyrics-idling-indicator ${!isActive ? "lyrics-idling-indicator-hidden" : ""} lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active`,
		[isActive]
	);

	const style = useMemo(() => ({
		"--position-index": 0,
		"--animation-index": 1,
		"--indicator-delay": `${delay}ms`,
	}), [delay]);

	// Memoize circle states to avoid unnecessary re-renders
	const circleStates = useMemo(() => [
		progress >= 0.05 ? "active" : "",
		progress >= 0.33 ? "active" : "",
		progress >= 0.66 ? "active" : ""
	], [progress]);

	return react.createElement(
		"div",
		{ className, style },
		react.createElement("div", { className: `lyrics-idling-indicator__circle ${circleStates[0]}` }),
		react.createElement("div", { className: `lyrics-idling-indicator__circle ${circleStates[1]}` }),
		react.createElement("div", { className: `lyrics-idling-indicator__circle ${circleStates[2]}` })
	);
});

const emptyLine = {
	startTime: 0,
	endTime: 0,
	text: [],
};

// Safe text renderer that handles objects, null, and undefined
const safeRenderText = (value) => {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "object") {
		// Handle React elements
		if (value && typeof value === 'object' && value.$$typeof) {
			return value; // React element, return as-is
		}
		// Handle line objects for karaoke
		if (value.text) return value.text;
		if (value.syllables) return value;
		if (value.vocals) return value;
		// Fallback: return empty string for other objects
		return "";
	}
	return String(value);
};

// Unified function to handle lyrics display mode logic
const getLyricsDisplayMode = (isKara, line, text, originalText, text2) => {
	const displayMode = CONFIG.visual["translate:display-mode"];
	const showTranslatedBelow = displayMode === "below";
	const replaceOriginal = displayMode === "replace";

	let mainText, subText, subText2;

	if (isKara) {
		// For karaoke mode, safely handle the line object
		mainText = line; // Keep as object for KaraokeLine component
		subText = text ? safeRenderText(text) : null;
		subText2 = safeRenderText(text2);
	} else {
		// Default: show original text
		// originalText is the actual original lyrics
		// text is the first translation (can be null)
		// text2 is the second translation (can be null)

		if (showTranslatedBelow) {
			// Show original as main, translations below
			// Apply furigana to original text if enabled
			const processedOriginalText = safeRenderText(originalText);
			mainText = typeof processedOriginalText === 'string' ?
				Utils.applyFuriganaIfEnabled(processedOriginalText) : processedOriginalText;
			subText = text ? safeRenderText(text) : null;
			subText2 = text2 ? safeRenderText(text2) : null;
		} else if (replaceOriginal && text) {
			// Replace original with translation (only if translation exists)
			mainText = safeRenderText(text);
			subText = text2 ? safeRenderText(text2) : null;
			subText2 = null;
		} else {
			// Default: just show original with furigana if enabled
			const processedOriginalText = safeRenderText(originalText);
			mainText = typeof processedOriginalText === 'string' ?
				Utils.applyFuriganaIfEnabled(processedOriginalText) : processedOriginalText;
			subText = null;
			subText2 = null;
		}
	}

	return { mainText, subText, subText2 };
};

function renderLyricsUnavailable(message = I18n.t("messages.noLyrics")) {
	return react.createElement(
		"div",
		{ className: "lyrics-lyricsContainer-LyricsUnavailablePage" },
		react.createElement(
			"span",
			{ className: "lyrics-lyricsContainer-LyricsUnavailableMessage" },
			message
		)
	);
}

const getCurrentTrackUri = () => Spicetify.Player?.data?.item?.uri || "";

const useTrackOffsetState = () => {
	const [trackOffset, setTrackOffset] = useState(0);
	const trackUri = getCurrentTrackUri();

	useEffect(() => {
		let cancelled = false;

		const loadOffset = async () => {
			const offset = (await Utils.getTrackSyncOffset(trackUri)) || 0;
			if (!cancelled) {
				setTrackOffset(offset);
			}
		};

		loadOffset();

		const handleOffsetChange = (event) => {
			if (event.detail.trackUri === trackUri) {
				setTrackOffset(event.detail.offset);
			}
		};

		window.addEventListener('ivLyrics:offset-changed', handleOffsetChange);
		return () => {
			cancelled = true;
			window.removeEventListener('ivLyrics:offset-changed', handleOffsetChange);
		};
	}, [trackUri]);

	return trackOffset;
};

const useLyricsPlaybackPosition = () => {
	const [position, setPosition] = useState(0);
	const trackOffset = useTrackOffsetState();

	useTrackPosition(() => {
		const newPos = Spicetify.Player.getProgress();
		const delay = CONFIG.visual.delay + trackOffset;
		setPosition(newPos + delay);
	});

	return position;
};

const useScrollActivity = (containerRef, deps = []) => {
	const [isScrolling, setIsScrolling] = useState(false);
	const scrollTimeout = useRef(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const handleWheel = () => {
			setIsScrolling(true);
			if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
			scrollTimeout.current = setTimeout(() => {
				setIsScrolling(false);
			}, 3000);
		};

		container.addEventListener("wheel", handleWheel, { passive: true });
		container.addEventListener("touchmove", handleWheel, { passive: true });

		return () => {
			container.removeEventListener("wheel", handleWheel);
			container.removeEventListener("touchmove", handleWheel);
			if (scrollTimeout.current) {
				clearTimeout(scrollTimeout.current);
				scrollTimeout.current = null;
			}
		};
	}, deps);

	const handleContainerClick = useCallback(() => {
		if (!isScrolling) return;
		setIsScrolling(false);
		if (scrollTimeout.current) {
			clearTimeout(scrollTimeout.current);
			scrollTimeout.current = null;
		}
	}, [isScrolling]);

	return { isScrolling, handleContainerClick };
};

const renderLyricSubLine = (className, text, onContextMenu = null) => {
	if (!text) return null;
	const props = {
		className,
		style: { "--sub-lyric-color": CONFIG.visual["inactive-color"] },
	};
	if (onContextMenu) {
		props.onContextMenu = onContextMenu;
	}

	if (typeof text === "string" && text) {
		props.dangerouslySetInnerHTML = { __html: Utils.rubyTextToHTML(text) };
		return react.createElement("p", props);
	}

	return react.createElement("p", props, safeRenderText(text));
};

const renderLyricMainContent = ({
	isKara = false,
	mainText,
	line,
	position,
	isActive,
	globalCharOffset = 0,
	activeGlobalCharIndex = -1,
}) => {
	if (isKara) {
		return react.createElement(KaraokeLine, {
			line,
			position,
			isActive,
			globalCharOffset,
			activeGlobalCharIndex,
		});
	}

	if (typeof mainText === "string") {
		return null;
	}

	return safeRenderText(mainText);
};

const normalizeUnsyncedLyrics = (lyrics) => {
	if (!lyrics) {
		return [];
	}
	if (Array.isArray(lyrics)) {
		return lyrics.filter(item => item !== null && item !== undefined);
	}
	if (typeof lyrics === "string") {
		return lyrics.split("\n").map((text, index) => ({ text, index }));
	}
	return [];
};

const getUnsyncedLineRenderData = (lyrics, text, originalText, text2) => {
	const { mainText: lineText, subText, subText2: showMode2Translation } =
		getLyricsDisplayMode(false, null, text, originalText, text2);

	const belowOrigin = (typeof originalText === "object"
		? originalText?.props?.children?.[0]
		: originalText)?.replace(/\s+/g, "");
	const belowTxt = (typeof text === "object"
		? text?.props?.children?.[0]
		: text)?.replace(/\s+/g, "");

	const displayMode = CONFIG.visual["translate:display-mode"];
	const showTranslatedBelow = displayMode === "below";
	const replaceOriginal = displayMode === "replace";
	const belowMode = showTranslatedBelow && originalText && belowOrigin !== belowTxt;
	const showMode2 = !!showMode2Translation && (showTranslatedBelow || replaceOriginal);

	return {
		lineText,
		subText,
		showMode2Translation,
		belowMode,
		showMode2,
	};
};

const buildLyricDisplayState = (isKara, line, text, originalText, text2) => {
	const { mainText, subText, subText2 } = getLyricsDisplayMode(
		isKara,
		line,
		text,
		originalText,
		text2
	);

	return {
		mainText,
		subText,
		subText2,
		hasSubLine: !!subText || !!subText2,
		originalText,
	};
};

const getCopyableText = (value) => {
	if (value === null || value === undefined) {
		return "";
	}

	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	if (typeof value === "object") {
		if (Array.isArray(value)) {
			return value.map(getCopyableText).join("");
		}

		if (value.props?.children !== undefined) {
			return getCopyableText(value.props.children);
		}

		if (typeof value.text === "string") {
			return value.text;
		}
	}

	return safeRenderText(value) || "";
};

const copyLyricText = (text, successMessageKey, failureMessageKey) => {
	const copyText = getCopyableText(text);
	if (!copyText) {
		Toast.error(I18n.t(failureMessageKey));
		return;
	}

	Spicetify.Platform.ClipboardAPI.copy(copyText)
		.then(() => Toast.success(I18n.t(successMessageKey)))
		.catch(() => Toast.error(I18n.t(failureMessageKey)));
};

const createCopyHandler = (text, successMessageKey, failureMessageKey) => (event) => {
	event.preventDefault();
	copyLyricText(text, successMessageKey, failureMessageKey);
};

const getLyricsAnchorRatio = (container) => {
	if (!container) {
		return 0.5;
	}

	const rawAnchorRatio = window.getComputedStyle(container).getPropertyValue("--ivfs-lyrics-anchor-ratio").trim();
	const parsedAnchorRatio = Number.parseFloat(rawAnchorRatio);

	return Number.isFinite(parsedAnchorRatio)
		? Math.min(0.95, Math.max(0.05, parsedAnchorRatio))
		: 0.5;
};

const scrollSyncedContainerToActiveLine = (container, activeLine, behavior = "smooth") => {
	if (!container || !activeLine) return;

	const anchorRatio = getLyricsAnchorRatio(container);
	const containerHeight = container.clientHeight || 0;
	const lineHeight = activeLine.clientHeight || activeLine.getBoundingClientRect().height || 0;
	const targetTop = activeLine.offsetTop - (containerHeight * anchorRatio - lineHeight / 2);
	const maxScrollTop = Math.max(0, container.scrollHeight - containerHeight);
	const nextTop = Math.max(0, Math.min(targetTop, maxScrollTop));

	if (typeof container.scrollTo === "function") {
		container.scrollTo({ top: nextTop, behavior });
		return;
	}

	container.scrollTop = nextTop;
};

const getCompactSyncedOffset = (container, activeLine, isScrolling) => {
	if (!container || !activeLine || isScrolling) {
		return 0;
	}

	const anchorRatio = getLyricsAnchorRatio(container);
	const anchorOffset = container.clientHeight * anchorRatio;
	return anchorOffset - (activeLine.offsetTop + activeLine.clientHeight / 2);
};

const buildGlobalCharState = (lyrics, position) => {
	const offsets = [];
	let totalChars = 0;
	let activeCharIndex = -1;
	let lastPassedCharIndex = -1;
	let lastPassedCharEndTime = 0;
	let lastPassedCharDuration = 100;

	for (let i = 0; i < lyrics.length; i++) {
		const line = lyrics[i];
		offsets.push(totalChars);

		if (!line?.syllables || !Array.isArray(line.syllables)) {
			continue;
		}

		for (const syllable of line.syllables) {
			if (!syllable || !syllable.text) continue;

			const charArray = Array.from(syllable.text || "");
			const syllableStart = syllable.startTime || 0;
			const syllableEnd = syllable.endTime || syllableStart + 500;

			for (let charIdx = 0; charIdx < charArray.length; charIdx++) {
				const charDuration = (syllableEnd - syllableStart) / charArray.length;
				const charStart = syllableStart + (charIdx * charDuration);
				const charEnd = charStart + charDuration;

				if (position >= charStart && position < charEnd) {
					activeCharIndex = totalChars;
				}

				if (position >= charEnd && charEnd > lastPassedCharEndTime) {
					lastPassedCharEndTime = charEnd;
					lastPassedCharIndex = totalChars;
					lastPassedCharDuration = charDuration || 100;
				}

				totalChars++;
			}
		}
	}

	if (activeCharIndex === -1 && lastPassedCharIndex !== -1) {
		const timeDiff = position - lastPassedCharEndTime;
		const simulateDuration = Math.max(40, lastPassedCharDuration * 0.01);
		const virtualProgress = Math.floor(timeDiff / simulateDuration);

		if (timeDiff < 2000) {
			activeCharIndex = lastPassedCharIndex + 1 + virtualProgress;
		}
	}

	return {
		globalCharOffsets: offsets,
		activeGlobalCharIndex: activeCharIndex,
	};
};

const EMPTY_GLOBAL_CHAR_STATE = {
	globalCharOffsets: [],
	activeGlobalCharIndex: -1,
};

const KARAOKE_PRE_SPACE_MIN_DURATION_MS = 45;
const KARAOKE_PRE_SPACE_NEXT_CHAR_RATIO = 0.7;
const KARAOKE_PRE_SPACE_MAX_DURATION_MS = 120;

const buildPreparedSyncedLyrics = (lyrics, isKara) =>
	lyrics.map((line) => ({
		...line,
		...buildLyricDisplayState(
			isKara,
			line,
			line?.text,
			line?.originalText,
			line?.text2
		),
	}));

const buildPaddedSyncedLyrics = (lyrics, leadingEmptyLines) =>
	Array.from({ length: leadingEmptyLines }, () => emptyLine)
		.concat(lyrics)
		.map((line, lineNumber) => ({
			...line,
			lineNumber,
		}));

const getActiveTimedLineIndex = (lines, position) => {
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (line && position >= (line.startTime || 0)) {
			return i;
		}
	}

	return 0;
};

const getSyncedAnimationIndex = ({ compact, isScrolling, activeLineIndex, lineNumber, visibleIndex }) => {
	if (compact && isScrolling) {
		return 0;
	}

	const sourceIndex = compact && !isScrolling ? visibleIndex : lineNumber;

	if (activeLineIndex <= CONFIG.visual["lines-before"]) {
		return sourceIndex - activeLineIndex;
	}

	return sourceIndex - CONFIG.visual["lines-before"];
};

const shouldHideSyncedLine = ({ compact, isScrolling, animationIndex }) => {
	if (compact && isScrolling) {
		return false;
	}

	return (
		(animationIndex < 0 && -animationIndex > CONFIG.visual["lines-before"]) ||
		animationIndex > CONFIG.visual["lines-after"]
	);
};

const LyricsLineBlock = react.memo(({
	className,
	style,
	lineRef = null,
	dir = "auto",
	seekTime = null,
	mainText,
	subText = null,
	subText2 = null,
	originalText = null,
	isKara = false,
	line = null,
	position = 0,
	isActive = false,
	globalCharOffset = 0,
	activeGlobalCharIndex = -1,
	mainCopyText = null,
	mainCopySuccessKey = "notifications.lyricsCopied",
	mainCopyFailureKey = "notifications.lyricsCopyFailed",
	subCopyText = null,
	subCopySuccessKey = "notifications.translationCopied",
	subCopyFailureKey = "notifications.translationCopyFailed",
	subText2CopyText = null,
	subText2CopySuccessKey = "notifications.secondTranslationCopied",
	subText2CopyFailureKey = "notifications.secondTranslationCopyFailed",
}) => {
	const mainLine = line || (typeof mainText === "object" ? mainText : {
		text: mainText,
		originalText,
		text2: subText2,
	});

	const mainProps = {
		onContextMenu: createCopyHandler(
			mainCopyText || Utils.formatLyricLineToCopy(mainText, subText, subText2, originalText),
			mainCopySuccessKey,
			mainCopyFailureKey
		),
	};

	if (typeof mainText === "string" && !isKara && mainText) {
		mainProps.dangerouslySetInnerHTML = { __html: Utils.rubyTextToHTML(mainText) };
	}

	const handleClick = useCallback(() => {
		if (Number.isFinite(seekTime)) {
			Spicetify.Player.seek(seekTime);
		}
	}, [seekTime]);

	return react.createElement(
		"div",
		{
			className,
			style,
			dir,
			ref: lineRef,
			onClick: Number.isFinite(seekTime) ? handleClick : null,
		},
		react.createElement(
			"p",
			mainProps,
			renderLyricMainContent({
				isKara,
				mainText,
				line: mainLine,
				position: isKara ? position : 0,
				isActive,
				globalCharOffset,
				activeGlobalCharIndex,
			})
		),
		renderLyricSubLine(
			"lyrics-lyricsContainer-LyricsLine-phonetic",
			subText,
			subCopyText
				? createCopyHandler(subCopyText, subCopySuccessKey, subCopyFailureKey)
				: null
		),
		renderLyricSubLine(
			"lyrics-lyricsContainer-LyricsLine-translation",
			subText2,
			subText2CopyText
				? createCopyHandler(subText2CopyText, subText2CopySuccessKey, subText2CopyFailureKey)
				: null
		)
	);
});

const renderLyricsItems = ({ items, isKara, position = 0, activeLineRef = null }) => {
	const karaokePosition = isKara ? position : 0;

	return items.map((item) => {
		if (item.type === "indicator") {
			return react.createElement(IdlingIndicator, {
				key: item.key,
				isActive: item.isActive,
				progress: item.progress,
				delay: item.delay,
			});
		}

		return react.createElement(LyricsLineBlock, {
			key: item.key,
			className: item.className,
			style: item.style,
			lineRef: item.trackLineRef ? activeLineRef : null,
			seekTime: item.canSeek ? item.startTime : null,
			mainText: item.mainText,
			subText: item.subText,
			subText2: item.subText2,
			originalText: item.originalText,
			isKara,
			line: item.line,
			position: karaokePosition,
			isActive: item.karaokeActive,
			globalCharOffset: item.globalCharOffset,
			activeGlobalCharIndex: item.activeGlobalCharIndex,
		});
	});
};

const SyncedLyricsScrollView = react.memo(({
	lyrics = [],
	position = 0,
	activeLyricIndex = 0,
	isKara = false,
	activeLineRef = null,
	globalCharOffsets = [],
	activeGlobalCharIndex = -1,
}) => {
	if (!Array.isArray(lyrics) || lyrics.length === 0) {
		return null;
	}

	return react.createElement(
		"div",
		{
			className: `lyrics-lyricsContainer-SyncedScrollView ${isKara ? "is-karaoke" : "is-synced"}`,
		},
		...lyrics.map((line, index) => {
			const { text, startTime, originalText, text2 } = line;
			const { mainText, subText, subText2, hasSubLine } = buildLyricDisplayState(
				isKara,
				line,
				text,
				originalText,
				text2
			);
			const isActiveLine = index === activeLyricIndex;

			return react.createElement(LyricsLineBlock, {
				key: `scroll-line-${startTime ?? index}-${index}`,
				className: `lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-scrollView${hasSubLine ? " lyrics-lyricsContainer-LyricsLine-hasSubLine" : ""}${isActiveLine ? " lyrics-lyricsContainer-LyricsLine-active lyrics-lyricsContainer-LyricsLine-scrollCurrent" : ""}`,
				style: {
					cursor: Number.isFinite(startTime) ? "pointer" : "default",
				},
				lineRef: isActiveLine ? activeLineRef : null,
				seekTime: Number.isFinite(startTime) ? startTime : null,
				mainText,
				subText,
				subText2,
				originalText,
				isKara,
				line,
				position,
				isActive: isActiveLine,
				globalCharOffset: globalCharOffsets[index] || 0,
				activeGlobalCharIndex,
			});
		})
	);
});

const useSyncedLyricsEngine = ({
	lyrics,
	position,
	compact = false,
	isKara = false,
	containerRef,
	activeLineRef,
	lyricsId,
	containerReady = true,
}) => {
	const leadingEmptyLines = compact ? 2 : 1;
	const { isScrolling, handleContainerClick } = useScrollActivity(
		containerRef,
		compact ? [lyricsId, containerReady] : [lyricsId]
	);

	const preparedLyrics = useMemo(
		() => buildPreparedSyncedLyrics(lyrics, isKara),
		[lyrics, isKara]
	);

	const paddedLyrics = useMemo(
		() => buildPaddedSyncedLyrics(preparedLyrics, leadingEmptyLines),
		[preparedLyrics, leadingEmptyLines]
	);

	const activeLineIndex = useMemo(
		() => getActiveTimedLineIndex(paddedLyrics, position),
		[paddedLyrics, position]
	);

	const compactWindowStartIndex = useMemo(() => {
		if (!compact) {
			return 0;
		}

		return Math.max(activeLineIndex - CONFIG.visual["lines-before"], 0);
	}, [compact, activeLineIndex]);

	const linesToRender = useMemo(() => {
		if (!compact || isScrolling) {
			return paddedLyrics;
		}

		const startIndex = Math.max(compactWindowStartIndex - 2, 0);
		const endIndex = Math.min(
			activeLineIndex + CONFIG.visual["lines-after"] + 3,
			paddedLyrics.length
		);

		return paddedLyrics.slice(startIndex, endIndex);
	}, [compact, isScrolling, paddedLyrics, compactWindowStartIndex, activeLineIndex]);
	const compactAnchorIndex = compact
		? Math.min(CONFIG.visual["lines-before"], leadingEmptyLines)
		: activeLineIndex;
	const activeElementIndex = compact
		? (isScrolling
			? activeLineIndex
			: Math.max(Math.min(activeLineIndex, CONFIG.visual["lines-before"]), compactAnchorIndex))
		: activeLineIndex;
	const visualAnchorLineNumber = compact && activeLineIndex < leadingEmptyLines
		? leadingEmptyLines
		: activeLineIndex;

	const { globalCharOffsets, activeGlobalCharIndex } = useMemo(() => {
		if (!isKara) {
			return EMPTY_GLOBAL_CHAR_STATE;
		}

		return buildGlobalCharState(lyrics, position);
	}, [lyrics, position, isKara]);

	const compactOffset = compact
		? getCompactSyncedOffset(containerRef.current, activeLineRef.current, isScrolling)
		: 0;

	useEffect(() => {
		const actualIndex = Math.max(0, activeLineIndex - leadingEmptyLines);
		window.dispatchEvent(new CustomEvent("ivLyrics:lyric-index-changed", {
			detail: { index: actualIndex, total: lyrics.length }
		}));
	}, [activeLineIndex, leadingEmptyLines, lyrics.length]);

	const hasAutoScrolledRef = useRef(false);
	useEffect(() => {
		hasAutoScrolledRef.current = false;
	}, [lyricsId]);

	useEffect(() => {
		if (compact) {
			return undefined;
		}

		const container = containerRef.current;
		const activeLine = activeLineRef.current;
		if (!container || !activeLine || isScrolling) {
			return undefined;
		}

		if (!hasAutoScrolledRef.current || isInViewport(activeLine)) {
			scrollSyncedContainerToActiveLine(container, activeLine, hasAutoScrolledRef.current ? "smooth" : "auto");
			hasAutoScrolledRef.current = true;
		}

		return undefined;
	}, [compact, activeLineIndex, isScrolling, containerRef, activeLineRef]);

	useEffect(() => {
		if (compact || !isScrolling || !activeLineRef.current) {
			return undefined;
		}

		const timeoutId = setTimeout(() => {
			scrollSyncedContainerToActiveLine(containerRef.current, activeLineRef.current, "auto");
		}, 0);

		return () => clearTimeout(timeoutId);
	}, [compact, activeLineIndex, isScrolling, containerRef, activeLineRef]);

	const renderItems = useMemo(() => {
		if (compact && isScrolling) {
			return preparedLyrics.map((line, index) => {
				const { startTime, originalText, mainText, subText, subText2, hasSubLine } = line;
				const isActiveLine = index === Math.max(0, activeLineIndex - leadingEmptyLines);

				return {
					type: "line",
					key: `scroll-inline-${startTime ?? index}-${index}`,
					className: `lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-scrollView${hasSubLine ? " lyrics-lyricsContainer-LyricsLine-hasSubLine" : ""}${isActiveLine ? " lyrics-lyricsContainer-LyricsLine-active lyrics-lyricsContainer-LyricsLine-scrollCurrent" : ""}`,
					style: {
						cursor: Number.isFinite(startTime) ? "pointer" : "default",
					},
					line,
					startTime,
					originalText,
					mainText,
					subText,
					subText2,
					isActiveLine,
					trackLineRef: isActiveLine,
					canSeek: Number.isFinite(startTime),
					karaokeActive: isActiveLine,
					globalCharOffset: globalCharOffsets[index] || 0,
					activeGlobalCharIndex,
				};
			});
		}

		return linesToRender.map((line, visibleIndex) => {
			const {
				lineNumber = visibleIndex,
				startTime,
				originalText,
				mainText,
				subText,
				subText2,
			} = line;
			const compactVisibleIndex = compact
				? lineNumber - compactWindowStartIndex
				: visibleIndex;

			if (compact && lineNumber === 1 && activeLineIndex <= leadingEmptyLines) {
				const firstLyricStartTime = lyrics[0]?.startTime || 1;
				if (position < firstLyricStartTime) {
					return {
						type: "indicator",
						key: `compact-idling-${lineNumber}`,
						progress: position / firstLyricStartTime,
						delay: firstLyricStartTime / 3,
						isActive: true,
					};
				}
			}

			if (!compact && lineNumber === 0) {
				const nextStartTime = paddedLyrics[1]?.startTime || 1;
				return {
					type: "indicator",
					key: `expanded-idling-${lineNumber}`,
					progress: position / nextStartTime,
					delay: nextStartTime / 3,
					isActive: activeLineIndex === 0,
				};
			}

			const isActiveLine = lineNumber === activeLineIndex;
			const animationIndex = getSyncedAnimationIndex({
				compact,
				isScrolling,
				activeLineIndex,
				lineNumber,
				visibleIndex: compactVisibleIndex,
			});
			let className = "lyrics-lyricsContainer-LyricsLine";
			if (isActiveLine) {
				className += " lyrics-lyricsContainer-LyricsLine-active";
			}
			if (shouldHideSyncedLine({ compact, isScrolling, animationIndex })) {
				className += " lyrics-lyricsContainer-LyricsLine-paddingLine";
				className += animationIndex < 0
					? " lyrics-lyricsContainer-LyricsLine-paddingBefore"
					: " lyrics-lyricsContainer-LyricsLine-paddingAfter";
			}

			return {
				type: "line",
				key: lineNumber,
				className,
				style: {
					cursor: "pointer",
					"--position-index": animationIndex,
					"--animation-index": Math.abs(animationIndex) + 1,
					"--line-shift-duration": isScrolling
						? "0s"
						: `${Math.max(0.28, 0.46 - Math.min(Math.abs(animationIndex), 4) * 0.04)}s`,
					"--line-shift-delay": isScrolling
						? "0s"
						: `${animationIndex > 0 ? Math.min(animationIndex, 3) * 0.02 : 0}s`,
					"--blur-index": Math.abs(animationIndex),
				},
				line,
				startTime,
				originalText,
				mainText,
				subText,
				subText2,
				isActiveLine,
				trackLineRef: lineNumber === visualAnchorLineNumber,
				canSeek: lineNumber >= leadingEmptyLines && Number.isFinite(startTime),
				karaokeActive: compact ? compactVisibleIndex === activeElementIndex : isActiveLine,
				globalCharOffset: lineNumber >= leadingEmptyLines && lineNumber - leadingEmptyLines < globalCharOffsets.length
					? globalCharOffsets[lineNumber - leadingEmptyLines]
					: 0,
				activeGlobalCharIndex,
			};
		});
	}, [
		linesToRender,
		compact,
		activeLineIndex,
		leadingEmptyLines,
		lyrics,
		preparedLyrics,
		position,
		paddedLyrics,
		isScrolling,
		isKara,
		activeElementIndex,
		compactWindowStartIndex,
		visualAnchorLineNumber,
		globalCharOffsets,
		activeGlobalCharIndex,
	]);

	return {
		isScrolling,
		handleContainerClick,
		renderItems,
		compactOffset,
		activeLineIndex,
		activeLyricIndex: Math.max(0, activeLineIndex - leadingEmptyLines),
		globalCharOffsets,
		activeGlobalCharIndex,
	};
};

// Global animation manager to prevent multiple instances
const AnimationManager = {
	active: false,
	frameId: null,
	callbacks: new Set(),
	lastTime: 0,
	targetFPS: 60,
	boundAnimate: null,

	start() {
		if (this.active) return;
		this.active = true;
		this.frameInterval = 1000 / this.targetFPS;
		// bind를 한 번만 수행하여 메모리 효율성 개선
		if (!this.boundAnimate) {
			this.boundAnimate = this.animate.bind(this);
		}
		this.frameId = requestAnimationFrame(this.boundAnimate);
	},

	stop() {
		if (this.frameId) {
			cancelAnimationFrame(this.frameId);
			this.frameId = null;
		}
		this.active = false;
	},

	addCallback(callback) {
		this.callbacks.add(callback);
		this.start();
	},

	removeCallback(callback) {
		this.callbacks.delete(callback);
		if (this.callbacks.size === 0) {
			this.stop();
		}
	},

	animate(currentTime) {
		if (!this.active) return;

		if (currentTime - this.lastTime >= this.frameInterval) {
			this.callbacks.forEach(callback => {
				try {
					callback();
				} catch (error) {
					// Error ignored
				}
			});
			this.lastTime = currentTime;
		}
		this.frameId = requestAnimationFrame(this.boundAnimate);
	}
};

// Enhanced visibility change manager to prevent duplicate listeners (최적화 #8 - 메모리 누수 수정)
const VisibilityManager = {
	listeners: new Set(),
	isListening: false,
	boundHandler: null,

	init() {
		// bind()로 생성된 함수 참조를 저장하여 제거 가능하게 함
		this.boundHandler = this.handleVisibilityChange.bind(this);
	},

	addListener(callback) {
		if (!this.boundHandler) this.init();

		this.listeners.add(callback);
		if (!this.isListening) {
			document.addEventListener('visibilitychange', this.boundHandler);
			this.isListening = true;
		}
	},

	removeListener(callback) {
		this.listeners.delete(callback);
		if (this.listeners.size === 0 && this.isListening) {
			document.removeEventListener('visibilitychange', this.boundHandler);
			this.isListening = false;
		}
	},

	handleVisibilityChange() {
		const isVisible = !document.hidden;
		this.listeners.forEach(callback => {
			try {
				callback(isVisible);
			} catch (error) {
				// Error ignored
			}
		});
	}
};

// Expose managers globally for performance monitoring
if (typeof window !== 'undefined') {
	window.AnimationManager = AnimationManager;
	window.VisibilityManager = VisibilityManager;
}

const useTrackPosition = (callback) => {
	const callbackRef = useRef();
	const mountedRef = useRef(true);
	const isActiveRef = useRef(true);

	callbackRef.current = callback;

	useEffect(() => {
		// Component mounted
		mountedRef.current = true;
		isActiveRef.current = true;

		const wrappedCallback = () => {
			if (mountedRef.current && isActiveRef.current && callbackRef.current) {
				callbackRef.current();
			}
		};

		// Add to global animation manager
		AnimationManager.addCallback(wrappedCallback);

		// Add visibility listener
		const visibilityCallback = (isVisible) => {
			if (mountedRef.current) {
				isActiveRef.current = isVisible;
			}
		};
		VisibilityManager.addListener(visibilityCallback);

		return () => {
			// Component unmounting
			mountedRef.current = false;
			isActiveRef.current = false;
			AnimationManager.removeCallback(wrappedCallback);
			VisibilityManager.removeListener(visibilityCallback);
		};
	}, []);
};

const getKaraokeLineBounds = (line) => {
	if (!line?.syllables || !Array.isArray(line.syllables) || line.syllables.length === 0) {
		const startTime = Number.isFinite(line?.startTime) ? line.startTime : 0;
		const endTime = Number.isFinite(line?.endTime) ? line.endTime : startTime;
		return { startTime, endTime };
	}

	let startTime = Infinity;
	let endTime = -Infinity;

	for (const syllable of line.syllables) {
		if (!syllable) continue;
		const syllableStart = Number.isFinite(syllable.startTime) ? syllable.startTime : null;
		const syllableEnd = Number.isFinite(syllable.endTime) ? syllable.endTime : syllableStart;

		if (syllableStart !== null) {
			startTime = Math.min(startTime, syllableStart);
			endTime = Math.max(endTime, syllableEnd ?? syllableStart);
		}
	}

	if (!Number.isFinite(startTime)) {
		startTime = Number.isFinite(line?.startTime) ? line.startTime : 0;
	}
	if (!Number.isFinite(endTime)) {
		endTime = Number.isFinite(line?.endTime) ? line.endTime : startTime;
	}

	return { startTime, endTime };
};

const buildKaraokeFuriganaMap = (processedText) => {
	const furiganaMap = new Map();
	if (typeof processedText !== "string" || !processedText.includes("<ruby>")) {
		return furiganaMap;
	}

	const rubyRegex = /<ruby>([^<]+)<rt>([^<]+)<\/rt><\/ruby>/g;
	let currentPos = 0;
	let lastMatchEnd = 0;
	let match;

	rubyRegex.lastIndex = 0;

	while ((match = rubyRegex.exec(processedText)) !== null) {
		const kanjiSequence = match[1];
		const reading = match[2];
		const beforeMatch = processedText.substring(lastMatchEnd, match.index);
		const plainTextBefore = beforeMatch.replace(/<[^>]+>/g, "");
		currentPos += Array.from(plainTextBefore).length;

		const kanjiChars = Array.from(kanjiSequence);
		if (kanjiChars.length === 1) {
			furiganaMap.set(currentPos, reading);
		} else {
			const readingChars = Array.from(reading);
			const charsPerKanji = Math.max(1, Math.floor(readingChars.length / kanjiChars.length));
			kanjiChars.forEach((_, idx) => {
				const nextReading = idx === kanjiChars.length - 1
					? readingChars.slice(idx * charsPerKanji).join("")
					: readingChars.slice(idx * charsPerKanji, (idx + 1) * charsPerKanji).join("");
				furiganaMap.set(currentPos + idx, nextReading);
			});
		}

		currentPos += kanjiChars.length;
		lastMatchEnd = match.index + match[0].length;
	}

	return furiganaMap;
};

const buildKaraokeTimedChars = (line) => {
	const timedChars = [];

	if (line?.syllables && Array.isArray(line.syllables) && line.syllables.length > 0) {
		line.syllables.forEach((syllable) => {
			if (!syllable || !syllable.text) return;

			const charArray = Array.from(syllable.text || "");
			const syllableStart = Number.isFinite(syllable.startTime) ? syllable.startTime : (line.startTime || 0);
			const syllableEnd = Number.isFinite(syllable.endTime) ? syllable.endTime : syllableStart + 500;
			const charDuration = Math.max(1, (syllableEnd - syllableStart) / Math.max(1, charArray.length));

			charArray.forEach((char, charIndex) => {
				const charStart = syllableStart + (charIndex * charDuration);
				timedChars.push({
					char,
					startTime: charStart,
					endTime: charStart + charDuration,
				});
			});
		});
	}

	if (timedChars.length > 0) {
		return timedChars;
	}

	const fallbackChars = Array.from(getCopyableText(line?.text) || "");
	const { startTime, endTime } = getKaraokeLineBounds(line);
	const totalDuration = Math.max(1, endTime - startTime || 500);
	const charDuration = Math.max(1, totalDuration / Math.max(1, fallbackChars.length || 1));

	return fallbackChars.map((char, index) => ({
		char,
		startTime: startTime + (index * charDuration),
		endTime: startTime + ((index + 1) * charDuration),
	}));
};

const applyKaraokeWhitespaceCompensation = (timedChars) => {
	if (!Array.isArray(timedChars) || timedChars.length < 2) {
		return timedChars;
	}

	let didChange = false;
	const compensatedChars = timedChars.map((charInfo, index) => {
		const nextCharInfo = timedChars[index + 1];
		if (!nextCharInfo) {
			return charInfo;
		}

		const currentChar = charInfo?.char || "";
		const nextChar = nextCharInfo?.char || "";
		const duration = Math.max(0, (charInfo?.endTime || 0) - (charInfo?.startTime || 0));
		const nextCharDuration = Math.max(0, (nextCharInfo?.endTime || 0) - (nextCharInfo?.startTime || 0));
		const isPreWhitespaceChar = currentChar && !/\s/u.test(currentChar) && /\s/u.test(nextChar);

		if (!isPreWhitespaceChar || duration >= KARAOKE_PRE_SPACE_MIN_DURATION_MS) {
			return charInfo;
		}

		const compensatedDuration = Math.max(
			KARAOKE_PRE_SPACE_MIN_DURATION_MS,
			Math.min(
				KARAOKE_PRE_SPACE_MAX_DURATION_MS,
				nextCharDuration * KARAOKE_PRE_SPACE_NEXT_CHAR_RATIO
			)
		);

		didChange = true;
		return {
			...charInfo,
			endTime: charInfo.startTime + compensatedDuration,
		};
	});

	return didChange ? compensatedChars : timedChars;
};

const getKaraokeCharFill = (position, isActive, startTime, endTime) => {
	if (!isActive) {
		return 0;
	}
	if (position <= startTime) {
		return 0;
	}
	if (position >= endTime) {
		return 1;
	}
	return Math.max(0, Math.min(1, (position - startTime) / Math.max(1, endTime - startTime)));
};

const getKaraokeBounceValues = (position, isActive, startTime, endTime) => {
	if (!CONFIG.visual["karaoke-bounce"] || !isActive) {
		return {
			offsetY: 0,
			scale: 1,
		};
	}

	const duration = Math.max(1, endTime - startTime);
	const releaseDuration = Math.max(240, Math.min(560, duration * 1.6));
	const totalWindow = duration + releaseDuration;
	const elapsed = position - startTime;

	if (elapsed < 0 || elapsed > totalWindow) {
		return {
			offsetY: 0,
			scale: 1,
		};
	}

	const riseDuration = Math.max(52, Math.min(120, duration * 0.42));
	let waveStrength;

	if (elapsed <= riseDuration) {
		const riseProgress = elapsed / riseDuration;
		waveStrength = 1 - Math.pow(1 - riseProgress, 3);
	} else {
		const fallProgress = Math.min(1, (elapsed - riseDuration) / Math.max(1, totalWindow - riseDuration));
		waveStrength = Math.pow(1 - fallProgress, 1.75);
	}

	return {
		offsetY: -6 * waveStrength,
		scale: 1 + 0.06 * waveStrength,
	};
};

const KaraokeLine = react.memo(({ line, position, isActive, globalCharOffset = 0, activeGlobalCharIndex = -1 }) => {
	if (!line) {
		return "";
	}

	const { furiganaMap, timedChars, endTime } = useMemo(() => {
		const rawLineText = line.syllables?.map((syllable) => syllable?.text || "").join("")
			|| getCopyableText(line.text)
			|| "";
		const processedText = Utils.applyFuriganaIfEnabled(rawLineText);
		const compensatedTimedChars = applyKaraokeWhitespaceCompensation(buildKaraokeTimedChars(line));

		return {
			furiganaMap: buildKaraokeFuriganaMap(processedText),
			timedChars: compensatedTimedChars,
			endTime: compensatedTimedChars.reduce(
				(maxEndTime, charInfo) => Math.max(maxEndTime, Number.isFinite(charInfo?.endTime) ? charInfo.endTime : 0),
				getKaraokeLineBounds(line).endTime
			),
		};
	}, [line]);
	const isComplete = isActive && position >= endTime;

	const charElements = timedChars.map((charInfo, index) => {
		const fillValue = Math.max(0, Math.min(100, getKaraokeCharFill(
			position,
			isActive,
			charInfo.startTime,
			charInfo.endTime
		) * 100));
		const softEdge = 16;
		const fillPercent = `${fillValue}%`;
		const shouldFeather = fillValue > 0 && fillValue < 100;
		const fillSoftStart = `${shouldFeather ? Math.max(0, fillValue - softEdge) : fillValue}%`;
		const fillSoftEnd = `${shouldFeather ? Math.min(100, fillValue + softEdge) : fillValue}%`;
		const bounce = getKaraokeBounceValues(
			position,
			isActive,
			charInfo.startTime,
			charInfo.endTime
		);
		const karaokeStyle = {
			"--karaoke-char-fill": fillPercent,
			"--karaoke-char-fill-soft-start": fillSoftStart,
			"--karaoke-char-fill-soft-end": fillSoftEnd,
			"--karaoke-bounce-y": `${bounce.offsetY}px`,
			"--karaoke-bounce-scale": bounce.scale,
		};
		const className = `lyrics-karaoke-char${isComplete ? " is-complete" : ""}`;
		const charNode = react.createElement(
			"span",
			{
				className,
				style: karaokeStyle,
				key: `karaoke-char-${index}`,
			},
			charInfo.char
		);
		const reading = furiganaMap.get(index);

		if (!reading) {
			return charNode;
		}

		return react.createElement(
			"ruby",
			{
				className: "lyrics-karaoke-ruby",
				style: karaokeStyle,
				key: `karaoke-ruby-${index}`,
			},
			charNode,
			react.createElement("rt", null, reading)
		);
	});

	return react.createElement(
		"span",
		{
			className: `lyrics-karaoke-line${isActive ? " is-active" : ""}${isComplete ? " is-complete" : ""}`,
		},
		charElements
	);
});

const SyncedLyricsPage = react.memo(({ lyrics = [], provider, contributors, copyright, isKara }) => {
	const position = useLyricsPlaybackPosition();
	const [containerReady, setContainerReady] = useState(false);
	const compactActiveLineEle = useRef();
	const lyricContainerEle = useRef();
	const lyricsId = useMemo(() => lyrics[0]?.text || "no-lyrics", [lyrics]);

	const containerRefCallback = useCallback((node) => {
		lyricContainerEle.current = node;
		if (node) {
			setContainerReady(true);
		}
	}, []);
	const {
		isScrolling,
		handleContainerClick,
		renderItems,
		compactOffset,
		activeLyricIndex,
		globalCharOffsets,
		activeGlobalCharIndex,
	} = useSyncedLyricsEngine({
		lyrics,
		position,
		compact: true,
		isKara,
		containerRef: lyricContainerEle,
		activeLineRef: compactActiveLineEle,
		lyricsId,
		containerReady,
	});

	const prevScrollModeRef = useRef(false);
	useEffect(() => {
		if (!isScrolling) {
			if (prevScrollModeRef.current && lyricContainerEle.current) {
				lyricContainerEle.current.scrollTop = 0;
			}
			prevScrollModeRef.current = false;
			return undefined;
		}

		if (prevScrollModeRef.current) {
			return undefined;
		}

		const raf = typeof requestAnimationFrame === "function"
			? requestAnimationFrame
			: (callback) => setTimeout(callback, 0);
		const cancelRaf = typeof cancelAnimationFrame === "function"
			? cancelAnimationFrame
			: clearTimeout;
		let nestedFrameId = null;
		const frameId = raf(() => {
			nestedFrameId = raf(() => {
				scrollSyncedContainerToActiveLine(
					lyricContainerEle.current,
					compactActiveLineEle.current,
					"auto"
				);
			});
		});

		prevScrollModeRef.current = isScrolling;
		return () => {
			cancelRaf(frameId);
			if (nestedFrameId !== null) {
				cancelRaf(nestedFrameId);
			}
		};
	}, [isScrolling, lyricsId]);

	if (!Array.isArray(lyrics) || lyrics.length === 0) {
		return react.createElement("div", { className: "lyrics-lyricsContainer-SyncedLyricsPage" }, renderLyricsUnavailable(I18n.t("messages.noLyrics")));
	}

	return react.createElement(
		"div",
		{
			className: `lyrics-lyricsContainer-SyncedLyricsPage ${isScrolling ? "scrolling-active" : ""}`,
			ref: containerRefCallback,
			onClick: handleContainerClick,
		},
		react.createElement(
			"div",
			{
				className: "lyrics-lyricsContainer-SyncedLyrics",
				style: {
					"--offset": `${compactOffset}px`,
				},
				key: lyricsId,
			},
			...renderLyricsItems({
				items: renderItems,
				isKara,
				position,
				activeLineRef: compactActiveLineEle,
			})
		)
	);
});

// Global SearchBar manager to prevent duplicate instances
const SearchBarManager = {
	instance: null,
	bindings: new Set(),

	register(instance) {
		// Clean up previous instance
		if (this.instance) {
			this.cleanup();
		}
		this.instance = instance;
	},

	unregister(instance) {
		if (this.instance === instance) {
			this.cleanup();
			this.instance = null;
		}
	},

	bind(key, callback) {
		const bindingKey = `${key}-${callback.name}`;
		if (this.bindings.has(bindingKey)) {
			return; // Already bound
		}
		Spicetify.Mousetrap().bind(key, callback);
		this.bindings.add(bindingKey);
	},

	bindToContainer(container, key, callback) {
		const bindingKey = `container-${key}-${callback.name}`;
		if (this.bindings.has(bindingKey)) {
			return; // Already bound
		}
		Spicetify.Mousetrap(container).bind(key, callback);
		this.bindings.add(bindingKey);
	},

	cleanup() {
		this.bindings.forEach(bindingKey => {
			const [type, key] = bindingKey.split('-');
			if (type === 'container' && this.instance?.container) {
				try {
					Spicetify.Mousetrap(this.instance.container).unbind(key);
				} catch (e) {
					// Container might be null
				}
			} else {
				try {
					Spicetify.Mousetrap().unbind(key);
				} catch (e) {
					// Mousetrap might not be available
				}
			}
		});
		this.bindings.clear();
	}
};

class SearchBar extends react.Component {
	constructor() {
		super();
		this.state = {
			hidden: true,
			atNode: 0,
			foundNodes: [],
		};
		this.container = null;
		this.instanceId = `searchbar-${Date.now()}-${Math.random()}`;
		this.getNodeFromInput = this.getNodeFromInput.bind(this);
		this.handleInputRef = (node) => {
			this.container = node;
		};
	}

	componentDidMount() {
		// Register with global manager
		SearchBarManager.register(this);

		this.viewPort = document.querySelector(".main-view-container .os-viewport");
		this.mainViewOffsetTop = document.querySelector(".Root__main-view")?.offsetTop || 0;

		this.toggleCallback = () => {
			if (!(Spicetify.Platform.History.location.pathname === "/ivLyrics" && this.container)) return;

			if (this.state.hidden) {
				this.setState({ hidden: false });
				this.container.focus();
			} else {
				this.setState({ hidden: true });
				this.container.blur();
			}
		};
		this.unFocusCallback = () => {
			if (this.container) {
				this.container.blur();
				this.setState({ hidden: true });
			}
		};
		this.loopThroughCallback = (event) => {
			if (!this.state.foundNodes.length) {
				return;
			}

			if (event.key === "Enter") {
				const dir = event.shiftKey ? -1 : 1;
				let atNode = this.state.atNode + dir;
				if (atNode < 0) {
					atNode = this.state.foundNodes.length - 1;
				}
				atNode %= this.state.foundNodes.length;
				const rects = this.state.foundNodes[atNode].getBoundingClientRect();
				if (this.viewPort) {
					this.viewPort.scrollBy(0, rects.y - 100);
				}
				this.setState({ atNode });
			}
		};

		// Use SearchBarManager to prevent duplicate bindings
		SearchBarManager.bind("mod+shift+f", this.toggleCallback);
		if (this.container) {
			SearchBarManager.bindToContainer(this.container, "mod+shift+f", this.toggleCallback);
			SearchBarManager.bindToContainer(this.container, "enter", this.loopThroughCallback);
			SearchBarManager.bindToContainer(this.container, "shift+enter", this.loopThroughCallback);
			SearchBarManager.bindToContainer(this.container, "esc", this.unFocusCallback);
		}
	}

	componentWillUnmount() {
		// Unregister from global manager
		SearchBarManager.unregister(this);
	}

	getNodeFromInput(event) {
		const value = event.target.value.toLowerCase();
		if (!value) {
			this.setState({ foundNodes: [] });
			this.viewPort.scrollTo(0, 0);
			return;
		}

		const lyricsPage = document.querySelector(".lyrics-lyricsContainer-UnsyncedLyricsPage");
		const walker = document.createTreeWalker(
			lyricsPage,
			NodeFilter.SHOW_TEXT,
			(node) => {
				if (node.textContent.toLowerCase().includes(value)) {
					return NodeFilter.FILTER_ACCEPT;
				}
				return NodeFilter.FILTER_REJECT;
			},
			false
		);

		const foundNodes = [];
		while (walker.nextNode()) {
			const range = document.createRange();
			range.selectNodeContents(walker.currentNode);
			foundNodes.push(range);
		}

		if (!foundNodes.length) {
			this.viewPort.scrollBy(0, 0);
		} else {
			const rects = foundNodes[0].getBoundingClientRect();
			this.viewPort.scrollBy(0, rects.y - 100);
		}

		this.setState({ foundNodes, atNode: 0 });
	}

	render() {
		let y = 0;
		let height = 0;
		if (this.state.foundNodes.length) {
			const node = this.state.foundNodes[this.state.atNode];
			const rects = node.getBoundingClientRect();
			y = rects.y + this.viewPort.scrollTop - this.mainViewOffsetTop;
			height = rects.height;
		}
		return react.createElement(
			"div",
			{
				className: `lyrics-Searchbar${this.state.hidden ? " hidden" : ""}`,
			},
						react.createElement("input", {
								ref: this.handleInputRef,
								onChange: this.getNodeFromInput,
						}),
			react.createElement("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				fill: "currentColor",
				dangerouslySetInnerHTML: {
					__html: Spicetify.SVGIcons.search,
				},
			}),
			react.createElement(
				"span",
				{
					hidden: this.state.foundNodes.length === 0,
				},
				`${this.state.atNode + 1}/${this.state.foundNodes.length}`
			),
			react.createElement("div", {
				className: "lyrics-Searchbar-highlight",
				style: {
					"--search-highlight-top": `${y}px`,
					"--search-highlight-height": `${height}px`,
				},
			})
		);
	}
}

function isInViewport(element) {
	const rect = element.getBoundingClientRect();
	return (
		rect.top >= 0 &&
		rect.left >= 0 &&
		rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
		rect.right <= (window.innerWidth || document.documentElement.clientWidth)
	);
}

const SyncedExpandedLyricsPage = react.memo(({ lyrics = [], provider, contributors, copyright, isKara }) => {
	const position = useLyricsPlaybackPosition();
	const activeLineRef = useRef(null);
	const pageRef = useRef(null);
	const lyricsId = useMemo(() => lyrics[0]?.text || "no-lyrics", [lyrics]);
	const {
		handleContainerClick,
		renderItems,
	} = useSyncedLyricsEngine({
		lyrics,
		position,
		compact: false,
		isKara,
		containerRef: pageRef,
		activeLineRef,
		lyricsId,
	});

	if (!Array.isArray(lyrics) || lyrics.length === 0) {
		return react.createElement("div", { className: "lyrics-lyricsContainer-UnsyncedLyricsPage" }, renderLyricsUnavailable(I18n.t("messages.noLyrics")));
	}

	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
			key: lyricsId,
			ref: pageRef,
			onClick: handleContainerClick,
		},
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		...renderLyricsItems({
			items: renderItems,
			isKara,
			position,
			activeLineRef,
		}),
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		react.createElement(SearchBar, null)
	);
});

const UnsyncedLyricsPage = react.memo(({ lyrics = [], provider, contributors, copyright }) => {
	const lyricsArray = useMemo(() => normalizeUnsyncedLyrics(lyrics), [lyrics]);
	const renderItems = useMemo(() => lyricsArray.map(({ text, originalText, text2 }, index) => {
		const {
			lineText,
			subText,
			showMode2Translation,
			belowMode,
			showMode2,
		} = getUnsyncedLineRenderData(lyrics, text, originalText, text2);

		return {
			key: index,
			mainText: lineText,
			subText: belowMode ? subText : null,
			subText2: showMode2 ? showMode2Translation : null,
			mainCopyText: Utils.formatLyricLineToCopy(
				lineText,
				belowMode ? subText : null,
				showMode2 ? showMode2Translation : null,
				originalText
			),
			subCopyText: belowMode ? subText : null,
			subText2CopyText: showMode2 ? showMode2Translation : null,
			originalText,
		};
	}), [lyricsArray, lyrics]);

	if (lyricsArray.length === 0) {
		return react.createElement("div", { className: "lyrics-lyricsContainer-UnsyncedLyricsPage" }, renderLyricsUnavailable(I18n.t("messages.noLyrics")));
	}

	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
		},
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		...renderItems.map((item) =>
			react.createElement(LyricsLineBlock, {
				key: item.key,
				className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
				mainText: item.mainText,
				subText: item.subText,
				subText2: item.subText2,
				originalText: item.originalText,
				mainCopyText: item.mainCopyText,
				subCopyText: item.subCopyText,
				subText2CopyText: item.subText2CopyText,
			})
		),
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),

		react.createElement(SearchBar, null)
	);
});




const LoadingIcon = react.createElement(
	"svg",
	{
		width: "200px",
		height: "200px",
		viewBox: "0 0 100 100",
		preserveAspectRatio: "xMidYMid",
	},
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "0s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "0s",
		})
	),
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		})
	)
);


const LyricsPage = ({ lyricsContainer }) => {
	const modes = CONFIG.modes;
	const activeMode = lyricsContainer.getCurrentMode();

	const topBarProps = {
		links: modes,
		activeLink: modes[activeMode] || modes[0],
		switchCallback: (mode) => {
			const modeIndex = modes.indexOf(mode);
			if (modeIndex !== -1) {
				lyricsContainer.switchTo(modeIndex);
			}
		}
	};

	const topBarContent = typeof TopBarContent === "function"
		? react.createElement(TopBarContent, topBarProps)
		: null;

	return react.createElement(
		"div",
		{
			className: "lyrics-page-wrapper",
			style: { width: "100%", height: "100%", position: "relative" }
		},
		topBarContent,
		lyricsContainer.render(),
		react.createElement(CreditFooter, {
			provider: lyricsContainer.state.provider,
			contributors: lyricsContainer.state.contributors
		})
	);
};

const LyricsUnavailableView = react.memo(({ isLoading }) =>
	isLoading
		? renderLyricsUnavailable(LoadingIcon)
		: renderLyricsUnavailable("(• _ • )")
);

const LyricsPageRenderer = react.memo(({
	mode = -1,
	karaokeMode = 0,
	syncedMode = 1,
	unsyncedMode = 2,
	trackUri = "",
	currentLyrics = [],
	karaoke = null,
	synced = null,
	unsynced = null,
	provider = null,
	contributors = null,
	copyright = null,
	isLoading = false,
	showMarketplace = false,
	onCloseMarketplace = null,
	reRenderLyricsPage = null,
}) => {
	const sharedLyrics = Array.isArray(currentLyrics) ? currentLyrics : [];
	const karaokeLyrics = Array.isArray(currentLyrics)
		? currentLyrics
		: (Array.isArray(karaoke) ? karaoke : []);

	const renderDescriptor = useMemo(() => {
		if (showMarketplace && typeof MarketplacePage !== "undefined") {
			return {
				component: MarketplacePage,
				props: {
					onClose: onCloseMarketplace,
				},
			};
		}

		if (mode === karaokeMode && karaoke) {
			return {
				component: SyncedLyricsPage,
				props: {
					trackUri,
					lyrics: karaokeLyrics,
					provider,
					contributors,
					copyright,
					isKara: true,
					reRenderLyricsPage,
				},
			};
		}

		if (mode === syncedMode && synced) {
			return {
				component: CONFIG.visual["synced-compact"]
					? SyncedLyricsPage
					: SyncedExpandedLyricsPage,
				props: {
					trackUri,
					lyrics: sharedLyrics,
					provider,
					contributors,
					copyright,
					reRenderLyricsPage,
				},
			};
		}

		if (mode === unsyncedMode && unsynced) {
			return {
				component: UnsyncedLyricsPage,
				props: {
					trackUri,
					lyrics: sharedLyrics,
					provider,
					contributors,
					copyright,
					reRenderLyricsPage,
				},
			};
		}

		return null;
	}, [
		showMarketplace,
		onCloseMarketplace,
		mode,
		karaokeMode,
		syncedMode,
		unsyncedMode,
		karaoke,
		synced,
		unsynced,
		karaokeLyrics,
		sharedLyrics,
		trackUri,
		provider,
		contributors,
		copyright,
		reRenderLyricsPage,
	]);

	const content = useMemo(() => {
		if (!renderDescriptor) {
			return react.createElement(LyricsUnavailableView, { isLoading });
		}

		return react.createElement(renderDescriptor.component, renderDescriptor.props);
	}, [renderDescriptor, isLoading]);

	return react.createElement(
		react.Fragment,
		null,
		content,
		react.createElement(CreditFooter, {
			provider,
			contributors,
		})
	);
});

window.LyricsPageRenderer = LyricsPageRenderer;
