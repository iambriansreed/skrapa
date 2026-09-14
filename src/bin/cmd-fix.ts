/**
 * `skrapa fix` upgrades a project written against an older skrapa.
 *
 * Two migrations, both idempotent, so running it twice changes nothing the
 * second time and running it on an already-current project changes nothing at
 * all:
 *
 * - `skrapa.config.ts` (or the older `skrapa.config.json`) moves into the
 *   `skrapa` key of tsconfig.json, the only place this version reads settings
 *   from (see config.ts), and the old file is removed. `ignore` carries over
 *   as `linkCheckIgnore`; settings that no longer exist (`input`, `root`) are
 *   not, and `fix` says what each needs instead. When the pages lived in a
 *   subdirectory (`input`, `src/` by default), that directory becomes the
 *   skrapa root: it gets a copy of the template's tsconfig.json holding the old
 *   settings, and the `package.json` scripts that ran skrapa change into it.
 * - The global type names older versions declared (`Page`, `Props`, `Tag`, ...)
 *   become their `Skrapa.*` equivalents, since every user-facing type moved
 *   into the `Skrapa` namespace so nothing shipped in skrapa.d.ts can collide
 *   with a type of your own.
 *
 * The only command that runs beside an old config file, since removing it is
 * the point. The type renames walk the whole directory it runs in, minus what
 * is not source (see isSkippedPath).
 * @param overrideConfig - {@link Skrapa.Config}; `fix` reads `output` from it,
 *   as a directory to leave alone.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
    CONFIG_KEYS,
    CWD_DIR,
    DEFAULT_CONFIG,
    color,
    isSkippedPath,
    log,
    versionBanner,
} from './utils';
import {
    CONFIG_FILE,
    CONFIG_KEY,
    LEGACY_CONFIG_FILES,
    REMOVED_FLAGS,
    formatJson,
    insertSkrapaKey,
    isPlainObject,
    loadConfig,
    parseJsonc,
    validateConfigKey,
} from './config';
import { skrapaScript, TEMPLATE_SKRAPA_ROOT } from './cmd-init';

/**
 * Global type names older versions declared, mapped to their names inside the
 * `Skrapa` namespace. `CSSProperties` is the one that also changed name, not
 * just namespace.
 */
export const TYPE_RENAMES: Readonly<Record<string, string>> = {
    CSSProperties: 'Skrapa.CSSProps',
    Page: 'Skrapa.Page',
    Props: 'Skrapa.Props',
    PropsWithChildren: 'Skrapa.PropsWithChildren',
    Tag: 'Skrapa.Tag',
};

/** Settings older versions read under another name, mapped to the current one. */
export const RENAMED_KEYS: ReadonlyMap<string, ConfigKey> = new Map<string, ConfigKey>([
    ['ignore', 'linkCheckIgnore'],
]);

/**
 * Settings older versions read that no longer exist, and what replaced each:
 * the same settings, and explanations, as the flags config.ts rejects, less
 * the ones that carry over under a new name.
 */
export const REMOVED_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(REMOVED_FLAGS)
        .map(([flag, instead]) => [flag.replace(/^--/, ''), instead])
        .filter(([key]) => !RENAMED_KEYS.has(key))
);

/** The `input` older versions used when a config did not set one. */
const LEGACY_DEFAULT_INPUT = 'src';

/**
 * Read an old config file's settings. A `.ts` file is evaluated the way older
 * versions loaded it: required from its own directory, with Node stripping the
 * types.
 * @param file - absolute path of a skrapa.config.ts or skrapa.config.json
 * @returns the settings object
 * @throws {Error} if the file cannot be loaded or does not hold an object
 */
export function readLegacyConfig(file: string): Record<string, unknown> {
    let value: unknown;

    if (file.endsWith('.json')) {
        value = parseJsonc(fs.readFileSync(file, 'utf-8'));
    } else {
        const mod = createRequire(file)(file) as { default?: unknown } | undefined;
        // `export default {...}` is the documented form, but a config written
        // with `module.exports = {...}` lands as the module object itself.
        value = mod?.default ?? mod;
    }

    if (!isPlainObject(value)) throw new Error('expected a config object, e.g. { port: 8080 }');
    return value;
}

/**
 * Sort an old config's keys into what carries over into tsconfig.json and what
 * does not. Pure; key order is preserved within each group.
 * @param legacy - the settings an old config file held
 * @returns `carried`, the current settings under their current names;
 *   `removed`, settings that no longer exist; `unknown`, keys that were never
 *   settings
 */
