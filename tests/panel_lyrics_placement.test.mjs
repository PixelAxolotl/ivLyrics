import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../NowPlayingPanelLyrics.js", import.meta.url), "utf8");

const slice = (startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	assert.notEqual(start, -1, `start marker not found: ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.notEqual(end, -1, `end marker not found: ${endMarker}`);
	return source.slice(start, end);
};

// Small DOM stand-in with the operations the placement helpers rely on.
class FakeElement {
	constructor({ classes = [], testId = null, name = "" } = {}) {
		this.classes = new Set(classes);
		this.testId = testId;
		this.name = name;
		this.children = [];
		this.parentElement = null;
	}
	append(...nodes) {
		for (const node of nodes) this.insertBefore(node, null);
		return this;
	}
	appendChild(node) {
		return this.insertBefore(node, null);
	}
	insertBefore(node, reference) {
		this.insertCount = (this.insertCount || 0) + 1;
		if (node.parentElement) {
			const siblings = node.parentElement.children;
			siblings.splice(siblings.indexOf(node), 1);
		}
		const index = reference ? this.children.indexOf(reference) : -1;
		if (reference && index < 0) throw new Error("reference is not a child");
		this.children.splice(index < 0 ? this.children.length : index, 0, node);
		node.parentElement = this;
		return node;
	}
	get nextSibling() {
		const siblings = this.parentElement?.children || [];
		return siblings[siblings.indexOf(this) + 1] || null;
	}
	get nextElementSibling() {
		return this.nextSibling;
	}
	get previousElementSibling() {
		const siblings = this.parentElement?.children || [];
		return siblings[siblings.indexOf(this) - 1] || null;
	}
	contains(node) {
		for (let current = node; current; current = current.parentElement) {
			if (current === this) return true;
		}
		return false;
	}
	matches(selector) {
		return selector.split(",").some((part) => {
			const simple = part.trim();
			const testId = simple.match(/^\[data-testid="([^"]+)"\]$/);
			if (testId) return this.testId === testId[1];
			if (simple.startsWith(".")) return this.classes.has(simple.slice(1));
			throw new Error(`unsupported selector: ${simple}`);
		});
	}
	querySelector(selector) {
		for (const child of this.children) {
			if (child.matches(selector)) return child;
			const nested = child.querySelector(selector);
			if (nested) return nested;
		}
		return null;
	}
}

const loadPlacementHelpers = () => {
	const helpers = slice("    const PANEL_HEADER_VISUAL_SELECTOR =", "    // Starry Night 테마 감지");
	const context = vm.createContext({ panelDebug() {}, console });
	vm.runInContext(
		`${helpers}
globalThis.helpers = { findPanelContextItemInfo, getPanelLyricsSlot, isPanelContainerPlaced, placePanelContainer, ensurePanelContainerPlacement };`,
		context
	);
	return context.helpers;
};

// Builds the Spotify 1.3.x Now Playing panel. With mapped=false only hashed
// class names exist, as when the Spicetify CSS map lacks the NPV mappings.
const buildPanel = ({ mapped, withHeader = true } = {}) => {
	const cls = (readable, hashed) => [mapped ? readable : hashed];
	const panel = new FakeElement({ testId: "NPV_Panel_OpenDiv", name: "panel" });
	const widget = new FakeElement({ classes: cls("main-nowPlayingView-nowPlayingWidget", "pqE5eDSKYuSBxdFtL7LM"), name: "widget" });
	const grid = new FakeElement({ classes: cls("main-nowPlayingView-nowPlayingGrid", "h7dZG0w8Jk1revePkNbK"), name: "grid" });
	const cover = new FakeElement({ classes: cls("main-nowPlayingView-coverArtContainer", "dXPcsn9IbcLL88Zvq6iQ"), name: "cover" });
	cover.append(new FakeElement({ testId: "track-visual-enhancement", name: "visual" }));
	grid.append(cover);
	let info = null;
	if (withHeader) {
		info = new FakeElement({ classes: cls("main-nowPlayingView-contextItemInfo", "uR1BMutIFRmR6BBWSAWo"), name: "info" });
		// Spotify always renders the minimized visual as the first child of the
		// track info block (data-testid survives a missing CSS map).
		const minimizedVisual = new FakeElement({ testId: "minimized-track-visual-enhancement", name: "minimizedVisual" });
		minimizedVisual.append(new FakeElement({ name: "contextLink" }));
		const trackInfo = new FakeElement({ classes: cls("main-nowPlayingView-trackInfo", "JeLnW9U7qWvy1faGLY1w"), name: "trackInfo" });
		info.append(minimizedVisual, trackInfo, new FakeElement({ name: "actions" }));
		grid.append(info);
	}
	widget.append(grid);
	const aboutArtist = new FakeElement({ classes: cls("main-nowPlayingView-section", "xAHDimZ5EWtt5x3_YMzZ"), name: "aboutArtist" });
	const queue = new FakeElement({ classes: cls("main-nowPlayingView-section", "xAHDimZ5EWtt5x3_YMzZ"), name: "queue" });
	panel.append(widget, aboutArtist, queue);
	return { panel, grid, info, aboutArtist, queue };
};

for (const mapped of [true, false]) {
	test(`panel lyrics are placed right under the track info (${mapped ? "mapped" : "unmapped"} NPV classes)`, () => {
		const { findPanelContextItemInfo, placePanelContainer, getPanelLyricsSlot, isPanelContainerPlaced } = loadPlacementHelpers();
		const { panel, grid, info } = buildPanel({ mapped });
		assert.equal(findPanelContextItemInfo(panel), info);

		const container = new FakeElement({ name: "ivlyrics" });
		assert.equal(placePanelContainer(panel, container), true);
		assert.equal(container.parentElement, grid);
		assert.equal(container.previousElementSibling, info);
		assert.equal(isPanelContainerPlaced(container, getPanelLyricsSlot(panel)), true);
	});
}

test("a card appended at the bottom moves under the track info once the header is rendered", () => {
	const { ensurePanelContainerPlacement } = loadPlacementHelpers();
	const { panel, grid, info, queue } = buildPanel({ mapped: false });
	const container = new FakeElement({ name: "ivlyrics" });
	panel.appendChild(container);
	assert.equal(container.previousElementSibling, queue, "starts below the artist sections");

	ensurePanelContainerPlacement(panel, container);
	assert.equal(container.parentElement, grid);
	assert.equal(container.previousElementSibling, info);

	const inserts = grid.insertCount;
	ensurePanelContainerPlacement(panel, container);
	assert.equal(grid.insertCount, inserts, "an already placed card is not moved again");
});

test("no slot is reported while the track info is not rendered yet", () => {
	const { getPanelLyricsSlot, placePanelContainer, isPanelContainerPlaced } = loadPlacementHelpers();
	const { panel, aboutArtist } = buildPanel({ mapped: false, withHeader: false });
	assert.equal(getPanelLyricsSlot(panel), null, "hashed section classes are not a reliable anchor");
	const container = new FakeElement({ name: "ivlyrics" });
	assert.equal(placePanelContainer(panel, container), false);
	assert.equal(container.parentElement, null);
	assert.equal(isPanelContainerPlaced(container, null), true);

	const mapped = buildPanel({ mapped: true, withHeader: false });
	const mappedContainer = new FakeElement({ name: "ivlyrics" });
	assert.equal(placePanelContainer(mapped.panel, mappedContainer), true);
	assert.equal(mappedContainer.nextElementSibling, mapped.aboutArtist, "falls back to before the first related section");
	assert.notEqual(aboutArtist, null);
});

test("insertion waits for the track info instead of appending to the panel end immediately", () => {
	const insert = slice("    const insertPanelLyrics = () => {", "    const removePanelLyrics = () => {");
	assert.match(insert, /if \(!slot && panelSlotRetryCount < PANEL_SLOT_MAX_RETRIES\)/);
	assert.match(insert, /scheduleInsertPanelLyrics\(PANEL_SLOT_RETRY_DELAY\)/);
	assert.match(insert, /ensurePanelContainerPlacement\(panel, existingContainer\)/);
	const observer = slice("    const setupObserver = () => {", "    const teardownObserver =");
	assert.match(observer, /ensurePanelContainerPlacement\(panel, container\)/);
});

test("panel shows 'lyrics not found' instead of loading forever when lookup finds nothing", () => {
	const emptyState = slice("        const renderPanelEmptyState = () =>", "        const renderPanelLyricsTree = () =>");
	assert.match(emptyState, /lyricsNotFound\s*\?\s*translatePanelText\("syncCreator\.noLyrics"/);
	const loader = slice("        const loadLyricsFromExtension = useCallback(", "        const loadTranslationAsync = useCallback(");
	assert.equal((loader.match(/setLyricsNotFound\(true\)/g) || []).length, 3, "every no-lyrics branch marks the lookup as finished");
	assert.match(loader, /setLyricsNotFound\(false\);/);
});
