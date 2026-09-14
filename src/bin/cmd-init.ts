/**
 * `skrapa init` scaffolds a Skrapa site (the default command).
 *
 * Two roots are involved (see config.ts): the skrapa root, which holds
 * tsconfig.json and the pages, and the project root, where `.github/`,
 * `.gitignore`, `package.json` and `skrapa.d.ts` live. So init first asks
 * whether this is a new project:
 *
 * - A new project gets the whole template, as it is, in the current directory,
 *   which becomes the project root. The pages and tsconfig.json are in `src/`
 *   (the skrapa root, whose `projectRoot` is `"../"`), with `assets/`,
 *   `README.md`, `skrapa.d.ts` and the GitHub Pages workflow beside it.
 * - An existing project already has a project root, so init asks where it is,
 *   and the current directory becomes the skrapa root. The site's own files go
 *   here (the template's pages, tsconfig.json and assets, and the build writes
 *   `dist/` here too), so nothing lands on top of what the project already has.
 *   Only what has to be at the project root goes there: `skrapa.d.ts`, the
 *   workflow, and `skrapa:dev`/`skrapa:build` scripts, named so as not to
 *   collide with the project's own `dev` and `build`.
 *
 * Either way it then makes the project root's `.gitignore` ignore `.skrapa`,
 * `node_modules` and the output dir, adds the scripts and a Node engines field
 * to `package.json` (creating it if absent), installs `typescript` when the
 * project does not have it, and starts the dev server unless `--no-dev` is
 * passed.
 *
 * CLI flags (the first two answer the questions up front; with no terminal to
 * ask in and neither flag, a new project is assumed):
 * - `--new`                scaffold a new project here
 * - `--projectRoot <dir>`  add a site here to the existing project at <dir>
 * - `-f`, `--force`        overwrite existing files with the scaffolded versions
 * - `--no-dev`             skip starting the dev server after scaffolding
 */

import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { color, CWD_DIR, exe, log, versionBanner } from './utils';
import {
    CONFIG_FILE,
    CONFIG_KEY,
    LEGACY_CONFIG_FILES,
    flagsWithoutValue,
    formatJson,
    insertSkrapaKey,
    isPlainObject,
    parseFlags,
    parseJsonc,
    readConfig,
} from './config';

/**
 * The template's skrapa root (the directory holding its tsconfig.json),
 * relative to the project root it is copied into.
 */
export const TEMPLATE_SKRAPA_ROOT = 'src';

/** The GitHub Pages workflow, relative to the project root and to the template. */
export const WORKFLOW_FILE = path.join('.github', 'workflows', 'skrapa-pages.yml');

/**
 * The npm scripts an existing project gets, named so they cannot collide with
 * a `dev` or `build` of its own. The workflow runs the build one.
 */
export const EXISTING_PROJECT_SCRIPTS = { dev: 'skrapa:dev', build: 'skrapa:build' } as const;

/** A path from one directory to another, posix-separated, `.` for the same one. */
const posixRelative = (from: string, to: string) =>
    path.relative(from, to).split(path.sep).join('/') || '.';

/**
 * The entries a `.gitignore` does not already cover. Pure.
 *
 * Compared the way git reads them: a leading or trailing slash does not change
 * which path a line names, and a line with no slash in it matches at any
 * depth, so an existing `.skrapa` already covers `src/.skrapa`. An anchored
 * `/dist` does not cover `src/dist`.
 * @param content - the current `.gitignore`, `''` when there is none
 * @param entries - the lines that should be in it
 */
export function gitignoreAdditions(content: string, entries: readonly string[]): string[] {
    const bare = (line: string) => line.replace(/^\/+|\/+$/g, '');
    const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));

    const covers = (line: string, entry: string) =>
        bare(line) === entry ||
        (!line.replace(/\/+$/, '').includes('/') && bare(line) === path.posix.basename(entry));

    return entries.filter((entry) => !lines.some((line) => covers(line, bare(entry))));
}

