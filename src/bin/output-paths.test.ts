import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
    checkCopy,
    checkEmitted,
    emittedPaths,
    formatProblem,
    outputKey,
    readManifest,
    writeManifest,
    type Emitted,
} from './output-paths';
import { CWD_DIR } from './utils';
import { buildBin, ROOT_DIR } from '../scripts/utils';

const OUTPUT = path.join(CWD_DIR, 'dist');

/** An absolute path under the cwd, which is what the messages render relative to. */
const at = (rel: string) => path.join(CWD_DIR, rel);

const page = (dir: string): Emitted => ({
    kind: 'page',
    sources: [at(`src/${dir}/index.html`), at(`src/${dir}/index.tsx`)],
});

/**
 * A throwaway directory under `.tmp/`, which is gitignored and skipped by
 * eslint and tsc. Inside the repo, not the system temp dir, so a fixture's own
 * `tsc` run resolves `@types/node` by walking up to the repo's node_modules.
 */
const tempDir = (prefix: string) => {
    const tmp = path.join(ROOT_DIR, '.tmp');
    fs.mkdirSync(tmp, { recursive: true });
    return fs.mkdtempSync(path.join(tmp, prefix));
};

/** Reason to skip a test that needs two paths differing only in case, or false. */
const caseSkip = (() => {
    const probe = tempDir('case-');
    try {
        fs.writeFileSync(path.join(probe, 'a'), '');
        return fs.existsSync(path.join(probe, 'A')) && 'filesystem is case-insensitive';
    } finally {
        fs.rmSync(probe, { recursive: true, force: true });
    }
})();

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

    // The lowercased path is spelled out so the fix can be read straight off
    // the message.
    test('a case problem names the path it should have been', () => {
        assert.equal(
            formatProblem({
                rule: 'case',
                outPath: at('dist/About/index.html'),
                source: page('About'),
                lowercased: at('dist/about/index.html'),
                assetOnly: false,
            }),
            [
                'Output path is not lowercase:',
                '  generated from  src/About/index.html + src/About/index.tsx',
                '  output path     dist/About/index.html',
                '  should be       dist/about/index.html',
                'Rename the source: a mixed-case URL works on some hosts and 404s on others.',
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

describe('src/bin/output-paths.test.ts - checkEmitted', () => {
    test('passes an all-lowercase render', () => {
        const emitted = emittedPaths(OUTPUT);
        emitted.record(path.join(OUTPUT, 'index.html'), page(''));
        emitted.record(path.join(OUTPUT, 'blog/first-post/index.html'), page('blog/first-post'));
        emitted.record(path.join(OUTPUT, 'blog/client.js'), {
            kind: 'script',
            sources: [at('src/blog/client.ts')],
        });

        assert.deepEqual(checkEmitted(emitted), []);
    });

    test('flags a page directory that is not lowercase', () => {
        const emitted = emittedPaths(OUTPUT);
        emitted.record(path.join(OUTPUT, 'About/index.html'), page('About'));

        const problems = checkEmitted(emitted);
        assert.equal(problems.length, 1);
        assert.equal(problems[0].rule, 'case');
        // Not the assets copy's doing, so a dev rebuild fails on it too.
        assert.equal(problems[0].assetOnly, false);
        assert.match(formatProblem(problems[0]), /should be {7}dist\/about\/index\.html/);
    });

    // The rewritten `src`/`href` follows the file, so a mixed-case client entry
    // ships a working tag pointing at a URL that 404s on a case-sensitive host.
    test('flags a bundle and a stylesheet, not just a page', () => {
        const emitted = emittedPaths(OUTPUT);
        emitted.record(path.join(OUTPUT, 'about/Client.js'), {
            kind: 'script',
            sources: [at('src/about/Client.ts')],
        });
        emitted.record(path.join(OUTPUT, 'about/Style.css'), {
            kind: 'stylesheet',
            sources: [at('src/about/Style.css')],
        });

        assert.deepEqual(
            checkEmitted(emitted).map((problem) => path.basename(problem.outPath)),
            ['Client.js', 'Style.css']
        );
    });

    // The output dir is not part of any URL, so a project living somewhere
    // capitalized must not fail its own build.
    test('judges only the part below the output root', () => {
        const output = path.join(CWD_DIR, 'Users', 'Brian', 'Sites', 'dist');
        const emitted = emittedPaths(output);
        emitted.record(path.join(output, 'about/index.html'), page('about'));

        assert.deepEqual(checkEmitted(emitted), []);
    });

    // Only the first writer of a path holds it, but both wrote a file: on a
    // case-sensitive filesystem these are two pages, and the second's case
    // must not be lost to that bookkeeping.
    test('flags a mixed-case write even when a lowercase one claimed the path', () => {
        const emitted = emittedPaths(OUTPUT);
        emitted.record(path.join(OUTPUT, 'about/index.html'), page('about'));
        emitted.record(path.join(OUTPUT, 'About/index.html'), page('About'));

        const problems = checkEmitted(emitted);
        assert.equal(problems.length, 1);
        assert.match(formatProblem(problems[0]), /output path {5}dist\/About\/index\.html/);
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

    // Dropping the rule for assets is not a general amnesty for uppercase: a
    // page directory named like one of those host files is still caught,
    // because the render is still judged.
    test('still flags a generated page named like a host file', () => {
        const emitted = emittedPaths(OUTPUT);
        emitted.record(path.join(OUTPUT, 'License/index.html'), page('License'));

        assert.equal(checkEmitted(emitted).length, 1);
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
let binBuilt = false;

/** Build the bin once per run, so the binary under test is this source. */
const ensureBin = () => {
    if (binBuilt) return;
    buildBin();
    binBuilt = true;
};

const runBuild = (fixture: string) => {
    const binDir = path.join(ROOT_DIR, 'node_modules', '.bin');
    const build = spawnSync(
        process.execPath,
        [path.join(ROOT_DIR, 'bin', 'index.js'), 'build', '--assets', 'public'],
        {
            cwd: fixture,
            encoding: 'utf-8',
            // The build shells out to a bare `tsc`, so make sure the repo's
            // copy is on PATH however the tests were launched.
            env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
        }
    );

    return { status: build.status, output: `${build.stdout}\n${build.stderr}` };
};

/** A minimal buildable project: a root shell and a root page. */
const scaffold = (fixture: string) => {
    const write = (file: string, body: string) => {
        const full = path.join(fixture, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
    };

    write('tsconfig.json', fs.readFileSync(path.join(ROOT_DIR, 'template/tsconfig.json'), 'utf-8'));
    write('src/index.html', '<!doctype html>\n<html><head></head><body></body></html>');
    write('src/index.tsx', 'export const Page = (): Skrapa.Page => <h1>home</h1>;\n');

    return write;
};

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

describe('src/bin/output-paths.test.ts - skrapa build, mixed-case output paths', () => {
    let fixture: string;
    let result: { status: number | null; output: string };

    before(() => {
        ensureBin();
        fixture = tempDir('build-case-');
        const write = scaffold(fixture);

        write('src/About/index.tsx', 'export const Page = (): Skrapa.Page => <h1>about</h1>;\n');
        // Mixed-case, but an asset, so it is copied as named and never reported.
        write('public/Logo.svg', '<svg />');
        write('public/favicon.ico', '');

        result = runBuild(fixture);
    });

    after(() => fs.rmSync(fixture, { recursive: true, force: true }));

    test('fails the build', () => {
        assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.output}`);
    });

    test('names the generated page and the lowercase path it should have', () => {
        assert.match(result.output, /Output path is not lowercase:/);
        for (const named of [
            'src/About/index.tsx',
            'dist/About/index.html',
            'dist/about/index.html',
        ]) {
            assert.ok(result.output.includes(named), `expected the message to name ${named}`);
        }
    });

    // The page and the asset are both mixed-case, and only the page is the
    // build's business. Asserted through a real build because this is the split
    // the rule is about.
    test('says nothing about the mixed-case asset', () => {
        const complaints = result.output.match(/Output path is not lowercase:/g) ?? [];
        assert.equal(
            complaints.length,
            1,
            `expected only the generated page to be reported\n${result.output}`
        );
        assert.ok(
            !result.output.includes('public/Logo.svg'),
            'an asset keeps whatever case it was named with'
        );
    });

    test('says nothing about the paths that are already lowercase', () => {
        assert.ok(!result.output.includes('favicon'), 'a lowercase asset should not be reported');
    });
});
