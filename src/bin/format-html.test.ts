import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatHtml } from './format-html';

describe('src/bin/format-html.test.ts - formatHtml', () => {
    test('inline content stays on one line (never inserts a render-visible space)', () => {
        assert.equal(formatHtml('<p>world<b>!</b></p>'), '<p>world<b>!</b></p>\n');
    });

    test('block elements whose children are all block-level get indented', () => {
        assert.equal(formatHtml('<div><p>hi</p></div>'), '<div>\n  <p>hi</p>\n</div>\n');
    });

    test('void elements render self-closed', () => {
        assert.equal(formatHtml('<div><br></div>'), '<div>\n  <br />\n</div>\n');
    });

    test('script content is copied verbatim, not parsed as markup', () => {
        assert.equal(formatHtml('<script>var a=1<2;</script>'), '<script>var a=1<2;</script>\n');
    });

    test('doctype and comments pass through as their own lines', () => {
        assert.equal(
            formatHtml('<!doctype html><!-- hi --><div></div>'),
            '<!doctype html>\n<!-- hi -->\n<div></div>\n'
        );
    });

    test('whitespace inside an attribute value is preserved, not collapsed', () => {
        assert.equal(formatHtml('<div data-x="a    b"></div>'), '<div data-x="a    b"></div>\n');
        assert.equal(formatHtml('<img alt="one\ntwo">'), '<img alt="one\ntwo" />\n');
    });

    test('whitespace between attributes is normalized to single spaces', () => {
        assert.equal(
            formatHtml('<input   disabled    type="text" >'),
            '<input disabled type="text" />\n'
        );
    });

    test('a ">" inside a quoted attribute value does not end the tag', () => {
        assert.equal(
            formatHtml('<div title="a > b"><p>hi</p></div>'),
            '<div title="a > b">\n  <p>hi</p>\n</div>\n'
        );
        assert.equal(
            formatHtml("<div data-q='x > y'><p>z</p></div>"),
            "<div data-q='x > y'>\n  <p>z</p>\n</div>\n"
        );
    });
});
