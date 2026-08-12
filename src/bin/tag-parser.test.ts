import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tagParser } from './tag-parser';

describe('src/bin/tag-parser.test.ts - tagParser', () => {
    test('reads the tag name, with and without attributes', () => {
        assert.equal(tagParser('<body>').name, 'body');
        assert.equal(tagParser('<body class="a">').name, 'body');
        assert.equal(tagParser('<br />').name, 'br');
        assert.deepEqual(tagParser('<body>').attrs, {});
    });

    test('reads double, single and unquoted values', () => {
        assert.deepEqual(tagParser('<html lang="en">').attrs, { lang: 'en' });
        assert.deepEqual(tagParser("<html lang='en'>").attrs, { lang: 'en' });
        assert.deepEqual(tagParser('<html lang=en>').attrs, { lang: 'en' });
    });

    test('keeps attributes in source order', () => {
        assert.deepEqual(Object.keys(tagParser('<body c="3" a="1" b="2">').attrs), ['c', 'a', 'b']);
    });

    // The whole reason this is a parser and not a regex: a quoted value may
    // contain `>`, which ends a `[^>]*` match early and truncates the tag.
    test('a quoted value may contain ">"', () => {
        assert.deepEqual(tagParser('<body title="a > b" class="c">').attrs, {
            title: 'a > b',
            class: 'c',
        });
    });

    test('a quoted value may contain "=", quotes of the other kind, and spaces', () => {
        assert.deepEqual(tagParser('<body data-q="a=b c" title=\'say "hi"\'>').attrs, {
            'data-q': 'a=b c',
            title: 'say "hi"',
        });
    });

    test('a valueless attribute reads as an empty string', () => {
        assert.deepEqual(tagParser('<body hidden>').attrs, { hidden: '' });
        assert.deepEqual(tagParser('<body hidden class="a">').attrs, { hidden: '', class: 'a' });
        assert.deepEqual(tagParser('<body class="a" hidden>').attrs, { class: 'a', hidden: '' });
    });

    // The version this replaced concatenated the tag name onto the first
    // attribute name, producing a single `bodyclass` key.
    test('the tag name does not bleed into the first attribute name', () => {
        assert.deepEqual(tagParser('<body class="a">').attrs, { class: 'a' });
    });

    test('an attribute name that prefixes another stays distinct', () => {
        assert.deepEqual(tagParser('<html data-page="a" data-page-id="b">').attrs, {
            'data-page': 'a',
            'data-page-id': 'b',
        });
    });

    test('tolerates whitespace around the equals sign and newlines between attributes', () => {
        assert.deepEqual(tagParser('<body class = "a"\n  id="b">').attrs, { class: 'a', id: 'b' });
    });

    test('ignores the slash of a self-closing tag', () => {
        assert.deepEqual(tagParser('<link rel="stylesheet" href="/a.css" />').attrs, {
            rel: 'stylesheet',
            href: '/a.css',
        });
    });

    test('values come back as written, entities still encoded', () => {
        assert.deepEqual(tagParser('<body title="a &amp; b">').attrs, { title: 'a &amp; b' });
        assert.deepEqual(tagParser('<body title="a &quot; b">').attrs, { title: 'a &quot; b' });
    });

    // HTML has no backslash escape: `\"` does not continue the value, it ends
    // it, and the remainder parses as further attributes. Surprising if you
    // read it as JS, but it is what a browser does, and these expectations were
    // taken from one (DOMParser gives the same two keys).
    test('a backslash does not escape a quote, matching real HTML parsing', () => {
        assert.deepEqual(tagParser('<body title="a \\" b">').attrs, {
            title: 'a \\',
            'b"': '',
        });
    });
});
