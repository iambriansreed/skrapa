import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { bundleModules, findRequireCalls } from './bundle';

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

    // ---- findRequireCalls ------------------------------------------------
    //
    // The regression these guard is real: bundle.ts's own header comment holds
    // a `require('./x')` example, and a plain regex treated it as an import,
    // logging "cannot find module" on every single build.

    test('a require inside a comment is not a require', () => {
        assert.deepEqual(findRequireCalls("// see require('./x')"), []);
        assert.deepEqual(findRequireCalls("/* require('./x') */"), []);
        assert.deepEqual(findRequireCalls("/*\n * require('./x')\n */"), []);
    });

    test('a require inside a string is not a require', () => {
        assert.deepEqual(findRequireCalls(`const s = "require('./x')";`), []);
        assert.deepEqual(findRequireCalls(`const s = 'require("./x")';`), []);
        assert.deepEqual(findRequireCalls("const s = `require('./x')`;"), []);
    });

    test('real requires around the decoys are still found', () => {
        const code = [
            "// require('./comment')",
            'const s = "require(\'./string\')";',
            "const real = require('./dep');",
        ].join('\n');
        assert.deepEqual(
            findRequireCalls(code).map((c) => c.spec),
            ['./dep']
        );
    });

    test('a regex literal containing // does not swallow the rest of the line', () => {
        // `/^https?:\/\//` reads as a line comment to a naive scanner, which
        // would then miss every require after it on that line.
        const code = "const re = /^[a-z]+:\\/\\//i; const dep = require('./dep');";
        assert.deepEqual(
            findRequireCalls(code).map((c) => c.spec),
            ['./dep']
        );
    });

    test('a require interpolated into a template literal is still found', () => {
        const code = "const s = `a ${require('./dep')} b`;";
        assert.deepEqual(
            findRequireCalls(code).map((c) => c.spec),
            ['./dep']
        );
    });

    test('braces inside an interpolation do not end it early', () => {
        // Without a brace count, the `}` of the object literal reads as the end
        // of the `${ }`, and the require after it is scanned as template text:
        // silently dropped from the bundle, no warning, throws in the browser.
        const cases = [
            'const s = `${ fmt({bold:true}) + require("./dep") }`;',
            'const s = `${ f({a:{b:{c:1}}}) + require("./dep") }`;',
            'const s = `${ f("}") + require("./dep") }`;',
        ];
        for (const code of cases) {
            assert.deepEqual(
                findRequireCalls(code).map((c) => c.spec),
                ['./dep'],
                code
            );
        }
    });

    test('a require inside a nested template literal is found', () => {
        const code = 'const s = `${ `${ require("./inner") }` }`;';
        assert.deepEqual(
            findRequireCalls(code).map((c) => c.spec),
            ['./inner']
        );
    });

    test('a stray brace in template text does not desync the scan', () => {
        const code = 'const s = `a } b`; const d = require("./dep");';
        assert.deepEqual(
            findRequireCalls(code).map((c) => c.spec),
            ['./dep']
        );
    });

    test('require as part of a longer identifier is not a require', () => {
        assert.deepEqual(findRequireCalls("myrequire('./x')"), []);
        assert.deepEqual(findRequireCalls("createRequire('./x')"), []);
    });

    test('a commented-out require of a missing file does not break the bundle', () => {
        const dir = tmpDir();
        fs.writeFileSync(path.join(dir, 'dep.js'), 'module.exports = 5;');
        fs.writeFileSync(
            path.join(dir, 'entry.js'),
            [
                "// Known limitation: the text require('./nope') used to be rewritten.",
                "globalThis.out = require('./dep');",
            ].join('\n')
        );

        const bundle = bundleModules(path.join(dir, 'entry.js'));
        assert.ok(bundle);
        const ctx = runBundle(bundle, dir);
        assert.equal(ctx.out, 5);
        // The comment is carried through verbatim, not rewritten to a module id.
        assert.match(bundle, /require\('\.\/nope'\)/);
    });
});
