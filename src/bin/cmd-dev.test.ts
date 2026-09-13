import { after, before, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { postbuildCommand, rebuildFlags } from './cmd-dev';
import { DEFAULT_CONFIG } from './utils';
import { ensureBin, scaffold, tempDir } from '../scripts/fixture';
import { ROOT_DIR } from '../scripts/utils';

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

describe('src/bin/cmd-dev.test.ts - postbuildCommand', () => {
    let bare: string;
    let project: string;

    before(() => {
        bare = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-postbuild-'));
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-postbuild-'));
        fs.writeFileSync(path.join(project, 'package.json'), '{}');
    });

    after(() => {
        for (const dir of [bare, project]) fs.rmSync(dir, { recursive: true, force: true });
    });

    // `npm run` fails outright without a package.json, `--if-present` or not,
    // which would fail every build in a directory never `skrapa init`-ed.
    test('is null when the project has no package.json', () => {
        assert.equal(postbuildCommand(bare), null);
    });

    test('tolerates a package.json without the script', () => {
        assert.equal(postbuildCommand(project), 'npm run --if-present postbuild-skrapa');
    });
});

/** A port nothing is listening on right now, so parallel test files never collide. */
function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, 'localhost', () => {
            const { port } = probe.address() as net.AddressInfo;
            probe.close(() => resolve(port));
        });
    });
}

describe('src/bin/cmd-dev.test.ts - dev', () => {
    let fixture: string;
    let server: ChildProcess | undefined;

    before(async () => {
        ensureBin();
        fixture = tempDir('dev-postbuild-');
        const write = scaffold(fixture);
        // A non-default assets dir has to exist, or the build refuses.
        fs.mkdirSync(path.join(fixture, 'public'));
        const hook = `node -e "require('fs').writeFileSync('dist/postbuild.txt', 'ran')"`;
        write(
            'package.json',
            JSON.stringify({ private: true, scripts: { 'postbuild-skrapa': hook } })
        );

        const port = await freePort();
        const binDir = path.join(ROOT_DIR, 'node_modules', '.bin');
        const dev = spawn(
            process.execPath,
            [
                path.join(ROOT_DIR, 'bin', 'index.js'),
                'dev',
                '--assets',
                'public',
                '--port',
                `${port}`,
            ],
            {
                cwd: fixture,
                env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
            }
        );
        server = dev;

        // The server prints its URL once it is listening, which is after the
        // first build and its hook have both finished.
        let output = '';
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`dev never started:\n${output}`)),
                60_000
            );
            dev.stderr.on('data', (chunk: Buffer) => (output += chunk));
            dev.stdout.on('data', (chunk: Buffer) => {
                output += chunk;
                if (!output.includes('ctrl+C to stop')) return;
                clearTimeout(timer);
                resolve();
            });
            dev.once('exit', (code) => {
                clearTimeout(timer);
                reject(new Error(`dev exited with ${code}:\n${output}`));
            });
        });
    });

    after(() => {
        server?.kill('SIGKILL');
        fs.rmSync(fixture, { recursive: true, force: true });
    });

    // The first build empties the output dir, and the hook used to run only
    // after rebuilds, so whatever it wrote was missing until the first save.
    test('runs postbuild-skrapa after the first build, before serving', () => {
        const marker = path.join(fixture, 'dist', 'postbuild.txt');
        assert.equal(fs.readFileSync(marker, 'utf-8'), 'ran');
    });
});
