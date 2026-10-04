import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const panelSource = readFileSync(new URL("../NowPlayingPanelLyrics.js", import.meta.url), "utf8");
const utilsSource = readFileSync(new URL("../Utils.js", import.meta.url), "utf8");

// Slices a source region between two literal markers so the real component and
// the real Utils helpers can be executed in isolation. `end` defaults to the
// next occurrence of `endMarker` after `startMarker`.
const slice = (source, startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	assert.notEqual(start, -1, `start marker not found: ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.notEqual(end, -1, `end marker not found: ${endMarker}`);
	return source.slice(start, end);
};

// Executes the real Utils ruby/HTML helpers so the panel test asserts against
// the same escaping the main lyrics view (Pages.js) already relies on.
const loadUtils = () => {
	const start = utilsSource.indexOf("  rubyTextToHTML(s) {");
	const end = utilsSource.indexOf("  escapeHtml(value) {");
	const context = vm.createContext({});
	vm.runInContext(
		`const Utils = {
${utilsSource.slice(start, end)}
};
globalThis.Utils = Utils;`,
		context
	);
	return context.Utils;
};

// Renders the real NormalLine component and returns the props it hands to the
// <p> element, so we can inspect the __html string React would inject.
const renderNormalLine = (displayText) => {
	const component = slice(panelSource, "const NormalLine = memo(", "const LyricLine = memo(");

	const created = [];
	const react = {
		createElement(type, props, ...children) {
			created.push({ type, props, children });
			return { type, props, children };
		},
		memo(fn) {
			return fn;
		},
	};

	const context = vm.createContext({ react, memo: react.memo, Utils: loadUtils(), console });
	vm.runInContext(`${component}\nglobalThis.NormalLine = NormalLine;`, context);

	created.length = 0;
	context.NormalLine({ displayText, phonetic: undefined, translation: undefined, lineClass: "c", lineStyle: undefined });
	const paragraph = created.find((node) => node.type === "p");
	assert.ok(paragraph, "NormalLine did not create a <p> element");
	return paragraph.props;
};

test("Now Playing panel escapes remote lyric markup before injecting it as HTML", () => {
	const { rubyTextToHTML } = loadUtils();
	const injected = "<img src=x onerror=window.__pwned=1>";
	const props = renderNormalLine(injected);

	assert.ok(
		props.dangerouslySetInnerHTML,
		"expected the panel to keep using dangerouslySetInnerHTML for furigana markup"
	);

	const html = props.dangerouslySetInnerHTML.__html;
	assert.equal(
		html,
		rubyTextToHTML(injected),
		"panel __html must match the escaping the main lyrics view applies"
	);
	assert.ok(!html.includes("<img"), "raw <img> survived into the injected HTML");
	// The handler text itself is allowed to survive as escaped literal text —
	// what must not survive is a live attribute, which only `<` escaping prevents.
	assert.ok(!html.includes('onerror="'), "onerror became a live attribute rather than literal text");
});

test("Now Playing panel still renders the furigana markup it generates itself", () => {
	const { rubyTextToHTML } = loadUtils();
	const furigana = "<ruby>漢字<rt>かんじ</rt></ruby>";
	const html = renderNormalLine(furigana).dangerouslySetInnerHTML.__html;

	assert.equal(html, rubyTextToHTML(furigana));
	assert.ok(html.includes("<ruby>"), "self-generated <ruby> must keep working");
	assert.ok(html.includes("<rt>"), "self-generated <rt> must keep working");
});

test("Now Playing panel renders plain lyric text unchanged", () => {
	const { rubyTextToHTML } = loadUtils();
	const plain = "아무노래";
	const html = renderNormalLine(plain).dangerouslySetInnerHTML.__html;

	assert.equal(html, rubyTextToHTML(plain));
	assert.equal(html, plain);
});
