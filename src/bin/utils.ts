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
 * The `Skrapa v0.0.0` line every command greets you with, tagged with the
 * source checkout when this is a linked bin.
 *
 * A linked skrapa is indistinguishable from the published one once it is in
 * another project's node_modules, so a stale link (or the wrong clone of two)
 * looks exactly like a released bug. Naming the directory it came from is the
 * cheapest way to catch that at the top of the output.
 */
export function versionBanner(): string {
    const banner = `${color.cyan}Skrapa${color.reset} ${color.gray}v${VERSION}${color.reset}`;
    if (!IS_DEV_BIN) return banner;
    return `${banner} ${color.yellow}(dev bin → ${PKG_ROOT})${color.reset}`;
}

// Run a command with its output inherited. Pass `cwd` rather than building a
// `cd <dir> && ...` string: an unquoted path with a space breaks the command,
// and a hostile one would run as shell.
export function exe(cmd: string, options: { cwd?: string } = {}) {
    execSync(cmd, { stdio: 'inherit', ...options });
}

export const CONFIG_KEYS: ConfigKey[] = [
    'input',
    'output',
    'assets',
    'port',
    'host',
    'origin',
    'base',
    'ignore',
    'root',
];

/**
 * The bottom layer of the precedence chain in config.ts. Typed as the resolved
 * shape, not the authoring one, so the defaults are guaranteed to fill every
 * field: a merge that starts here can never come out with a hole in it.
 */
export const DEFAULT_CONFIG: ResolvedConfig = {
    input: 'src',
    output: 'dist',
    assets: 'assets',
    port: 8080,
    host: 'localhost',
    origin: '',
    base: '/',
    ignore: [],
    root: process.cwd(),
} as const;
