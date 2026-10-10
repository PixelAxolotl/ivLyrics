import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const menu = readFileSync(new URL('../OptionsMenu.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');

const section = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source section: ${startMarker}`);
  return text.slice(start, end);
};

test('regenerate button stays pressable while loading (spinner only)', () => {
  const btn = section(menu, 'const RegenerateTranslationButton = react.memo(', '\n);');
  assert.match(btn, /isLoading/, 'button must receive isLoading');
  assert.match(btn, /loading-spin/, 'button must show spinner while loading');
  assert.doesNotMatch(btn, /disabled:\s*!isEnabled\s*\|\|\s*isLoading/, 'button must NOT lock during loading');
  assert.match(btn, /disabled:\s*!isEnabled,/, 'button must disable only when not enabled');
});

test('regenerate choice modal grays out only running jobs', () => {
  const modal = section(menu, 'function openRegenerateTranslationChoiceModal({', 'closeModal = openOptionsModal(');
  assert.match(modal, /disabledTargets/, 'modal must accept per-task disabled states');
  assert.match(modal, /disabled:\s*!!disabled/, 'modal items must support disabled');
});

test('single-target regenerate path guards already-running jobs', () => {
  const fn = section(index, 'handleRegenerateTranslationRequest()', 'this.regenerateTranslation("all")');
  assert.match(fn, /isTranslationRunning|isTranslationLoading/, 'must reference translation running state');
  assert.match(fn, /isPhoneticRunning|isPhoneticLoading/, 'must reference phonetic running state');
  // The single-target fallback (after the modal branch) must not fire unguarded.
  const fallback = fn.slice(fn.indexOf('if (targets.needPhonetic)'));
  assert.match(fallback, /isPhoneticRunning|isTranslationRunning|already running|alreadyRunning/i, 'fallback must guard running jobs');
});
