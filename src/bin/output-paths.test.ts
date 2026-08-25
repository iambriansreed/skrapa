import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    checkCopy,
    emittedPaths,
    formatProblem,
    outputKey,
    readManifest,
    writeManifest,
    type Emitted,
} from './output-paths';
import { CWD_DIR } from './utils';
import { ROOT_DIR } from '../scripts/utils';
import { caseSkip, ensureBin, runBuild, scaffold, tempDir } from '../scripts/fixture';

const OUTPUT = path.join(CWD_DIR, 'dist');

/** An absolute path under the cwd, which is what the messages render relative to. */
const at = (rel: string) => path.join(CWD_DIR, rel);

const page = (dir: string): Emitted => ({
    kind: 'page',
    sources: [at(`src/${dir}/index.html`), at(`src/${dir}/index.tsx`)],
});

describe('src/bin/output-paths.test.ts - outputKey', () => {
    test('keys on the output-relative path, in posix form', () => {
        assert.equal(
            outputKey(OUTPUT, path.join(OUTPUT, 'chores', 'index.html')),
            'chores/index.html'
        );
    });

    // The whole point of the key: the same source tree must be judged the same
    // way on a case-insensitive laptop and a case-sensitive CI runner.
    test('ignores case, so a macOS-only shadow is caught on Linux too', () => {
        assert.equal(
            outputKey(OUTPUT, path.join(OUTPUT, 'Chores', 'Index.HTML')),
            outputKey(OUTPUT, path.join(OUTPUT, 'chores', 'index.html'))
        );
    });

    // macOS hands back decomposed filenames where git and Linux keep them
    // composed; both name one file on the filesystem that matters here.
    test('ignores Unicode composition', () => {
        assert.equal(
            outputKey(OUTPUT, path.join(OUTPUT, 'café.css')),
            outputKey(OUTPUT, path.join(OUTPUT, 'café.css'))
        );
    });
});

