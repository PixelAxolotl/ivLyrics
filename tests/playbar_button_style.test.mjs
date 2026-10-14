import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../PlaybarButton.js", import.meta.url), "utf8");

class FakeClassList {
	constructor() {
		this.values = new Set();
	}
	add(...names) {
		names.forEach((name) => this.values.add(name));
	}
	remove(...names) {
		names.forEach((name) => this.values.delete(name));
	}
	toggle(name, force) {
		const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
		if (enabled) this.values.add(name);
		else this.values.delete(name);
		return enabled;
	}
	contains(name) {
		return this.values.has(name);
	}
}

const createElement = (tagName) => ({
	tagName: tagName.toUpperCase(),
	id: "",
	textContent: "",
	innerHTML: "",
	classList: new FakeClassList(),
	remove() {
		this.removed = true;
	},
});

// Mirrors Spicetify.Playbar.Button: on Spotify 1.3+ it cannot copy classes
// from a native sibling, so the element only carries main-genericButton-*.
class FakePlaybarButton {
	constructor(label, icon, onClick, disabled, active, registerOnCreate) {
		this.label = label;
		this.element = createElement("button");
		this.element.classList.add("main-genericButton-button");
		this.registered = false;
		this.active = active;
		if (registerOnCreate) this.register();
	}
	set active(value) {
		this._active = value;
		this.element.classList.toggle("main-genericButton-buttonActive", value);
		this.element.classList.toggle("main-genericButton-buttonActiveDot", value);
	}
	get active() {
		return this._active;
	}
	register() {
		this.registered = true;
	}
	deregister() {
		this.registered = false;
	}
}

const loadPlaybarButtons = ({ lyricsButtonEnabled = "true", fullscreenButtonEnabled = "true" } = {}) => {
	const created = [];
	const headChildren = [];
	const PlaybarButtonSpy = class extends FakePlaybarButton {
		constructor(...args) {
			super(...args);
			created.push(this);
		}
	};
	const document = {
		head: {
			appendChild(node) {
				headChildren.push(node);
				return node;
			},
		},
		createElement,
		getElementById(id) {
			return headChildren.find((node) => node.id === id) || null;
		},
		querySelector() {
			return {};
		},
		querySelectorAll() {
			return [];
		},
	};
	const storage = {
		"ivLyrics:visual:playbar-button": lyricsButtonEnabled,
		"ivLyrics:visual:fullscreen-button": fullscreenButtonEnabled,
	};
	const timers = [];
	const context = vm.createContext({
		console,
		document,
		window: { addEventListener() {}, dispatchEvent() {} },
		setTimeout(callback) {
			timers.push(callback);
			return timers.length;
		},
		CustomEvent: class {},
		Spicetify: {
			Platform: {
				History: {
					location: { pathname: "/" },
					listen() {},
					push() {},
					goBack() {},
				},
			},
			Playbar: { Button: PlaybarButtonSpy },
			LocalStorage: { get: (key) => storage[key] ?? null },
		},
	});
	vm.runInContext(source, context);
	// Run the deferred registration checks (they resolve immediately because
	// querySelector always finds the rendered button in this fake DOM).
	while (timers.length) timers.shift()();
	return { created, headChildren };
};

test("ivLyrics playbar buttons get native-looking control styling", () => {
	const { created, headChildren } = loadPlaybarButtons();
	assert.equal(created.length, 2, "expected the lyrics and fullscreen buttons");
	for (const control of created) {
		assert.ok(
			control.element.classList.contains("ivlyrics-playbar-control"),
			`${control.label} button is missing the ivLyrics control class`
		);
	}

	const styles = headChildren.filter((node) => node.id === "ivlyrics-playbar-control-style");
	assert.equal(styles.length, 1, "control style must be injected exactly once");
	const css = styles[0].textContent;
	assert.match(css, /button\.ivlyrics-playbar-control \{[^}]*background: transparent;/);
	assert.match(css, /button\.ivlyrics-playbar-control \{[^}]*border: 0;/);
	assert.match(css, /button\.ivlyrics-playbar-control \{[^}]*appearance: none;/);
	assert.match(css, /button\.ivlyrics-playbar-control\.main-genericButton-buttonActive \{/);
	assert.match(css, /button\.ivlyrics-playbar-control\.main-genericButton-buttonActiveDot::after \{/);
});

test("control styling does not depend on the replacement settings being enabled first", () => {
	// The fullscreen button is created with registerOnCreate=true, so it is in the
	// playbar even while the replacement setting is off and must still be styled.
	const { created, headChildren } = loadPlaybarButtons({ lyricsButtonEnabled: "false", fullscreenButtonEnabled: "false" });
	for (const control of created) {
		assert.ok(control.element.classList.contains("ivlyrics-playbar-control"));
	}
	assert.equal(headChildren.filter((node) => node.id === "ivlyrics-playbar-control-style").length, 1);
});
