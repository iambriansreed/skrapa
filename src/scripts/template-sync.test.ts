import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, TEMPLATE_DIR } from './utils';

describe('src/scripts/template-sync.test.ts - shipped template stays in sync', () => {
    // `skrapa.d.ts` at the repo root is the source of truth: cmd-build.ts
    // copies it over the project's own copy on every run. The published
    // package ships both it and template/skrapa.d.ts, so if they differ, a
    // fresh `skrapa init` writes one version and the first build silently
    // rewrites it to the other, showing a spurious diff in a brand new repo.
    // Nothing copies one to the other any more, so this test is the only thing
    // holding them together. If it fails, run:
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
});
