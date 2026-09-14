import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseJsonc, validateConfigKey } from '../bin/config';
import { ROOT_DIR, TEMPLATE_DIR, WEB_DIR } from './utils';

describe('src/scripts/template-sync.test.ts - committed skrapa files stay in sync', () => {
    // `skrapa.d.ts` at the repo root is the source of truth: it is the copy
    // package.json ships, and cmd-build.ts copies it over a project's own copy
    // on every run. The published package ships template/skrapa.d.ts too, so if
    // the two differ, a fresh `skrapa init` writes one version and the first
    // build silently rewrites it to the other, showing a spurious diff in a
    // brand new repo. Nothing copies one to the other, so this test is the only
    // thing holding them together. If it fails, run:
    //   cp skrapa.d.ts template/skrapa.d.ts
    it('template/skrapa.d.ts is byte-identical to the root skrapa.d.ts', () => {
        const source = fs.readFileSync(path.join(ROOT_DIR, 'skrapa.d.ts'), 'utf-8');
        const shipped = fs.readFileSync(path.join(TEMPLATE_DIR, 'skrapa.d.ts'), 'utf-8');

        assert.equal(
            shipped,
            source,
            'template/skrapa.d.ts has drifted from skrapa.d.ts; run `cp skrapa.d.ts template/skrapa.d.ts`'
        );
    });

    // A missing or invalid skrapa key stops every command, so a template
    // shipping one would fail on the first `npm run dev` after init.
    it('the skrapa key in template/src/ and web/ tsconfig.json is valid', () => {
        for (const dir of [path.join(TEMPLATE_DIR, 'src'), WEB_DIR]) {
            const file = path.join(dir, 'tsconfig.json');
            const tsconfig = parseJsonc(fs.readFileSync(file, 'utf-8')) as { skrapa?: unknown };
            const where = path.relative(ROOT_DIR, file);

            assert.notEqual(tsconfig.skrapa, undefined, `${where} has no skrapa key`);
            assert.deepEqual(validateConfigKey(tsconfig.skrapa), [], where);
        }
    });
});