describe('src/bin/output-paths.test.ts - emittedPaths', () => {
    test('finds a recorded path again, whatever case it is asked about', () => {
        const emitted = emittedPaths(OUTPUT);
        emitted.record(path.join(OUTPUT, 'chores/index.html'), page('chores'));

        assert.equal(emitted.heldBy(path.join(OUTPUT, 'chores/index.html'))?.kind, 'page');
        assert.equal(emitted.heldBy(path.join(OUTPUT, 'Chores/index.html'))?.kind, 'page');
        assert.equal(emitted.heldBy(path.join(OUTPUT, 'other/index.html')), undefined);
    });

    // A stylesheet two shells both link to is written twice; the source that
    // actually put it there is the first one, not the last.
    test('keeps the first writer of a path', () => {
        const emitted = emittedPaths(OUTPUT);
        const first: Emitted = { kind: 'stylesheet', sources: [at('src/style.css')] };
        emitted.record(path.join(OUTPUT, 'style.css'), first);
        emitted.record(path.join(OUTPUT, 'style.css'), {
            kind: 'stylesheet',
            sources: [at('src/about/style.css')],
        });

        assert.deepEqual(emitted.heldBy(path.join(OUTPUT, 'style.css')), first);
    });

    test('round-trips through a manifest on disk', () => {
        const dir = tempDir('manifest-');
        try {
            const emitted = emittedPaths(OUTPUT);
            emitted.record(path.join(OUTPUT, 'chores/index.html'), page('chores'));
            writeManifest(dir, emitted);

            const read = readManifest(dir, OUTPUT);
            assert.deepEqual(read.heldBy(path.join(OUTPUT, 'chores/index.html')), page('chores'));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    // dev reads the manifest on every asset event. A build that has not run
    // yet, or a half-written file, must not take the server down with it.
    test('a missing manifest reads as empty rather than throwing', () => {
        const read = readManifest(path.join(ROOT_DIR, 'does-not-exist'), OUTPUT);
        assert.equal(read.heldBy(path.join(OUTPUT, 'index.html')), undefined);
    });
});

describe('src/bin/output-paths.test.ts - formatProblem', () => {
    // The exact message, because all three paths are the point: the output
    // path does not say which page was lost, and the asset does not say what
    // it shadowed.
    test('a collision names all three paths', () => {
        assert.equal(
            formatProblem({
                rule: 'collision',
                outPath: at('dist/chores/index.html'),
                held: page('chores'),
                incoming: { kind: 'asset', sources: [at('public/chores/index.html')] },
                assetOnly: true,
            }),
            [
                'Asset would overwrite generated page:',
                '  generated from  src/chores/index.html + src/chores/index.tsx',
                '  overwritten by  public/chores/index.html',
                '  output path     dist/chores/index.html',
                'Remove one of the two sources, or rename the asset.',
            ].join('\n')
        );
    });

    test('names the client entry when the shadowed file is a bundle', () => {
        const message = formatProblem({
            rule: 'collision',
            outPath: at('dist/chores/client.js'),
            held: { kind: 'script', sources: [at('src/chores/client.ts')] },
            incoming: { kind: 'asset', sources: [at('public/chores/client.js')] },
            assetOnly: true,
        });
        assert.match(message, /^Asset would overwrite generated script:/);
        assert.match(message, /generated from {2}src\/chores\/client\.ts/);
    });

    test('tells two colliding assets apart from an asset shadowing the build', () => {
        const message = formatProblem({
            rule: 'collision',
            outPath: at('dist/chores/index.html'),
            held: { kind: 'asset', sources: [at('public/Chores/index.html')] },
            incoming: { kind: 'asset', sources: [at('public/chores/index.html')] },
            assetOnly: true,
        });
        assert.match(message, /^Asset would overwrite another asset:/);
        assert.match(message, /copied from {5}public\/Chores\/index\.html/);
        assert.match(message, /Rename one of the two assets\.$/);
    });
});

describe('src/bin/output-paths.test.ts - checkCopy', () => {
    let root: string;
    let assets: string;

    const write = (file: string, body: string) => {
        const full = path.join(root, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
    };

    before(() => {
        root = tempDir('copy-');
        assets = path.join(root, 'public');
        write('public/chores/index.html', '<h1>stale</h1>');
        write('public/chores/client.js', 'console.log("stale")');
        write('public/chores/style.css', 'body{}');
        write('public/logo.svg', '<svg />');
    });

    after(() => fs.rmSync(root, { recursive: true, force: true }));

    const output = () => path.join(root, 'dist');

    test('passes an assets tree that shadows nothing', () => {
        assert.deepEqual(checkCopy(assets, output(), emittedPaths(output())), []);
    });

    // Not just index.html: the generated bundle and stylesheet sitting beside
    // it are shadowed the same way, and just as invisibly.
    test('catches a page, a bundle and a stylesheet in one run', () => {
        const emitted = emittedPaths(output());
        emitted.record(path.join(output(), 'chores/index.html'), page('chores'));
        emitted.record(path.join(output(), 'chores/client.js'), {
            kind: 'script',
            sources: [at('src/chores/client.ts')],
        });
        emitted.record(path.join(output(), 'chores/style.css'), {
            kind: 'stylesheet',
            sources: [at('src/chores/style.css')],
        });

        const problems = checkCopy(assets, output(), emitted);

        // Every one of them, not just the first: fixing them a build at a time
        // is how the second gets missed.
        assert.deepEqual(problems.map((problem) => path.basename(problem.outPath)).sort(), [
            'client.js',
            'index.html',
            'style.css',
        ]);
        assert.ok(problems.every((problem) => problem.rule === 'collision'));
        // Only the assets copy writes these, so a dev rebuild reports without
        // failing.
        assert.ok(problems.every((problem) => problem.assetOnly));
        // The untouched asset is still copied.
        assert.ok(!problems.some((problem) => problem.outPath.endsWith('logo.svg')));
    });

    test('catches an asset that only shadows on a case-insensitive filesystem', () => {
        const emitted = emittedPaths(output());
        emitted.record(path.join(output(), 'Chores/Index.html'), page('Chores'));

        const problems = checkCopy(assets, output(), emitted);
        assert.equal(problems.length, 1);
        assert.equal(problems[0].rule, 'collision');
    });

    // The lowercase rule stops at the render. An asset is copied verbatim and
    // its name is the author's, so a mixed-case one is not the build's business.
    test('leaves an asset that is not lowercase alone', () => {
        const upper = tempDir('upper-assets-');
        try {
            fs.mkdirSync(path.join(upper, 'public', 'Icons'), { recursive: true });
            fs.writeFileSync(path.join(upper, 'public', 'Icons', 'Logo.SVG'), '<svg />');

            const dist = path.join(upper, 'dist');

            assert.deepEqual(checkCopy(path.join(upper, 'public'), dist, emittedPaths(dist)), []);
        } finally {
            fs.rmSync(upper, { recursive: true, force: true });
        }
    });

    // The files that forced the old exemption list. GitHub Pages reads `CNAME`
    // at the site root by that exact name, so lowercasing it drops the custom
    // domain. Nothing special about them now: no asset is case-checked, nested
    // or not, so there is no list to keep in step with what hosts expect.
    test('says nothing about host files like CNAME, at any depth', () => {
        const exempt = tempDir('exempt-');
        try {
            fs.mkdirSync(path.join(exempt, 'public', 'blog'), { recursive: true });
            fs.writeFileSync(path.join(exempt, 'public', 'CNAME'), 'skrapa.example\n');
            fs.writeFileSync(path.join(exempt, 'public', 'LICENSE'), 'MIT\n');
            fs.writeFileSync(path.join(exempt, 'public', 'blog', 'CNAME'), 'nope\n');

            const dist = path.join(exempt, 'dist');

            assert.deepEqual(checkCopy(path.join(exempt, 'public'), dist, emittedPaths(dist)), []);
        } finally {
            fs.rmSync(exempt, { recursive: true, force: true });
        }
    });

    // Two assets differing only in case can only coexist on a case-sensitive
    // filesystem; where they cannot, the second write lands on the first file
    // and there is no fixture to build. That is the asymmetry the check is for
    // (they are two files in a Linux checkout and one on the machine the site
    // is previewed on), so this runs where the OS allows it and says why when
    // it does not.
    test('catches two assets that resolve to the same output path', { skip: caseSkip }, () => {
        const twoCase = tempDir('twocase-');
        try {
            fs.mkdirSync(path.join(twoCase, 'Chores'), { recursive: true });
            fs.mkdirSync(path.join(twoCase, 'chores'), { recursive: true });
            fs.writeFileSync(path.join(twoCase, 'Chores', 'index.html'), 'a');
            fs.writeFileSync(path.join(twoCase, 'chores', 'index.html'), 'b');

            const dist = path.join(twoCase, 'dist');
            const problems = checkCopy(twoCase, dist, emittedPaths(dist));

            // One collision, not two: the first asset seen holds the path and
            // the second is the one refused. And nothing else, since the
            // uppercase asset's own case is no longer the build's business.
            const collisions = problems.filter((problem) => problem.rule === 'collision');
            assert.equal(collisions.length, 1);
            assert.equal(collisions[0].rule === 'collision' && collisions[0].held.kind, 'asset');
            assert.match(formatProblem(collisions[0]), /Asset would overwrite another asset:/);

            assert.equal(problems.length, 1);
        } finally {
            fs.rmSync(twoCase, { recursive: true, force: true });
        }
    });

    // dev's watcher copies one changed file, so it checks one path.
    test('checks a single file for the dev server', () => {
        const emitted = emittedPaths(output());
        emitted.record(path.join(output(), 'chores/index.html'), page('chores'));

        const dest = path.join(output(), 'chores/index.html');
        assert.equal(checkCopy(path.join(assets, 'chores/index.html'), dest, emitted).length, 1);
        assert.deepEqual(
            checkCopy(path.join(assets, 'logo.svg'), path.join(output(), 'logo.svg'), emitted),
            []
        );
    });
});

// The end-to-end cases: real builds of projects that break each rule. Run the
// CLI as a subprocess, since the failure being asserted is a non-zero exit.
// The harness itself lives in ../scripts/fixture.ts, shared with the other
// test files that need a real build.

describe('src/bin/output-paths.test.ts - skrapa build, asset shadowing a page', () => {
    let fixture: string;
    let result: { status: number | null; output: string };

    before(() => {
        ensureBin();
        fixture = tempDir('build-collision-');
        const write = scaffold(fixture);

        write(
            'src/chores/index.html',
            '<!doctype html>\n<html><head></head><body><script src="./client.ts"></script></body></html>'
        );
        write('src/chores/client.ts', 'console.log("chores client");\n');
        write('src/chores/index.tsx', 'export const Page = (): Skrapa.Page => <h1>chores</h1>;\n');

        // The stale hand-written prototype, and a stale bundle beside it.
        write('public/chores/index.html', '<h1>months-old prototype</h1>');
        write('public/chores/client.js', 'console.log("stale client");\n');

        result = runBuild(fixture);
    });

    after(() => fs.rmSync(fixture, { recursive: true, force: true }));

    test('fails the build rather than reporting success', () => {
        assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.output}`);
    });

    test('names both sources and the output path they meet at', () => {
        assert.match(result.output, /Asset would overwrite generated page:/);
        for (const named of [
            'src/chores/index.html',
            'src/chores/index.tsx',
            'public/chores/index.html',
            'dist/chores/index.html',
        ]) {
            assert.ok(result.output.includes(named), `expected the message to name ${named}`);
        }
    });

    // A build that stopped at the first problem would leave the second to be
    // found on the next run, one at a time.
    test('reports the shadowed client bundle in the same run', () => {
        assert.match(result.output, /Asset would overwrite generated script:/);
        for (const named of [
            'src/chores/client.ts',
            'public/chores/client.js',
            'dist/chores/client.js',
        ]) {
            assert.ok(result.output.includes(named), `expected the message to name ${named}`);
        }
    });

    test('leaves the generated page in place instead of the asset', () => {
        const built = fs.readFileSync(path.join(fixture, 'dist/chores/index.html'), 'utf-8');
        assert.match(built, /<h1>chores<\/h1>/);
        assert.doesNotMatch(built, /months-old prototype/);
    });
});

// A rule that every generated path be lowercase used to live here, and this
// build used to be the proof that it failed. It was a proxy for the real
// question: not whether a path is mixed-case, but whether the URLs pointing at
// it agree. link-check.ts asks that one directly, so a mixed-case directory is
// now the author's business. Kept as a build, because the thing worth asserting
// about a removed rule is that a real project no longer trips over it.
describe('src/bin/output-paths.test.ts - skrapa build, a mixed-case page directory', () => {
    let fixture: string;
    let result: { status: number | null; output: string };

    before(() => {
        ensureBin();
        fixture = tempDir('build-case-');
        const write = scaffold(fixture);

        write('src/About/index.tsx', 'export const Page = (): Skrapa.Page => <h1>about</h1>;\n');
        // Linked with the spelling it is built under, which is all that was
        // ever actually at stake.
        write(
            'src/index.tsx',
            'export const Page = (): Skrapa.Page => <a href="About/">about</a>;\n'
        );
        write('public/Logo.svg', '<svg />');

        result = runBuild(fixture);
    });

    after(() => fs.rmSync(fixture, { recursive: true, force: true }));

    test('builds, since every reference to it agrees on the spelling', () => {
        assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.output}`);
    });

    test('emits the directory under the name it was written with', () => {
        assert.ok(fs.existsSync(path.join(fixture, 'dist/About/index.html')));
    });
});
