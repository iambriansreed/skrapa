/**
 * `skrapa init` scaffolds a new project (the default command).
 *
 * Copies the bundled `template/` into the target directory, ensures
 * `.gitignore` ignores `.skrapa`/`node_modules`/`dist`, adds `dev`/`build`
 * scripts and a Node engines field to `package.json` (creating it if absent),
 * installs `typescript`, then starts the dev server unless `--no-dev` is passed.
 *
 * CLI flags:
 * - `-f`, `--force`  overwrite existing files with the scaffolded versions
 * - `--no-dev`       skip starting the dev server after scaffolding
 * @param overrideConfig - {@link Skrapa.Config}; `init` uses the resolved
 *   `root` (honoring `--root`) as the directory to scaffold into.
 */

import path from 'node:path';
import { color, exe, log, versionBanner } from './utils';
import { loadConfig } from './config';
import fs from 'node:fs';

export async function init(overrideConfig?: Skrapa.Config): Promise<void> {
    console.log(`\n${versionBanner()}`);

    log.gray('Initializing...\n');

    // Same config precedence as the other commands (see config.ts). Init runs
    // before a config file exists, so this is really just the resolved `root`
    // (honoring --root / an override) to scaffold into; the rest are defaults.
    const { config } = loadConfig(overrideConfig);
    const rootPath = (...paths: string[]) => path.join(config.root, ...paths);

    const templateDir = path.join(__dirname, '../template');

    const force = process.argv.includes('-f') || process.argv.includes('--force');
    const skipDev = process.argv.includes('--no-dev');

    // Copy the whole template, dotfiles (e.g. .github/workflows/deploy.yml)
    // included. `force` mirrors the documented -f flag: off, existing files
    // are left alone; on, they are overwritten. Done in Node rather than via
    // `cp` so a project path containing spaces works.
    fs.cpSync(templateDir, rootPath(), { recursive: true, force });

    // ensure .skrapa, node_modules, and dist are in .gitignore, creating it if needed
    const gitIgnorePath = rootPath('.gitignore');
    const gitIgnoreEntries = ['.skrapa', 'node_modules', 'dist'];
    if (fs.existsSync(gitIgnorePath)) {
        const content = fs.readFileSync(gitIgnorePath, 'utf-8');
        // Compare loosely so an existing "dist/" or "/dist" is not duplicated
        // by a bare "dist".
        const normalize = (line: string) => line.trim().replace(/^\/+|\/+$/g, '');
        const existing = new Set(content.split('\n').map(normalize));
        const toAdd = gitIgnoreEntries.filter((e) => !existing.has(normalize(e)));
        if (toAdd.length > 0) {
            fs.appendFileSync(
                gitIgnorePath,
                (content.endsWith('\n') ? '' : '\n') + toAdd.join('\n') + '\n'
            );
        }
    } else {
        fs.writeFileSync(gitIgnorePath, gitIgnoreEntries.join('\n') + '\n');
    }

    const pkgPath = rootPath('package.json');

    // ensure package.json exists before installing.
    if (!fs.existsSync(pkgPath)) {
        fs.writeFileSync(
            pkgPath,
            JSON.stringify({ name: path.basename(config.root), version: '1.0.0' }, null, 4) + '\n'
        );
    }

    const pkgRaw = fs.readFileSync(pkgPath, 'utf-8');
    const pkgIndent = pkgRaw.match(/^([ \t]+)/m)?.[1] ?? '    ';
    const pkg = JSON.parse(pkgRaw);
    pkg.scripts = pkg.scripts ?? {};
    let pkgJsonUpdated = false;

    // add dev/build scripts if not already present
    if (!pkg.scripts.dev) {
        pkg.scripts.dev = 'npx skrapa dev';
        pkgJsonUpdated = true;
    }
    if (!pkg.scripts.build) {
        pkg.scripts.build = 'npx skrapa build';
        pkgJsonUpdated = true;
    }

    if (!pkg?.engines?.node) {
        pkg.engines = { ...pkg.engines, node: '>=24' };
        pkgJsonUpdated = true;
    }

    if (pkgJsonUpdated) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, pkgIndent) + '\n');
        log.success('Added dev and build scripts to package.json');
    }

    // install dependencies (in the scaffolded project, which --root may move)
    exe('npm install --save-dev typescript', { cwd: config.root });

    log.success('\nProject initialized.\n');
    console.log(`${color.cyan}  npx skrapa dev${color.reset}   starts the dev server`);
    console.log(`${color.cyan}  npx skrapa build${color.reset} builds for production\n`);

    if (!skipDev) {
        exe('npx skrapa dev', { cwd: config.root });
    }
}
