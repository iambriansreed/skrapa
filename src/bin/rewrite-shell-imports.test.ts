import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rewriteShellImports, type RewriteDirs } from './rewrite-shell-imports';

// These two rewriters read and write real files, so each run gets a throwaway
// tree: <tmp>/{src,dist,assets,compiled}. Until they were lifted out of
// build(), only the end-to-end run reached them, which is how a `>` inside an
// unrelated attribute came to silently skip a client script.
let root: string;
let dirs: RewriteDirs;

const write = (file: string, body: string) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
};

const exists = (file: string) => fs.existsSync(path.join(root, file));
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf-8');

before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-rewrite-'));
    dirs = {
        input: path.join(root, 'src'),
        output: path.join(root, 'dist'),
        assets: path.join(root, 'assets'),
        compiled: path.join(root, 'compiled'),
        base: '/',
    };

    // A compiled client entry, as tsc would have left it, plus one nested in a
    // page directory.
    write('compiled/client.js', 'console.log("root client");\n');
    write('compiled/about/client.js', 'console.log("about client");\n');

    write('src/style.css', 'body { color: red }\n');
    write('src/about/style.css', '.about { color: blue }\n');
    write('assets/style.css', 'body { color: green }\n');
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

describe('src/bin/rewrite-shell-imports.test.ts - rewriteShellImports, client scripts', () => {
    test('bundles a relative src against the template dir and rewrites its path', () => {
        const out = rewriteShellImports('<script src="./client.ts"></script>', 'about', dirs);
        assert.match(out, /src="\/about\/client\.js"/);
        assert.ok(exists('dist/about/client.js'));
        assert.match(read('dist/about/client.js'), /about client/);
    });

    test('resolves a root-relative src from the input root', () => {
        const out = rewriteShellImports('<script src="/client.ts"></script>', 'about', dirs);
        assert.match(out, /src="\/client\.js"/);
        assert.ok(exists('dist/client.js'));
    });

    test('preserves every other attribute, and its quoting', () => {
        const out = rewriteShellImports(
            `<script type="module" src="./client.ts" data-x='y'></script>`,
            '',
            dirs
        );
        assert.match(out, /type="module"/);
        assert.match(out, /data-x='y'/);
        assert.match(out, /src="\/client\.js"/);
    });

    // The bug that motivated extracting this: the tag was passed over in
    // silence and the page shipped a src pointing at a .ts file.
    test('a ">" in another attribute does not stop the script being bundled', () => {
        const out = rewriteShellImports(
            '<script src="./client.ts" data-note="a > b"></script>',
            '',
            dirs
        );
        assert.match(out, /src="\/client\.js"/);
        assert.match(out, /data-note="a > b"/);
        assert.ok(exists('dist/client.js'));
    });

    test('leaves a missing entry alone rather than emitting a broken bundle', () => {
        const tag = '<script src="./nope.ts"></script>';
        assert.equal(rewriteShellImports(tag, '', dirs), tag);
        assert.ok(!exists('dist/nope.js'));
    });

    test('ignores scripts that are not TypeScript entries', () => {
        for (const tag of [
            '<script src="/already.js"></script>',
            '<script>console.log(1)</script>',
            '<script src="https://cdn.example.com/x.js"></script>',
        ]) {
            assert.equal(rewriteShellImports(tag, '', dirs), tag);
        }
    });
});