export function splitLegacyConfig(legacy: Record<string, unknown>): {
    carried: Record<string, unknown>;
    removed: Record<string, unknown>;
    unknown: Record<string, unknown>;
} {
    const carried: Record<string, unknown> = {};
    const removed: Record<string, unknown> = {};
    const unknown: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(legacy)) {
        const renamed = RENAMED_KEYS.get(key);
        if (CONFIG_KEYS.includes(key as ConfigKey)) carried[key] = value;
        else if (renamed) carried[renamed] = value;
        else if (key in REMOVED_KEYS) removed[key] = value;
        else unknown[key] = value;
    }

    return { carried, removed, unknown };
}

/**
 * Walk a project tree for the TypeScript sources `fix` renames types in.
 *
 * Symlinked directories are not followed (`isDirectory()` is false for them),
 * which keeps a linked `node_modules` or a self-referential link from looping.
 * @param project - absolute directory to walk
 * @param skipDirs - absolute directories to leave out (the build output)
 * @returns TypeScript sources, absolute
 */
export function collectTargets(project: string, skipDirs: string[] = []): string[] {
    const sources: string[] = [];

    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const absolute = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (!isSkippedPath(project, absolute, skipDirs)) walk(absolute);
                continue;
            }
            if (!entry.isFile()) continue;

            // skrapa.d.ts is managed by skrapa: every build rewrites it from
            // the installed copy, so editing it here would be undone anyway.
            if (/\.tsx?$/.test(entry.name) && entry.name !== 'skrapa.d.ts') sources.push(absolute);
        }
    };

    walk(project);

    return sources;
}

/**
 * An old config's settings, rewritten for a tsconfig.json that moves into the
 * `input` dir the pages were in. Pure.
 *
 * Older versions resolved `output` and `assets` against the directory above
 * `input`. Now the dir holding tsconfig.json (the skrapa root) is `input`
 * itself, so both are rewritten to reach the same places from there, and
 * `projectRoot` points back up at where the tsconfig.json was.
 * @param carried - the current settings from the old config
 * @param input - posix path of the old `input`, relative to the old config
 * @returns the settings to write into the moved tsconfig.json
 */
export function rebaseSettings(
    carried: Record<string, unknown>,
    input: string
): Record<string, unknown> {
    const fromInput = (to: string) => path.posix.relative(input, to) || '.';
    const pathOf = (key: 'output' | 'assets') =>
        typeof carried[key] === 'string' ? (carried[key] as string) : DEFAULT_CONFIG[key];

    return {
        ...carried,
        output: fromInput(pathOf('output')),
        assets: fromInput(pathOf('assets')),
        projectRoot: fromInput('.'),
    };
}

/**
 * The tsconfig.json an old project's input dir gets: the template's, with the
 * old settings as its `skrapa` key and an `include` that reaches the
 * `skrapa.d.ts` every build writes to the project root. Pure.
 * @param template - the template's parsed tsconfig.json
 * @param settings - the old settings, rebased for the input dir (see
 *   rebaseSettings)
 * @param input - posix path of the old input dir, from the project root
 * @returns the tsconfig.json to write there
 */
export function migratedTsconfig(
    template: Record<string, unknown>,
    settings: Record<string, unknown>,
    input: string
): Record<string, unknown> {
    return {
        ...template,
        [CONFIG_KEY]: settings,
        include: ['**/*.ts', '**/*.tsx', path.posix.relative(input, 'skrapa.d.ts')],
    };
}

/**
 * Point the `package.json` scripts older versions of `init` wrote, which ran
 * skrapa from the project root, at the input dir skrapa runs from now. Only a
 * script that is exactly `npx skrapa dev` or `npx skrapa build` changes:
 * anything else was written by a person, for a reason of their own. Pure.
 * @param scripts - the scripts in package.json
 * @param input - posix path of the old input dir, from the project root
 * @returns the scripts, and the names of the ones changed
 */
export function migrateScripts(
    scripts: Record<string, string>,
    input: string
): { scripts: Record<string, string>; changed: string[] } {
    const changed: string[] = [];
    const next = Object.fromEntries(
        Object.entries(scripts).map(([name, script]) => {
            const command = /^npx skrapa (dev|build)$/.exec(String(script).trim())?.[1];
            if (!command) return [name, script];
            changed.push(name);
            return [name, skrapaScript(command, input)];
        })
    );
    return { scripts: next, changed };
}

function fail(message: string): never {
    log.error(`Error: ${message}`);
    process.exit(1);
}

/**
 * Move an old config file's settings into a tsconfig.json, remove the file,
 * and say what became of every setting that did not carry over.
 *
 * When the pages were in a subdirectory (`input`, `src` by default), that
 * directory becomes the skrapa root. It gets a copy of the template's
 * tsconfig.json holding the old settings, rebased to reach the same places
 * from there, and the `package.json` scripts that ran skrapa change into it.
 * Otherwise the settings go into the tsconfig.json beside the old config.
 * @param dir - absolute dir the old config sits in, which is the project root
 * @returns the skrapa root the settings went to, or null when there was no
 *   old config
 */
