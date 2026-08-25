import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkLinks, cssReferences, globToRegExp, htmlReferences } from './link-check';
import { formatProblem, type Problem } from './output-paths';
import { ensureBin, runBuild, scaffold, tempDir } from '../scripts/fixture';

describe('src/bin/link-check.test.ts - htmlReferences', () => {
    test('reads href and src, quoted either way or not at all', () => {
        assert.deepEqual(
            htmlReferences(
                `<a href="/a.pdf">a</a><img src='/b.png' /><iframe src=/c.html></iframe>`
            ),
            ['/a.pdf', '/b.png', '/c.html']
        );
    });

    // Reading only the first candidate passes a build whose 2x image is
    // missing, which is the one nobody looks at before deploying.
    test('reads every candidate of a srcset, without its descriptors', () => {
        assert.deepEqual(
            htmlReferences(
                `<img src="/a.png" srcset="/a.png 1x, /a@2x.png 2x, /a-wide.png 640w" />`
            ),
            ['/a.png', '/a.png', '/a@2x.png', '/a-wide.png']
        );
    });

    test('reads the imagesrcset of a preload link', () => {
        assert.deepEqual(
            htmlReferences(`<link rel="preload" as="image" imagesrcset="/hero.avif 1x" />`),
            ['/hero.avif']
        );
    });

    // The tag names a file; what is between the tags is a program.
    test('keeps a script src and drops what the script contains', () => {
        assert.deepEqual(
            htmlReferences(`<script src="/client.js">el.src = "/not-a-build-path.png";</script>`),
            ['/client.js']
        );
    });

    test('reads url() out of an inline style block, not the block itself', () => {
        assert.deepEqual(htmlReferences(`<style>body { background: url("/bg.png"); }</style>`), [
            '/bg.png',
        ]);
    });

    test('ignores markup that was commented out', () => {
        assert.deepEqual(htmlReferences(`<!-- <img src="/old.png" /> --><img src="/new.png" />`), [
            '/new.png',
        ]);
    });

    // A commented-out <style> is as switched off as a commented-out <img>, and
    // a stylesheet built inside client JS is that program's business. Reading
    // the style bodies before the comments and script bodies come out collects
    // the url()s of both and fails the build over them.
    test('ignores a style block that was commented out', () => {
        assert.deepEqual(
            htmlReferences(
                `<!-- <style>a{background:url("/old.png")}</style> --><img src="/new.png" />`
            ),
            ['/new.png']
        );
    });

    test('ignores a style block written inside a script body', () => {
        assert.deepEqual(
            htmlReferences(
                `<script>el.innerHTML = '<style>a{background:url("/from-js.png")}</style>';</script>`
            ),
            []
        );
    });

    // <base> says where the other URLs resolve from; it does not name a file,
    // and a project with no root page would be told its own <base> was broken.
    test('ignores the href of a <base> tag', () => {
        assert.deepEqual(htmlReferences(`<base href="/" /><a href="/a.html">a</a>`), ['/a.html']);
    });

    // This project's own docs page renders `&lt;script src="....ts"&gt;` as an
    // example. Scanning raw text rather than tags reports it as a missing file.
    test('ignores escaped markup in text, which is not markup', () => {
        assert.deepEqual(htmlReferences(`<p><code>&lt;script src="....ts"&gt;</code></p>`), []);
    });

    test('decodes entities in a value', () => {
        assert.deepEqual(htmlReferences(`<a href="/a&amp;b.html">a</a>`), ['/a&b.html']);
    });

    // A base64 payload carries commas of its own. Splitting the value on
    // commas turns the tail of one into something that looks like a relative
    // path; the srcset grammar reads a URL as a run of non-whitespace, so the
    // commas belong to it.
    test('does not split a data: URI in a srcset into fragments', () => {
        assert.deepEqual(htmlReferences(`<img srcset="data:image/png;base64,iVBORw0KGgo= 1x" />`), [
            'data:image/png;base64,iVBORw0KGgo=',
        ]);
    });

    // And the candidates beside it are still checked. Skipping the whole value
    // on sight of a data: URI is how a missing 2x image ships.
    test('reads the candidates sitting next to a data: URI', () => {
        assert.deepEqual(
            htmlReferences(
                `<img srcset="data:image/png;base64,iVBORw0KGgo= 1x, /hero-2x.png 2x" />`
            ),
            ['data:image/png;base64,iVBORw0KGgo=', '/hero-2x.png']
        );
    });

    test('reads candidates written with no descriptor at all', () => {
        assert.deepEqual(htmlReferences(`<img srcset="/a.png, /b.png" />`), ['/a.png', '/b.png']);
    });

    // The comma closing a descriptor need not have a space after it. Reading
    // the descriptor as a whitespace-delimited token swallows the URL that
    // follows, which is how the missing 2x image this all exists to catch
    // ships anyway.
    test('reads a candidate that follows a comma with no space', () => {
        assert.deepEqual(htmlReferences(`<img srcset="/a.png 1x,/b.png 2x" />`), [
            '/a.png',
            '/b.png',
        ]);
    });

    // Not a candidate list: the srcset grammar reads a URL as the whole run of
    // non-whitespace, so this is one URL with a comma in it, and a browser
    // requests it verbatim. Reporting it as one unresolved reference is the
    // same thing the browser will do about it.
    test('reads a comma with no whitespace around it as part of the URL', () => {
        assert.deepEqual(htmlReferences(`<img srcset="/a.png,/b.png" />`), ['/a.png,/b.png']);
    });
});

