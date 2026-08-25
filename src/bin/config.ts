/**
 * Config
 *
 * Shared config loading for every command. `loadConfig` merges, in increasing
 * precedence: DEFAULT_CONFIG, skrapa.config.ts, CLI flags, and a caller
 * `overrideConfig`, then normalizes the result. Each command (build, dev, init,
 * page) takes the same optional `overrideConfig?: Skrapa.Config` and hands it
 * here, so config and override handling behave identically across the CLI.
 *
 * The two config types are deliberately different shapes. `Skrapa.Config` is
 * what a human writes: every field optional, `port` either a number or a
 * numeric string. `ResolvedConfig` is what commands run on: nothing
 * optional, `port` a validated number, `base` and `root` normalized. Everything
 * between the two lives in `normalizeConfig` below, so no command has to guess
 * whether a value has been through it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CONFIG_KEYS, CWD_DIR, DEFAULT_CONFIG, log } from './utils';

/** The config file name, resolved relative to the `--root` directory. */
export const CONFIG_FILE = 'skrapa.config.ts';

/**
 * A config layer as it arrives, before normalization. Sources disagree about
 * types for the same key: the config file gives `port` as a number, a `--port`
 * flag gives the string "8080". Both are legal here and reconciled below.
 */
type RawConfig = { [K in ConfigKey]?: Skrapa.Config[K] | string };

// Parse `--key value` pairs for every known config key out of argv (positional
// args like the page name or `pretty`/`skip-assets` markers are ignored).
export function parseFlags(): Partial<Record<ConfigKey, string>> {
    const args = process.argv.slice(3);
    const flags: Partial<Record<ConfigKey, string>> = {};

    CONFIG_KEYS.forEach((key) => {
        const flag = `--${key}`; // --input, --output, --assets, --port, --host, --origin, --base, --root
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
    config: ResolvedConfig;
    /** Absolute path skrapa.config.ts was looked for at. */
    configPath: string;
    /** Whether that config file existed and was merged in. */
    fileExists: boolean;
};

/**
 * Read and evaluate `skrapa.config.ts`.
 *
 * `require` rather than `import()` on purpose, for two reasons. It is
 * synchronous, so `loadConfig` and every command that calls it stay
 * synchronous. And `import()` of a .ts file in a project whose package.json has
 * no `"type"` field prints a four-line MODULE_TYPELESS_PACKAGE_JSON warning on
 * every single command; require does not. Node strips the types itself (>=24 is
 * the engines floor), so this costs no dependency and no transpile step.
 */
function readConfigFile(configPath: string): RawConfig {
    // Resolved from the config file's own directory so a config that imports a
    // helper next to it resolves against the project, not against skrapa.
    const require = createRequire(configPath);
    let mod: unknown;
    try {
        mod = require(configPath);
    } catch (err) {
        log.error(
            `Error: could not load ${path.relative(CWD_DIR, configPath)}\n  ${(err as Error).message}`
        );
        process.exit(1);
    }

    // `export default {...}` is the documented form, but a config written with
    // `module.exports = {...}` lands as the module object itself.
    const value = (mod as { default?: unknown })?.default ?? mod;

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        log.error(
            `Error: ${path.relative(CWD_DIR, configPath)} must export a config object.\n` +
                `  Expected:  export default { port: 8080 } satisfies Skrapa.Config`
        );
        process.exit(1);
    }

    // An unknown key is nearly always a typo ("prot" for "port") that would
    // otherwise be dropped in silence and leave the default in place.
    const unknown = Object.keys(value).filter((key) => !CONFIG_KEYS.includes(key as ConfigKey));
    if (unknown.length > 0) {
        log.warn(
            `Warning: ${path.relative(CWD_DIR, configPath)} has unknown ` +
                `${unknown.length === 1 ? 'key' : 'keys'}: ${unknown.join(', ')}`
        );
    }

    return value as RawConfig;
}

/**
 * Turn a merged {@link RawConfig} into the {@link ResolvedConfig} every
 * command runs on. This is the single place a value is coerced or validated, so
 * the resolved type can be taken at face value downstream.
 */
function normalizeConfig(raw: Required<RawConfig>): ResolvedConfig {
    // Checked here rather than at listen() time so `--port abc` fails the same
    // way for every command, and so the resolved type can promise a number.
    const port = Number(raw.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        log.error(
            `\nError: "${raw.port}" is not a valid port. Pass --port <1-65535> (default 8080).\n`
        );
        process.exit(1);
    }

    // Both slashes matter: the leading one because <base href="repo/"> would
    // resolve relative to the current directory, the trailing one because
    // <base href="/repo"> drops the last segment when resolving against it.
    let base = String(raw.base);
    if (!base.startsWith('/')) base = `/${base}`;
    if (!base.endsWith('/')) base = `${base}/`;

    // A scheme-less origin is normalized rather than rejected: "dev.localhost"
    // is the easy thing to type, and a --origin flag bypasses the type that
    // would otherwise have required the scheme.
    const rawOrigin = String(raw.origin).trim().replace(/\/+$/, '');
    const origin = (
        !rawOrigin || /^[a-z][a-z0-9+.-]*:\/\//i.test(rawOrigin) ? rawOrigin : `http://${rawOrigin}`
    ) as Skrapa.Origin;

    // The only list-valued setting, so it is the only one that has to reconcile
    // two shapes: the config file gives an array, and a `--ignore "/a/*,/b/*"`
    // flag can only give one comma-separated string.
    const ignore = (Array.isArray(raw.ignore) ? raw.ignore : String(raw.ignore).split(','))
        .map((glob) => String(glob).trim())
        .filter(Boolean);

    return {
        input: String(raw.input),
        output: String(raw.output),
        assets: String(raw.assets),
        port,
        host: String(raw.host),
        origin,
        base: base as Skrapa.BasePath,
        ignore,
        // Absolute so require() and every derived path (input/output/assets/
        // WORKING_DIR) follow --root instead of the current directory.
        root: path.resolve(CWD_DIR, String(raw.root)),
    };
}

/**
 * Resolve the final config with precedence (lowest to highest): DEFAULT_CONFIG,
 * config file, CLI flags, `overrideConfig` (e.g. `dev` pinning the port), then
 * normalize it. Reads at most skrapa.config.ts; it never creates or validates
 * directories (that stays with the build).
 * @param overrideConfig
 */
export function loadConfig(overrideConfig?: Skrapa.Config): LoadedConfig {
    const flagConfig = parseFlags();

    // Look for the config file in the --root directory when provided, so
    // `--root template` reads template/skrapa.config.ts instead of the cwd's.
    const configRoot = path.resolve(
        CWD_DIR,
        overrideConfig?.root ?? flagConfig.root ?? DEFAULT_CONFIG.root
    );
    const configPath = path.resolve(configRoot, CONFIG_FILE);
    const fileExists = fs.existsSync(configPath);

    const fileConfig: RawConfig = fileExists ? readConfigFile(configPath) : {};

    const merged = {
        ...DEFAULT_CONFIG,
        ...stripUndefined(fileConfig),
        ...stripUndefined(flagConfig),
        ...stripUndefined(overrideConfig),
    } as Required<RawConfig>;

    return { config: normalizeConfig(merged), configPath, fileExists };
}

// An explicit `{ port: undefined | null }` in any layer would otherwise punch a hole
// through the layer below it and land as undefined in the merged object.
function stripUndefined<T extends object>(source: T | undefined): Partial<T> {
    if (!source) return {};
    return Object.fromEntries(
        Object.entries(source).filter(([, value]) => value !== undefined && value !== null)
    ) as Partial<T>;
}
