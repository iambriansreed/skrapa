/**
 * Config
 *
 * Shared config loading for every command. Skrapa runs in the skrapa root, the
 * directory holding a tsconfig.json with a `skrapa` key: one file for the
 * compiler and the build alike, and every path in it resolves against that
 * directory. The key is required, as `true` (every default) or an object, so a
 * tsconfig.json written for something else is never built as a site.
 *
 * There are two roots. The skrapa root holds the pages, `.skrapa/` and, by
 * default, the output and assets dirs. The project root (`projectRoot`, the
 * skrapa root itself unless set) is where the files that belong to the project
 * as a whole live: `.github/`, `.gitignore`, `package.json`, `skrapa.d.ts`.
 * The template keeps its pages in `src/` with `"projectRoot": "../"`.
 *
 * `readConfig` merges, in increasing
 * precedence: DEFAULT_CONFIG, that key, CLI flags, and a caller
 * `overrideConfig`, then validates the result. `loadConfig` does the same but
 * stops the command when anything is wrong, so no command ever acts on a
 * config it could not fully understand.
 *
 * The two config types are deliberately different shapes. `Skrapa.Config` is
 * what a human writes: every field optional. `ResolvedConfig` is what commands
 * run on: nothing optional, `port` a validated number, `base` and `origin`
 * normalized. Everything between the two lives in `normalizeConfig` below, so
 * no command has to guess whether a value has been through it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_KEYS, CWD_DIR, DEFAULT_CONFIG, log } from './utils';

/** The one file skrapa reads settings from, in the directory it runs in. */
export const CONFIG_FILE = 'tsconfig.json';

/** The top-level key of {@link CONFIG_FILE} that holds the settings. */
export const CONFIG_KEY = 'skrapa';

/**
 * Config files older versions read. One of them in a project holds settings
 * that would otherwise be silently dropped, so every command but `fix` (which
 * migrates them) refuses to run beside one.
 */
export const LEGACY_CONFIG_FILES = ['skrapa.config.ts', 'skrapa.config.json'] as const;

/**
 * Flags for settings that no longer exist, and what took their place. Rejected
 * rather than ignored: `--root site` quietly building the current directory
 * instead is exactly the surprise a hard error saves.
 */
export const REMOVED_FLAGS: Readonly<Record<string, string>> = {
    '--root':
        'run skrapa from the directory that holds tsconfig.json, and set "projectRoot" for where .github and .gitignore live',
    '--input': 'pages live in the directory that holds tsconfig.json',
    '--ignore': 'use --linkCheckIgnore instead',
};

/**
 * Whether the argument after the flag at `index` is that flag's value. Not
 * when nothing follows it, and not when what follows is another flag:
 * `--base --output public` is a `--base` left unfinished, not a base of
 * `--output`.
 */
function hasValue(args: string[], index: number): boolean {
    return index + 1 < args.length && !args[index + 1].startsWith('--');
}

// Parse `--key value` pairs for every known config key out of argv (positional
// args like the page name or `pretty`/`skip-assets` markers are ignored). A
// flag with no value is left out here, and reported by readConfig.
export function parseFlags(): Partial<Record<ConfigKey, string>> {
    const args = process.argv.slice(3);
    const flags: Partial<Record<ConfigKey, string>> = {};

    CONFIG_KEYS.forEach((key) => {
        const index = args.indexOf(`--${key}`);
        if (index > -1 && hasValue(args, index)) flags[key] = args[index + 1];
    });

    return flags;
}

/**
 * The config flags on the command line that were given no value. A problem
 * rather than something to skip: `npm run build -- --base` would otherwise
 * build for `/` without a word, and the site's links would 404 once deployed
 * under the subpath.
 */
export function flagsWithoutValue(): string[] {
    const args = process.argv.slice(3);
    return CONFIG_KEYS.map((key) => `--${key}`).filter((flag) => {
        const index = args.indexOf(flag);
        return index > -1 && !hasValue(args, index);
    });
}