describe('src/bin/link-check.test.ts - cssReferences', () => {
    test('reads url(), quoted either way or not at all', () => {
        assert.deepEqual(
            cssReferences(
                `a{background:url("/a.png")}b{background:url('/b.png')}c{src:url(/c.woff2)}`
            ),
            ['/a.png', '/b.png', '/c.woff2']
        );
    });

    test('reads both forms of @import', () => {
        assert.deepEqual(cssReferences(`@import "/a.css";\n@import url("/b.css");`), [
            '/b.css',
            '/a.css',
        ]);
    });

    // `type()` takes a quoted MIME type, which is not a file. Reading every
    // string in the body fails the build over `image/avif`.
    test('ignores the type() descriptor of an image-set candidate', () => {
        assert.deepEqual(
            cssReferences(
                `a{background:image-set("hero.avif" type("image/avif"), "hero.png" type("image/png"))}`
            ),
            ['hero.avif', 'hero.png']
        );
    });

    // A nested url() closes a `[^)]*` body early, hiding every candidate after
    // it, so the body is scanned by counting parentheses instead.
    test('reads every candidate of an image-set, url() and bare string alike', () => {
        const refs = cssReferences(
            `a{background:image-set(url("/a.png") 1x, "/a@2x.png" 2x, url("/a@3x.png") 3x)}`
        );
        for (const url of ['/a.png', '/a@2x.png', '/a@3x.png']) assert.ok(refs.includes(url), url);
    });

    test('ignores a commented-out url()', () => {
        assert.deepEqual(cssReferences(`/* url("/old.png") */ a{background:url("/new.png")}`), [
            '/new.png',
        ]);
    });
});

describe('src/bin/link-check.test.ts - globToRegExp', () => {
    test('* matches within one path segment and ** across them', () => {
        assert.ok(globToRegExp('/api/*').test('/api/status'));
        assert.ok(!globToRegExp('/api/*').test('/api/v1/status'));
        assert.ok(globToRegExp('/api/**').test('/api/v1/status'));
    });

    test('? matches one character, and a dot is a dot', () => {
        assert.ok(globToRegExp('/v?/x').test('/v1/x'));
        assert.ok(!globToRegExp('/v?/x').test('/v10/x'));
        assert.ok(!globToRegExp('/a.pdf').test('/axpdf'));
    });

    test('is anchored, so a pattern describes the whole URL', () => {
        assert.ok(!globToRegExp('/api').test('/api/status'));
    });

    // Someone writing this is saying the API is not theirs to serve, and
    // having to add `/api` beside it to cover the bare URL is a papercut that
    // only turns up as a failed build.
    test('a trailing /** covers the path itself as well as what is under it', () => {
        assert.ok(globToRegExp('/api/**').test('/api'));
        assert.ok(globToRegExp('/api/**').test('/api/v1/status'));
        // Still a path boundary, not a prefix match.
        assert.ok(!globToRegExp('/api/**').test('/apidocs'));
    });
});