/**
 * The npm script for a skrapa command. Skrapa only reads the tsconfig.json in
 * the directory it runs in, and package.json sits in the project root, so a
 * skrapa root below it has to be changed into first. Pure.
 * @param command - `dev`, `build`, ...
 * @param skrapaRoot - posix path of the skrapa root, relative to package.json
 */
export function skrapaScript(command: string, skrapaRoot: string): string {
    if (skrapaRoot === '' || skrapaRoot === '.') return `npx skrapa ${command}`;
    const dir = /^[\w./-]+$/.test(skrapaRoot) ? skrapaRoot : JSON.stringify(skrapaRoot);
    return `cd ${dir} && npx skrapa ${command}`;
}

/**
 * The project root to suggest for a site being added to an existing project:
 * the nearest directory at or above the skrapa root holding a `package.json`
 * or `.git`, as a path from the skrapa root. `.` when there is none.
 * @param skrapaRoot - absolute skrapa root
 */
export function suggestProjectRoot(skrapaRoot: string): string {
    for (let dir = skrapaRoot; ; dir = path.dirname(dir)) {
        if (['package.json', '.git'].some((name) => fs.existsSync(path.join(dir, name)))) {
            return posixRelative(skrapaRoot, dir);
        }
        if (path.dirname(dir) === dir) return '.';
    }
}

/**
 * What is wrong with a project root given for an existing project, if
 * anything. It has to be a directory, and the skrapa root has to be inside it:
 * the scripts `cd` down into the site, and the `.gitignore` entries name paths
 * below the project root.
 * @param skrapaRoot - absolute skrapa root
 * @param projectRoot - the project root as given, relative to the skrapa root
 */
export function projectRootProblem(skrapaRoot: string, projectRoot: string): string | undefined {
    const dir = path.resolve(skrapaRoot, projectRoot);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return `${projectRoot} is not a directory.`;
    }
    const down = path.relative(dir, skrapaRoot);
    if (down === '..' || down.startsWith(`..${path.sep}`) || path.isAbsolute(down)) {
        return `${projectRoot} is not this directory or one above it, so it cannot be its project root.`;
    }
    return undefined;
}

/**
 * The template's tsconfig.json, set up for a site added to an existing
 * project: the skrapa root is where init ran, so the output and assets dirs
 * are there too, and `projectRoot` and `include` reach back up. Pure.
 * @param template - the template's parsed tsconfig.json
 * @param projectRoot - posix path of the project root, from the skrapa root
 */
export function existingProjectTsconfig(
    template: Record<string, unknown>,
    projectRoot: string
): Record<string, unknown> {
    const settings = isPlainObject(template[CONFIG_KEY]) ? template[CONFIG_KEY] : {};
    const types = path.posix.join(projectRoot, 'skrapa.d.ts');

    return {
        ...template,
        [CONFIG_KEY]: { ...settings, output: 'dist', assets: 'assets', projectRoot },
        include: ['**/*.ts', '**/*.tsx', ...(projectRoot === '.' ? [] : [types])],
    };
}

/**
 * The template's workflow, set up for a site added to an existing project: it
 * builds with the site's own script and uploads the site's output dir. Pure.
 * @param template - the contents of the template's workflow
 * @param skrapaRoot - posix path of the skrapa root, from the project root
 * @throws {Error} if the template no longer has what is replaced, which would
 *   otherwise ship a workflow that builds and uploads the wrong thing
 */
export function existingProjectWorkflow(template: string, skrapaRoot: string): string {
    const replace = (text: string, from: string, to: string) => {
        if (!text.includes(from)) {
            throw new Error(`the template's ${WORKFLOW_FILE} no longer has ${from}`);
        }
        return text.replace(from, to);
    };
    const output = (skrapaRoot === '.' ? './dist' : `./${skrapaRoot}/dist`).replace(/'/g, "''");

    return replace(
        replace(template, 'npm run build', `npm run ${EXISTING_PROJECT_SCRIPTS.build}`),
        "path: './dist'",
        `path: '${output}'`
    );
}

async function ask(question: string): Promise<string> {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        return (await prompt.question(question)).trim();
    } finally {
        prompt.close();
    }
}

