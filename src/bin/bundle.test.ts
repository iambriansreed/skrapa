import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { bundleModules } from './bundle';

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-bundle-'));
}

// Execute a bundle string in an isolated context and return that context, so a
// test can read side effects the entry module wrote to `globalThis`. A real
// `require` is provided so bare/builtin specifiers left as literal calls still
// resolve at runtime.
function runBundle(code: string, baseDir: string): Record<string, unknown> {
    const context: Record<string, unknown> = {
        require: createRequire(path.join(baseDir, 'runner.js')),
        console,
    };
    vm.createContext(context);
    vm.runInContext(code, context);
    return context;
}

describe('src/bin/bundle.test.ts - bundleModules', () => {
    test('bundles a relative require graph into a runnable IIFE', () => {
        const dir = tmpDir();
        fs.writeFileSync(path.join(dir, 'dep.js'), 'module.exports = { val: 42 };');
        fs.writeFileSync(path.join(dir, 'entry.js'), "globalThis.out = require('./dep').val;");

        const bundle = bundleModules(path.join(dir, 'entry.js'));
        assert.ok(bundle, 'expected a bundle string');
        // The relative require is rewritten to the dep's canonical module id
        // (registry keys are JSON-stringified; the require call keeps its quote).
        assert.match(bundle, /"dep\.js": function/);
        assert.match(bundle, /require\('dep\.js'\)/);

        const ctx = runBundle(bundle, dir);
        assert.equal(ctx.out, 42);
    });

    test('resolves a directory import to its index.js, not the directory itself', () => {
        const dir = tmpDir();
        fs.mkdirSync(path.join(dir, 'sub'));
        fs.writeFileSync(path.join(dir, 'sub', 'index.js'), 'module.exports = 7;');
        fs.writeFileSync(path.join(dir, 'entry.js'), "globalThis.out = require('./sub');");

        const bundle = bundleModules(path.join(dir, 'entry.js'));
        assert.ok(bundle);
        assert.match(bundle, /"sub\/index\.js": function/);

        const ctx = runBundle(bundle, dir);
        assert.equal(ctx.out, 7);
    });

    test('leaves bare and node: specifiers as literal require calls', () => {
        const dir = tmpDir();
        fs.writeFileSync(path.join(dir, 'entry.js'), "globalThis.out = require('node:path').sep;");

        const bundle = bundleModules(path.join(dir, 'entry.js'));
        assert.ok(bundle);
        // node:path is not in the registry, so it stays a literal require and falls
        // through to the real require at runtime.
        assert.doesNotMatch(bundle, /"node:path": function/);

        const ctx = runBundle(bundle, dir);
        assert.equal(ctx.out, path.sep);
    });

    test('hoists a shebang above the IIFE and only there', () => {
        const dir = tmpDir();
        fs.writeFileSync(path.join(dir, 'entry.js'), '#!/usr/bin/env node\nmodule.exports = 1;');

        const bundle = bundleModules(path.join(dir, 'entry.js'));
        assert.ok(bundle);
        assert.ok(bundle.startsWith('#!/usr/bin/env node\n'));
        // Exactly one shebang: it is hoisted, never left embedded in a module body.
        assert.equal(bundle.split('#!').length, 2);
    });

    test('returns null when the entry file does not exist', () => {
        assert.equal(bundleModules(path.join(os.tmpdir(), 'skrapa-nope-xyz.js')), null);
    });
});
