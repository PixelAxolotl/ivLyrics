import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../OptionsMenu.js', import.meta.url), 'utf8');
const presetsSource = readFileSync(new URL('../LyricsShareImage.js', import.meta.url), 'utf8');
const sectionOf = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
const presets = vm.runInNewContext(`(() => {
  ${sectionOf(presetsSource, '  const DEFAULT_SETTINGS =', '  // TEMPLATES')}
  return { DEFAULT_SETTINGS, PRESETS };
})()`);

const hooks = [];
let cursor = 0;
const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = { value: index === 5 ? {} : initial };
    return [hooks[index].value, (v) => { hooks[index].value = typeof v === 'function' ? v(hooks[index].value) : v; }];
  },
  useMemo(factory, deps) {
    const index = cursor++;
    if (!hooks[index] || deps.some((value, i) => !Object.is(value, hooks[index].deps[i]))) hooks[index] = { value: factory(), deps };
    return hooks[index].value;
  },
  useRef(value) { const index = cursor++; hooks[index] ||= { value: { current: value } }; return hooks[index].value; },
  useEffect() { cursor++; },
};
const context = vm.createContext({
  react, I18n: { t: (key) => `translated:${key}` },
  LyricsShareImage: { DEFAULT_SETTINGS: presets.DEFAULT_SETTINGS, PRESETS: presets.PRESETS },
  navigator: {}, Toast: { error() {} },
});
vm.runInContext(`${sectionOf(source, 'const renderShareImageControls =', '// Open Share Image Modal')}\nglobalThis.renderModal = ShareImageModal;`, context);
cursor = 0;
const tree = context.renderModal({ lyrics: [], trackInfo: {}, onClose() {} });
const nodes = (t) => Array.isArray(t) ? t.flatMap(nodes) : t?.type ? [t, ...nodes(t.children)] : [];
const details = nodes(tree).filter((n) => n.type === 'details');
console.log('details count:', details.length);
for (const d of details) {
  const kids = (d.children || []).filter((c) => c && typeof c === 'object');
  console.log('---', d.props?.['data-group'], 'open=' + d.props?.open, 'kids:', kids.map((k) => `${k.type}.${k.props?.className}`));
  const summary = kids.find((k) => k.type === 'summary');
  console.log('    summary kids:', JSON.stringify((summary?.children || []).map((c) => typeof c === 'string' ? c : c?.type)));
  const body = kids.find((k) => k.type === 'div');
  console.log('    body rows:', (body?.children || []).filter((c) => c && typeof c === 'object').length, 'falsy:', (body?.children || []).filter((c) => !c || typeof c !== 'object').length);
}
