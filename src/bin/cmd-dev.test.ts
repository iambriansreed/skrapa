import { after, before, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
    portHolder,
    portInUseMessage,
    postbuildCommand,
    rebuildFlags,
    staleAssetFiles,
} from './cmd-dev';
import { CWD_DIR, DEFAULT_CONFIG } from './utils';
import { ensureBin, removeTempDir, scaffold, tempDir } from '../scripts/fixture';
import { ROOT_DIR } from '../scripts/utils';

const config = (over: Partial<ResolvedConfig> = {}): ResolvedConfig => ({
    ...DEFAULT_CONFIG,
    ...over,
});

describe('src/bin/cmd-dev.test.ts - rebuildFlags', () => {
    // Each save spawns a fresh `skrapa build`, which resolves its own config
    // from scratch. Drop these and `skrapa dev --output public` serves public/
    // while every rebuild writes to dist/ instead, silently, on every save.
    test('carries every build-relevant key through to the rebuild', () => {
        const flags = rebuildFlags(
            config({
                output: 'public',
                assets: 'static',
                base: '/x/',
                linkCheckIgnore: ['/api/**', '/uploads/*.pdf'],
                projectRoot: '..',
            })
        );
        assert.match(flags, /--output "public"/);
        assert.match(flags, /--assets "static"/);
        assert.match(flags, /--base "\/x\/"/);
        assert.match(flags, /--linkCheckIgnore "\/api\/\*\*,\/uploads\/\*\.pdf"/);
        assert.match(flags, /--projectRoot "\.\."/);
    });

    // Left out, the rebuild would read back the patterns in tsconfig.json that
    // an override this server was started with had cleared.
    test('sends an empty linkCheckIgnore as an empty value rather than leaving it out', () => {
        assert.match(rebuildFlags(config({ linkCheckIgnore: [] })), /--linkCheckIgnore ""/);
    });

    // A removed flag fails the build it is passed to.
    test('sends nothing the build does not read, and no removed flag', () => {
        const flags = rebuildFlags(
            config({ port: 9999, host: '0.0.0.0', origin: 'https://x.test' })
        );
        for (const key of ['--port', '--host', '--origin', '--root', '--input', '--ignore']) {
            assert.ok(!flags.includes(key), `${key} should not reach the build`);
        }
    });

    test('quotes values, so a path with a space stays one argument', () => {
        const flags = rebuildFlags(config({ output: 'my site' }));
        assert.match(flags, /--output "my site"/);
    });

    test('starts with a space, so it appends straight onto a command', () => {
        const flags = rebuildFlags(config());
        assert.ok(flags.startsWith(' '));
        assert.equal(`build skip-assets pretty${flags}`.includes('pretty --output'), true);
    });
});

describe('src/bin/cmd-dev.test.ts - staleAssetFiles', () => {
    const copied = new Set([
        'logo.svg',
        path.join('fonts', 'a.woff2'),
        path.join('fonts', 'b.woff2'),
        'fonts-extra.css',
    ]);

    test('a deleted file names itself', () => {
        assert.deepEqual(staleAssetFiles('logo.svg', copied), ['logo.svg']);
    });

    // Deleting a directory can be the only event the watcher gets for it.
    test('a deleted directory names every file under it, and not a sibling sharing its prefix', () => {
        assert.deepEqual(staleAssetFiles('fonts', copied), [
            path.join('fonts', 'a.woff2'),
            path.join('fonts', 'b.woff2'),
        ]);
    });

    // index.html is the build's, never the assets dir's, so it is not in the set.
    test('a path nothing was copied to names nothing', () => {
        assert.deepEqual(staleAssetFiles('index.html', copied), []);
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

describe('src/bin/cmd-dev.test.ts - portHolder, portInUseMessage', () => {
    const noLsof = spawnSync('lsof', ['-v']).error ? 'lsof is not installed' : false;

    // The message used to say only that the port was taken, which left a dev
    // server orphaned by an earlier session to be hunted down by hand.
    test('names the process listening on a port, and where it runs', { skip: noLsof }, async () => {
        const server = net.createServer();
        await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
        const { port } = server.address() as net.AddressInfo;

        try {
            const holder = portHolder(port);
            assert.equal(holder?.pid, process.pid);
            assert.ok(holder?.command, 'expected a command line');
            assert.equal(holder?.cwd, fs.realpathSync(process.cwd()));
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    test('is null when nothing is listening', { skip: noLsof }, async () => {
        assert.equal(portHolder(await freePort()), null);
    });

    test('the message names the PID, where it runs, and how to stop it', () => {
        const message = portInUseMessage(8090, {
            pid: 43577,
            command: 'node skrapa dev',
            cwd: path.join(CWD_DIR, 'web'),
        });

        assert.match(message, /port 8090 is already in use by PID 43577 in web:/);
        assert.match(message, /^ {2}node skrapa dev$/m);
        assert.match(message, /Stop it with `kill 43577`, or pass --port <number>/);
    });

    test('names a working directory outside this one in full', () => {
        const elsewhere = path.join(path.sep, 'elsewhere', 'site');
        const message = portInUseMessage(8080, { pid: 1, command: 'x', cwd: elsewhere });
        assert.ok(message.includes(` in ${elsewhere}:`));
    });

    test('without a holder, still says how to get past it', () => {
        assert.equal(
            portInUseMessage(8090, null),
            'Error: port 8090 is already in use. Pass --port <number> to use another.'
        );
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
        write('public/gone.txt', 'deleted mid-session');
        write('public/fonts/a.woff2', 'font');
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
        removeTempDir(fixture);
    });

    // The first build empties the output dir, and the hook used to run only
    // after rebuilds, so whatever it wrote was missing until the first save.
    test('runs postbuild-skrapa after the first build, before serving', () => {
        const marker = path.join(fixture, 'dist', 'postbuild.txt');
        assert.equal(fs.readFileSync(marker, 'utf-8'), 'ran');
    });

    // A deleted asset used to be served until the next full build, so a page
    // still linking it looked fine in dev and 404ed once deployed.
    test('removes assets deleted while it runs from the output, and nothing else', async () => {
        const dist = path.join(fixture, 'dist');
        assert.ok(fs.existsSync(path.join(dist, 'gone.txt')), 'the first build copies the assets');

        fs.rmSync(path.join(fixture, 'public', 'gone.txt'));
        fs.rmSync(path.join(fixture, 'public', 'fonts'), { recursive: true });

        const gone = () =>
            !fs.existsSync(path.join(dist, 'gone.txt')) && !fs.existsSync(path.join(dist, 'fonts'));
        for (let waited = 0; !gone() && waited < 10_000; waited += 50) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        assert.ok(gone(), 'the deleted assets are still in the output');
        assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'a page the build wrote stays');
        assert.ok(fs.existsSync(path.join(dist, 'postbuild.txt')), 'a postbuild-skrapa file stays');
    });

    // Kept while the server runs, for its rebuilds and its assets watcher, and
    // gone once dev mode ends. Last, since it stops the server.
    test('keeps .skrapa while it runs, and deletes it when it stops', async () => {
        assert.ok(fs.existsSync(path.join(fixture, '.skrapa')));

        const stopped = new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 10_000);
            server?.once('exit', () => {
                clearTimeout(timer);
                resolve(true);
            });
        });
        server?.kill('SIGINT');

        assert.ok(await stopped, 'dev did not stop on SIGINT');
        assert.ok(!fs.existsSync(path.join(fixture, '.skrapa')));
    });
});