/**
 * The project root of the existing project to add a site to, or `null` for a
 * new project. From `--new` or `--projectRoot`, else by asking.
 */
async function chooseProjectRoot(): Promise<string | null> {
    const flag = parseFlags().projectRoot;
    const isNew = process.argv.includes('--new');

    // parseFlags leaves out a flag with no value, which would otherwise ask the
    // very question the flag was passed to answer, or scaffold a new project.
    if (flagsWithoutValue().includes('--projectRoot')) {
        log.error('Error: --projectRoot needs a value: the root of the existing project.');
        process.exit(1);
    }

    if (isNew && flag !== undefined) {
        log.error('Error: pass --new or --projectRoot, not both.');
        process.exit(1);
    }
    if (isNew) return null;

    if (flag !== undefined) {
        const problem = projectRootProblem(CWD_DIR, flag);
        if (problem) {
            log.error(`Error: ${problem}`);
            process.exit(1);
        }
        return flag;
    }

    // Nobody to ask (a script, CI): a new project, which is what init has
    // always scaffolded.
    if (!process.stdin.isTTY) return null;

    const question = (text: string, hint: string) =>
        `${color.cyan}?${color.reset} ${text} ${color.gray}(${hint})${color.reset} `;

    const answer = await ask(
        question('Is this a new project? The whole template is scaffolded here.', 'Y/n')
    );
    if (!/^n/i.test(answer)) return null;

    const suggested = suggestProjectRoot(CWD_DIR);
    for (;;) {
        const given =
            (await ask(
                question(
                    'Project root, where package.json, .gitignore and .github live, relative to here:',
                    suggested
                )
            )) || suggested;
        const problem = projectRootProblem(CWD_DIR, given);
        if (!problem) return given;
        log.error(problem);
    }
}

/** Where a scaffolded site's pieces ended up, all absolute. */
type Layout = {
    skrapaRoot: string;
    projectRoot: string;
    /** The output dir, or `null` when the tsconfig.json could not be read for it. */
    output: string | null;
    scripts: { dev: string; build: string };
};

