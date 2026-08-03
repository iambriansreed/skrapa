import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bundleModules } from '../bin/bundle';

export function buildBin() {
    execSync(`tsc -p tsconfig.json`, { stdio: 'inherit', cwd: process.cwd() });

    const entryFile = path.join('.skrapa', 'src', 'bin', 'index.js');

    const bundle = bundleModules(entryFile);

    if (bundle === null) {
        console.error(`Could not find ${entryFile}. Run tsc first.`);
        process.exit(1);
    }

    // Bake the real version into index.js's `globalThis.VERSION` placeholder
    // (see src/bin/index.ts) so the bundled CLI never has to resolve
    // package.json at runtime.
    const { version } = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    const versioned = bundle.replace(/__SKRAPA_VERSION__/g, version);

    fs.mkdirSync('bin', { recursive: true });
    const outPath = path.join('bin', 'index.js');

    fs.writeFileSync(outPath, versioned);
    fs.chmodSync(outPath, 0o755);
}

// Point the global `skrapa` bin at this checkout. Only the dev/e2e scripts need
// it, since they run `npx skrapa` in the repo root and in the scaffolded .tmp
// project. Deliberately NOT part of buildBin(): a build that depends on a global
// symlink means CI silently falls back to the *published* skrapa when the link
// isn't on PATH, producing a green build of the wrong source.
export function linkBin() {
    execSync(`npm link`, { stdio: 'inherit', cwd: ROOT_DIR });
}

export const ROOT_DIR = path.join(__dirname, '../..');
export const TMP_DIR = path.join(ROOT_DIR, '.tmp');
export const TEMPLATE_DIR = path.join(ROOT_DIR, 'template');

export function scaffoldTmp() {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(TMP_DIR, 'dist'), { recursive: true });
    execSync('npx skrapa init --no-dev', { cwd: TMP_DIR, stdio: 'inherit' });
}
