import { exec, execSync, spawn } from 'node:child_process';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process';

let server: ChildProcess | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

const binOnly = process.argv.includes('-bin');
const templateOnly = process.argv.includes('-template');

const tsc = spawn('tsc', ['--watch'], { stdio: 'pipe' });
const tscTemplate = templateOnly
    ? spawn('tsc', ['--watch'], { stdio: 'pipe', cwd: 'template' })
    : undefined;

function start() {
    if (server) {
        server.kill();
        server = null;
    }
    execSync('mkdir -p bin && cp .skrapa/src/bin/skrapa.js bin/skrapa.js', { stdio: 'inherit' });

    // Don't start the server if we're only watching for changes to the bin files (for testing purposes)
    if (binOnly) {
        console.log('Watching for changes to bin files only. Dev server will not start.');
        return;
    }

    let cmd = `node bin/skrapa.js dev`;
    if (templateOnly) {
        console.log(
            'Watching for changes to template files as well. Dev server will start with --root template flag.'
        );
        cmd += ' --root template';
    }

    server = exec(cmd, { stdio: 'inherit' } as any);
    server.stdout?.pipe(process.stdout);
    server.stderr?.pipe(process.stderr);
}

function scheduleRestart() {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        restartTimer = null;
        console.log('Restarting dev server...');
        start();
    }, 100);
}

tsc.stdout.on('error', (error) => {
    console.error(`Compilation error:`, error);
});

tscTemplate?.stdout.on('error', (error) => {
    console.error(`Compilation error:`, error);
});

execSync(`npm link`, { stdio: 'inherit' });
console.log('npm link ready.');

tsc.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output);

    if (output.includes('Watching for file changes.')) {
        scheduleRestart();
    }
});

tscTemplate?.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output);

    if (output.includes('Watching for file changes.')) {
        scheduleRestart();
    }
});
