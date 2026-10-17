import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("Song Controls has a localized title and description in all 22 languages", async () => {
  const directory = new URL("../langs/", import.meta.url);
  const files = readdirSync(directory).filter((file) => /^Lang.*\.js$/.test(file));
  assert.equal(files.length, 22);
  const runtime = vm.createContext({ window: {}, localStorage: { getItem: () => "en", setItem() {} } });
  const locales = files.map((file) => {
    const source = readFileSync(new URL(file, directory), "utf8"), isolated = { window: {} };
    vm.runInNewContext(source, isolated, { filename: file });
    vm.runInContext(source, runtime, { filename: file });
    return { file, locale: Object.values(isolated.window)[0] };
  });
  vm.runInContext(readFileSync(new URL("../I18n.js", import.meta.url), "utf8"), runtime);
  const english = locales.find(({ file }) => file === "LangEn.js").locale.settingsAdvanced.controllerStyle;
  const korean = locales.find(({ file }) => file === "LangKo.js").locale.settingsAdvanced.controllerStyle;
  assert.equal(english.title, "Song Controls");
  assert.equal(korean.title, "곡 컨트롤");
  for (const { file, locale } of locales) {
    assert.equal(await runtime.window.I18n.setLanguage(locale.meta.code), true);
    for (const suffix of ["title", "subtitle"]) {
      const key = `settingsAdvanced.controllerStyle.${suffix}`, value = locale.settingsAdvanced.controllerStyle[suffix];
      assert.equal(typeof value, "string", `${file}: ${key}`);
      assert.ok(value.trim(), `${file}: empty ${key}`);
      assert.equal(runtime.window.I18n.t(key), value, `${file}: no fallback`);
      if (file !== "LangEn.js") assert.notEqual(value, english[suffix], `${file}: translated ${key}`);
    }
  }
});