// Positional args (after the command), with `--key value` config-flag pairs and
// any other `-flag` removed. Lets a command take positionals (e.g. the page
// name and parent) that coexist with the shared config flags in any order.
// A removed flag still takes its value with it, so `page About --input app`
// is reported as a removed flag rather than read as a page nested under `app`.
export function positionalArgs(): string[] {
    const args = process.argv.slice(3);
    const valueFlags = new Set([
        ...CONFIG_KEYS.map((key) => `--${key}`),
        ...Object.keys(REMOVED_FLAGS),
    ]);
    const positionals: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (valueFlags.has(arg)) {
            if (hasValue(args, i)) i++; // skip the flag's value too
            continue;
        }
        if (arg.startsWith('-')) continue; // boolean flag, e.g. --no-dev, -f
        positionals.push(arg);
    }

    return positionals;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Blank out the comments and trailing commas that tsconfig.json allows and
 * JSON does not, leaving everything else where it was.
 *
 * Every removed character becomes a space (newlines are kept), so the result
 * is exactly as long as the input: a `JSON.parse` error still points at the
 * right line, and an offset found in the result is the same offset in the
 * original, which is how `fix` edits the file without disturbing its comments.
 * @param text - the contents of a tsconfig.json
 */
export function stripJsonc(text: string): string {
    const blank = (s: string) => s.replace(/[^\n]/g, ' ');

    // The index of the first character at or after `from` that is neither
    // whitespace nor inside a comment.
    const nextSignificant = (from: number): number => {
        let i = from;
        while (i < text.length) {
            if (/\s/.test(text[i])) i++;
            else if (text.startsWith('//', i)) {
                const end = text.indexOf('\n', i);
                i = end === -1 ? text.length : end;
            } else if (text.startsWith('/*', i)) {
                const end = text.indexOf('*/', i + 2);
                i = end === -1 ? text.length : end + 2;
            } else break;
        }
        return i;
    };

    let out = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '"') {
            // Copied whole, so a `//` or `,}` inside a string is left alone.
            let end = i + 1;
            while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
            out += text.slice(i, end + 1);
            i = end + 1;
        } else if (text.startsWith('//', i) || text.startsWith('/*', i)) {
            const end = nextSignificant(i);
            out += blank(text.slice(i, end));
            i = end;
        } else if (ch === ',' && ['}', ']'].includes(text[nextSignificant(i + 1)])) {
            out += ' ';
            i++;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

/**
 * Parse a tsconfig.json, comments and trailing commas included. Zero
 * dependencies on purpose: requiring the project's own `typescript` would tie
 * reading a config to where that package happens to be installed.
 * @param text - the contents of a tsconfig.json
 * @throws {SyntaxError} if it is not valid JSON once comments are removed
 */
export function parseJsonc(text: string): unknown {
    return JSON.parse(stripJsonc(text));
}

/**
 * JSON the way Prettier writes a tsconfig.json: four-space indents, and an
 * array of plain values on one line whenever that line fits in 100 columns.
 * `JSON.stringify` puts every array item on a line of its own, so a
 * tsconfig.json `init` wrote would otherwise fail a project's own formatting
 * check the moment it was scaffolded.
 * @param value - a JSON-serializable value
 * @returns the text, with no trailing newline
 */
export function formatJson(value: unknown): string {
    const text = JSON.stringify(value, null, 4);

    // An array holding no array or object, spread over lines: `[`, its items
    // each on a line ending `,`, then `]`.
    return text.replace(/\[\n([^[\]{}]*?)\n[ \t]*\]/g, (whole, items: string, offset: number) => {
        const inline = `[${items
            .split(',\n')
            .map((item) => item.trim())
            .join(', ')}]`;
        const column = offset - (text.lastIndexOf('\n', offset) + 1);
        // The comma after it, when a sibling follows, is on the line too.
        const comma = text[offset + whole.length] === ',' ? 1 : 0;
        return column + inline.length + comma <= 100 ? inline : whole;
    });
}

/**
 * Add a `skrapa` key holding `values` to the contents of a tsconfig.json, as
 * the first key of its top-level object. Pure. Used by `fix`, and by `init`
 * for a tsconfig.json it keeps.
 *
 * Inserted as text rather than by parsing and re-serializing the file, which
 * would throw away every comment in it and reformat the rest.
 * @param tsconfig - the contents of a tsconfig.json
 * @param values - the settings to write, or `true` for every default
 * @returns the new contents
 * @throws {Error} if the file is not a JSON object or already has the key
 */
export function insertSkrapaKey(tsconfig: string, values: Record<string, unknown> | true): string {
    const parsed = parseJsonc(tsconfig);
    if (!isPlainObject(parsed)) throw new Error(`${CONFIG_FILE} must contain a JSON object`);
    if (CONFIG_KEY in parsed) throw new Error(`${CONFIG_FILE} already has a "${CONFIG_KEY}" key`);

    // stripJsonc blanks comments to spaces without moving anything, so the
    // first `{` it leaves is the object's opening brace, at the same offset in
    // the original text.
    const stripped = stripJsonc(tsconfig);
    const open = stripped.indexOf('{');
    const indent = /^([ \t]+)"/m.exec(tsconfig)?.[1] ?? '    ';
    const value = JSON.stringify(values, null, indent).replace(/\n/g, `\n${indent}`);
    const isEmpty = stripped
        .slice(open + 1)
        .trimStart()
        .startsWith('}');

    return (
        tsconfig.slice(0, open + 1) +
        `\n${indent}"${CONFIG_KEY}": ${value}${isEmpty ? '\n' : ','}` +
        tsconfig.slice(open + 1)
    );
}

/**
 * Read the `skrapa` key out of a tsconfig.json, adding whatever is wrong with it
 * to `problems`.
 * @returns the key's value, or undefined when there is no usable one
 */
function readConfigKey(
    tsconfigPath: string,
    problems: string[]
): Record<string, unknown> | undefined {
    const shown = path.relative(CWD_DIR, tsconfigPath);

    if (!fs.existsSync(tsconfigPath)) {
        problems.push(
            `No ${CONFIG_FILE} at ${shown}. Run skrapa from the directory that holds it, ` +
                'or `npx skrapa init` to scaffold a project.'
        );
        return undefined;
    }

    let tsconfig: unknown;
    try {
        tsconfig = parseJsonc(fs.readFileSync(tsconfigPath, 'utf-8'));
    } catch (err) {
        problems.push(`${shown} could not be parsed: ${(err as Error).message}`);
        return undefined;
    }

    if (!isPlainObject(tsconfig)) {
        problems.push(`${shown} must contain a JSON object.`);
        return undefined;
    }

    const value = tsconfig[CONFIG_KEY];

    // Required: a tsconfig.json without it was written for something else, and
    // building it as a site with every default would be a guess.
    if (value === true) return {};
    if (value === undefined) {
        problems.push(
            `${shown} has no "${CONFIG_KEY}" key. Add "${CONFIG_KEY}": true for the defaults, ` +
                'or an object of settings.'
        );
        return undefined;
    }

    if (!isPlainObject(value)) {
        problems.push(
            `"${CONFIG_KEY}" in ${shown} must be true or an object, e.g. "${CONFIG_KEY}": { "port": 8080 }.`
        );
        return undefined;
    }

    const unknown = unknownKeysProblem(value);
    if (unknown) problems.push(`"${CONFIG_KEY}" in ${shown} has ${unknown}`);

    return value;
}

// An unknown key is nearly always a typo ("prot" for "port") or a setting that
// has since been removed, and either way its value is not doing what its
// author thinks it is.
function unknownKeysProblem(value: Record<string, unknown>): string | undefined {
    const unknown = Object.keys(value).filter((key) => !CONFIG_KEYS.includes(key as ConfigKey));
    if (unknown.length === 0) return undefined;
    return (
        `unknown ${unknown.length === 1 ? 'key' : 'keys'}: ${unknown.join(', ')}. ` +
        `Known keys: ${CONFIG_KEYS.join(', ')}.`
    );
}

/**
 * Everything wrong with a `skrapa` key's value taken on its own, without flags
 * or overrides: what `fix` checks before writing one into a tsconfig.json.
 * @param value - the value of a `skrapa` key
 * @returns every problem, or an empty list
 */
export function validateConfigKey(value: unknown): string[] {
    if (value === true) return [];
    if (!isPlainObject(value)) return [`"${CONFIG_KEY}" must be true or an object.`];
    const unknown = unknownKeysProblem(value);
    const { problems } = normalizeConfig({ ...DEFAULT_CONFIG, ...value } as Record<
        ConfigKey,
        unknown
    >);
    return unknown ? [`"${CONFIG_KEY}" has ${unknown}`, ...problems] : problems;
}

/**
 * Turn a merged config into the {@link ResolvedConfig} every command runs on.
 * This is the single place a value is coerced or validated, so the resolved
 * type can be taken at face value downstream.
 */
function normalizeConfig(raw: Record<ConfigKey, unknown>): {
    config: ResolvedConfig;
    problems: string[];
} {
    const problems: string[] = [];

    // An empty path would resolve to the skrapa root itself, and an empty host
    // binds nowhere in particular; neither is something anyone means.
    const text = (key: ConfigKey, allowEmpty = false): string => {
        const value = raw[key];
        if (typeof value === 'string' && (allowEmpty || value.trim() !== '')) return value;
        problems.push(
            `"${key}" must be ${allowEmpty ? 'a string' : 'a non-empty string'}, got ${JSON.stringify(value)}.`
        );
        return String(DEFAULT_CONFIG[key]);
    };

    // A number from tsconfig.json, or the numeric string a `--port` flag always
    // arrives as. Anything else (`true`, `[8080]`, `"80abc"`) would otherwise
    // pass through Number() as something it is not.
    const port =
        typeof raw.port === 'number'
            ? raw.port
            : typeof raw.port === 'string' && /^\s*\d+\s*$/.test(raw.port)
              ? Number(raw.port)
              : NaN;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        problems.push(
            `"port" must be an integer from 1 to 65535, got ${JSON.stringify(raw.port)}.`
        );
    }

    // Both slashes matter: the leading one because <base href="repo/"> would
    // resolve relative to the current directory, the trailing one because
    // <base href="/repo"> drops the last segment when resolving against it.
    let base = text('base', true);
    if (!base.startsWith('/')) base = `/${base}`;
    if (!base.endsWith('/')) base = `${base}/`;

    // A scheme-less origin is normalized rather than rejected: "dev.localhost"
    // is the easy thing to type, and a --origin flag bypasses the type that
    // would otherwise have required the scheme.
    const rawOrigin = text('origin', true).trim().replace(/\/+$/, '');
    const origin = (
        !rawOrigin || /^[a-z][a-z0-9+.-]*:\/\//i.test(rawOrigin) ? rawOrigin : `http://${rawOrigin}`
    ) as Skrapa.Origin;

    // The one list. tsconfig.json gives an array and a flag a comma-separated
    // string, and either way a pattern is a path from the site root: one
    // without the leading slash would never match anything.
    const listed =
        typeof raw.linkCheckIgnore === 'string'
            ? raw.linkCheckIgnore.split(',')
            : raw.linkCheckIgnore;
    const linkCheckIgnore = isStringList(listed)
        ? listed.map((pattern) => pattern.trim()).filter(Boolean)
        : [];
    if (!isStringList(listed)) {
        problems.push(
            `"linkCheckIgnore" must be a list of URL paths, e.g. ["/api/**"], got ${JSON.stringify(raw.linkCheckIgnore)}.`
        );
    }
    for (const pattern of linkCheckIgnore.filter((pattern) => !pattern.startsWith('/'))) {
        problems.push(
            `"linkCheckIgnore" patterns must start with "/", a path from the site root, got ${JSON.stringify(pattern)}.`
        );
    }

    // tsconfig.json has to sit at one of the two roots, so at most one of them
    // can point somewhere else.
    const away = (key: 'source' | 'projectRoot') =>
        typeof raw[key] === 'string' && path.posix.normalize(raw[key] as string) !== '.';
    if (away('source') && away('projectRoot')) {
        problems.push(
            '"source" and "projectRoot" cannot both be set: tsconfig.json has to sit in the source dir or in the project root. Set one of them, or move tsconfig.json.'
        );
    }

    return {
        config: {
            output: text('output'),
            assets: text('assets'),
            port,
            host: text('host'),
            origin,
            base: base as Skrapa.BasePath,
            linkCheckIgnore,
            projectRoot: text('projectRoot'),
            source: text('source'),
        },
        problems,
    };
}