function migrateConfig(dir: string): string | null {
    const found = LEGACY_CONFIG_FILES.filter((name) => fs.existsSync(path.join(dir, name)));
    if (found.length === 0) return null;

    // Which of the two holds the values actually wanted is not ours to decide.
    if (found.length > 1) {
        fail(
            `both ${found.join(' and ')} exist. Delete the one you no longer use, then run fix again.`
        );
    }

    const [name] = found;
    const legacyPath = path.join(dir, name);

    let legacy: Record<string, unknown>;
    try {
        legacy = readLegacyConfig(legacyPath);
    } catch (err) {
        fail(`could not read ${name}: ${(err as Error).message}`);
    }

    const { carried, removed, unknown } = splitLegacyConfig(legacy);

    // Checked before anything is written: a value the old loader tolerated
    // would otherwise land in tsconfig.json and stop every command after this.
    const invalid = validateConfigKey(carried);
    if (invalid.length > 0) {
        fail(
            `${name} has values this version rejects. Fix them, then run fix again:\n  - ${invalid.join('\n  - ')}`
        );
    }

    // Pages used to live in `input` (default `src`), below the tsconfig.json.
    // Now the tsconfig.json sits with the pages, in the skrapa root.
    const input =
        typeof removed.input === 'string'
            ? path.posix.normalize(removed.input.split(path.sep).join('/'))
            : LEGACY_DEFAULT_INPUT;
    const moves = input !== '.' && fs.existsSync(path.join(dir, input));
    const skrapaRoot = moves ? path.join(dir, input) : dir;
    const settings = moves ? rebaseSettings(carried, input) : carried;
    const tsconfigPath = path.join(skrapaRoot, CONFIG_FILE);
    const tsconfigShown = path.relative(dir, tsconfigPath);

    // A .ts config could compute its values; what they came to right now is
    // what gets written, and tsconfig.json cannot compute anything.
    const readsEnv =
        name.endsWith('.ts') && /process\.env/.test(fs.readFileSync(legacyPath, 'utf-8'));

    if (moves && !fs.existsSync(tsconfigPath)) {
        const templateFile = path.join(__dirname, '../template', TEMPLATE_SKRAPA_ROOT, CONFIG_FILE);
        const template = parseJsonc(fs.readFileSync(templateFile, 'utf-8')) as Record<
            string,
            unknown
        >;
        fs.writeFileSync(
            tsconfigPath,
            `${formatJson(migratedTsconfig(template, settings, input))}\n`
        );
    } else {
        if (!fs.existsSync(tsconfigPath)) {
            fail(`${name} has nowhere to go: there is no ${CONFIG_FILE} beside it.`);
        }

        const text = fs.readFileSync(tsconfigPath, 'utf-8');
        let tsconfig: unknown;
        try {
            tsconfig = parseJsonc(text);
        } catch (err) {
            fail(`${tsconfigShown} could not be parsed: ${(err as Error).message}`);
        }

        // The key is required, so with nothing to carry over it is written as
        // `true`, unless it is already there.
        const empty = Object.keys(settings).length === 0;
        if (!(empty && isPlainObject(tsconfig) && CONFIG_KEY in tsconfig)) {
            let next: string;
            try {
                next = insertSkrapaKey(text, empty ? true : settings);
            } catch (err) {
                fail(
                    `${(err as Error).message}. Move these settings into ${tsconfigShown} by hand, ` +
                        `then delete ${name}:\n${JSON.stringify(settings, null, 4)}`
                );
            }
            fs.writeFileSync(tsconfigPath, next);
        }
    }

    fs.rmSync(legacyPath);
    log.success(`  ${name} -> "${CONFIG_KEY}" in ${tsconfigShown}`);

    for (const [from, to] of RENAMED_KEYS) {
        if (from in legacy) log.info(`    ${from} is ${to} now`);
    }

    for (const [key, value] of Object.entries(removed)) {
        // Not lost: the directory it named is the skrapa root now.
        if (key === 'input' && moves) continue;
        log.warn(`    dropped ${key} (${JSON.stringify(value)}): ${REMOVED_KEYS[key]}.`);
    }

    if (Object.keys(unknown).length > 0) {
        log.warn(
            `    dropped ${Object.keys(unknown).length === 1 ? 'a key' : 'keys'} skrapa never read: ` +
                JSON.stringify(unknown)
        );
    }

    if (readsEnv) {
        log.warn(
            `    ${name} read process.env. The values it produced just now were written as they are; ` +
                'pass a flag (e.g. --base "$BASE") for anything that changes per environment.'
        );
    }

    if (moves) {
        // Older versions of init wrote scripts that ran skrapa from here, and
        // skrapa runs from the input dir now.
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const raw = fs.readFileSync(pkgPath, 'utf-8');
            const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
            const { scripts, changed } = migrateScripts(pkg.scripts ?? {}, input);
            if (changed.length > 0) {
                const indent = raw.match(/^([ \t]+)/m)?.[1] ?? '    ';
                fs.writeFileSync(pkgPath, `${JSON.stringify({ ...pkg, scripts }, null, indent)}\n`);
                log.success(`  package.json: ${changed.join(', ')} now run skrapa from ${input}/`);
            }
        }

        if (fs.existsSync(path.join(dir, CONFIG_FILE))) {
            log.warn(
                `    ${CONFIG_FILE} here is no longer read by skrapa, which reads ${tsconfigShown} ` +
                    'now. Compiler options of your own in it were not carried over; delete it ' +
                    'unless something else uses it.'
            );
        }
    }

    return skrapaRoot;
}

