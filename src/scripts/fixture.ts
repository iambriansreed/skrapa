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
import { parseJsonc } from '../bin/config';
import { buildBin, removeTmp, ROOT_DIR, TMP_ROOT } from './utils';

/**
 * A throwaway directory under `.tmp/`, which is gitignored and skipped by
 * eslint and tsc. Inside the repo, not the system temp dir, so a fixture's own
 * `tsc` run resolves `@types/node` by walking up to the repo's node_modules.
 * Remove it with {@link removeTempDir}.
 * @param prefix - names the directory, so a leaked one says what left it
 */
export function tempDir(prefix: string): string {
    for (;;) {
        fs.mkdirSync(TMP_ROOT, { recursive: true });
        try {
            return fs.mkdtempSync(path.join(TMP_ROOT, prefix));
        } catch (err) {
            // Another test file, running in a process of its own, removed its
            // last fixture and .tmp with it between the two calls.
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
    }
}

/**
 * Remove a directory from {@link tempDir}, and `.tmp/` too once nothing else is
 * in it, so a test run leaves no trace.
 * @param dir - the directory {@link tempDir} returned
 */
export function removeTempDir(dir: string): void {
    removeTmp(dir);
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
        removeTempDir(probe);
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
 * Run the built CLI in a directory and collect what it said.
 * @param dir - the directory to run it in; skrapa reads only `./tsconfig.json`
 * @param args - the command and its args, e.g. `['fix']`
 * @returns the exit status, and stdout and stderr as one string
 */
export function runCli(dir: string, args: string[]): { status: number | null; output: string } {
    const binDir = path.join(ROOT_DIR, 'node_modules', '.bin');
    const result = spawnSync(process.execPath, [path.join(ROOT_DIR, 'bin', 'index.js'), ...args], {
        cwd: dir,
        encoding: 'utf-8',
        // The build shells out to a bare `tsc`, so make sure the repo's copy
        // is on PATH however the tests were launched.
        env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    });

    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

/**
 * Run `skrapa build` against a fixture, with its assets in `public/`.
 * @param fixture - the skrapa root to build (a fixture from {@link scaffold}, or a
 *   directory below one)
 * @param args - extra CLI args, e.g. `['--base', '/repo/']`
 * @returns the exit status, and stdout and stderr as one string
 */
export function runBuild(
    fixture: string,
    args: string[] = []
): { status: number | null; output: string } {
    return runCli(fixture, ['build', '--assets', 'public', ...args]);
}

/**
 * A minimal buildable project in one directory: the template's compiler
 * options with a `skrapa` key of `{ "output": "dist" }` (so the skrapa root and
 * the project root are both the fixture), plus a top-level shell and home page.
 * @param fixture - the directory to scaffold into, from {@link tempDir}
 * @returns a `write(file, body)` for adding whatever the case under test needs
 */
export function scaffold(fixture: string): (file: string, body: string) => void {
    const write = (file: string, body: string) => {
        const full = path.join(fixture, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
    };

    const template = parseJsonc(
        fs.readFileSync(path.join(ROOT_DIR, 'template', 'src', 'tsconfig.json'), 'utf-8')
    ) as Record<string, unknown>;
    const tsconfig = { ...template, skrapa: { output: 'dist' }, include: ['**/*.ts', '**/*.tsx'] };
    write('tsconfig.json', JSON.stringify(tsconfig, null, 4));
    write('index.html', '<!doctype html>\n<html><head></head><body></body></html>');
    write('index.tsx', 'export const Page = (): Skrapa.Page => <h1>home</h1>;\n');

    return write;
}
