/**
 * Throwaway projects for the tests that need a real build.
 *
 * A rule that fails a build can only be proved by a build that fails, so those
 * cases scaffold a project, run the CLI against it as a subprocess, and read
 * the exit code and the output. Shared here because more than one test file
 * needs the same three things (a temp dir, a built bin, a minimal project), and
 * a second copy of this harness would drift from the first.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildBin, ROOT_DIR } from './utils';

/**
 * A throwaway directory under `.tmp/`, which is gitignored and skipped by
 * eslint and tsc. Inside the repo, not the system temp dir, so a fixture's own
 * `tsc` run resolves `@types/node` by walking up to the repo's node_modules.
 * @param prefix - names the directory, so a leaked one says what left it
 */
export function tempDir(prefix: string): string {
    const tmp = path.join(ROOT_DIR, '.tmp');
    fs.mkdirSync(tmp, { recursive: true });
    return fs.mkdtempSync(path.join(tmp, prefix));
}

/**
 * Reason to skip a test that needs two paths differing only in case, or false.
 *
 * Where the filesystem folds case the two are one file, so there is no fixture
 * to build. Computed once, since it probes the disk.
 */
export const caseSkip: string | false = (() => {
    const probe = tempDir('case-');
    try {
        fs.writeFileSync(path.join(probe, 'a'), '');
        return fs.existsSync(path.join(probe, 'A')) && 'filesystem is case-insensitive';
    } finally {
        fs.rmSync(probe, { recursive: true, force: true });
    }
})();

let binBuilt = false;

/** Build the bin once per run, so the binary under test is this source. */
export function ensureBin(): void {
    if (binBuilt) return;
    buildBin();
    binBuilt = true;
}

/**
 * Run `skrapa build` against a fixture and collect what it said.
 * @param fixture - the project directory to build, from {@link scaffold}
 * @param args - extra CLI args, e.g. `['--base', '/repo/']`
 * @returns the exit status, and stdout and stderr as one string
 */
export function runBuild(
    fixture: string,
    args: string[] = []
): { status: number | null; output: string } {
    const binDir = path.join(ROOT_DIR, 'node_modules', '.bin');
    const build = spawnSync(
        process.execPath,
        [path.join(ROOT_DIR, 'bin', 'index.js'), 'build', '--assets', 'public', ...args],
        {
            cwd: fixture,
            encoding: 'utf-8',
            // The build shells out to a bare `tsc`, so make sure the repo's
            // copy is on PATH however the tests were launched.
            env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
        }
    );

    return { status: build.status, output: `${build.stdout}\n${build.stderr}` };
}

/**
 * A minimal buildable project: a root shell and a root page.
 * @param fixture - the directory to scaffold into, from {@link tempDir}
 * @returns a `write(file, body)` for adding whatever the case under test needs
 */
export function scaffold(fixture: string): (file: string, body: string) => void {
    const write = (file: string, body: string) => {
        const full = path.join(fixture, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
    };

    write('tsconfig.json', fs.readFileSync(path.join(ROOT_DIR, 'template/tsconfig.json'), 'utf-8'));
    write('src/index.html', '<!doctype html>\n<html><head></head><body></body></html>');
    write('src/index.tsx', 'export const Page = (): Skrapa.Page => <h1>home</h1>;\n');

    return write;
}
