import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    Fragment,
    jsx,
    raw,
    isElement,
    styleToCss,
    escapeAttr,
    escapeText,
    VOID_ELEMENTS,
} from './jsx';

// `Skrapa.Props` is a closed type (children/style only); real attributes reach jsx()
// through the JSX transform, which the type system special-cases via
// JSX.IntrinsicElements. These direct calls pass a plain attribute bag through
// an assertion to stand in for that.
const attrs = (o: Record<string, unknown>): Skrapa.Props => o as unknown as Skrapa.Props;

// jsx() returns a boxed element, not a string. Assert on the markup explicitly:
// `assert.equal` would coerce via `==` and pass either way, which would hide a
// regression that turned an element back into a bare string.
const html = (element: JSX.Element): string => String(element);

describe('src/bin/jsx.test.ts - jsx, styleToCss, escapeAttr', () => {
    test('escapeAttr escapes &, ", and <', () => {
        assert.equal(escapeAttr('a & b " c < d'), 'a &amp; b &quot; c &lt; d');
    });

    test('escapeText escapes &, < and >', () => {
        assert.equal(escapeText('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
    });

    test('string attribute values are escaped so a quote cannot break the tag', () => {
        assert.equal(
            html(jsx('a', attrs({ title: 'she said "hi" & <ok>' }))),
            '<a title="she said &quot;hi&quot; &amp; &lt;ok>"></a>'
        );
    });

    test('object attribute values are JSON-encoded and escaped', () => {
        assert.equal(
            html(jsx('div', attrs({ 'data-x': { a: 1 } }))),
            '<div data-x="{&quot;a&quot;:1}"></div>'
        );
    });

    test('null and undefined attributes are dropped; key is ignored', () => {
        assert.equal(
            html(jsx('div', attrs({ id: 'x', hidden: null, role: undefined, key: '1' }))),
            '<div id="x"></div>'
        );
    });

    test('style objects serialize to a css string (camelCase to kebab-case)', () => {
        assert.equal(styleToCss(undefined), '');
        assert.equal(
            html(jsx('div', attrs({ style: { color: 'red', marginTop: '1px' } }))),
            '<div style="color:red;margin-top:1px"></div>'
        );
    });

    test('a string style passes through instead of being serialized per character', () => {
        // styleToCss on a string iterates its characters and emits
        // style="0:c;1:o;2:l;...". Hit both `<div style="color:red">` in JSX and
        // a shell's own style attribute round-tripping through applyTagAttrs.
        assert.equal(
            html(jsx('div', attrs({ style: 'color:red' }))),
            '<div style="color:red"></div>'
        );
        assert.equal(
            html(jsx('div', attrs({ style: { color: 'red' } }))),
            '<div style="color:red"></div>'
        );
    });

    test('void elements self-close and reject children', () => {
        assert.equal(html(jsx('br', undefined)), '<br />');
        assert.equal(html(jsx('img', attrs({ src: 'a.png' }))), '<img src="a.png" />');
        assert.throws(() => jsx('br', undefined, 'oops'), /void element/);
        assert.ok(VOID_ELEMENTS.has('br'));
    });

    test('fragments and empty tags return only their children', () => {
        assert.equal(html(jsx('Fragment', undefined, 'a', 'b')), 'ab');
        assert.equal(html(jsx('', undefined, 'x')), 'x');
    });

    test('the Fragment factory is callable, as <> requires', () => {
        assert.equal(typeof Fragment, 'function');
        assert.equal(html(jsx(Fragment, undefined, 'a', 'b')), 'ab');
    });

    test('children are flattened; false/null/undefined drop out but 0 is kept', () => {
        assert.equal(html(jsx('p', undefined, ['a', null, false, undefined, 'b'])), '<p>ab</p>');
        assert.equal(html(jsx('p', undefined, 0)), '<p>0</p>');
    });

    test('true renders as nothing, so {flag && <p/>} never leaks the word', () => {
        assert.equal(html(jsx('p', undefined, true)), '<p></p>');
    });

    test('nested child arrays flatten all the way down, never stringified as "a,b"', () => {
        // A nested map (rows.map(r => r.cells.map(...))) produces arrays of arrays.
        assert.equal(html(jsx('tr', undefined, [[['a'], ['b']], ['c']])), '<tr>abc</tr>');
        assert.doesNotMatch(html(jsx('tr', undefined, [[['a'], ['b']]])), /,/);
    });

    test('CSS custom properties keep their case; other keys go kebab-case', () => {
        assert.equal(
            styleToCss({ '--myVar': 'red', backgroundColor: 'blue' } as Skrapa.CSSProps),
            '--myVar:red;background-color:blue'
        );
    });

    test('function components receive children and render their return value', () => {
        const Item = (p: Skrapa.PropsWithChildren) => jsx('li', undefined, p.children);
        assert.equal(html(jsx(Item, undefined, 'hi')), '<li>hi</li>');
    });

    // ---- escaping -------------------------------------------------------

    test('a string child is escaped, so markup in data renders as visible text', () => {
        assert.equal(
            html(jsx('p', undefined, '<script>alert(1)</script>')),
            '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
        );
        assert.equal(html(jsx('p', undefined, 'a & b')), '<p>a &amp; b</p>');
    });

    test('a nested element is not escaped, though it is a string underneath', () => {
        assert.equal(
            html(jsx('div', undefined, jsx('span', undefined, 'hi'))),
            '<div><span>hi</span></div>'
        );
    });

    test('escaping does not compound through nesting', () => {
        // The inner element is already rendered; re-escaping it at each level
        // would turn "&amp;" into "&amp;amp;" one layer up.
        const inner = jsx('em', undefined, 'a & b');
        assert.equal(html(jsx('p', undefined, inner)), '<p><em>a &amp; b</em></p>');
        assert.equal(
            html(jsx('div', undefined, jsx('p', undefined, inner))),
            '<div><p><em>a &amp; b</em></p></div>'
        );
    });

    test('raw() opts a hand-built string out of escaping', () => {
        assert.equal(html(jsx('p', undefined, raw('<b>hi</b>'))), '<p><b>hi</b></p>');
        assert.equal(html(raw('<b>hi</b>')), '<b>hi</b>');
    });

    test('isElement separates rendered markup from a lookalike string', () => {
        assert.ok(isElement(jsx('p', undefined)));
        assert.ok(isElement(raw('<p></p>')));
        assert.ok(!isElement('<p></p>'));
        assert.ok(!isElement(null));
    });
});