describe('src/bin/rewrite-shell-imports.test.ts - rewriteShellImports, stylesheets', () => {
    test('copies a relative href and rewrites it root-relative', () => {
        const out = rewriteShellImports(
            '<link rel="stylesheet" href="./style.css" />',
            'about',
            dirs
        );
        assert.match(out, /href="\/about\/style\.css"/);
        assert.ok(exists('dist/about/style.css'));
        assert.match(read('dist/about/style.css'), /color: blue/);
    });

    test('does not copy over a root-relative href the assets dir provides', () => {
        const tag = '<link rel="stylesheet" href="/style.css" />';
        // assets/style.css exists and the assets dir is copied wholesale, so
        // this must not be copied over the asset. At the default base the href
        // is written back exactly as authored.
        assert.equal(rewriteShellImports(tag, '', dirs), tag);
    });

    test('copies a root-relative href that only the input root has', () => {
        const noAssets = { ...dirs, assets: path.join(root, 'no-assets') };
        const tag = '<link rel="stylesheet" href="/style.css" />';
        assert.equal(rewriteShellImports(tag, '', noAssets), tag);
        assert.ok(exists('dist/style.css'));
        assert.match(read('dist/style.css'), /color: red/);
    });

    test('a ">" in an earlier attribute does not hide the href', () => {
        const out = rewriteShellImports(
            '<link rel="stylesheet" title="High > Contrast" href="./style.css" />',
            'about',
            dirs
        );
        assert.match(out, /href="\/about\/style\.css"/);
        assert.match(out, /title="High > Contrast"/);
    });

    // A CDN stylesheet is ordinary, and nothing about it is missing, so it
    // must pass through silently rather than being joined onto the input dir
    // and warned about.
    test('leaves stylesheets on another origin alone', () => {
        for (const href of [
            'https://cdn.example.com/lib.css',
            'http://cdn.example.com/lib.css',
            '//cdn.example.com/lib.css',
        ]) {
            const tag = `<link rel="stylesheet" href="${href}" />`;
            assert.equal(rewriteShellImports(tag, 'about', dirs), tag);
        }
        assert.ok(!exists('dist/cdn.example.com'));
    });

    test('leaves scripts on another origin alone', () => {
        const tag = '<script src="https://cdn.example.com/x.ts"></script>';
        assert.equal(rewriteShellImports(tag, '', dirs), tag);
    });

    // The warning names the file the bad href was written in. A page-body
    // pass hands its own index.tsx through `referencedIn`; without it the
    // warning blames the shell's index.html for a link the shell never had.
    test('a missing stylesheet warns once, naming the file it came from', (t) => {
        const logged: string[] = [];
        t.mock.method(console, 'log', (msg: string) => logged.push(String(msg)));

        rewriteShellImports(
            '<link rel="stylesheet" href="./missing.css" />',
            'about',
            dirs,
            path.join(dirs.input, 'about', 'index.tsx')
        );

        const warnings = logged.filter((l) => l.includes('Stylesheet not found'));
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /about\/index\.tsx/);
        assert.doesNotMatch(warnings[0], /index\.html/);
    });

    test('the warning defaults to blaming the shell when no source is given', (t) => {
        const logged: string[] = [];
        t.mock.method(console, 'log', (msg: string) => logged.push(String(msg)));

        rewriteShellImports('<link rel="stylesheet" href="./missing.css" />', 'about', dirs);

        const warnings = logged.filter((l) => l.includes('Stylesheet not found'));
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /about\/index\.html/);
    });

    // `./x.css` means "next to this file", so it can never reach the assets
    // dir, which is copied to the *output root*. That trips people up, because
    // the file is plainly sitting in assets when the warning fires. The
    // resolution stays as it is; the warning does the explaining.

    test('a relative href missing from src points at the assets copy by name', (t) => {
        write('assets/only-in-assets.css', 'body { color: teal }\n');
        const logged: string[] = [];
        t.mock.method(console, 'log', (msg: string) => logged.push(String(msg)));

        rewriteShellImports('<link rel="stylesheet" href="./only-in-assets.css" />', '', dirs);

        const warnings = logged.filter((l) => l.includes('Stylesheet not found'));
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /reference it as "\/only-in-assets\.css"/);
    });

    test('the hint finds an assets file by bare name from a nested page', (t) => {
        write('assets/nested-only.css', 'body { color: olive }\n');
        const logged: string[] = [];
        t.mock.method(console, 'log', (msg: string) => logged.push(String(msg)));

        // rel is about/nested-only.css, which is not in assets; the bare
        // filename is, and that is what the author almost certainly meant.
        rewriteShellImports('<link rel="stylesheet" href="./nested-only.css" />', 'about', dirs);

        const warnings = logged.filter((l) => l.includes('Stylesheet not found'));
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /reference it as "\/nested-only\.css"/);
    });

    test('no assets suggestion when the file is nowhere at all', (t) => {
        const logged: string[] = [];
        t.mock.method(console, 'log', (msg: string) => logged.push(String(msg)));

        rewriteShellImports('<link rel="stylesheet" href="./nowhere.css" />', '', dirs);

        const warnings = logged.filter((l) => l.includes('Stylesheet not found'));
        assert.equal(warnings.length, 1);
        assert.doesNotMatch(warnings[0], /reference it as/);
    });

    test('a relative href still does not resolve to assets, only warns about it', () => {
        write('assets/not-copied.css', 'body { color: maroon }\n');
        const tag = '<link rel="stylesheet" href="./not-copied.css" />';

        // Unchanged tag and nothing emitted: the hint is advice, not a fallback.
        assert.equal(rewriteShellImports(tag, '', dirs), tag);
        assert.ok(!exists('dist/not-copied.css'));
    });

    test('leaves non-stylesheet links and missing files untouched', () => {
        for (const tag of [
            '<link rel="icon" href="/favicon.css" />',
            '<link rel="stylesheet" href="./missing.css" />',
            '<link rel="preconnect" href="https://example.com" />',
        ]) {
            assert.equal(rewriteShellImports(tag, 'about', dirs), tag);
        }
    });
});

// `<base href>` governs relative URLs only, so a root-relative path skrapa
// writes has to carry the base itself. Without this a project site under
// `/repo/` ships `<script src="/client.js">`: a request to the domain root,
// which the dev server happens to answer and the deployed host 404s.
describe('src/bin/rewrite-shell-imports.test.ts - rewriteShellImports, under a base', () => {
    const based = () => ({ ...dirs, base: '/repo/' });

    test('writes the base into a bundled script path', () => {
        const out = rewriteShellImports('<script src="./client.ts"></script>', 'about', based());
        assert.match(out, /src="\/repo\/about\/client\.js"/);
        // The file still lands at the output path the URL resolves to.
        assert.ok(exists('dist/about/client.js'));
    });

    test('writes the base into a copied stylesheet path', () => {
        const out = rewriteShellImports(
            '<link rel="stylesheet" href="./style.css" />',
            'about',
            based()
        );
        assert.match(out, /href="\/repo\/about\/style\.css"/);
        assert.ok(exists('dist/about/style.css'));
    });

    // The two cases that used to return the tag untouched. Both name a path
    // below the base, and neither href as authored does.
    test('writes the base into a root-relative href the assets dir provides', () => {
        const out = rewriteShellImports('<link rel="stylesheet" href="/style.css" />', '', based());
        assert.match(out, /href="\/repo\/style\.css"/);
    });

    test('writes the base into a root-relative href from the input root', () => {
        const out = rewriteShellImports('<link rel="stylesheet" href="/style.css" />', '', {
            ...based(),
            assets: path.join(root, 'no-assets'),
        });
        assert.match(out, /href="\/repo\/style\.css"/);
        assert.ok(exists('dist/style.css'));
    });

    // A URL on another origin is not ours to prefix.
    test('leaves another origin alone, base or no base', () => {
        const tag = '<link rel="stylesheet" href="https://cdn.example.com/lib.css" />';
        assert.equal(rewriteShellImports(tag, '', based()), tag);
    });
});