export type ReadConfig = {
    /** The resolved config, present only when `problems` is empty. */
    config?: ResolvedConfig;
    /** Everything wrong, in one list, so it can all be fixed in one pass. */
    problems: string[];
    /** Absolute skrapa root: where tsconfig.json was read from. */
    skrapaRoot: string;
};

/**
 * Resolve the config for the skrapa root `skrapaRoot` with precedence (lowest
 * to highest): DEFAULT_CONFIG, tsconfig.json's `skrapa` key, CLI flags,
 * `overrideConfig` (e.g. `dev` pinning the port), then validate it. Never
 * exits and never writes, so every problem is collected rather than the first
 * one ending the run.
 * @param skrapaRoot - the dir holding tsconfig.json; the cwd unless a test says otherwise
 * @param overrideConfig - applied over everything else
 */
export function readConfig(
    skrapaRoot: string = CWD_DIR,
    overrideConfig?: Skrapa.Config
): ReadConfig {
    const problems: string[] = [];

    // `fix` is the one command that runs beside one of these, and it deletes
    // the file before it loads the config.
    for (const name of LEGACY_CONFIG_FILES) {
        if (fs.existsSync(path.join(skrapaRoot, name))) {
            problems.push(
                `${name} is no longer read: settings live under "${CONFIG_KEY}" in ` +
                    `${CONFIG_FILE} now. Run \`npx skrapa fix\` to move them.`
            );
        }
    }

    const args = process.argv.slice(3);
    for (const [flag, instead] of Object.entries(REMOVED_FLAGS)) {
        if (args.includes(flag)) problems.push(`${flag} has been removed: ${instead}.`);
    }
    for (const flag of flagsWithoutValue()) {
        problems.push(`${flag} needs a value: pass ${flag} <value>, or leave the flag out.`);
    }

    const fileConfig = readConfigKey(path.join(skrapaRoot, CONFIG_FILE), problems);

    // The file layer is merged as written: JSON has no undefined, and a
    // `"port": null` there is a mistake to report, not a hole to fill.
    const merged = {
        ...DEFAULT_CONFIG,
        ...fileConfig,
        ...stripUndefined(parseFlags()),
        ...stripUndefined(overrideConfig),
    } as Record<ConfigKey, unknown>;

    const { config, problems: invalid } = normalizeConfig(merged);
    problems.push(...invalid);

    return {
        config: problems.length === 0 ? config : undefined,
        problems,
        skrapaRoot,
    };
}

