import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isGlobalLink } from './utils';

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
