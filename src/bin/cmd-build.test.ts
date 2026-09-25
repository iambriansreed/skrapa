import { after, before, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyTagAttrs } from './cmd-build';
import { parseJsonc } from './config';
import { ensureBin, removeTempDir, runBuild, scaffold, tempDir } from '../scripts/fixture';

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

// The end-to-end cases: real builds, since what is asserted is an exit code and
// what was or was not left on disk. The harness lives in ../scripts/fixture.ts.

/**
 * Replace the scaffolded tsconfig.json's skrapa key, merge compilerOptions, and
 * set any other top-level field.
 */
function writeTsconfig(
    fixture: string,
    skrapa: unknown,
    compilerOptions: Record<string, unknown> = {},
    fields: Record<string, unknown> = {}
): void {
    const file = path.join(fixture, 'tsconfig.json');
    const tsconfig = parseJsonc(fs.readFileSync(file, 'utf-8')) as {
        compilerOptions: Record<string, unknown>;
    };
    tsconfig.compilerOptions = { ...tsconfig.compilerOptions, ...compilerOptions };
    fs.writeFileSync(file, JSON.stringify({ ...tsconfig, ...fields, skrapa }, null, 4));
}

const NOT_A_PAGE = 'export const Page = (): Skrapa.Page => <h1>not a page</h1>;\n';

describe('src/bin/cmd-build.test.ts - skrapa build, a config with problems', () => {
    let fixture: string;
    let result: { status: number | null; output: string };

    before(() => {
        ensureBin();
        fixture = tempDir('build-config-');
        const write = scaffold(fixture);
        writeTsconfig(fixture, { prot: 8080, port: 0 });
        write('skrapa.config.ts', 'export default { input: "src" };\n');
        write('dist/keep.txt', 'from the last good build');

        result = runBuild(fixture, ['--input', 'src']);
    });

    after(() => removeTempDir(fixture));

    test('fails the build', () => {
        assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.output}`);
    });

    // Fixing them one run at a time is how the second one gets missed.
    test('names every problem in the one run', () => {
        for (const named of [
            'unknown key: prot',
            '"port" must be an integer',
            '--input has been removed',
            'skrapa.config.ts is no longer read',
        ]) {
            assert.ok(result.output.includes(named), `expected the message to name ${named}`);
        }
    });

    // A config skrapa does not fully understand is not one to act on, even
    // partly: not the clean, not the types sync, not tsc.
    test('stops before touching anything', () => {
        assert.ok(fs.existsSync(path.join(fixture, 'dist/keep.txt')), 'the output dir was cleaned');
        assert.ok(!fs.existsSync(path.join(fixture, 'skrapa.d.ts')), 'skrapa.d.ts was written');
        assert.ok(!fs.existsSync(path.join(fixture, '.skrapa')), 'tsc ran');
    });
});

describe('src/bin/cmd-build.test.ts - skrapa build, a project dir with more than pages in it', () => {
    let fixture: string;
    let result: { status: number | null; output: string };

    before(() => {
        ensureBin();
        fixture = tempDir('build-project-');
        const write = scaffold(fixture);
        // Both are overridden: the page walk relies on .skrapa mirroring the
        // project dir exactly.
        writeTsconfig(fixture, { output: 'dist' }, { outDir: './elsewhere', rootDir: './nowhere' });
        write('about/index.tsx', 'export const Page = (): Skrapa.Page => <h1>about</h1>;\n');
        write('node_modules/pkg/index.tsx', NOT_A_PAGE);
        write('.hidden/index.tsx', NOT_A_PAGE);
        fs.mkdirSync(path.join(fixture, 'public'));

        result = runBuild(fixture);
    });

    after(() => removeTempDir(fixture));

    test('builds', () => {
        assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.output}`);
    });

    test('compiles nothing where outDir and rootDir point', () => {
        assert.ok(!fs.existsSync(path.join(fixture, 'elsewhere')));
        assert.ok(!fs.existsSync(path.join(fixture, 'nowhere')));
    });

    test('builds the pages beside tsconfig.json, and none under node_modules or a dot-dir', () => {
        assert.ok(fs.existsSync(path.join(fixture, 'dist', 'index.html')));
        assert.ok(fs.existsSync(path.join(fixture, 'dist', 'about', 'index.html')));
        assert.ok(!fs.existsSync(path.join(fixture, 'dist', 'node_modules')));
        assert.ok(!fs.existsSync(path.join(fixture, 'dist', '.hidden')));
    });

    // Scratch space nothing reads once the build is over; a project should not
    // be left holding it.
    test('deletes .skrapa once the build is done', () => {
        assert.ok(!fs.existsSync(path.join(fixture, '.skrapa')));
    });

    // A dev server rebuilds through a `skrapa build skip-assets` subprocess,
    // and still needs .skrapa afterwards: tsc's incremental state, and the
    // manifest its assets watcher reads. Last, since it rebuilds the fixture.
    test('keeps .skrapa after a dev rebuild', () => {
        const rebuild = runBuild(fixture, ['skip-assets', 'pretty']);

        assert.equal(rebuild.status, 0, rebuild.output);
        assert.ok(fs.existsSync(path.join(fixture, '.skrapa', 'about', 'index.js')));
        assert.ok(fs.existsSync(path.join(fixture, '.skrapa', 'emitted.json')));
    });
});

