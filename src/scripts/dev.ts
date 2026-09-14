//

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { color, log } from '../bin/utils';
import {
    buildBin,
    linkBin,
    removeTmp,
    ROOT_DIR,
    scaffoldTmp,
    TEMPLATE_DIR,
    TMP_DIR,
    TMP_SKRAPA_DIR,
    WEB_DIR,
} from './utils';

// Every dev server this process has started and not yet seen exit, so all of
// them can be stopped however this process ends.
const running = new Set<ChildProcess>();

// Stop every dev server, however this process is asked to end: Ctrl+C
// (SIGINT), a closed terminal (SIGHUP), or a kill (SIGTERM). Each server runs
// in a process group of its own (see runDev), so no signal reaches it unless
// it is passed on from here, and a server left behind keeps its port until
// someone finds it. Registered before anything is started, so there is no
// window in which a server exists and nothing would stop it.
let shuttingDown = false;
async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.gray('\nShutting down dev servers...');
    await Promise.all([...running].map(stopDev));
    // Undo linkBin(), so `npx skrapa` in other projects goes back to the
    // published package. Best effort: a failure here must not stop the exit.
    try {
        execSync('npm unlink -g skrapa');
    } catch {
        log.warn('Could not remove the global skrapa link. Run `npm unlink -g skrapa` by hand.');
    }
    process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => void shutdown());
}

// The last resort, for an ending none of those signals covers: an uncaught
// error, or a sync step (the build, the scaffold) failing. Nothing can be
// awaited here, so whatever is still running is killed outright.
//
// Every ending comes through here, shutdown() included, so this is also where
// the CLI's tsc output goes: buildBin() writes it to the repo's .skrapa for as
// long as this dev session rebuilds the CLI, and nothing needs it after. The
// same goes for the project scaffoldTmp() put in .tmp, and .tmp with it when
// nothing else is left there.
process.on('exit', () => {
    for (const proc of running) signalGroup(proc, 'SIGKILL');
    fs.rmSync(path.join(ROOT_DIR, '.skrapa'), { recursive: true, force: true });
    try {
        removeTmp(TMP_DIR);
    } catch {
        log.warn(`Could not remove ${path.relative(ROOT_DIR, TMP_DIR)}. Delete it by hand.`);
    }
});

// `test` mode (used by src/scripts/test.ts) only needs the scaffolded .tmp
// site up on its default port, so it skips the web/ dev server, the file
// watchers, and building the dogfooded docs site, since a one-shot test run
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

// run the docs site's dev server in web/
let webDev: ChildProcess | null = testMode ? null : runDev('web', color.cyan, WEB_DIR);

// scaffold .tmp
log.gray('Scaffolding .tmp...');
scaffoldTmp();

// run dev server in .tmp
let tmpDev = runDev('tmp', color.blue, TMP_SKRAPA_DIR);

if (!testMode) {
    observeBinChanges();
    observeTemplateChanges();
}

//

// Run a dev server in the given directory and return the ChildProcess. Output
// is piped (rather than inherited) so it can be prefixed with a colored label.
// Otherwise the web and .tmp servers' logs interleave indistinguishably.
function runDev(label: string, labelColor: string, cwd: string): ChildProcess {
    log.gray(`[${label}] starting dev server in ${path.relative(ROOT_DIR, cwd) || '.'}`);
    // `detached` puts the server in a process group of its own. npx starts
    // skrapa as a child of its own, and a signal sent to npx alone is not
    // always passed on, which leaves skrapa running and holding the port with
    // nothing left that knows about it. Signalling the group (signalGroup)
    // reaches both. It also keeps the terminal's Ctrl+C from reaching the
    // servers directly, so they are stopped once, from shutdown().
    const proc = spawn('npx', ['skrapa', 'dev'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd,
        detached: true,
    });
    running.add(proc);
    proc.once('exit', () => running.delete(proc));
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

// Signal a dev server's whole process group: npx and the skrapa it started.
function signalGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
    if (proc.pid === undefined) return;
    try {
        process.kill(-proc.pid, signal);
    } catch {
        // The group is already gone.
    }
}

// Ask a dev server to shut down and wait for it to actually exit (falling
// back to a hard kill) so a restart never races the old process for the port.
function stopDev(proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
        const done = () => {
            // npx can exit a moment before the skrapa it started, and anything
            // still in the group would otherwise be left holding the port.
            signalGroup(proc, 'SIGKILL');
            resolve();
        };
        if (proc.exitCode !== null || proc.signalCode !== null) return done();
        const timer = setTimeout(() => {
            log.warn(`Dev server (pid ${proc.pid}) didn't exit in time, killing it.`);
            signalGroup(proc, 'SIGKILL');
        }, 3000);
        proc.once('exit', () => {
            clearTimeout(timer);
            done();
        });
        signalGroup(proc, 'SIGINT');
    });
}

function observeBinChanges() {
    // watch for changes to src/bin/**, if changes are detected:
    // stop the dev servers, run buildBin() (tsc + bundle), restart servers
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
            await Promise.all([webDev && stopDev(webDev), stopDev(tmpDev)]);

            try {
                buildBin();
                log.success('CLI rebuilt.');
                // The link already points here and bin/index.js was rewritten
                // in place, so there is nothing to re-link.
            } catch (err) {
                log.error(`Build failed: ${(err as Error).message}`);
            }

            // Shutting down while this rebuild was waiting: starting servers
            // now would leave them running after this process exits.
            if (shuttingDown) return;
            webDev = runDev('web', color.cyan, WEB_DIR);
            tmpDev = runDev('tmp', color.blue, TMP_SKRAPA_DIR);
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
            // See the same check in observeBinChanges.
            if (shuttingDown) return;
            tmpDev = runDev('tmp', color.blue, TMP_SKRAPA_DIR);
            log.success('.tmp rescaffolded.');
        } while (rescaffoldPending);
        rescaffolding = false;
    };

    fs.watch(TEMPLATE_DIR, { recursive: true }, () => {
        if (templateTimer) clearTimeout(templateTimer);
        templateTimer = setTimeout(rescaffold, 200);
    });
}
