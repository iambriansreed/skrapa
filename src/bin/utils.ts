// ============================================================================
// UTILS
// ============================================================================

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const CWD_DIR = path.join(process.cwd());

// The package directory this CLI was loaded from. The bundled entry sits at
// `<pkg>/bin/index.js` in an installed copy and in a working checkout alike,
// and Node resolves symlinks before setting __dirname, so an `npm link`-ed
// consumer reports the checkout it actually ran, not its node_modules stub.
export const PKG_ROOT = path.resolve(__dirname, '..');

// True when running a linked/checkout build rather than one installed from
// the registry. `src/` is absent from package.json "files", so it exists only
// in a working copy. Checked instead of looking for `node_modules` in the
// path, which would also call a global `npm i -g` install a dev bin.
export const IS_DEV_BIN = fs.existsSync(path.join(PKG_ROOT, 'src', 'bin', 'index.ts'));

export const color = {
    reset: '\x1b[0m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
};

export const log = {
    info: (msg: string) => console.log(`${color.blue}${msg}${color.reset}`),
    success: (msg: string) => console.log(`${color.green}${msg}${color.reset}`),
    warn: (msg: string) => console.log(`${color.yellow}${msg}${color.reset}`),
    error: (msg: string) => console.error(`${color.red}${msg}${color.reset}`),
    gray: (msg: string) => console.log(`${color.gray}${msg}${color.reset}`),
};

/**
 * Whether this process was started through a global `npm link`, the kind
 * `npm unlink -g skrapa` removes.
 *
 * npm links a bin by putting a symlink in its global bin dir. Node follows that
 * symlink for `__dirname` but leaves `process.argv[1]` as invoked, so an entry
 * that is itself a symlink is the tell. Running a checkout's `bin/index.js` by
 * path (`npm run build`, CI) is not a link. Neither is a project-local
 * `npm link skrapa`, whose symlink sits in that project's `node_modules/.bin`,
 * out of reach of the global unlink.
 * @param invokedAs - the entry path as invoked, normally `process.argv[1]`
 */
export function isGlobalLink(invokedAs: string | undefined): boolean {
    if (!invokedAs) return false;
    const entry = path.resolve(invokedAs);
    if (entry.split(path.sep).includes('node_modules')) return false;
    try {
        return fs.lstatSync(entry).isSymbolicLink();
    } catch {
        return false;
    }
}

/**
 * The `Skrapa v0.0.0` line every command greets you with, tagged with the
 * source checkout when this is a dev bin, plus the way back to the published
 * package when that dev bin was reached through a global link.
 *
 * A linked skrapa is indistinguishable from the published one once it is in
 * another project's node_modules, so a stale link (or the wrong clone of two)
 * looks exactly like a released bug. Naming the directory it came from is the
 * cheapest way to catch that at the top of the output.
 *
 * The unlink hint is left out when there is no link to remove (see
 * {@link isGlobalLink}). It reads sentence-first so it stays unambiguous once
 * the color is stripped (piped output, a CI log), where a trailing explanation
 * would run straight into the command. Only the command itself is cyan, so
 * selecting the colored run copies something runnable and nothing else.
 *
 * Padded with one blank line above and one below, the same for every command
 * and every kind of bin, so callers print it as is.
 */
export function versionBanner(): string {
    const lines = [`${color.cyan}Skrapa${color.reset} ${color.gray}v${VERSION}${color.reset}`];
    if (IS_DEV_BIN) {
        lines[0] += ` ${color.yellow}(dev bin → ${PKG_ROOT})${color.reset}`;
        if (isGlobalLink(process.argv[1])) {
            lines.push(
                `${color.gray}To use the published version: $ ${color.cyan}npm unlink -g skrapa${color.reset}`
            );
        }
    }
    return `\n${lines.join('\n')}\n`;
}

// Run a command with its output inherited. Pass `cwd` rather than building a
// `cd <dir> && ...` string: an unquoted path with a space breaks the command,
// and a hostile one would run as shell.
export function exe(cmd: string, options: { cwd?: string } = {}) {
    execSync(cmd, { stdio: 'inherit', ...options });
}

export const CONFIG_KEYS: ConfigKey[] = [
    'output',
    'assets',
    'port',
    'host',
    'origin',
    'base',
    'linkCheckIgnore',
    'projectRoot',
];

/**
 * The bottom layer of the precedence chain in config.ts. Typed as the resolved
 * shape, not the authoring one, so the defaults are guaranteed to fill every
 * field: a merge that starts here can never come out with a hole in it.
 */
export const DEFAULT_CONFIG: ResolvedConfig = {
    output: 'dist',
    assets: 'assets',
    port: 8080,
    host: 'localhost',
    origin: '',
    base: '/',
    linkCheckIgnore: [],
    projectRoot: '.',
} as const;

/**
 * Whether a path under a skrapa root is outside what skrapa reads as source.
 *
 * Pages live directly in the skrapa root, so walking it finds everything else
 * in there too. Skipped: anything under a dot-dir (`.skrapa`, which tsc and the
 * manifest write to on every build, `.git`, `.github`), under `node_modules`,
 * outside the root, or at or under one of `exclude` (the output and assets
 * dirs). The page walk, the dev watcher, stylesheet copies, `page` and `fix`
 * all ask this one question, so none of them can drift into reading the
 * build's own output as source, which in the dev watcher is an endless
 * rebuild loop.
 * @param root - absolute skrapa root the path is judged relative to
 * @param file - absolute path to judge
 * @param exclude - absolute dirs to leave out; empty entries are ignored
 */
export function isSkippedPath(
    root: string,
    file: string,
    exclude: readonly string[] = []
): boolean {
    const within = (dir: string) => {
        const rel = path.relative(dir, file);
        return (
            rel === '' ||
            (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
        );
    };
    if (exclude.some((dir) => dir && within(dir))) return true;

    return path
        .relative(root, file)
        .split(path.sep)
        .some((part) => part.startsWith('.') || part === 'node_modules');
}
