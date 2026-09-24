import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Pages.js', import.meta.url), 'utf8');
const start = source.indexOf('const renderLyricSubLine =');
const end = source.indexOf('const renderLyricMainContent =', start);
assert.ok(start >= 0 && end > start);

for (const singleLineScroll of [false, true]) {
  test(`legacy highlight preferences preserve ordinary sublines (vinyl scroll: ${singleLineScroll})`, () => {
    const annotations = [{ marker: 1 }];
    const html = 'Translation <sup>1</sup>';
    const onContextMenu = () => {};
    const context = vm.createContext({
      CONFIG: { visual: {
        'inactive-color': '#aaa',
        'phonetic-semantic-highlight': true,
        'translation-semantic-highlight': true,
      } },
      window: { LyricsAlignment: new Proxy({}, {
        get() { throw new Error('Removed alignment service must never run'); },
      }) },
      MeaningLinkedSubline: 'removed-component',
      react: { createElement: (type, props, ...children) => ({ type, props, children }) },
      renderAnnotatedLyricHTML(text, received) {
        assert.equal(text, 'Translation');
        assert.equal(received, annotations);
        return html;
      },
    });
    vm.runInContext(`${source.slice(start, end)}\nglobalThis.render = renderLyricSubLine;`, context);
    for (const kind of ['phonetic', 'translation']) {
      const tree = context.render(kind, 'Translation', onContextMenu,
        singleLineScroll, annotations, kind,
        { line: { text: 'Original', startTime: 1000 }, kind, position: 1500 });
      assert.equal(tree.type, 'p');
      assert.equal(tree.props.onContextMenu, onContextMenu);
      assert.equal(tree.props.key, kind);
      assert.equal(tree.props.style['--sub-lyric-color'], '#aaa');
      if (singleLineScroll) {
        assert.equal(tree.children[0].type, 'span');
        assert.equal(tree.children[0].props.className, 'ivlyrics-vinyl-lyric-scroll-content');
        assert.equal(tree.children[0].props.dangerouslySetInnerHTML.__html, html);
      } else {
        assert.equal(tree.props.dangerouslySetInnerHTML.__html, html);
      }
    }
  });
}
