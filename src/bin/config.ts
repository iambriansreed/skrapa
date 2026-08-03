/**
 * Config
 *
 * Shared config loading for every command. `loadConfig` merges, in increasing
 * precedence: DEFAULT_CONFIG, skrapa.config.json, CLI flags, and a caller
 * `overrideConfig`. Each command (build, dev, init, page) takes the same
 * optional `overrideConfig?: Partial<Config>` and hands it here, so config and
 * override handling behave identically across the CLI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_KEYS, CWD_DIR, DEFAULT_CONFIG, log } from './utils';

// Parse `--key value` pairs for every known config key out of argv (positional
// args like the page name or `pretty`/`skip-assets` markers are ignored).
export function parseFlags(): Partial<Config> {
    const args = process.argv.slice(3);
    const flags: Partial<Config> = {};

    CONFIG_KEYS.forEach((key) => {
        const flag = `--${key}`; // --input, --output, --assets, --port, --host, --base, --root
        const index = args.findIndex((arg) => arg === flag);
        if (index > -1 && index < args.length - 1) flags[key] = args[index + 1];
    });

    return flags;
}

// Positional args (after the command), with `--key value` config-flag pairs and
// any other `-flag` removed. Lets a command take positionals (e.g. the page
// name and parent) that coexist with the shared config flags in any order.
export function positionalArgs(): string[] {
    const args = process.argv.slice(3);
    const valueFlags = new Set(CONFIG_KEYS.map((key) => `--${key}`));
    const positionals: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (valueFlags.has(arg)) {
            i++; // skip the flag's value too
            continue;
        }
        if (arg.startsWith('-')) continue; // boolean flag, e.g. --no-dev, -f
        positionals.push(arg);
    }

    return positionals;
}

export type LoadedConfig = {
    config: Config;
    /** Absolute path skrapa.config.json was looked for at. */
    configPath: string;
    /** Whether that config file existed and was merged in. */
    fileExists: boolean;
};

/**
 * Resolve the final config with precedence (lowest to highest): DEFAULT_CONFIG,
 * config file, CLI flags, `overrideConfig` (e.g. `dev` pinning the port). The
 * returned `config.root` is always absolute. Reads at most skrapa.config.json;
 * it never creates or validates directories (that stays with the build).
 * @param overrideConfig
 */
export function loadConfig(overrideConfig?: ConfigOverrides): LoadedConfig {
    const flagConfig = parseFlags();

    // Look for skrapa.config.json in the --root directory when provided, so
    // `--root template` reads template/skrapa.config.json instead of the cwd's.
    const configRoot = path.resolve(
        CWD_DIR,
        overrideConfig?.root ?? flagConfig.root ?? DEFAULT_CONFIG.root
    );
    const configPath = path.resolve(configRoot, 'skrapa.config.json');
    const fileExists = fs.existsSync(configPath);

    // A hand-edited config file is easy to get wrong; report it as a config
    // error rather than letting a raw SyntaxError stack escape.
    let fileConfig: Partial<Config> = {};
    if (fileExists) {
        try {
            fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch (err) {
            log.error(
                `Error: ${path.relative(CWD_DIR, configPath)} is not valid JSON.\n  ${(err as Error).message}`
            );
            process.exit(1);
        }
    }

    const config: Config = { ...DEFAULT_CONFIG, ...fileConfig, ...flagConfig, ...overrideConfig };

    // Resolve root to an absolute path so require() and all derived paths
    // (input/output/assets/WORKING_DIR) follow --root instead of the cwd.
    config.root = path.resolve(CWD_DIR, config.root);

    return { config, configPath, fileExists };
}
