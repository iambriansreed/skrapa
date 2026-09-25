import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { slugify, planPage } from './cmd-page';
import { ensureBin, removeTempDir, runBuild, runCli, scaffold, tempDir } from '../scripts/fixture';

describe('src/bin/cmd-page.test.ts - slugify, planPage', () => {
    test('slugify lowercases, hyphenates non-alphanumerics, and trims edges', () => {
        assert.equal(slugify('About Us'), 'about-us');
        assert.equal(slugify('  First Post!  '), 'first-post');
        assert.equal(slugify('Hello___World'), 'hello-world');
        assert.equal(slugify('cafe 2'), 'cafe-2');
        assert.equal(slugify('@#$'), '');
    });

    test('planPage places a page in the project dir and fills its four files', () => {
        const plan = planPage({ name: 'About Us', sourceRoot: '/proj' });

        assert.equal(plan.slug, 'about-us');
        assert.equal(plan.route, 'about-us');
        assert.equal(plan.urlPath, '/about-us/');
        assert.equal(plan.dir, path.join('/proj', 'about-us'));
        assert.deepEqual(Object.keys(plan.files).sort(), [
            'client.ts',
            'index.html',
            'index.tsx',
            'style.css',
        ]);
        assert.match(plan.files['index.tsx'], /<h1>About Us<\/h1>/);
        assert.match(plan.files['index.tsx'], /class="about-us"/);
        assert.match(plan.files['index.html'], /<title>About Us<\/title>/);
        assert.match(plan.files['style.css'], /\.about-us \{/);
        assert.match(plan.files['client.ts'], /about-us page loaded/);
    });

    // Either link to nothing fails the next build's link check: /style.css in a
    // project with no global stylesheet, or a home link with no home page.
    test('planPage links the global stylesheet and the home page only when they exist', () => {
        const bare = planPage({ name: 'Contact', sourceRoot: '/proj' });
        assert.doesNotMatch(bare.files['index.html'], /href="\/style\.css"/);
        assert.match(bare.files['index.html'], /href="\.\/style\.css"/);
        assert.doesNotMatch(bare.files['index.tsx'], /Home/);

        const full = planPage({
            name: 'Contact',
            sourceRoot: '/proj',
            globalStylesheet: true,
            homePage: true,
        });
        assert.match(full.files['index.html'], /href="\/style\.css"/);
        assert.match(full.files['index.html'], /href="\.\/style\.css"/);
        assert.match(full.files['index.tsx'], /<a href="\.\/">← Home<\/a>/);
    });

    // Under a base like /repo/, a hand-written `/` is the domain root, where
    // the site is not. A relative link resolves through the page's <base href>.
    test('planPage writes the home link relative, so it resolves under any base', () => {
        const plan = planPage({ name: 'Contact', sourceRoot: '/proj', homePage: true });
        assert.doesNotMatch(plan.files['index.tsx'], /href="\/"/);
    });

    test('planPage nests under a parent route and strips surrounding slashes', () => {
        const plan = planPage({ name: 'First Post', parent: '/blog/', sourceRoot: '/proj' });

        assert.equal(plan.route, 'blog/first-post');
        assert.equal(plan.urlPath, '/blog/first-post/');
        assert.equal(plan.dir, path.join('/proj', 'blog', 'first-post'));
    });

    test('planPage throws when the name has no usable characters', () => {
        assert.throws(
            () => planPage({ name: '@#$', sourceRoot: '/proj' }),
            /no letters or numbers/
        );
    });

    // A parent that climbs out of the project would scaffold files in a
    // surprising place, and the page would never build (the build only scans
    // the project tree). Interior `..` that stays inside is fine once
    // normalized; only a net climb is refused.
    test('planPage refuses a parent that escapes the project dir', () => {
        for (const parent of ['..', '../outside', 'a/../../b', 'a/b/../../../c']) {
            assert.throws(
                () => planPage({ name: 'Post', parent, sourceRoot: '/proj' }),
                /outside the source dir/,
                `parent ${JSON.stringify(parent)} should throw`
            );
        }
    });

    test('planPage allows interior ".." that stays inside the project dir', () => {
        const plan = planPage({ name: 'Post', parent: 'a/../blog', sourceRoot: '/proj' });
        assert.equal(plan.route, 'blog/post');
        assert.equal(plan.dir, path.join('/proj', 'blog', 'post'));
    });

    // Inside the project, but where the build never looks for pages: the page
    // would never build, and one in the output dir would be deleted by the
    // next build.
    test('planPage refuses a page where the build does not look for pages', () => {
        const notSource = [path.join('/proj', 'dist'), path.join('/proj', 'assets')];
        const cases: [string, string | undefined][] = [
            ['Dist', undefined],
            ['Post', 'dist/archive'],
            ['Post', 'assets'],
            ['Post', '.github'],
            ['Post', 'node_modules'],
        ];
        for (const [name, parent] of cases) {
            assert.throws(
                () => planPage({ name, parent, sourceRoot: '/proj', notSource }),
                /does not build pages from/,
                `${name} under ${parent} should throw`
            );
        }
    });
});

describe('src/bin/cmd-page.test.ts - skrapa build, a page scaffolded into a project without global styles', () => {
    let fixture: string;
    let scaffolded: { status: number | null; output: string };

    before(() => {
        ensureBin();
        fixture = tempDir('page-build-');
        scaffold(fixture);
        // A non-default assets dir has to exist, or the build refuses. Left
        // empty, so there is no global style.css to link.
        fs.mkdirSync(path.join(fixture, 'public'));
        scaffolded = runCli(fixture, ['page', 'Contact Us', '--assets', 'public']);
    });

    after(() => removeTempDir(fixture));

    test('scaffolds the page', () => {
        assert.equal(scaffolded.status, 0, scaffolded.output);
        assert.ok(fs.existsSync(path.join(fixture, 'contact-us', 'index.tsx')));
    });

    // The shell linked /style.css whether or not there was one, and the page
    // linked home as `/`, the domain root under a base. Either failed the link
    // check on the very next build.
    test('builds as scaffolded, at the default base and under a subpath', () => {
        for (const args of [[], ['--base', '/repo/']]) {
            const result = runBuild(fixture, args);
            const shown = `build ${args.join(' ')}`.trim();
            assert.equal(result.status, 0, `${shown} exited ${result.status}\n${result.output}`);
            assert.doesNotMatch(result.output, /Reference does not resolve|Stylesheet not found/);
        }
    });
});
