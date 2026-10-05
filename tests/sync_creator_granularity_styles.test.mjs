import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../SyncDataCreator.js", import.meta.url), "utf8");

const extractBlock = (name) => {
	const match = source.match(new RegExp(`${name}:\\s*\\{([^}]*)\\}`, "s"));
	assert.match(source, new RegExp(`${name}:\\s*\\{`), `${name} style block must exist`);
	return match[1];
};

// Regression guard: the granularity buttons toggle between an inactive
// style (border shorthand) and an active overlay style. If the overlay
// only overrides the `borderColor` longhand, React removes just that
// longhand on deactivate while the unchanged `border` shorthand is not
// re-applied; Chromium then leaves border-width/style with no color,
// which falls back to currentcolor (light) — a stuck white border.
test("granularity active style sets a complete border shorthand", () => {
	const active = extractBlock("granularityButtonActive");
	assert.match(active, /(^|[\s,])border\s*:/, "active style must set the full border shorthand");
	assert.match(active, /border\s*:\s*[`'"]1px solid/, "active border must keep the 1px solid shape");
});

test("granularity active style does not rely on a lone borderColor override", () => {
	const active = extractBlock("granularityButtonActive");
	assert.doesNotMatch(active, /(^|[\s,])borderColor\s*:/, "active style must not use a bare borderColor longhand");
});

test("granularity inactive style keeps a transparent border shorthand", () => {
	const inactive = extractBlock("granularityButton");
	assert.match(inactive, /border\s*:\s*['"]1px solid transparent['"]/, "inactive style must keep border: 1px solid transparent");
});

// Same Chromium shorthand/longhand quirk class: overlay styles merged
// conditionally over a base that owns the border must restate the full
// border (or borderBottom), never a lone borderColor longhand.
for (const name of ["parallelStackLineActive", "parallelStackLineDuet", "parallelStackLineDuetActive"]) {
	test(`${name} overlay restates the full border shorthand`, () => {
		const overlay = extractBlock(name);
		assert.match(overlay, /(^|[\s,])border\s*:/, `${name} must set the full border shorthand`);
		assert.doesNotMatch(overlay, /(^|[\s,])borderColor\s*:/, `${name} must not use a bare borderColor longhand`);
	});
}

test("candidateItemApplied overlay restates borderBottom", () => {
	const overlay = extractBlock("candidateItemApplied");
	assert.match(overlay, /(^|[\s,])borderBottom\s*:/, "applied overlay must set borderBottom");
	assert.doesNotMatch(overlay, /(^|[\s,])borderColor\s*:/, "applied overlay must not use a bare borderColor longhand");
});

test("revert-button highlight restates the full border shorthand", () => {
	assert.doesNotMatch(source, /borderColor:\s*TOSS_RED/, "revert highlight must not use a bare borderColor longhand");
	assert.match(source, /border:\s*`1px solid \$\{TOSS_RED\}`/, "revert highlight must set the full border shorthand");
});
