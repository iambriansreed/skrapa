import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyHtmlAttrs } from './cmd-build';

const shell = (tag = '<html lang="en">') => `<!doctype html>\n${tag}\n<head></head>\n</html>`;

describe('src/bin/cmd-build.test.ts - applyHtmlAttrs', () => {
    test('adds an attribute the shell does not set', () => {
        assert.match(
            applyHtmlAttrs(shell(), { class: 'docs-page' }),
            /<html lang="en" class="docs-page">/
        );
    });

    test('leaves the shell untouched when there are no attrs', () => {
        assert.equal(applyHtmlAttrs(shell(), undefined), shell());
        assert.equal(applyHtmlAttrs(shell(), {}), shell());
    });

    test('replaces an attribute the shell already sets, rather than duplicating it', () => {
        const out = applyHtmlAttrs(shell(), { lang: 'fr' });
        assert.match(out, /<html lang="fr">/);
        // A duplicate would leave the shell's value first, which is the one
        // browsers would actually honour.
        assert.equal(out.match(/lang=/g)?.length, 1);
    });

    test('preserves the shell attributes the page does not mention', () => {
        const out = applyHtmlAttrs(shell('<html lang="en" dir="rtl">'), { class: 'x' });
        assert.match(out, /lang="en"/);
        assert.match(out, /dir="rtl"/);
        assert.match(out, /class="x"/);
    });

    test('matches single-quoted and unquoted shell attributes when replacing', () => {
        assert.match(applyHtmlAttrs(shell("<html lang='en'>"), { lang: 'fr' }), /<html lang="fr">/);
        assert.match(applyHtmlAttrs(shell('<html lang=en>'), { lang: 'fr' }), /<html lang="fr">/);
    });

    test('serializes values the way jsx does: escaping, style objects, dropped nulls', () => {
        assert.match(
            applyHtmlAttrs(shell(), { title: 'a "b" & c' }),
            /title="a &quot;b&quot; &amp; c"/
        );
        assert.match(applyHtmlAttrs(shell(), { style: { color: 'red' } }), /style="color:red"/);
        assert.doesNotMatch(applyHtmlAttrs(shell(), { class: null }), /class=/);
    });

    test('only the opening <html> tag is touched, not </html> or the body', () => {
        const out = applyHtmlAttrs(shell(), { class: 'x' });
        assert.match(out, /<\/html>/);
        assert.equal(out.match(/class="x"/g)?.length, 1);
    });

    test('is a no-op on a shell with no <html> tag at all', () => {
        const fragment = '<head></head><body></body>';
        assert.equal(applyHtmlAttrs(fragment, { class: 'x' }), fragment);
    });
});
