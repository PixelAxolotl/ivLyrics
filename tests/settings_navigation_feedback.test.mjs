import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Settings.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('  const settingsContentRef ='), source.indexOf('  // 텍스트 하이라이트 헬퍼 함수'));

function harness(reduced = false) {
  const timers = new Map(), listeners = new Map(), scrolls = [];
  let nextId = 0;
  const rows = ['first', 'second'].map((key, index) => {
    const classes = new Set();
    return { classes, getAttribute: () => key, getBoundingClientRect: () => ({ top: 200 + index * 100 }),
      classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  });
  const panel = { querySelectorAll: () => rows, querySelector: () => null };
  const container = { scrollTop: 50, querySelector: () => panel, getBoundingClientRect: () => ({ top: 100 }),
    scrollTo: options => scrolls.push(options), addEventListener: (type, cb) => listeners.set(type, cb),
    removeEventListener: type => listeners.delete(type) };
  const context = vm.createContext({
    react: { useRef: current => ({ current }), useCallback: callback => callback },
    window: { setTimeout: (cb, delay) => { timers.set(++nextId, { cb, delay }); return nextId; } },
    clearTimeout: id => timers.delete(id), getEffectiveReducedMotionPreference: () => reduced,
  });
  vm.runInContext(code + '\n globalThis.api = { settingsContentRef, scrollToSetting, clearSettingHighlight };', context);
  context.api.settingsContentRef.current = container;
  return { ...context.api, rows, timers, listeners, scrolls };
}

test('rapid settings navigation removes the old highlight and cleans the latest one on expiry', () => {
  const h = harness();
  h.scrollToSetting('first');
  assert.equal(h.rows[0].classes.has('setting-highlight-flash'), true);
  h.scrollToSetting('second');
  assert.equal(h.rows[0].classes.size, 0);
  assert.equal(h.rows[1].classes.has('setting-highlight-flash'), true);
  assert.equal(h.listeners.size, 1, 'only the latest smooth scroll owns a scrollend listener');
  [...h.timers.values()].find(timer => timer.cb === h.clearSettingHighlight).cb();
  assert.equal(h.rows[1].classes.size, 0);
  h.scrollToSetting('first');
  h.scrollToSetting('second', { highlight: false });
  assert.ok(h.rows.every(row => row.classes.size === 0));
});

test('reduced motion settings navigation jumps directly without a smooth-scroll listener', () => {
  const h = harness(true);
  assert.equal(h.scrollToSetting('second'), true);
  assert.equal(h.scrolls[0].behavior, 'auto');
  assert.equal(h.scrolls[0].top, 238);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.scrollToSetting('missing'), false);
  h.clearSettingHighlight();
  assert.ok(h.rows.every(row => row.classes.size === 0));
});