// `output: "docs"` is the usual GitHub Pages setting, and a project can just as
// easily have a docs/ page. The output dir is never searched for pages, so the
// page would never build, and cleaning the output dir would delete it.
describe('src/bin/cmd-build.test.ts - skrapa build, an output dir that holds a page', () => {
    let fixture: string;
    let result: { status: number | null; output: string };

    before(() => {
        ensureBin();
        fixture = tempDir('build-output-page-');
        const write = scaffold(fixture);
        writeTsconfig(fixture, { output: 'docs' });
        write('docs/index.tsx', NOT_A_PAGE);
        fs.mkdirSync(path.join(fixture, 'public'));

        result = runBuild(fixture);
    });

    after(() => removeTempDir(fixture));

    test('refuses to clean it', () => {
        assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.output}`);
        assert.match(result.output, /refusing to clean the output dir docs; it holds the page/);
    });

    test('leaves the page where it was', () => {
        assert.ok(fs.existsSync(path.join(fixture, 'docs', 'index.tsx')));
    });
});

// The template's shape: tsconfig.json and the pages in src/ (the skrapa root),
// with the project root around it one level up.
describe('src/bin/cmd-build.test.ts - skrapa build, a skrapa root inside the project root', () => {
    let fixture: string;
    let result: { status: number | null; output: string };

    before(() => {
        ensureBin();
        fixture = tempDir('build-roots-');
        scaffold(fixture);

        const src = path.join(fixture, 'src');
        fs.mkdirSync(path.join(src, 'public'), { recursive: true });
        for (const file of ['tsconfig.json', 'index.html', 'index.tsx']) {
            fs.renameSync(path.join(fixture, file), path.join(src, file));
        }
        writeTsconfig(
            src,
            { output: '../dist', projectRoot: '..' },
            {},
            { include: ['**/*.ts', '**/*.tsx', '../skrapa.d.ts'] }
        );

        result = runBuild(src);
    });

    after(() => removeTempDir(fixture));

    test('builds', () => {
        assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.output}`);
    });

    // It belongs to the project, like .github and package.json, and the
    // tsconfig.json below names it in "include".
    test('writes skrapa.d.ts into the project root, not the skrapa root', () => {
        assert.ok(fs.existsSync(path.join(fixture, 'skrapa.d.ts')));
        assert.ok(!fs.existsSync(path.join(fixture, 'src', 'skrapa.d.ts')));
    });

    test('resolves the output dir against the skrapa root, and leaves no .skrapa in either root', () => {
        assert.ok(fs.existsSync(path.join(fixture, 'dist', 'index.html')));
        assert.ok(!fs.existsSync(path.join(fixture, 'src', '.skrapa')));
        assert.ok(!fs.existsSync(path.join(fixture, '.skrapa')));
    });
});

// The opposite shape: tsconfig.json beside the project files, the pages one
// level down in src/ (`source`).
describe('src/bin/cmd-build.test.ts - skrapa build, a source dir below tsconfig.json', () => {
    let fixture: string;
    let result: { status: number | null; output: string };

    before(() => {
        ensureBin();
        fixture = tempDir('build-source-');
        const write = scaffold(fixture);

        const src = path.join(fixture, 'src');
        fs.mkdirSync(path.join(src, 'about'), { recursive: true });
        fs.mkdirSync(path.join(fixture, 'public'));
        for (const file of ['index.html', 'index.tsx']) {
            fs.renameSync(path.join(fixture, file), path.join(src, file));
        }
        write(
            'src/about/index.tsx',
            'export const Page = (): Skrapa.Page => <script src="./client.ts"></script>;\n'
        );
        write('src/about/client.ts', 'console.log("about");\n');
        writeTsconfig(fixture, { output: 'dist', source: 'src' });

        result = runBuild(fixture);
    });

    after(() => removeTempDir(fixture));

    test('builds', () => {
        assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.output}`);
    });

    // Pages are routed relative to the source dir, not to tsconfig.json.
    test('routes pages relative to the source dir', () => {
        assert.ok(fs.existsSync(path.join(fixture, 'dist', 'index.html')));
        assert.ok(fs.existsSync(path.join(fixture, 'dist', 'about', 'index.html')));
        assert.ok(!fs.existsSync(path.join(fixture, 'dist', 'src')));
    });

    test('bundles a client script from below the source dir', () => {
        assert.ok(fs.existsSync(path.join(fixture, 'dist', 'about', 'client.js')));
    });

    test('writes skrapa.d.ts beside tsconfig.json, not into the source dir', () => {
        assert.ok(fs.existsSync(path.join(fixture, 'skrapa.d.ts')));
        assert.ok(!fs.existsSync(path.join(fixture, 'src', 'skrapa.d.ts')));
    });
});
