import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyTagAttrs } from './cmd-build';

const shell = (tag = '<html lang="en">') => `<!doctype html>\n${tag}\n<head></head>\n</html>`;

describe('src/bin/cmd-build.test.ts - applyTagAttrs', () => {
    test('adds an attribute the shell does not set', () => {
        assert.match(
            applyTagAttrs(shell(), 'html', { class: 'docs-page' }),
            /<html lang="en" class="docs-page">/
        );
    });

    test('leaves the shell untouched when there are no attrs', () => {
        assert.equal(applyTagAttrs(shell(), 'html', undefined), shell());
        assert.equal(applyTagAttrs(shell(), 'html', {}), shell());
    });

    test('replaces an attribute the shell already sets, rather than duplicating it', () => {
        const out = applyTagAttrs(shell(), 'html', { lang: 'fr' });
        assert.match(out, /<html lang="fr">/);
        // A duplicate would leave the shell's value first, which is the one
        // browsers would actually honour.
        assert.equal(out.match(/lang=/g)?.length, 1);
    });

    test('preserves the shell attributes the page does not mention', () => {
        const out = applyTagAttrs(shell('<html lang="en" dir="rtl">'), 'html', { class: 'x' });
        assert.match(out, /lang="en"/);
        assert.match(out, /dir="rtl"/);
        assert.match(out, /class="x"/);
    });

    test('matches single-quoted and unquoted shell attributes when replacing', () => {
        assert.match(
            applyTagAttrs(shell("<html lang='en'>"), 'html', { lang: 'fr' }),
            /<html lang="fr">/
        );
        assert.match(
            applyTagAttrs(shell('<html lang=en>'), 'html', { lang: 'fr' }),
            /<html lang="fr">/
        );
    });

    test('escapes values the way jsx does', () => {
        assert.match(
            applyTagAttrs(shell(), 'html', { title: 'a "b" & c' }),
            /title="a &quot;b&quot; &amp; c"/
        );
    });

    // A function value merges with what the shell already had, instead of
    // overwriting it like a string does.
    test('a function receives the shell value and its result is used', () => {
        assert.match(
            applyTagAttrs(shell('<html class="a">'), 'html', {
                class: (prev) => `${prev} b`,
            }),
            /<html class="a b">/
        );
    });

    test('a function receives "" when the shell sets no such attribute', () => {
        let seen: string | undefined;
        const out = applyTagAttrs(shell(), 'html', {
            class: (prev) => {
                seen = prev;
                return 'only';
            },
        });
        assert.equal(seen, '');
        assert.match(out, /class="only"/);
    });

    test('a function receives "" for a valueless shell attribute', () => {
        let seen: string | undefined;
        applyTagAttrs('<html><body hidden></body></html>', 'body', {
            hidden: (prev) => {
                seen = prev;
                return 'until-found';
            },
        });
        assert.equal(seen, '');
    });

    test('a function sees the value as authored, not its escaped form', () => {
        // Without unescaping first, `prev` would arrive as "a &amp; b" and get
        // re-escaped to "a &amp;amp; b", compounding on every build.
        let seen: string | undefined;
        const out = applyTagAttrs('<html class="a &amp; b"></html>', 'html', {
            class: (prev) => {
                seen = prev;
                return prev;
            },
        });
        assert.equal(seen, 'a & b');
        assert.match(out, /class="a &amp; b"/);
        assert.doesNotMatch(out, /&amp;amp;/);
    });

    test('a string overwrites where a function would have merged', () => {
        assert.match(applyTagAttrs(shell('<html class="a">'), 'html', { class: 'b' }), /class="b"/);
        assert.doesNotMatch(
            applyTagAttrs(shell('<html class="a">'), 'html', { class: 'b' }),
            /class="a/
        );
    });

    test('only the opening <html> tag is touched, not </html> or the body', () => {
        const out = applyTagAttrs(shell(), 'html', { class: 'x' });
        assert.match(out, /<\/html>/);
        assert.equal(out.match(/class="x"/g)?.length, 1);
    });

    test('is a no-op on a shell with no matching tag at all', () => {
        const fragment = '<head></head><body></body>';
        assert.equal(applyTagAttrs(fragment, 'html', { class: 'x' }), fragment);
        assert.equal(applyTagAttrs('<html></html>', 'body', { class: 'x' }), '<html></html>');
    });

    // An attribute name that prefixes a longer one the shell already sets must
    // not match it. Without a boundary check, setting `data-page` would strip
    // the front off `data-page-id="keep"` and leave a stray `-id="keep"`.
    test('does not match an attribute whose name it merely prefixes', () => {
        const out = applyTagAttrs('<html data-page-id="keep" class="c"></html>', 'html', {
            'data-page': 'home',
        });
        assert.match(out, /data-page-id="keep"/);
        assert.match(out, /class="c"/);
        assert.match(out, /data-page="home"/);
        // The corruption this guards against leaves the tail of the stripped
        // name behind as its own attribute, i.e. a whitespace-preceded `-id=`.
        assert.doesNotMatch(out, /\s-id=/);
    });

    // A `>` inside a quoted value does not end the tag. Scanning to the first
    // `>` ends it mid-attribute, drops the rest of that value, and spills the
    // remainder of the tag into the document as visible text.
    test('a ">" inside a quoted attribute value does not end the tag', () => {
        const out = applyTagAttrs('<body title="a > b" class="c"><h1>hi</h1></body>', 'body', {
            class: 'new',
        });
        assert.match(out, /<body title="a > b" class="new">/);
        assert.match(out, /<h1>hi<\/h1><\/body>/);
        // The tell-tale of the old behaviour: the tag ended early, so the
        // shell's overwritten class survived as leftover text after it.
        assert.doesNotMatch(out, /class="c"/);
    });

    test('a merge function reads a value containing ">" intact', () => {
        let seen: string | undefined;
        applyTagAttrs('<body data-q="x > y"></body>', 'body', {
            'data-q': (prev) => {
                seen = prev;
                return prev;
            },
        });
        assert.equal(seen, 'x > y');
    });

    // Attribute names must only ever match as names. Searching the tag's raw
    // text finds them inside other attributes' values too, which would carve
    // the word "class" straight out of the title below.
    test('does not match its own name inside another attribute value', () => {
        const out = applyTagAttrs('<body title="my class is nice"></body>', 'body', {
            class: 'c',
        });
        assert.match(out, /title="my class is nice"/);
        assert.match(out, /class="c"/);
    });

    test('a merge function is not fooled by its name inside another value', () => {
        let seen: string | undefined;
        applyTagAttrs('<body title="a class here" class="real"></body>', 'body', {
            class: (prev) => {
                seen = prev;
                return prev;
            },
        });
        assert.equal(seen, 'real');
    });

    test('a merge function sees the real value, not one stolen from a longer name', () => {
        let seen: string | undefined;
        applyTagAttrs('<html class="real" classy="other"></html>', 'html', {
            class: (prev) => {
                seen = prev;
                return prev;
            },
        });
        assert.equal(seen, 'real');
    });

    // shellAttrs.body runs through the same code path, so these cover the parts
    // specific to targeting <body>: the right tag, and only that tag.
    test('merges into the opening <body> tag', () => {
        const html = '<html lang="en"><head></head><body class="a"></body></html>';
        assert.match(
            applyTagAttrs(html, 'body', { 'data-page': 'docs' }),
            /<body class="a" data-page="docs">/
        );
    });

    test('replaces an attribute <body> already sets', () => {
        const html = '<html><body class="a"></body></html>';
        const out = applyTagAttrs(html, 'body', { class: 'b' });
        assert.match(out, /<body class="b">/);
        assert.equal(out.match(/class=/g)?.length, 1);
    });

    test('body and html attrs do not bleed into each other', () => {
        const html = '<html lang="en"><body></body></html>';
        const out = applyTagAttrs(applyTagAttrs(html, 'html', { class: 'h' }), 'body', {
            class: 'b',
        });
        assert.match(out, /<html lang="en" class="h">/);
        assert.match(out, /<body class="b">/);
    });

    test('does not match </body> or a <body> later in the markup', () => {
        const html = '<html><body></body></html>';
        const out = applyTagAttrs(html, 'body', { class: 'x' });
        assert.equal(out.match(/class="x"/g)?.length, 1);
        assert.match(out, /<\/body>/);
    });

    test('a shell style attribute survives the round trip intact', () => {
        // Every untouched attribute is re-serialized through renderAttrs, whose
        // style branch used to run styleToCss() over the string and emit
        // style="0:c;1:o;2:l;...".
        const out = applyTagAttrs(
            '<html style="color:red" lang="en"><body></body></html>',
            'html',
            {
                class: 'docs',
            }
        );
        assert.match(out, /style="color:red"/);
        assert.match(out, /lang="en"/);
        assert.match(out, /class="docs"/);
    });
});
