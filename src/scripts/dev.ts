//

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { color, log } from '../bin/utils';
import { buildBin, linkBin, ROOT_DIR, scaffoldTmp, TEMPLATE_DIR, TMP_DIR } from './utils';

// `test` mode (used by src/scripts/test.ts) only needs the scaffolded .tmp
// site up on its default port, so it skips the root dev server, the file
// watchers, and building the dogfooded root site, since a one-shot test run
// won't stick around to benefit from any of them.
const testMode = process.argv.includes('test');

if (testMode) {
    buildBin();
} else {
    execSync(`npm run build`, { stdio: 'inherit', cwd: ROOT_DIR });
}

// Both modes below run `npx skrapa` (to scaffold .tmp and to start each dev
// server), so the global bin has to point at this checkout. `npm run build`
// no longer does this for us, on purpose: see linkBin() in ./utils.
linkBin();

// run dev server in root
let rootDev: ChildProcess | null = testMode ? null : runDev('root', color.cyan, ROOT_DIR);

// scaffold .tmp
log.gray('Scaffolding .tmp...');
scaffoldTmp();

// run dev server in .tmp
let tmpDev = runDev('tmp', color.blue, TMP_DIR);

if (!testMode) {
    observeBinChanges();
    observeTemplateChanges();
}

process.on('SIGINT', async () => {
    log.gray('\nShutting down dev servers...');
    await Promise.all([rootDev ? stopDev(rootDev) : Promise.resolve(), stopDev(tmpDev)]);
    process.exit(0);
});

//

// Run a dev server in the given directory and return the ChildProcess. Output
// is piped (rather than inherited) so it can be prefixed with a colored label.
// Otherwise the root and .tmp servers' logs interleave indistinguishably.
function runDev(label: string, labelColor: string, cwd: string): ChildProcess {
    log.gray(`[${label}] starting dev server in ${path.relative(ROOT_DIR, cwd) || '.'}`);
    const proc = spawn('npx', ['skrapa', 'dev'], { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    pipeLabeled(proc, label, labelColor);
    return proc;
}

function pipeLabeled(proc: ChildProcess, label: string, labelColor: string) {
    const prefix = `${labelColor}[${label}]${color.reset} `;
    const write = (stream: NodeJS.WritableStream) => (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
            if (line.trim() !== '') stream.write(`${prefix}${line}\n`);
        }
    };
    proc.stdout?.on('data', write(process.stdout));
    proc.stderr?.on('data', write(process.stderr));
}

// Ask a dev server to shut down and wait for it to actually exit (falling
// back to a hard kill) so a restart never races the old process for the port.
function stopDev(proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
        if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
        const timer = setTimeout(() => {
            log.warn(`Dev server (pid ${proc.pid}) didn't exit in time, killing it.`);
            proc.kill('SIGKILL');
        }, 3000);
        proc.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
        proc.kill('SIGINT');
    });
}

function observeBinChanges() {
    // watch for changes to src/bin/**, if changes are detected:
    // stop the dev servers, run tsc && buildBin(), restart servers
    let binTimer: NodeJS.Timeout | null = null;
    let rebuilding = false;
    let rebuildPending = false;

    const rebuild = async () => {
        if (rebuilding) {
            rebuildPending = true;
            return;
        }
        rebuilding = true;
        do {
            rebuildPending = false;
            log.info('\nsrc/bin changed, rebuilding CLI...');
            await Promise.all([rootDev && stopDev(rootDev), stopDev(tmpDev)]);

            try {
                execSync(`tsc -p tsconfig.json`, { stdio: 'inherit', cwd: ROOT_DIR });
                buildBin();
                log.success('CLI rebuilt.');
                // The link already points here and bin/index.js was rewritten
                // in place, so there is nothing to re-link.
            } catch (err) {
                log.error(`Build failed: ${(err as Error).message}`);
            }

            rootDev = runDev('root', color.cyan, ROOT_DIR);
            tmpDev = runDev('tmp', color.blue, TMP_DIR);
        } while (rebuildPending);
        rebuilding = false;
    };

    fs.watch(path.join(ROOT_DIR, 'src', 'bin'), { recursive: true }, () => {
        if (binTimer) clearTimeout(binTimer);
        binTimer = setTimeout(rebuild, 200);
    });
}

function observeTemplateChanges() {
    // watch for changes to template/**, if changes are detected:
    // stop the .tmp dev server, rescaffold .tmp, restart it
    let templateTimer: NodeJS.Timeout | null = null;
    let rescaffolding = false;
    let rescaffoldPending = false;

    const rescaffold = async () => {
        if (rescaffolding) {
            rescaffoldPending = true;
            return;
        }
        rescaffolding = true;
        do {
            rescaffoldPending = false;
            log.info('\ntemplate/ changed, rescaffolding .tmp...');
            await stopDev(tmpDev);
            scaffoldTmp();
            tmpDev = runDev('tmp', color.blue, TMP_DIR);
            log.success('.tmp rescaffolded.');
        } while (rescaffoldPending);
        rescaffolding = false;
    };

    fs.watch(TEMPLATE_DIR, { recursive: true }, () => {
        if (templateTimer) clearTimeout(templateTimer);
        templateTimer = setTimeout(rescaffold, 200);
    });
}
