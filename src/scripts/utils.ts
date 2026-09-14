import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bundleModules } from '../bin/bundle';

export function buildBin() {
    // src/tsconfig.json compiles the CLI (and these scripts) into the repo
    // root's .skrapa/, rooted at the repo so the entry lands at src/bin/.
    execSync(`tsc -p ${JSON.stringify(path.join('src', 'tsconfig.json'))}`, {
        stdio: 'inherit',
        cwd: ROOT_DIR,
    });

    const entryFile = path.join(ROOT_DIR, '.skrapa', 'src', 'bin', 'index.js');

    const bundle = bundleModules(entryFile);

    if (bundle === null) {
        console.error(`Could not find ${entryFile}. Run tsc first.`);
        process.exit(1);
    }

    // Bake the real version into index.js's `globalThis.VERSION` placeholder
    // (see src/bin/index.ts) so the bundled CLI never has to resolve
    // package.json at runtime.
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
    const versioned = bundle.replace(/__SKRAPA_VERSION__/g, version);

    fs.mkdirSync(path.join(ROOT_DIR, 'bin'), { recursive: true });
    const outPath = path.join(ROOT_DIR, 'bin', 'index.js');

    fs.writeFileSync(outPath, versioned);
    fs.chmodSync(outPath, 0o755);
}

// Point the global `skrapa` bin at this checkout. Only the dev/e2e scripts need
// it, since they run `npx skrapa` in the repo root and in the scaffolded .tmp
// project. Deliberately NOT part of buildBin(): a build that depends on a global
// symlink means CI silently falls back to the *published* skrapa when the link
// isn't on PATH, producing a green build of the wrong source. dev.ts removes
// the link again on SIGINT.
export function linkBin() {
    execSync(`npm link`, { stdio: 'inherit', cwd: ROOT_DIR });
}

export const ROOT_DIR = path.join(__dirname, '../..');
/** The docs site's skrapa root, holding its tsconfig.json. Its project root is the repo root. */
export const WEB_DIR = path.join(ROOT_DIR, 'web');
/** Gitignored scratch space for the e2e/dev project and the unit-test fixtures. */
export const TMP_ROOT = path.join(ROOT_DIR, '.tmp');
/**
 * The scaffolded e2e/dev project. A subdirectory of .tmp rather than .tmp
 * itself: unit-test fixtures are created as siblings under .tmp, and a project
 * dir that contained them would compile and build them as pages of its own.
 */
export const TMP_DIR = path.join(TMP_ROOT, 'project');
/** The scaffolded project's skrapa root, where its tsconfig.json and pages are. */
export const TMP_SKRAPA_DIR = path.join(TMP_DIR, 'src');
export const TEMPLATE_DIR = path.join(ROOT_DIR, 'template');

/**
 * Remove a directory under .tmp, then .tmp itself if nothing else is left in
 * it. Whatever creates something under .tmp removes it when done, but .tmp is
 * shared (the dev project and every test file's fixtures, often from
 * concurrent processes), so it goes only with the last thing in it.
 * @param dir - the directory under .tmp this process created
 */
export function removeTmp(dir: string) {
    // Retries cover a dev server killed a moment ago that is still writing.
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    try {
        fs.rmdirSync(TMP_ROOT);
    } catch {
        // Something else is still using it, or it is already gone.
    }
}

export function scaffoldTmp() {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(TMP_DIR, 'dist'), { recursive: true });
    // --new, so a terminal running `npm run dev` is not stopped by init's
    // question about whether this is a new project.
    execSync('npx skrapa init --new --no-dev', { cwd: TMP_DIR, stdio: 'inherit' });
}
