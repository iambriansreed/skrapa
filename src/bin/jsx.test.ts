import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { jsx, styleToCss, escapeAttr, VOID_ELEMENTS } from './jsx';

// `Props` is a closed type (children/style only); real attributes reach jsx()
// through the JSX transform, which the type system special-cases via
// JSX.IntrinsicElements. These direct calls pass a plain attribute bag through
// an assertion to stand in for that.
const attrs = (o: Record<string, unknown>): Props => o as unknown as Props;

describe('src/bin/jsx.test.ts - jsx, styleToCss, escapeAttr', () => {
    test('escapeAttr escapes &, ", and <', () => {
        assert.equal(escapeAttr('a & b " c < d'), 'a &amp; b &quot; c &lt; d');
    });

    test('string attribute values are escaped so a quote cannot break the tag', () => {
        assert.equal(
            jsx('a', attrs({ title: 'she said "hi" & <ok>' })),
            '<a title="she said &quot;hi&quot; &amp; &lt;ok>"></a>'
        );
    });

    test('object attribute values are JSON-encoded and escaped', () => {
        assert.equal(
            jsx('div', attrs({ 'data-x': { a: 1 } })),
            '<div data-x="{&quot;a&quot;:1}"></div>'
        );
    });

    test('null and undefined attributes are dropped; key is ignored', () => {
        assert.equal(
            jsx('div', attrs({ id: 'x', hidden: null, role: undefined, key: '1' })),
            '<div id="x"></div>'
        );
    });

    test('style objects serialize to a css string (camelCase to kebab-case)', () => {
        assert.equal(styleToCss(undefined), '');
        assert.equal(
            jsx('div', attrs({ style: { color: 'red', marginTop: '1px' } })),
            '<div style="color:red;margin-top:1px"></div>'
        );
    });

    test('void elements self-close and reject children', () => {
        assert.equal(jsx('br', undefined), '<br />');
        assert.equal(jsx('img', attrs({ src: 'a.png' })), '<img src="a.png" />');
        assert.throws(() => jsx('br', undefined, 'oops'), /void element/);
        assert.ok(VOID_ELEMENTS.has('br'));
    });

    test('fragments and empty tags return only their children', () => {
        assert.equal(jsx('Fragment', undefined, 'a', 'b'), 'ab');
        assert.equal(jsx('', undefined, 'x'), 'x');
    });

    test('children are flattened; false/null/undefined drop out but 0 is kept', () => {
        assert.equal(jsx('p', undefined, ['a', null, false, undefined, 'b']), '<p>ab</p>');
        assert.equal(jsx('p', undefined, 0), '<p>0</p>');
    });

    test('nested child arrays flatten all the way down, never stringified as "a,b"', () => {
        // A nested map (rows.map(r => r.cells.map(...))) produces arrays of arrays.
        assert.equal(jsx('tr', undefined, [[['a'], ['b']], ['c']]), '<tr>abc</tr>');
        assert.doesNotMatch(jsx('tr', undefined, [[['a'], ['b']]]), /,/);
    });

    test('CSS custom properties keep their case; other keys go kebab-case', () => {
        assert.equal(
            styleToCss({ '--myVar': 'red', backgroundColor: 'blue' } as CSSProperties),
            '--myVar:red;background-color:blue'
        );
    });

    test('function components receive children and render their return value', () => {
        const Item = (p: PropsWithChildren) => jsx('li', undefined, p.children);
        assert.equal(jsx(Item, undefined, 'hi'), '<li>hi</li>');
    });
});