/**
 * Build a throwaway output tree, run `fn` against it, and clean up.
 * @param files - the tree to write, keyed by output-relative path
 * @param fn - receives the absolute output dir
 */
function withOutput(files: Record<string, string>, fn: (output: string) => void): void {
    const output = tempDir('links-');
    try {
        for (const [rel, body] of Object.entries(files)) {
            const full = path.join(output, ...rel.split('/'));
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, body);
        }
        fn(output);
    } finally {
        fs.rmSync(output, { recursive: true, force: true });
    }
}

/** A page as skrapa emits one, with the <base> it injects. */
const page = (body: string, base = '/') =>
    `<!doctype html>\n<html><head><base href="${base}" /></head><body>${body}</body></html>`;

/** The link problems of a check, narrowed for the assertions below. */
const links = (problems: Problem[]) =>
    problems.flatMap((problem) => (problem.rule === 'link' ? [problem] : []));

describe('src/bin/link-check.test.ts - checkLinks', () => {
    test('says nothing when every reference resolves', () => {
        withOutput(
            {
                'index.html': page('<a href="/about/">about</a><img src="/logo.svg" />'),
                'about/index.html': page('<a href="/">home</a>'),
                'logo.svg': '<svg />',
            },
            (output) => assert.deepEqual(checkLinks(output, '/'), [])
        );
    });

    // The whole reason this module exists. fs.existsSync() answers "yes" here
    // on macOS and Windows, which is exactly how the reference shipped.
    test('catches a reference that differs only in case, on any filesystem', () => {
        withOutput(
            {
                'resume/index.html': page('<a href="/brian_reed_resume.pdf">cv</a>'),
                'Brian_Reed_Resume.pdf': '%PDF',
            },
            (output) => {
                const [problem, ...rest] = links(checkLinks(output, '/'));
                assert.equal(rest.length, 0);
                assert.equal(problem.reference, '/brian_reed_resume.pdf');
                assert.deepEqual(problem.suggestion, {
                    url: '/Brian_Reed_Resume.pdf',
                    caseOnly: true,
                });

                // Both spellings in the message, since neither is legible
                // without the other beside it.
                const message = formatProblem(problem);
                assert.match(message, /Reference does not resolve:/);
                assert.match(message, /\/brian_reed_resume\.pdf/);
                assert.match(message, /\/Brian_Reed_Resume\.pdf/);
                assert.match(message, /differs only in case/);
                assert.ok(message.includes('resume/index.html'));
            }
        );
    });

    test('a directory URL resolves to its index.html, slash or no slash', () => {
        withOutput(
            {
                'index.html': page(
                    '<a href="/about/">a</a><a href="/about">b</a><a href="/">c</a>'
                ),
                'about/index.html': page('about'),
            },
            (output) => assert.deepEqual(checkLinks(output, '/'), [])
        );
    });

    test('skips what does not name a file in the build', () => {
        withOutput(
            {
                'index.html': page(
                    [
                        '<a href="https://example.com/x.pdf">a</a>',
                        '<link rel="stylesheet" href="//cdn.example.com/lib.css" />',
                        '<a href="mailto:hi@example.com">b</a>',
                        '<a href="tel:+15555550123">c</a>',
                        '<a href="#top">d</a>',
                        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />',
                    ].join('')
                ),
            },
            (output) => assert.deepEqual(checkLinks(output, '/'), [])
        );
    });

    test('compares the path, not the query or the fragment', () => {
        withOutput(
            {
                'index.html': page('<a href="/style.css?v=2">a</a><a href="/about/#team">b</a>'),
                'style.css': 'a{}',
                'about/index.html': page('about'),
            },
            (output) => assert.deepEqual(checkLinks(output, '/'), [])
        );
    });

    // A url() is relative to the stylesheet, never to the page that linked it.
    test('resolves a CSS url() against the stylesheet it is written in', () => {
        withOutput(
            {
                'index.html': page('<link rel="stylesheet" href="/css/site.css" />'),
                'css/site.css': '@font-face{src:url("../fonts/archivo.woff2")}',
                'fonts/archivo.woff2': 'font',
            },
            (output) => assert.deepEqual(checkLinks(output, '/'), [])
        );
    });

    // Which is what <base href> is for: the same relative href resolves the
    // same way from a nested page as from the root.
    test('resolves a relative HTML reference against the document base', () => {
        withOutput(
            {
                'about/index.html': page('<img src="logo.svg" />'),
                'logo.svg': '<svg />',
            },
            (output) => assert.deepEqual(checkLinks(output, '/'), [])
        );
    });

    test('resolves against the file itself when the document declares no base', () => {
        withOutput(
            {
                'docs/hand-written.html': '<html><body><img src="diagram.svg" /></body></html>',
                'docs/diagram.svg': '<svg />',
            },
            (output) => assert.deepEqual(checkLinks(output, '/'), [])
        );
    });

    // The href may be quoted either way, and a <base> that is read as absent
    // silently resolves every relative reference in the page against the wrong
    // directory. Skrapa writes double quotes; a hand-written asset page is
    // whatever its author typed.
    test('follows a single-quoted <base href> as well as a double-quoted one', () => {
        for (const tag of [`<base href='/' />`, `<base href="/" />`]) {
            withOutput(
                {
                    'about/index.html': `<html><head>${tag}</head><body><img src="logo.svg" /></body></html>`,
                    'logo.svg': '<svg />',
                },
                (output) => assert.deepEqual(checkLinks(output, '/'), [], tag)
            );
        }
    });

    test('strips a configured base from a root-relative URL', () => {
        withOutput(
            {
                'index.html': page('<img src="/repo/logo.svg" />', '/repo/'),
                'logo.svg': '<svg />',
            },
            (output) => assert.deepEqual(checkLinks(output, '/repo/'), [])
        );
    });

    // <base> does not apply to root-relative URLs, so one written without the
    // prefix is a request to the domain root: fine against a dev server rooted
    // at /, a 404 on the project site. The file exists, and is not there.
    test('flags a root-relative URL that omits the base, and suggests it with one', () => {
        withOutput(
            {
                'index.html': page('<link rel="stylesheet" href="/style.css" />', '/repo/'),
                'style.css': 'a{}',
            },
            (output) => {
                const [problem, ...rest] = links(checkLinks(output, '/repo/'));
                assert.equal(rest.length, 0);
                assert.deepEqual(problem.suggestion, { url: '/repo/style.css', caseOnly: false });
            }
        );
    });

    // Nothing can be outside the default base, so the rule above costs a
    // project that has not set one nothing at all.
    test('a root-relative URL is never outside the default base', () => {
        withOutput(
            {
                'index.html': page('<link rel="stylesheet" href="/style.css" />'),
                'style.css': 'a{}',
            },
            (output) => assert.deepEqual(checkLinks(output, '/'), [])
        );
    });

    // The base is on the URL, and a relative reference gets there through the
    // injected <base href> rather than by carrying it.
    test('resolves a relative reference under a base through the document base', () => {
        withOutput(
            {
                'about/index.html': page('<img src="logo.svg" />', '/repo/'),
                'logo.svg': '<svg />',
            },
            (output) => assert.deepEqual(checkLinks(output, '/repo/'), [])
        );
    });

    test('skips a URL matching an ignore glob, written either way', () => {
        withOutput(
            {
                'index.html': page('<a href="/uploads/brief.pdf">a</a>'),
                'docs/index.html': page('<a href="../uploads/brief.pdf">b</a>'),
            },
            (output) => {
                assert.equal(links(checkLinks(output, '/')).length, 2);
                assert.deepEqual(checkLinks(output, '/', ['/uploads/**']), []);
            }
        );
    });

    // Fixing them one build at a time is how the second one gets missed.
    test('reports every broken reference in one run', () => {
        withOutput(
            {
                'index.html': page('<img src="/a.png" /><img src="/b.png" />'),
            },
            (output) => assert.equal(links(checkLinks(output, '/')).length, 2)
        );
    });

    // One bad URL in a shared shell reaches every page built from it, and is
    // still one thing to fix.
    test('groups one reference across the pages that carry it', () => {
        withOutput(
            {
                'index.html': page('<link rel="stylesheet" href="/style.css" />'),
                'about/index.html': page('<link rel="stylesheet" href="/style.css" />'),
                'Style.css': 'a{}',
            },
            (output) => {
                const [problem, ...rest] = links(checkLinks(output, '/'));
                assert.equal(rest.length, 0);
                assert.equal(problem.files.length, 2);

                // Both pages named on the one line, in walk order.
                const [named] = formatProblem(problem).split('\n').slice(1);
                assert.match(named, /about\/index\.html,.*[/\\]index\.html/);
            }
        );
    });

    // The suggestion is a URL from the site root; the reference need not be.
    // Comparing the two as written finds a difference beyond case that is not
    // there, and withholds the one explanation this check exists to give.
    test('calls a case-only difference by its name for a relative reference', () => {
        withOutput(
            {
                'docs/hand-written.html': '<html><body><a href="resume.pdf">cv</a></body></html>',
                'docs/Resume.pdf': '%PDF',
            },
            (output) => {
                const [problem] = links(checkLinks(output, '/'));
                assert.deepEqual(problem.suggestion, {
                    url: '/docs/Resume.pdf',
                    caseOnly: true,
                });
                assert.match(formatProblem(problem), /differs only in case/);
            }
        );
    });

    // A reference that is missing the base differs by more than case, even
    // when the filename matches exactly.
    test('does not call a missing base a case difference', () => {
        withOutput(
            {
                'index.html': page('<link rel="stylesheet" href="/style.css" />', '/repo/'),
                'style.css': 'a{}',
            },
            (output) => {
                const [problem] = links(checkLinks(output, '/repo/'));
                assert.equal(problem.suggestion?.caseOnly, false);
                assert.doesNotMatch(formatProblem(problem), /differs only in case/);
            }
        );
    });

    // A <base> inside a comment is not a <base>. Reading it off the raw text
    // lets it silently govern where every reference in the file resolves from.
    test('ignores a commented-out <base href>', () => {
        withOutput(
            {
                'docs/page.html':
                    '<html><head><!-- <base href="/elsewhere/" /> --></head>' +
                    '<body><img src="diagram.svg" /></body></html>',
                'docs/diagram.svg': '<svg />',
            },
            (output) => assert.deepEqual(checkLinks(output, '/'), [])
        );
    });

    test('suggests the same filename found in another directory', () => {
        withOutput(
            {
                'index.html': page('<img src="/logo.svg" />'),
                'img/logo.svg': '<svg />',
            },
            (output) => {
                const [problem] = links(checkLinks(output, '/'));
                assert.deepEqual(problem.suggestion, { url: '/img/logo.svg', caseOnly: false });
            }
        );
    });

    test('suggests a page as the directory URL it is reached by', () => {
        withOutput(
            {
                'index.html': page('<a href="/About/">about</a>'),
                'about/index.html': page('about'),
            },
            (output) => {
                const [problem] = links(checkLinks(output, '/'));
                assert.deepEqual(problem.suggestion, { url: '/about/', caseOnly: true });
            }
        );
    });

    test('names the file and stops when nothing is close enough to suggest', () => {
        withOutput(
            {
                'index.html': page('<img src="/nothing-like-what-is-here.png" />'),
                'logo.svg': '<svg />',
            },
            (output) => {
                const [problem] = links(checkLinks(output, '/'));
                assert.equal(problem.suggestion, undefined);
                assert.match(formatProblem(problem), /add it to `ignore`/);
            }
        );
    });

    // fs.cpSync copies a symlink as the link it is, so one pointing nowhere
    // lands in the output under a name this check wants to open. It has no
    // references to read, and it is not worth ending a build with a stack
    // trace over.
    test('skips a file it cannot read rather than throwing', () => {
        withOutput(
            {
                'index.html': page('<img src="/logo.svg" />'),
                'logo.svg': '<svg />',
            },
            (output) => {
                fs.symlinkSync(path.join(output, 'gone.css'), path.join(output, 'dangling.css'));
                assert.deepEqual(checkLinks(output, '/'), []);
            }
        );
    });

    test('reads no references out of a .js bundle, where a URL is just a string', () => {
        withOutput(
            {
                'index.html': page('<script src="/client.js"></script>'),
                'client.js': 'fetch("/api/not-a-build-path");',
            },
            (output) => assert.deepEqual(checkLinks(output, '/'), [])
        );
    });
});

