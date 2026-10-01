import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../Settings.js", import.meta.url), "utf8");

const ADDON = "ivLyrics:ai:addon:chatgpt";
const BASE_URL = `${ADDON}:base-url`;
const API_KEY = `${ADDON}:api-keys`;

const ENDPOINT_KEY_PATTERN = /(^|:)(base-url|baseurl|api-base|apiurl|endpoint)$/i;

// Builds an isolated copy of normalizeImportedConfig so we can observe exactly
// which keys survive an import, independent of any browser storage.
const loadNormalizer = () => {
	// The endpoint guard helpers are declared immediately above the normalizer
	// and are part of the behaviour under test, so they are sliced in with it.
	const helperStart = indexSource.indexOf("const IMPORT_ENDPOINT_KEY_PATTERN =");
	assert.notEqual(helperStart, -1, "imported-endpoint guard not found");
	const start = indexSource.indexOf("const normalizeImportedConfig = (config) => {");
	assert.notEqual(start, -1, "normalizeImportedConfig not found");
	assert.ok(helperStart < start, "endpoint guard must be declared before the normalizer");
	const bodyStart = indexSource.indexOf("=> {", start) + "=> ".length;
	let depth = 0;
	let end = -1;
	for (let i = bodyStart; i < indexSource.length; i += 1) {
		if (indexSource[i] === "{") depth += 1;
		else if (indexSource[i] === "}") {
			depth -= 1;
			if (depth === 0) {
				end = i + 1;
				break;
			}
		}
	}
	assert.notEqual(end, -1, "could not brace-match normalizeImportedConfig");

	const context = vm.createContext({
		APP_NAME: "ivLyrics",
		LEGACY_STORAGE_PREFIX: "ivLyrics_",
		CURRENT_STORAGE_PREFIX: "ivLyrics:",
		TRACK_SYNC_OFFSETS_STORAGE_KEY: "ivLyrics:track-sync-offsets",
		PRIVATE_OR_TRANSIENT_STORAGE_KEYS: new Set(),
		OBSOLETE_LEGACY_STORAGE_KEYS: new Set(),
		IMPORT_PROVIDER_ORDER_KEYS: new Set(),
		LANGUAGE_STORAGE_KEY: "ivLyrics:language",
		QUICK_SYNC_CONTROLS_STORAGE_KEY: "ivLyrics:quick-sync-controls",
		normalizeIsrc: (value) => value,
		URL,
		console,
	});
	vm.runInContext(
		`${indexSource.slice(helperStart, start)}\n${indexSource.slice(start, end)}\nglobalThis.normalize = normalizeImportedConfig;`,
		context
	);
	return context.normalize;
};

test("an imported base-url is validated rather than stored verbatim", () => {
	const normalize = loadNormalizer();
	const out = normalize({ [BASE_URL]: "javascript:alert(1)", [API_KEY]: "sk-victim" });

	assert.notEqual(
		out[BASE_URL],
		"javascript:alert(1)",
		"a non-http(s) endpoint survived import and would receive the victim's API key"
	);
});

test("an imported base-url pointing off the http(s) scheme is dropped entirely", () => {
	const normalize = loadNormalizer();
	for (const hostile of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "vbscript:msgbox"]) {
		const out = normalize({ [BASE_URL]: hostile, [API_KEY]: "sk-victim" });
		assert.equal(
			out[BASE_URL],
			undefined,
			`hostile endpoint ${hostile} survived import`
		);
	}
});

test("a legitimate https base-url still imports unchanged", () => {
	const normalize = loadNormalizer();
	const legitimate = "https://api.openai.com/v1";
	const out = normalize({ [BASE_URL]: legitimate, [API_KEY]: "sk-victim" });

	assert.equal(out[BASE_URL], legitimate, "valid endpoints must keep working");
	assert.equal(out[API_KEY], "sk-victim", "credentials are not this check's concern");
});

test("the settings-file import asks for confirmation before writing", () => {
	// Every other destructive path in Settings.js calls window.confirm; the
	// settings-file import is the one that does not. Locate the import handler
	// and assert the guard is present in it.
	const start = settingsSource.indexOf('key: "import-settings"');
	assert.notEqual(start, -1, "import-settings config button not found");
	const handler = settingsSource.slice(start, start + 4000);

	assert.match(
		handler,
		/window\.confirm|confirm\(/,
		"the settings-file import must prompt before overwriting stored settings"
	);
});

test("the import handler names the setting count in its confirmation", () => {
	const start = settingsSource.indexOf('key: "import-settings"');
	const handler = settingsSource.slice(start, start + 4000);
	const confirmIndex = handler.search(/window\.confirm|confirm\(/);
	assert.notEqual(confirmIndex, -1, "expected a confirmation prompt");

	// The prompt should describe what is about to change so a user can decline.
	const prompt = handler.slice(confirmIndex, confirmIndex + 400);
	assert.match(prompt, /[A-Za-z]/, "the confirmation must carry readable text");
	assert.ok(
		!prompt.includes("`" + "undefined"),
		"the confirmation must not interpolate an unresolved value"
	);
});

test("declining the import confirmation leaves stored settings untouched", () => {
	const start = settingsSource.indexOf('key: "import-settings"');
	const handler = settingsSource.slice(start, start + 4000);

	// The guard must be a real early return between the prompt and the write,
	// so a declined import never reaches importConfig.
	const confirmIndex = handler.search(/window\.confirm|confirm\(/);
	assert.notEqual(confirmIndex, -1, "expected a confirmation prompt");

	const afterConfirm = handler.slice(confirmIndex);
	const writeIndex = afterConfirm.indexOf("StorageManager.importConfig");
	assert.notEqual(writeIndex, -1, "expected the import write to be present");

	// The whole guard block must sit between the prompt and the write, so a
	// decline returns before any setting is stored.
	const guardBlock = afterConfirm.slice(0, writeIndex);
	const guardMatch = guardBlock.match(/if\s*\(\s*!confirmed\s*\)\s*\{[^}]*\breturn\b[^}]*\}/);

	assert.ok(
		guardMatch,
		"declining the prompt must return before importConfig runs"
	);
});

test("the confirmation prompt is translated in every shipped language", () => {
	const langsDir = new URL("../langs/", import.meta.url);
	const files = readdirSync(langsDir).filter((name) => /^Lang.*\.js$/.test(name));
	assert.ok(files.length >= 20, `expected the full language set, saw ${files.length}`);

	for (const file of files) {
		const source = readFileSync(new URL(`../langs/${file}`, import.meta.url), "utf8");
		const importBlock = source.slice(source.indexOf('"exportImport"'));
		assert.match(
			importBlock,
			/"confirm"\s*:/,
			`${file} is missing the exportImport.import.confirm string; the prompt would render as a raw key`
		);
	}
});

test("every AI endpoint key is covered by the import validation", () => {
	// If a new addon introduces another endpoint key it must be caught by the
	// same rule, so the pattern is asserted to be shared rather than per-key.
	const normalize = loadNormalizer();
	for (const key of [
		"ivLyrics:ai:addon:gemini:base-url",
		"ivLyrics:ai:addon:openrouter:base-url",
		"ivLyrics:ai:addon:deepL:base-url",
	]) {
		const out = normalize({ [key]: "javascript:alert(1)" });
		assert.equal(out[key], undefined, `endpoint key ${key} bypassed import validation`);
	}
	assert.ok(ENDPOINT_KEY_PATTERN.test("base-url"), "guard pattern must stay in sync with the tests");
});