function readTemplateTsconfig(templateDir: string): Record<string, unknown> {
    const file = path.join(templateDir, TEMPLATE_SKRAPA_ROOT, CONFIG_FILE);
    return parseJsonc(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

/**
 * Leave a tsconfig.json that was already there as it is, except for giving it
 * a skrapa key when it has none (no command runs without one), and say what
 * else the pages need from it.
 */
function keepTsconfig(tsconfigPath: string, settings: unknown): void {
    const shown = path.relative(CWD_DIR, tsconfigPath);
    const text = fs.readFileSync(tsconfigPath, 'utf-8');

    try {
        const parsed = parseJsonc(text);
        if (isPlainObject(parsed) && !(CONFIG_KEY in parsed)) {
            const value = isPlainObject(settings) ? settings : true;
            fs.writeFileSync(tsconfigPath, insertSkrapaKey(text, value));
            log.success(`Added a "${CONFIG_KEY}" key to the existing ${shown}`);
        }
    } catch {
        // Not parseable. The first command reports that, with the reason.
    }

    log.warn(
        `Kept the existing ${shown}. Pages need "jsx": "react" with "jsxFactory": "jsx" and ` +
            '"jsxFragmentFactory": "Fragment", "module": "commonjs", and an "include" covering ' +
            '**/*.ts, **/*.tsx and skrapa.d.ts. Compare it with the one in the skrapa template.'
    );
}

function writeUnlessPresent(file: string, content: string, force: boolean): void {
    if (fs.existsSync(file) && !force) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    log.success(`Added ${path.relative(CWD_DIR, file)}`);
}

/** The whole template, as it is, into the current directory. */
function scaffoldNew(templateDir: string, force: boolean): Layout {
    const skrapaRoot = path.join(CWD_DIR, TEMPLATE_SKRAPA_ROOT);
    const tsconfigPath = path.join(skrapaRoot, CONFIG_FILE);
    const hadTsconfig = fs.existsSync(tsconfigPath);

    // Copy the whole template, dotfiles (e.g. .github/workflows/skrapa-pages.yml)
    // included. `force` mirrors the documented -f flag: off, existing files
    // are left alone; on, they are overwritten. Done in Node rather than via
    // `cp` so a project path containing spaces works.
    fs.cpSync(templateDir, CWD_DIR, { recursive: true, force });

    if (hadTsconfig && !force) {
        keepTsconfig(tsconfigPath, readTemplateTsconfig(templateDir)[CONFIG_KEY]);
    }

    // Read back from the tsconfig.json just scaffolded (or kept), so the
    // project root and output dir come from the one place every later command
    // reads them. One with a problem in it leaves the project root where init
    // ran; the first build reports the problem.
    const config = readConfig(skrapaRoot).config;

    return {
        skrapaRoot,
        projectRoot: config ? path.resolve(skrapaRoot, config.projectRoot) : CWD_DIR,
        output: config ? path.resolve(skrapaRoot, config.output) : null,
        scripts: { dev: 'dev', build: 'build' },
    };
}

/** A site in the current directory, added to the project at `projectRoot`. */
function scaffoldExisting(templateDir: string, projectRoot: string, force: boolean): Layout {
    const skrapaRoot = CWD_DIR;
    const root = path.resolve(skrapaRoot, projectRoot);
    const templateSrc = path.join(templateDir, TEMPLATE_SKRAPA_ROOT);
    const tsconfigPath = path.join(skrapaRoot, CONFIG_FILE);
    const hadTsconfig = fs.existsSync(tsconfigPath);
    const tsconfig = existingProjectTsconfig(
        readTemplateTsconfig(templateDir),
        posixRelative(skrapaRoot, root)
    );

    // The site's own files, all here in the skrapa root. The tsconfig.json is
    // written below rather than copied, since its paths depend on the answer.
    fs.cpSync(templateSrc, skrapaRoot, {
        recursive: true,
        force,
        filter: (source) => source !== path.join(templateSrc, CONFIG_FILE),
    });
    fs.cpSync(path.join(templateDir, 'assets'), path.join(skrapaRoot, 'assets'), {
        recursive: true,
        force,
    });

    if (hadTsconfig && !force) keepTsconfig(tsconfigPath, tsconfig[CONFIG_KEY]);
    else fs.writeFileSync(tsconfigPath, `${formatJson(tsconfig)}\n`);

    // Only what has to be at the project root goes there.
    const types = fs.readFileSync(path.join(templateDir, 'skrapa.d.ts'), 'utf-8');
    writeUnlessPresent(path.join(root, 'skrapa.d.ts'), types, force);

    const workflow = fs.readFileSync(path.join(templateDir, WORKFLOW_FILE), 'utf-8');
    writeUnlessPresent(
        path.join(root, WORKFLOW_FILE),
        existingProjectWorkflow(workflow, posixRelative(root, skrapaRoot)),
        force
    );

    const config = readConfig(skrapaRoot).config;

    return {
        skrapaRoot,
        projectRoot: root,
        output: path.resolve(skrapaRoot, config?.output ?? 'dist'),
        scripts: { ...EXISTING_PROJECT_SCRIPTS },
    };
}

export async function init(): Promise<void> {
    console.log(versionBanner());

    const force = process.argv.includes('-f') || process.argv.includes('--force');
    const skipDev = process.argv.includes('--no-dev');

    // A project from an older skrapa has settings only `fix` knows how to carry
    // over. Scaffolding beside them would leave them behind, and every command
    // after this one refusing to run. `--force` is the explicit way through.
    const legacyConfig = LEGACY_CONFIG_FILES.find((name) =>
        fs.existsSync(path.join(CWD_DIR, name))
    );
    if (legacyConfig && !force) {
        log.error(
            `Error: ${legacyConfig} is from an older skrapa. Run \`npx skrapa fix\` to migrate ` +
                'this project, or `npx skrapa init --force` to scaffold over it.'
        );
        process.exit(1);
    }

    const existingRoot = await chooseProjectRoot();

    log.gray('\nInitializing...\n');

    const templateDir = path.join(__dirname, '../template');
    const layout =
        existingRoot === null
            ? scaffoldNew(templateDir, force)
            : scaffoldExisting(templateDir, existingRoot, force);

    const fromProject = (to: string) =>
        path.relative(layout.projectRoot, to).split(path.sep).join('/');

    // ensure .skrapa, node_modules and the output dir are in the project
    // root's .gitignore, as paths from there, creating it if needed
    const gitIgnorePath = path.join(layout.projectRoot, '.gitignore');
    const entries = [fromProject(path.join(layout.skrapaRoot, '.skrapa')), 'node_modules'];
    const output = layout.output && fromProject(layout.output);
    if (output && !output.startsWith('..')) entries.push(output);

    const gitIgnore = fs.existsSync(gitIgnorePath) ? fs.readFileSync(gitIgnorePath, 'utf-8') : '';
    const toIgnore = gitignoreAdditions(gitIgnore, entries);
    if (toIgnore.length > 0) {
        const separator = gitIgnore && !gitIgnore.endsWith('\n') ? '\n' : '';
        fs.writeFileSync(gitIgnorePath, `${gitIgnore}${separator}${toIgnore.join('\n')}\n`);
    }

    const pkgPath = path.join(layout.projectRoot, 'package.json');

    // ensure package.json exists before installing.
    if (!fs.existsSync(pkgPath)) {
        fs.writeFileSync(
            pkgPath,
            JSON.stringify({ name: path.basename(layout.projectRoot), version: '1.0.0' }, null, 4) +
                '\n'
        );
    }

    const pkgRaw = fs.readFileSync(pkgPath, 'utf-8');
    const pkgIndent = pkgRaw.match(/^([ \t]+)/m)?.[1] ?? '    ';
    const pkg = JSON.parse(pkgRaw);
    pkg.scripts = pkg.scripts ?? {};
    let pkgJsonUpdated = false;

    // add the scripts if not already present, each run from the skrapa root
    for (const [command, name] of Object.entries(layout.scripts)) {
        if (!pkg.scripts[name]) {
            pkg.scripts[name] = skrapaScript(command, fromProject(layout.skrapaRoot));
            pkgJsonUpdated = true;
        }
    }

    if (!pkg?.engines?.node) {
        pkg.engines = { ...pkg.engines, node: '>=24' };
        pkgJsonUpdated = true;
    }

    if (pkgJsonUpdated) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, pkgIndent) + '\n');
        log.success(
            `Added ${layout.scripts.dev} and ${layout.scripts.build} scripts to ${path.relative(CWD_DIR, pkgPath)}`
        );
    }

    // An existing project that already has typescript keeps the version it
    // chose; installing again would move it to the latest.
    if (!pkg.dependencies?.typescript && !pkg.devDependencies?.typescript) {
        exe('npm install --save-dev typescript', { cwd: layout.projectRoot });
    }

    log.success('\nProject initialized.\n');
    const commands = [
        [`npm run ${layout.scripts.dev}`, 'starts the dev server'],
        [`npm run ${layout.scripts.build}`, 'builds for production'],
    ];
    const width = Math.max(...commands.map(([command]) => command.length));
    for (const [command, what] of commands) {
        console.log(`${color.cyan}  ${command.padEnd(width)}${color.reset}  ${what}`);
    }
    console.log('');

    if (!skipDev) {
        exe('npx skrapa dev', { cwd: layout.skrapaRoot });
    }
}
