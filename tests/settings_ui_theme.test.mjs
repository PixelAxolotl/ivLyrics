import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const settingsSource = readFileSync(new URL('../Settings.js', import.meta.url), 'utf8');

const THEME_HELPERS_START = 'const SETTINGS_UI_THEME_STORAGE_KEY = ';
const THEME_HELPERS_END = 'const persistSettingsUiTheme = (theme) => {';

function loadThemeHelpers({ storedTheme }) {
  const from = settingsSource.indexOf(THEME_HELPERS_START);
  const until = settingsSource.indexOf(THEME_HELPERS_END, from);
  assert.ok(from >= 0 && until > from, 'Missing theme helper section in Settings.js');
  const helperSource = settingsSource.slice(from, until);

  const sandboxWindow = {
    localStorage: { getItem: () => storedTheme ?? null, setItem: () => {} },
    ivLyricsStoragePersistence: null,
    Spicetify: {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  };
  const sandbox = {
    localStorage: sandboxWindow.localStorage,
    document: { documentElement: {} },
  };
  sandbox.window = sandboxWindow;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    `${helperSource}; globalThis.__themeApi = { getSettingsUiTheme, resolveEffectiveSettingsUiTheme };`,
    sandbox,
  );
  return sandbox.__themeApi;
}

test('settings theme offers light and dark only, with no auto option', () => {
  assert.ok(!settingsSource.includes('id: "auto"'), 'Settings.js must not offer an auto theme option');
  assert.ok(
    !settingsSource.includes('themePreference === "auto"'),
    'Settings.js must not resolve an auto theme preference',
  );
  assert.ok(
    !settingsSource.includes('uiThemePreference !== "auto"'),
    'Settings.js must not branch on an auto theme preference',
  );
  assert.ok(
    !settingsSource.includes('|| storedTheme === "auto"'),
    'Settings.js must not accept a stored auto theme value',
  );
});

test('stored auto or missing theme migrates to dark', () => {
  assert.equal(loadThemeHelpers({ storedTheme: 'auto' }).getSettingsUiTheme(), 'dark');
  assert.equal(loadThemeHelpers({ storedTheme: null }).getSettingsUiTheme(), 'dark');
  assert.equal(loadThemeHelpers({ storedTheme: 'light' }).getSettingsUiTheme(), 'light');
  assert.equal(loadThemeHelpers({ storedTheme: 'auto' }).resolveEffectiveSettingsUiTheme('auto'), 'dark');
});

test('decentralized theme getters fall back to dark without system detection', () => {
  for (const file of ['NoticeSystem.js', 'OptionsMenu.js', 'index.js', 'Pages.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const marker = ['getNoticeUiTheme', 'getSettingsSurfaceTheme', 'getUpdateBannerTheme', 'getCreatorProfileUiTheme'].find(
      (name) => source.includes(name),
    );
    const body = source.slice(source.indexOf(marker), source.indexOf(marker) + 800);
    assert.ok(
      !body.includes('prefers-color-scheme'),
      `${file} theme getter must not consult prefers-color-scheme`,
    );
    assert.ok(body.includes('return "dark"'), `${file} theme getter must fall back to dark`);
  }
});