export type LoadedConfig = {
    config: ResolvedConfig;
    /** Absolute skrapa root: where tsconfig.json was read from. */
    skrapaRoot: string;
};

/**
 * {@link readConfig}, for a command about to act on the result: any problem
 * is printed, every one of them, and the process exits before the command
 * touches anything.
 * @param overrideConfig - applied over everything else
 * @param skrapaRoot - the dir holding tsconfig.json; the cwd unless a test says otherwise
 */
export function loadConfig(overrideConfig?: Skrapa.Config, skrapaRoot = CWD_DIR): LoadedConfig {
    const { config, problems } = readConfig(skrapaRoot, overrideConfig);

    if (!config) {
        log.error(
            `\nError: fix ${problems.length === 1 ? 'this' : 'these'} before skrapa can run:`
        );
        for (const problem of problems) log.error(`  - ${problem}`);
        console.error('');
        process.exit(1);
    }

    return { config, skrapaRoot };
}

// An explicit `{ port: undefined | null }` in any layer would otherwise punch a hole
// through the layer below it and land as undefined in the merged object.
function stripUndefined<T extends object>(source: T | undefined): Partial<T> {
    if (!source) return {};
    return Object.fromEntries(
        Object.entries(source).filter(([, value]) => value !== undefined && value !== null)
    ) as Partial<T>;
}
