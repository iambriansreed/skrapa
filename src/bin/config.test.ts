import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFlags, positionalArgs, loadConfig } from './config';

// parseFlags / positionalArgs read process.argv, so each case swaps in a
// crafted argv (argv[3+] is what the command sees) and restores it after.
const ORIGINAL_ARGV = process.argv;
function withArgv<T>(args: string[], fn: () => T): T {
    process.argv = ['node', 'skrapa', 'cmd', ...args];
    try {
        return fn();
    } finally {
        process.argv = ORIGINAL_ARGV;
    }
}

// The config is a real TypeScript module now, so it has to be written as source
// and evaluated by Node's type stripping rather than JSON.parse-d.
function tmpProject(source?: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-config-'));
    if (source !== undefined) fs.writeFileSync(path.join(dir, 'skrapa.config.ts'), source);
    return dir;
}

function tmpProjectWithConfig(config: Record<string, unknown>): string {
    return tmpProject(`export default ${JSON.stringify(config)} satisfies Skrapa.Config;`);
}

describe('src/bin/config.test.ts - parseFlags, positionalArgs, loadConfig', () => {
    test('parseFlags reads --key value pairs for known config keys only', () => {
        withArgv(['--port', '3000', '--input', 'app', '--nope', 'x'], () => {
            assert.deepEqual(parseFlags(), { port: '3000', input: 'app' });
        });
    });

    test('parseFlags ignores a trailing flag that has no value', () => {
        withArgv(['--host', 'h', '--port'], () => {
            assert.deepEqual(parseFlags(), { host: 'h' });
        });
    });

    test('positionalArgs drops config flag pairs and standalone flags, in any order', () => {
        withArgv(['About Us', 'blog'], () =>
            assert.deepEqual(positionalArgs(), ['About Us', 'blog'])
        );
        withArgv(['About', '--root', 'site'], () => assert.deepEqual(positionalArgs(), ['About']));
        withArgv(['--root', 'site', 'About'], () => assert.deepEqual(positionalArgs(), ['About']));
        withArgv(['-f', 'About', '--no-dev'], () => assert.deepEqual(positionalArgs(), ['About']));
        withArgv(['--input', 'src', 'A', 'B'], () =>
            assert.deepEqual(positionalArgs(), ['A', 'B'])
        );
    });

    test('loadConfig falls back to defaults when there is no file or flags', () => {
        const dir = tmpProject();
        withArgv([], () => {
            const { config, fileExists } = loadConfig({ root: dir });
            assert.equal(fileExists, false);
            assert.equal(config.input, 'src');
            assert.equal(config.output, 'dist');
            assert.equal(config.port, 8080);
            assert.equal(config.root, dir); // resolved to an absolute path
        });
    });

    test('loadConfig merges skrapa.config.ts over the defaults', () => {
        const dir = tmpProjectWithConfig({ port: 9999, input: 'app' });
        withArgv([], () => {
            const { config, fileExists, configPath } = loadConfig({ root: dir });
            assert.equal(fileExists, true);
            assert.equal(configPath, path.join(dir, 'skrapa.config.ts'));
            assert.equal(config.port, 9999);
            assert.equal(config.input, 'app');
            assert.equal(config.output, 'dist'); // untouched default
        });
    });

    test('loadConfig reads a config written with module.exports', () => {
        const dir = tmpProject('module.exports = { input: "app" };');
        withArgv([], () => assert.equal(loadConfig({ root: dir }).config.input, 'app'));
    });

    test('loadConfig evaluates the config, so it can compute values', () => {
        const dir = tmpProject(
            'const n: number = 4000;\nexport default { port: n + 44 } satisfies Skrapa.Config;'
        );
        withArgv([], () => assert.equal(loadConfig({ root: dir }).config.port, 4044));
    });

    test('loadConfig precedence: CLI flags beat the file, overrides beat flags', () => {
        const dir = tmpProjectWithConfig({ port: 9999 });
        withArgv(['--port', '3000'], () => {
            assert.equal(loadConfig({ root: dir }).config.port, 3000); // flag > file
            assert.equal(loadConfig({ root: dir, port: 1234 }).config.port, 1234); // override > flag
        });
    });

    test('loadConfig coerces a numeric-string port from a flag to a number', () => {
        const dir = tmpProject();
        withArgv(['--port', '3000'], () => {
            const { port } = loadConfig({ root: dir }).config;
            assert.equal(port, 3000);
            assert.equal(typeof port, 'number');
        });
    });

    test('loadConfig normalizes base to have a leading and trailing slash', () => {
        const dir = tmpProject();
        withArgv([], () => {
            assert.equal(loadConfig({ root: dir, base: '/repo' }).config.base, '/repo/');
            assert.equal(loadConfig({ root: dir }).config.base, '/');
        });
    });

    test('loadConfig gives a scheme-less origin one, and drops a trailing slash', () => {
        const dir = tmpProject();
        withArgv(['--origin', 'dev.localhost'], () =>
            assert.equal(loadConfig({ root: dir }).config.origin, 'http://dev.localhost')
        );
        withArgv(['--origin', 'https://dev.localhost/'], () =>
            assert.equal(loadConfig({ root: dir }).config.origin, 'https://dev.localhost')
        );
        withArgv([], () => assert.equal(loadConfig({ root: dir }).config.origin, ''));
    });

    test('an explicit undefined in a layer does not punch through the one below', () => {
        const dir = tmpProjectWithConfig({ input: 'app' });
        withArgv([], () =>
            assert.equal(loadConfig({ root: dir, input: undefined }).config.input, 'app')
        );
    });
});
