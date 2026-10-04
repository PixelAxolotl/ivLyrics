import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");

const slice = (source, startMarker, endMarker) => {
	const start = source.indexOf(startMarker);
	assert.notEqual(start, -1, `start marker not found: ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.notEqual(end, -1, `end marker not found: ${endMarker}`);
	return source.slice(start, end);
};

// Executes the real kuromoji loader block against a recording `document`, so we
// inspect the exact attributes the app sets on the injected <script> element.
const loadKuromojiLoader = () => {
	// Only the loader block: it ends at the `}` that closes the outer
	// `if (typeof window.kuromoji === "undefined")` guard, which is followed by
	// the `else` branch. Slicing to the overlay banner instead would pull in
	// initializeFuriganaConverter's async body, which vm cannot parse as a
	// top-level script.
	// Extract the real loader by brace-matching from its declaration. The
	// enclosing `if` block also contains initializeFuriganaConverter's body,
	// which uses top-level `await` and cannot be parsed as a vm script, so the
	// whole block cannot be executed as-is. The loader itself is self-contained:
	// it reads only kuromojiScriptUrls, KUROMOJI_INTEGRITY, document, and the
	// onload callback.
	const braceMatch = (source, from) => {
		let depth = 0;
		for (let i = from; i < source.length; i += 1) {
			if (source[i] === "{") depth += 1;
			else if (source[i] === "}") {
				depth -= 1;
				if (depth === 0) return source.slice(from, i + 1);
			}
		}
		throw new Error("unbalanced braces while extracting the loader");
	};

	const urlsDecl = slice(indexSource, "const kuromojiScriptUrls = [", "];") + "]";
	const integrityDecl = slice(indexSource, "const KUROMOJI_INTEGRITY =", ";") + ";";
	const fnStart = indexSource.indexOf("const loadKuromojiScript =");
	// Match braces from the arrow function's body, which opens after `=> {`.
	// Matching from the declaration would pair with the `{` in the default
	// parameter `(index = 0)` object-free but arrow-adjacent brace and cut short.
	const fnBodyStart = indexSource.indexOf("=> {", fnStart) + "=> ".length;
	const fnDecl = indexSource.slice(fnStart, fnBodyStart) + braceMatch(indexSource, fnBodyStart);
	const block = `${integrityDecl}\n${urlsDecl}\n${fnDecl}\nloadKuromojiScript();`;

	const scripts = [];
	const document = {
		createElement(tag) {
			const element = { tag, remove() { element.removed = true; } };
			scripts.push(element);
			return element;
		},
		head: { appendChild() {} },
	};

	const context = vm.createContext({
		document,
		window: {},
		initializeFuriganaConverter() {},
		console,
	});
	vm.runInContext(block, context);
	return scripts;
};

test("the kuromoji CDN script is integrity-pinned before it can execute", () => {
	const [script] = loadKuromojiLoader();

	assert.ok(script, "expected the loader to create a script element");
	assert.equal(script.src, "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js");
	assert.match(
		script.integrity ?? "",
		/^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/,
		"the CDN script must carry a subresource-integrity hash"
	);
	assert.equal(
		script.crossOrigin,
		"anonymous",
		"a crossorigin attribute is required or the SRI check cannot run for a cross-origin script"
	);
});

test("every kuromoji mirror the loader can fall back to is integrity-pinned", () => {
	const list = slice(indexSource, "const kuromojiScriptUrls = [", "];");
	const mirrors = [...list.matchAll(/"(https:\/\/[^"]+)"/g)].map((match) => match[1]);

	assert.ok(mirrors.length >= 2, `expected a primary mirror and a fallback, saw ${mirrors.length}`);

	// A single hash is only sufficient if every fallback serves the same bytes,
	// otherwise a compromised fallback could satisfy the request with different
	// content. The loader therefore pins one shared hash for all mirrors, which
	// this asserts: the constant must be applied to whichever mirror is loaded.
	const pinned = slice(indexSource, "const KUROMOJI_INTEGRITY =", ";");
	assert.match(
		pinned,
		/"sha(?:256|384|512)-[A-Za-z0-9+/=]+"/,
		"the shared integrity constant must hold a subresource-integrity hash"
	);

	const loadBody = slice(indexSource, "const loadKuromojiScript = (index = 0) => {", "document.head.appendChild(kuromojiScript);");
	assert.ok(
		loadBody.includes("KUROMOJI_INTEGRITY"),
		"the loader must apply the pinned hash to every mirror it can fall back to"
	);
});
