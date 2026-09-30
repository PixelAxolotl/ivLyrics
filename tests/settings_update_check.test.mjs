import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Settings.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const from = source.indexOf(start);
  const until = source.indexOf(end, from);
  assert.ok(from >= 0 && until > from, `Missing source section: ${start}`);
  return source.slice(from, until);
};

test('settings update check displays an available release and restores its button in strict mode', async () => {
  const resultContainer = { innerHTML: '' };
  const button = { textContent: 'Check for updates', disabled: false };
  let resolveUpdate;
  const update = new Promise(resolve => { resolveUpdate = resolve; });
  const context = vm.createContext({
    react: { createElement: (type, props) => ({ type, props }) },
    OptionList: () => null,
    ConfigButton: () => null,
    I18n: { t: key => key },
    Utils: {
      currentVersion: '6.6.24',
      checkForUpdates: () => update,
      escapeHtml: String,
      escapeAttribute: String,
      sanitizeHttpUrl: String,
    },
    getSettingsResultContainer: () => resultContainer,
  });
  // Spicetify executes the custom-app bundle in strict mode. Match that mode
  // so an undeclared assignment cannot silently become a global variable.
  vm.runInContext([
    '"use strict";',
    section('function escapeSettingsReleaseHtml(', 'function renderSettingsReleaseMarkdown('),
    section('  const renderAboutUpdateSection =', '  const renderAboutClientInfoSection ='),
    'globalThis.updateSetting = renderAboutUpdateSection().props.items.find(item => item.key === "check-update");',
  ].join('\n'), context);

  const pending = context.updateSetting.onChange(null, { target: button });
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'settingsAdvanced.aboutTab.update.checkUpdate.checking');
  resolveUpdate({ hasUpdate: true, currentVersion: '6.6.24', latestVersion: '6.6.25' });
  await pending;

  assert.match(resultContainer.innerHTML, /notifications\.updateAvailable/);
  assert.match(resultContainer.innerHTML, /6\.6\.24 → 6\.6\.25/);
  assert.match(resultContainer.innerHTML, /href="https:\/\/lyrics\.ivl\.is\/update"/);
  assert.match(resultContainer.innerHTML, /href="https:\/\/github\.com\/ivLis-Studio\/ivLyrics\/releases\/tag\/v6\.6\.25"/);
  assert.doesNotMatch(resultContainer.innerHTML, /notifications\.updateCheckFailed/);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Check for updates');
});