/**
 *
 * @param overrideConfig
 */
export function fix(overrideConfig?: Skrapa.Config): void {
    console.log(versionBanner());

    const migratedTo = migrateConfig(CWD_DIR);
    let changed = migratedTo ? 1 : 0;

    // After the migration, from the skrapa root it wrote to, so the settings
    // just moved are the ones read, and like every other command, not acted on
    // if anything in them is wrong.
    const { config, skrapaRoot } = loadConfig(overrideConfig, migratedTo ?? CWD_DIR);

    const rel = (absolute: string) => path.relative(CWD_DIR, absolute) || path.basename(absolute);

    for (const file of collectTargets(skrapaRoot, [path.resolve(skrapaRoot, config.output)])) {
        const before = fs.readFileSync(file, 'utf-8');
        const { source, renames } = renameTypes(before);

        if (source === before) continue;

        fs.writeFileSync(file, source);
        changed++;
        const summary = Object.entries(renames)
            .map(([name, count]) => `${name} -> ${TYPE_RENAMES[name]} (${count})`)
            .join(', ');
        log.success(`  ${rel(file)}: ${summary}`);
    }

    if (changed === 0) {
        log.gray('\nNothing to fix; this project is already up to date.\n');
        return;
    }

    const fromHere = path.relative(CWD_DIR, skrapaRoot);
    const build = fromHere ? `cd ${fromHere} && npx skrapa build` : 'npx skrapa build';
    console.log(
        `\n${color.cyan}Fixed ${changed} file${changed === 1 ? '' : 's'}.${color.reset} ` +
            `Review with ${color.cyan}git diff${color.reset}, then run ` +
            `${color.cyan}${build}${color.reset}.\n`
    );
}

/**
 * Whether a file declares `name` as a type of its own, in which case that
 * declaration shadows the global one and must be left alone.
 *
 * Only *type* declarations count. A value named `Page` does not shadow the
 * type `Page`, which is exactly the common case: an old page reads
 * `export function Page(): Page`, where the function is the value and the
 * return annotation is the global type being renamed.
 * @param source - file contents
 * @param name - the old global type name
 * @returns true when the file declares or imports that name itself
 */
function declaresOwnType(source: string, name: string): boolean {
    return (
        new RegExp(String.raw`\b(?:type|interface|enum|class)\s+${name}\b`).test(source) ||
        new RegExp(String.raw`^import\b[^;]*\b${name}\b[^;]*\bfrom\b`, 'm').test(source)
    );
}

/**
 * Rewrite old global type names to their `Skrapa.*` equivalents. Pure; does not
 * touch the filesystem.
 *
 * Only type *positions* are rewritten, recognized by the token in front of the
 * name: `:` (annotations), `as`, and `satisfies`. That is what keeps the
 * function in `export function Page(): Page` intact while its return type
 * moves. An already-namespaced `: Skrapa.Page` never matches, since the name
 * after the colon is `Skrapa`, so this is safe to run repeatedly.
 * @param source - file contents
 * @returns the rewritten source, and how many times each name was renamed
 */
export function renameTypes(source: string): { source: string; renames: Record<string, number> } {
    const renames: Record<string, number> = {};
    let output = source;

    for (const [oldName, newName] of Object.entries(TYPE_RENAMES)) {
        if (declaresOwnType(source, oldName)) continue;

        let count = 0;

        output = output
            // Annotations: `x: Page`, `(): Page`. A name reached only through a
            // generic (`Promise<Page>`) is left alone, since `<` is JSX here.
            .replace(new RegExp(String.raw`:(\s*)${oldName}\b`, 'g'), (_match, space: string) => {
                count++;
                return `:${space}${newName}`;
            })
            // `x as Page`, `x satisfies Page`
            .replace(
                new RegExp(String.raw`\b(as|satisfies)(\s+)${oldName}\b`, 'g'),
                (_match, keyword: string, space: string) => {
                    count++;
                    return `${keyword}${space}${newName}`;
                }
            );

        if (count > 0) renames[oldName] = count;
    }

    return { source: output, renames };
}
