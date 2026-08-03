// ============================================================================
// UTILS
// ============================================================================

import { execSync } from 'node:child_process';
import path from 'node:path';

export const CWD_DIR = path.join(process.cwd());

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

// Run a command with its output inherited. Pass `cwd` rather than building a
// `cd <dir> && ...` string: an unquoted path with a space breaks the command,
// and a hostile one would run as shell.
export function exe(cmd: string, options: { cwd?: string } = {}) {
    execSync(cmd, { stdio: 'inherit', ...options });
}

export const CONFIG_KEYS: ConfigKeys[] = [
    'input',
    'output',
    'assets',
    'port',
    'host',
    'base',
    'root',
];

export const DEFAULT_CONFIG: Config = {
    input: 'src',
    output: 'dist',
    assets: 'assets',
    port: '8080',
    host: 'localhost',
    base: '/',
    root: process.cwd(),
} as const;
