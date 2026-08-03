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

function tmpProject(config?: Record<string, unknown>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-config-'));
    if (config) fs.writeFileSync(path.join(dir, 'skrapa.config.json'), JSON.stringify(config));
    return dir;
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
            assert.equal(config.port, '8080');
            assert.equal(config.root, dir); // resolved to an absolute path
        });
    });

    test('loadConfig merges skrapa.config.json over the defaults', () => {
        const dir = tmpProject({ port: '9999', input: 'app' });
        withArgv([], () => {
            const { config, fileExists, configPath } = loadConfig({ root: dir });
            assert.equal(fileExists, true);
            assert.equal(configPath, path.join(dir, 'skrapa.config.json'));
            assert.equal(config.port, '9999');
            assert.equal(config.input, 'app');
            assert.equal(config.output, 'dist'); // untouched default
        });
    });

    test('loadConfig precedence: CLI flags beat the file, overrides beat flags', () => {
        const dir = tmpProject({ port: '9999' });
        withArgv(['--port', '3000'], () => {
            assert.equal(loadConfig({ root: dir }).config.port, '3000'); // flag > file
            assert.equal(loadConfig({ root: dir, port: '1234' }).config.port, '1234'); // override > flag
        });
    });
});
