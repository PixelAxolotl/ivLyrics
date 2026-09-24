import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../OptionsMenu.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('const IvLyricsTooltip ='), source.indexOf('function getSettingsSurfaceTheme()'));
test('toolbar tooltips preserve refs and actions, portal outside scroll clipping, and dismiss', () => {
    let anchor = null, cleanup;
    const listeners = new Map();
    const document = { body: {}, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
    const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }),
        cloneElement: (child, props) => ({ ...child, props: { ...child.props, ...props } }) };
    const window = { innerWidth: 1000, innerHeight: 800, ...document,
        ReactDOM: { createPortal: (content, target) => ({ content, target }) } };
    const context = { react, window, document, useState: () => [anchor, value => { anchor = value; }],
        useEffect: effect => { cleanup?.(); cleanup = effect(); } };
    const render = vm.runInNewContext(code + '\nIvLyricsTooltip;', context);
    const ref = { current: {} };
    let clicks = 0, enters = 0;
    const children = { type: 'button', ref, props: { onClick: () => clicks++, onMouseEnter: () => enters++ } };
    const event = { currentTarget: { getBoundingClientRect: () => ({ left: 940, top: 100, height: 40 }) } };
    let result = render({ children, label: 'Sync' });
    assert.equal(result.children[0].ref, ref);
    result.children[0].props.onMouseEnter(event);
    result = render({ children, label: 'Sync' });
    assert.equal(enters, 1);
    assert.equal(result.children[1].target, document.body);
    assert.equal(result.children[1].content.props.role, 'tooltip');
    result.children[0].props.onClick(event);
    assert.equal(clicks, 1);
    assert.equal(anchor, null);
    result.children[0].props.onFocus(event);
    render({ children, label: 'Sync' });
    listeners.get('keydown')({ key: 'Escape' });
    assert.equal(anchor, null);
    cleanup();
    assert.equal(listeners.size, 0);
});
