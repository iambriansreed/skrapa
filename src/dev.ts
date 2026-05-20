import { exec, execSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const tsc = spawn('tsc', ['--watch'], { stdio: 'pipe' });

let server: ChildProcess | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

function start() {
    if (server) {
        server.kill();
        server = null;
    }
    execSync('mkdir -p bin && cp .skrapa/src/bin/skrapa.js bin/skrapa.js', { stdio: 'inherit' });
    server = exec(`node bin/skrapa.js dev`, { stdio: 'inherit' } as any);
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

execSync(`npm link`, { stdio: 'inherit' });
console.log('npm link ready.');

tsc.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output);

    if (output.includes('Watching for file changes.')) {
        scheduleRestart();
    }
});
