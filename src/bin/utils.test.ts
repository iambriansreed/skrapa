import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isGlobalLink, isSkippedPath } from './utils';

describe('src/bin/utils.test.ts - isSkippedPath', () => {
    const project = path.join(path.sep, 'proj');
    const at = (rel: string) => path.join(project, rel);
    const notSource = [at('dist'), at('assets')];

    test('source anywhere in the project is not skipped', () => {
        for (const rel of [
            'index.tsx',
            'about/index.tsx',
            'tsconfig.json',
            'distant/index.tsx',
            'assets-old/style.css',
        ]) {
            assert.equal(isSkippedPath(project, at(rel), notSource), false, rel);
        }
    });

    // Every build writes .skrapa, and an output dir inside the project. The
    // dev watcher reacting to either rebuilds forever.
    test('dot-dirs, node_modules and the excluded dirs are skipped, at any depth', () => {
        for (const rel of [
            '.skrapa/about/index.js',
            '.git/HEAD',
            'node_modules/x/index.tsx',
            'about/node_modules/y.ts',
            'dist',
            'dist/about/index.html',
            'assets/style.css',
        ]) {
            assert.equal(isSkippedPath(project, at(rel), notSource), true, rel);
        }
    });

    test('a path outside the project is skipped', () => {
        assert.equal(isSkippedPath(project, path.join(path.sep, 'elsewhere', 'x.css')), true);
        assert.equal(isSkippedPath(project, at('../x.css')), true);
    });

    // The docs site builds to ../dist, outside its project dir.
    test('an excluded dir outside the project excludes nothing inside it', () => {
        assert.equal(isSkippedPath(project, at('about'), [path.join(path.sep, 'dist')]), false);
    });

    test('the project dir itself is not skipped, and empty excludes are ignored', () => {
        assert.equal(isSkippedPath(project, project, ['']), false);
    });
});

describe('src/bin/utils.test.ts - isGlobalLink', () => {
    let dir: string;
    let entry: string;

    // A checkout's bin, a global bin dir linking to it the way `npm link`
    // does, and a project that links it locally instead.
    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-link-'));
        entry = path.join(dir, 'checkout', 'bin', 'index.js');
        fs.mkdirSync(path.dirname(entry), { recursive: true });
        fs.writeFileSync(entry, '');
        for (const bin of ['global/bin', 'project/node_modules/.bin']) {
            fs.mkdirSync(path.join(dir, bin), { recursive: true });
            fs.symlinkSync(entry, path.join(dir, bin, 'skrapa'));
        }
    });

    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('is true for an entry reached through a symlink in a global bin dir', () => {
        assert.equal(isGlobalLink(path.join(dir, 'global', 'bin', 'skrapa')), true);
    });

    // `npm run build` and every CI workflow run the checkout's bin by path,
    // and used to be told to `npm unlink -g skrapa` with nothing linked.
    test('is false for the bin run by path', () => {
        assert.equal(isGlobalLink(entry), false);
    });

    test('is false for a project-local link, which the global unlink does not remove', () => {
        const local = path.join(dir, 'project', 'node_modules', '.bin', 'skrapa');
        assert.equal(isGlobalLink(local), false);
    });

    test('is false with no entry path, or one that does not exist', () => {
        assert.equal(isGlobalLink(undefined), false);
        assert.equal(isGlobalLink(path.join(dir, 'missing')), false);
    });
});
