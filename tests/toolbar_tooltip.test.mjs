import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../OptionsMenu.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('const IvLyricsTooltip ='), source.indexOf('function getSettingsSurfaceTheme()'));
const react = {
    Fragment: 'fragment',
    memo: component => component,
    createElement: (type, props, ...children) => ({ type, props, children }),
    cloneElement: (child, props) => ({ ...child, props: { ...child.props, ...props } }),
};
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

test('disabled controls expose their tooltip without enabling or forwarding the action', () => {
    let anchor = null;
    const document = { body: {}, addEventListener() {}, removeEventListener() {} };
    const window = { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {},
        ReactDOM: { createPortal: (content, target) => ({ content, target }) } };
    const render = vm.runInNewContext(code + '\nIvLyricsTooltip;', {
        react, window, document, useState: () => [anchor, value => { anchor = value; }], useEffect() {},
    });
    assert.equal(window.IvLyricsTooltip, render);
    const ref = { current: {} };
    const action = () => assert.fail('disabled action must not run');
    const children = { type: 'button', ref, props: { disabled: true, onClick: action } };
    let result = render({ children, label: 'Regenerate translation' });
    const trigger = result.children[0];
    assert.equal(trigger.type, 'span');
    assert.equal(trigger.props.onClick, undefined);
    assert.equal(trigger.children[0].ref, ref);
    assert.equal(trigger.children[0].props.disabled, true);
    assert.equal(trigger.children[0].props.onClick, action);
    trigger.props.onMouseEnter({ currentTarget: {
        getBoundingClientRect: () => ({ left: 940, top: 100, height: 34 }),
    } });
    result = render({ children, label: 'Regenerate translation' });
    assert.equal(result.children[1].target, document.body);
    assert.equal(result.children[1].content.children[0], 'Regenerate translation');
    result.children[0].props.onMouseLeave();
    assert.equal(anchor, null);
    delete window.ReactDOM;
    result = render({ children, label: 'Regenerate translation' });
    assert.equal(result.children[0].props.title, 'Regenerate translation');
});

test('study control shares the toolbar tooltip and keeps a native fallback', () => {
    const learningSource = readFileSync(new URL('../LearningMode.js', import.meta.url), 'utf8');
    const studyCode = learningSource.slice(learningSource.indexOf('const StudyButton ='), learningSource.indexOf('const TabButton ='));
    let toggles = 0;
    const tooltip = () => {};
    const window = { IvLyricsTooltip: tooltip, Spicetify: { ReactComponent: {
        TooltipWrapper: () => assert.fail('Spotify private tooltip must not be used'),
    } } };
    const render = vm.runInNewContext(studyCode + '\nStudyButton;', {
        react, window, useLearningOpenState: () => false, t: () => 'Study', BookIcon: {}, toggle: () => toggles++,
    });
    let result = render({ disabled: false });
    assert.equal(result.type, tooltip);
    assert.equal(result.props.label, 'Study');
    result.children[0].props.onClick({ stopPropagation() {} });
    assert.equal(toggles, 1);
    render({ disabled: true }).children[0].props.onClick({ stopPropagation() {} });
    assert.equal(toggles, 1);
    delete window.IvLyricsTooltip;
    result = render({ disabled: false });
    assert.equal(result.type, 'button');
    assert.equal(result.props.title, 'Study');
});
