import { exec, execSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const tsc = spawn('tsc', ['-p', 'src/bin/tsconfig.json', '--watch'], { stdio: 'pipe' });

let server: ChildProcess | null = null;

function start() {
    if (server) {
        server.kill();
        server = null;
    }
    server = exec(`node bin/scratch.js dev`, { stdio: 'inherit' } as any);
    server.stdout?.pipe(process.stdout);
    server.stderr?.pipe(process.stderr);
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
        console.log('Restarting dev server...');
        start();
    }
});
