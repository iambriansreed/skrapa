import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rebuildFlags } from './cmd-dev';
import { DEFAULT_CONFIG } from './utils';

const config = (over: Partial<ResolvedConfig> = {}): ResolvedConfig => ({
    ...DEFAULT_CONFIG,
    ...over,
});

describe('src/bin/cmd-dev.test.ts - rebuildFlags', () => {
    // Each save spawns a fresh `skrapa build`, which resolves its own config
    // from scratch. Drop these and `skrapa dev --root site` serves site/ while
    // rebuilding the current directory instead, silently, on every save.
    test('carries every build-relevant key through to the rebuild', () => {
        const flags = rebuildFlags(
            config({
                root: '/p/site',
                input: 'app',
                output: 'public',
                assets: 'static',
                base: '/x/',
            })
        );
        assert.match(flags, /--root "\/p\/site"/);
        assert.match(flags, /--input "app"/);
        assert.match(flags, /--output "public"/);
        assert.match(flags, /--assets "static"/);
        assert.match(flags, /--base "\/x\/"/);
    });

    test('sends nothing the build does not read', () => {
        const flags = rebuildFlags(
            config({ port: 9999, host: '0.0.0.0', origin: 'https://x.test' })
        );
        for (const key of ['--port', '--host', '--origin']) {
            assert.ok(!flags.includes(key), `${key} should not reach the build`);
        }
    });

    test('quotes values, so a path with a space stays one argument', () => {
        const flags = rebuildFlags(config({ root: '/p/my site' }));
        assert.match(flags, /--root "\/p\/my site"/);
    });

    test('starts with a space, so it appends straight onto a command', () => {
        const flags = rebuildFlags(config());
        assert.ok(flags.startsWith(' '));
        assert.equal(`build skip-assets pretty${flags}`.includes('pretty --root'), true);
    });
});