// The end-to-end cases: real builds, since the failure being asserted is a
// non-zero exit. The harness lives in ../scripts/fixture.ts.

describe('src/bin/link-check.test.ts - skrapa build, a reference that differs only in case', () => {
    let fixture: string;
    let result: { status: number | null; output: string };

    before(() => {
        ensureBin();
        fixture = tempDir('build-link-case-');
        const write = scaffold(fixture);

        // The asset keeps the case it was named with, and the page links it
        // lowercased. Both files exist, the site works on macOS, and the
        // download is dead everywhere else.
        write(
            'src/resume/index.tsx',
            'export const Page = (): Skrapa.Page => <a href="/brian_reed_resume.pdf">CV</a>;\n'
        );
        write('public/Brian_Reed_Resume.pdf', '%PDF-1.4\n');

        result = runBuild(fixture);
    });

    after(() => fs.rmSync(fixture, { recursive: true, force: true }));

    test('fails the build rather than reporting success', () => {
        assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.output}`);
    });

    test('names both spellings, and says which of the two ways they differ', () => {
        assert.match(result.output, /Reference does not resolve:/);
        for (const named of [
            'dist/resume/index.html',
            '/brian_reed_resume.pdf',
            '/Brian_Reed_Resume.pdf',
            'differs only in case',
        ]) {
            assert.ok(result.output.includes(named), `expected the message to name ${named}`);
        }
    });

    // The same project rebuilt the way the dev server rebuilds it. Mid-edit a
    // broken reference is usually a link to a file that is about to exist, so
    // it is reported without taking a running server's updates down.
    test('warns instead of failing when a dev server asked for the build', () => {
        const dev = runBuild(fixture, ['pretty']);
        assert.equal(dev.status, 0, `expected exit 0, got ${dev.status}\n${dev.output}`);
        assert.match(dev.output, /Reference does not resolve:/);
    });
});

describe('src/bin/link-check.test.ts - skrapa build, references off the build', () => {
    let fixture: string;
    let result: { status: number | null; output: string };

    before(() => {
        ensureBin();
        fixture = tempDir('build-link-external-');
        const write = scaffold(fixture);

        write(
            'src/index.tsx',
            'export const Page = (): Skrapa.Page => (\n' +
                '    <p>\n' +
                '        <a href="https://example.com/report.pdf">report</a>\n' +
                '        <a href="//cdn.example.com/lib.js">cdn</a>\n' +
                '        <a href="mailto:hi@example.com">mail</a>\n' +
                '        <a href="#top">top</a>\n' +
                '        <img src="/logo.svg" alt="logo" />\n' +
                '    </p>\n' +
                ');\n'
        );
        write('public/logo.svg', '<svg />');

        result = runBuild(fixture);
    });

    after(() => fs.rmSync(fixture, { recursive: true, force: true }));

    test('builds, since another origin is not the build to check', () => {
        assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.output}`);
        assert.doesNotMatch(result.output, /Reference does not resolve/);
        assert.ok(
            !result.output.includes('example.com'),
            'an external URL is not the build to fix'
        );
    });
});
