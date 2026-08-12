/**
 * `skrapa fix` upgrades a project written against an older skrapa.
 *
 * Two migrations, both idempotent, so running it twice changes nothing the
 * second time and running it on an already-current project changes nothing at
 * all:
 *
 * - `skrapa.config.json` becomes `skrapa.config.ts`, the only config file this
 *   version loads (see config.ts). The JSON object is re-emitted as
 *   `export default { ... } satisfies Skrapa.Config` and the `.json` removed.
 * - The global type names older versions declared (`Page`, `Props`, `Tag`, ...)
 *   become their `Skrapa.*` equivalents, since every user-facing type moved
 *   into the `Skrapa` namespace so nothing shipped in skrapa.d.ts can collide
 *   with a type of your own.
 *
 * Both run over the whole project tree rather than just the input dir, so a
 * repo holding more than one site (this one holds `template/`) is migrated in
 * a single pass.
 * @param overrideConfig - {@link Skrapa.Config}; `fix` uses the resolved `root`
 *   (honoring `--root`) as the tree to walk, and `output` as a directory to
 *   leave alone.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_KEYS, color, log, versionBanner } from './utils';
import { CONFIG_FILE, loadConfig } from './config';

/** The config file name this command migrates away from. */
export const LEGACY_CONFIG_FILE = 'skrapa.config.json';

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

/** Directories never walked, whatever the project layout. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.skrapa', '.tmp']);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Render a JSON value as the TypeScript literal to write into the config.
 *
 * Single-quoted to match the rest of a skrapa project, but only where that
 * cannot change the value: a string carrying a quote or a backslash keeps its
 * JSON form, which is already valid TypeScript.
 * @param value - a parsed JSON value
 * @returns the TypeScript source for it
 */
function literal(value: unknown): string {
    if (typeof value === 'string' && !/['\\]/.test(value)) return `'${value}'`;
    return JSON.stringify(value) ?? 'undefined';
}

/**
 * Convert the contents of a `skrapa.config.json` into a `skrapa.config.ts`
 * module. Pure; does not touch the filesystem.
 *
 * Key order is preserved, and an unrecognized key is reported rather than
 * dropped: silently deleting a value someone wrote is worse than the compile
 * error `satisfies` raises on it.
 * @param json - the raw contents of a skrapa.config.json
 * @returns the TypeScript source, and any keys that are not config keys
 * @throws {Error} if the JSON is malformed or is not an object
 */
export function configJsonToTs(json: string): { source: string; unknownKeys: string[] } {
    const parsed: unknown = JSON.parse(json);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('expected a JSON object, e.g. { "port": 8080 }');
    }

    const entries = Object.entries(parsed as Record<string, unknown>);
    const unknownKeys = entries
        .map(([key]) => key)
        .filter((key) => !CONFIG_KEYS.includes(key as ConfigKey));

    const body = entries
        .map(([key, value]) => `    ${IDENTIFIER.test(key) ? key : `'${key}'`}: ${literal(value)},`)
        .join('\n');

    const object = body ? `{\n${body}\n}` : '{}';

    return { source: `export default ${object} satisfies Skrapa.Config;\n`, unknownKeys };
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

/**
 * Walk a project tree for the files `fix` operates on.
 *
 * Symlinked directories are not followed (`isDirectory()` is false for them),
 * which keeps a linked `node_modules` or a self-referential link from looping.
 * @param root - absolute directory to walk
 * @param skipDirs - absolute directories to leave out (the build output)
 * @returns legacy config files and TypeScript sources, both absolute
 */
export function collectTargets(
    root: string,
    skipDirs: string[] = []
): { configs: string[]; sources: string[] } {
    const configs: string[] = [];
    const sources: string[] = [];
    const skip = new Set(skipDirs.map((dir) => path.resolve(dir)));

    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const absolute = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name) && !skip.has(absolute)) walk(absolute);
                continue;
            }
            if (!entry.isFile()) continue;

            if (entry.name === LEGACY_CONFIG_FILE) configs.push(absolute);
            // skrapa.d.ts is managed by skrapa: every command rewrites it from
            // the installed copy, so editing it here would be undone anyway.
            else if (/\.tsx?$/.test(entry.name) && entry.name !== 'skrapa.d.ts')
                sources.push(absolute);
        }
    };

    walk(root);

    return { configs, sources };
}

/**
 *
 * @param overrideConfig
 */
export function fix(overrideConfig?: Skrapa.Config): void {
    console.log(`\n${versionBanner()}`);

    // Same config precedence as the other commands (see config.ts). A project
    // still on skrapa.config.json has no file for this to read, which is fine:
    // only the resolved `root` and `output` are used, and both have defaults.
    const { config } = loadConfig(overrideConfig);

    const { configs, sources } = collectTargets(config.root, [
        path.resolve(config.root, config.output),
    ]);

    const rel = (absolute: string) =>
        path.relative(config.root, absolute) || path.basename(absolute);

    let changed = 0;

    for (const jsonPath of configs) {
        const tsPath = path.join(path.dirname(jsonPath), CONFIG_FILE);

        // Never clobber a config that has already been migrated. The .ts is the
        // one skrapa loads, so the .json is the stale copy, but which of the two
        // holds the values actually wanted is not ours to decide.
        if (fs.existsSync(tsPath)) {
            log.warn(`  skipped ${rel(jsonPath)}: ${rel(tsPath)} already exists. Delete one.`);
            continue;
        }

        let migrated: ReturnType<typeof configJsonToTs>;
        try {
            migrated = configJsonToTs(fs.readFileSync(jsonPath, 'utf-8'));
        } catch (err) {
            log.error(`  skipped ${rel(jsonPath)}: ${(err as Error).message}`);
            continue;
        }

        fs.writeFileSync(tsPath, migrated.source);
        fs.rmSync(jsonPath);
        changed++;
        log.success(`  ${rel(jsonPath)} -> ${rel(tsPath)}`);

        if (migrated.unknownKeys.length > 0) {
            const { unknownKeys } = migrated;
            const [one, many] = unknownKeys.length === 1 ? ['key', 'it'] : ['keys', 'them'];
            log.warn(
                `    kept unknown ${one}: ${unknownKeys.join(', ')}. Skrapa ignores ` +
                    `${many} and "satisfies" will flag ${many}, so delete ${many} once ` +
                    `you have checked nothing needs ${many}.`
            );
        }
    }

    for (const file of sources) {
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

    console.log(
        `\n${color.cyan}Fixed ${changed} file${changed === 1 ? '' : 's'}.${color.reset} ` +
            `Review with ${color.cyan}git diff${color.reset}, then run ` +
            `${color.cyan}npx skrapa build${color.reset}.\n`
    );
}
