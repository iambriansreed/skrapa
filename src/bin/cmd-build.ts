/**
 * `skrapa build` renders the site to static HTML.
 *
 * Compiles the source tree with `tsc`, then renders every `<dir>/index.tsx`
 * that exports `Page` into a page under the output dir: each is spliced into
 * its nearest `index.html` shell, its client scripts and stylesheets are
 * bundled/copied, and the assets dir is copied across. Returns the resolved
 * {@link InitContext} (which `dev` reuses).
 * @param overrideConfig - {@link Skrapa.Config} applied on top of the
 *   `skrapa` key in tsconfig.json and the CLI flags below (all optional):
 *   - `--output <dir>`  build output dir (default `"dist"`)
 *   - `--assets <dir>`  static files copied as-is to the output (default `"assets"`)
 *   - `--base <path>`   base URL injected as `<base href>` (default `"/"`)
 *   - `--linkCheckIgnore <patterns>`  comma-separated URL paths the link check skips (default none)
 *   - `--projectRoot <dir>`  where skrapa.d.ts is synced to (default `"."`)
 */

import { CWD_DIR, DEFAULT_CONFIG, exe, isSkippedPath, log, versionBanner } from './utils';
import { tagParser } from './tag-parser';
import { ATTR, rewriteShellImports, type RewriteDirs } from './rewrite-shell-imports';
import {
    checkCopy,
    emittedPaths,
    formatProblem,
    writeManifest,
    type Problem,
} from './output-paths';
import { checkLinks } from './link-check';
import { CONFIG_FILE, loadConfig, positionalArgs } from './config';
import { formatHtml } from './format-html';
import { escapeText, isElement, renderAttrs, unescapeAttr } from './jsx';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Initialize the build context by loading the config, resolving paths, and syncing type declarations.
 *
 * It returns the resolved directory paths, the final config, and the working directory for temporary build files.
 */
function initContext(overrideConfig?: Skrapa.Config): InitContext {
    console.log(versionBanner());

    // Shared precedence (defaults < tsconfig.json `skrapa` < CLI flags <
    // overrideConfig); see config.ts. First, and before anything is written:
    // a config with any problem in it stops the build here.
    const { config, skrapaRoot } = loadConfig(overrideConfig);
    log.success(`Loaded config from ${CONFIG_FILE}`);

    // Where .github, .gitignore and package.json live, which is not always the
    // skrapa root: the template keeps its pages in src/, one level down.
    const projectRoot = path.resolve(skrapaRoot, config.projectRoot);

    // Sync the project's skrapa.d.ts with the type declarations bundled in the
    // installed skrapa package. It belongs to the project root, so a
    // tsconfig.json below it names it in "include" (e.g. "../skrapa.d.ts").
    {
        const sourcePath = path.join(__dirname, '../skrapa.d.ts');
        const destPath = path.join(projectRoot, 'skrapa.d.ts');
        const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
        const destContent = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf-8') : null;

        if (destContent !== sourceContent) {
            fs.writeFileSync(destPath, sourceContent);
            log.success(`${destContent === null ? 'Added' : 'Updated'} skrapa.d.ts`);
        }
    }

    // Scratch space: tsc's output, its incremental state (tsconfig.tsbuildinfo,
    // since `composite: true` implies `incremental`) and the emitted-files
    // manifest. It lasts as long as the process that owns it (see build()).
    const WORKING_DIR = path.join(skrapaRoot, '.skrapa');
    const output = path.resolve(skrapaRoot, config.output);
    const assets = path.resolve(skrapaRoot, config.assets);

    if (!fs.existsSync(output)) {
        fs.mkdirSync(output, { recursive: true });
    }

    if (!fs.existsSync(assets)) {
        if (config.assets !== DEFAULT_CONFIG.assets) {
            log.error(`Error: assets directory does not exist at ${assets}`);
            process.exit(1);
        }

        log.gray(`Assets directory (${assets}) does not exist. Continuing without copying assets.`);
    }

    return { directory: { skrapaRoot, projectRoot, output, assets }, config, WORKING_DIR };
}

/**
 * Empty the output dir so a build only ever reflects the current source.
 *
 * Without this, a page that gets renamed or deleted leaves its old
 * `index.html` behind forever, and an asset removed from the assets dir stays
 * in the deployed site. The output dir is recreated empty rather than deleted,
 * since a dev server may already be serving from it.
 * @param output - absolute output dir
 * @param directory - the resolved roots and assets dir, none of which may sit
 *   inside the output dir
 * @param directory.skrapaRoot
 * @param directory.projectRoot
 * @param directory.assets
 */
export function cleanOutput(
    output: string,
    directory: { skrapaRoot: string; projectRoot: string; assets: string }
): void {
    // A wrong `output` turns this into an rm -rf of the source: `--output .`
    // would delete the very project being built. Refuse whenever the output dir
    // *is* or *contains* the skrapa root, the project root, the assets, or the
    // cwd.
    const protectedDirs = [directory.skrapaRoot, directory.projectRoot, directory.assets, CWD_DIR]
        .filter(Boolean)
        .map((dir) => path.resolve(dir));

    const contains = (parent: string, child: string) =>
        parent === child || child.startsWith(parent + path.sep);

    const conflict = protectedDirs.find((dir) => contains(output, dir));
    if (conflict) {
        log.error(
            `Error: refusing to clean the output dir ${path.relative(CWD_DIR, output) || '.'}; it is or contains ${path.relative(CWD_DIR, conflict) || 'the skrapa root'}.`
        );
        process.exit(1);
    }

    // An output dir inside the project is not searched for pages, so a page
    // kept in it never builds, and cleaning it deletes that page: `output:
    // "docs"` in a project with a docs/ page. Refuse while it holds one.
    const findPage = (dir: string): string | undefined => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            const found = entry.isDirectory() ? findPage(full) : entry.name === 'index.tsx' && full;
            if (found) return found;
        }
        return undefined;
    };
    const page =
        contains(directory.skrapaRoot, output) && fs.existsSync(output) && findPage(output);
    if (page) {
        log.error(
            `Error: refusing to clean the output dir ${path.relative(CWD_DIR, output)}; it holds the page ${path.relative(CWD_DIR, page)}. Pick an output dir that is not a page directory.`
        );
        process.exit(1);
    }

    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true });
}

/**
 * Set a page's `shellAttrs.html` / `shellAttrs.body` on the shell's opening `<html>` or
 * `<body>` tag.
 *
 * An attribute the page names is dropped from the shell's tag, so the page's
 * value replaces it rather than appearing twice (browsers honour the first
 * occurrence, which would otherwise be the shell's). Attributes the page does
 * not name are carried over exactly as authored, so `<html lang="en">`
 * survives a page that only sets a class.
 *
 * A string value therefore overwrites. A function value merges instead: it is
 * called with the shell's current value for that attribute (`''` when the
 * shell sets none) and returns the value to use, which is how a page appends
 * to a class list rather than replacing it.
 *
 * Only the first matching tag is rewritten, and this runs before the page's
 * own `body` is spliced in, so markup inside the page can never be mistaken
 * for the shell's opening tag.
 * @param html - the full shell HTML
 * @param tag - which opening tag to write to
 * @param attrs - the page's attributes for that tag, if it set any
 * @returns the HTML with that tag rewritten, or unchanged if there is nothing
 *   to write
 */
export function applyTagAttrs(
    html: string,
    tag: 'html' | 'body',
    attrs?: Record<string, string | ((prev: string) => string)>
): string {
    if (!attrs || Object.keys(attrs).length === 0) return html;

    // The regex only finds the tag's extent; tagParser reads it apart. It is
    // attribute-aware for the same reason tagParser is: `[^>]*` would end the
    // tag at a `>` inside a quoted value.
    const tagRe = new RegExp(`<${tag}\\b((?:\\s+${ATTR})*)\\s*/?>`, 'i');

    // Which page key, if any, names this shell attribute (HTML names are
    // case-insensitive, so `CLASS` and `class` are the same attribute).
    const pageKeyFor = (name: string) =>
        Object.keys(attrs).find((key) => key.toLowerCase() === name.toLowerCase());

    const valueOf = (key: string, prev: string) => {
        const value = attrs[key];
        return typeof value === 'function' ? value(prev) : value;
    };

    return html.replace(tagRe, (match: string) => {
        // Decoded up front so a merge function sees the value as authored
        // (`a & b`, not `a &amp; b`) and renderAttrs re-encodes exactly once.
        const shell = Object.entries(tagParser(match).attrs).map(
            ([name, value]) => [name, unescapeAttr(value)] as const
        );

        const merged: Record<string, string> = {};

        // Shell attributes first, in their original order: one the page names
        // is replaced where it stands rather than moved to the end.
        for (const [name, value] of shell) {
            const key = pageKeyFor(name);
            merged[key ?? name] = key ? valueOf(key, value) : value;
        }

        // Then whatever the page adds that the shell did not already have.
        for (const key of Object.keys(attrs)) {
            if (!shell.some(([name]) => name.toLowerCase() === key.toLowerCase())) {
                merged[key] = valueOf(key, '');
            }
        }

        return `<${tag}${renderAttrs(merged)}>`;
    });
}

// A page module exports `Page()`, which returns either the body HTML as a
// string or a `Page` object (see skrapa.d.ts) that can also set the shared
// template's head/title and the page's client JS.
export function build(overrideConfig?: Skrapa.Config): InitContext {
    const cfg = initContext(overrideConfig);
    const { directory, config, WORKING_DIR } = cfg;

    // Whether a dev server is what asked for this build. The `dev` command
    // covers the initial build the dev server runs directly, the `pretty`
    // positional covers the rebuilds it triggers via a `skrapa build`
    // subprocess (see cmd-dev.ts). Read as command + positionals, not a raw
    // argv scan, so `build --output dev` is not mistaken for dev mode.
    const markers = positionalArgs();
    const devMode = process.argv[2] === 'dev' || markers.includes('pretty');

    // Output HTML is pretty-printed for dev and left dense for a real build.
    const pretty = devMode;

    // A rebuild triggered by the dev server, which leaves the assets already
    // in the output dir alone.
    const skipAssets = markers.includes('skip-assets');

    // .skrapa is deleted once the process that owns it is done, however it
    // ends, failures included: a standalone `skrapa build`, or the `dev`
    // process whose first build this is, when dev mode stops. A dev rebuild
    // (`skip-assets`) runs as a subprocess of that dev server and leaves it in
    // place, since the server still needs it between rebuilds: tsc's
    // incremental state, and the manifest its assets watcher reads.
    if (!skipAssets) {
        process.once('exit', () => fs.rmSync(WORKING_DIR, { recursive: true, force: true }));
    }

    // Start from an empty output dir so renamed/deleted pages and removed
    // assets never linger in the build. Skipped for dev's incremental rebuilds,
    // which pass `skip-assets`: those don't re-copy the assets dir, so wiping
    // the output would strip every asset from the running site.
    if (!skipAssets) {
        cleanOutput(directory.output, directory);
    }

    // The project's own outDir and rootDir are overridden rather than read:
    // everything below relies on a page at about/index.tsx compiling to
    // .skrapa/about/index.js, whatever the tsconfig says.
    exe(`tsc -p ${CONFIG_FILE} --outDir .skrapa --rootDir .`, { cwd: directory.skrapaRoot });

    // Served-from base path, injected as <base href> so relative asset and link
    // URLs resolve the same from "/" and from nested pages like "/about/".
    // Already slash-normalized on both ends by loadConfig.
    const base = config.base;

    // The compiled output mirrors the project tree under .skrapa, so a page
    // authored at about/index.tsx compiles to .skrapa/about/index.js. Skrapa
    // does not bundle CSS, so a page's own stylesheet is copied as-is (see
    // rewrite-shell-imports.ts); anything shared belongs in the assets dir
    // (e.g. a root-relative <link>).
    const compiledDir = WORKING_DIR;

    // Every output path this render writes, so the output tree can be checked
    // against the rules in output-paths.ts before anything is copied over it.
    const emitted = emittedPaths(directory.output);

    // The rewriters live at module scope (and are unit-tested there); this
    // is the directory set they need.
    const dirs: RewriteDirs = { ...directory, compiled: compiledDir, emitted, base };

    // Find the index.html that serves as a page's template: the one in the
    // page's own directory, else the nearest ancestor up to the skrapa root.
    // Returns the template HTML, the file it came from (named in a collision
    // message), and its posix dir relative to the skrapa root (for resolving
    // relative client `src` paths).
    const findTemplate = (pageDir: string): { html: string; file: string; dir: string } | null => {
        for (let d = pageDir; ; d = path.dirname(d) === '.' ? '' : path.dirname(d)) {
            const p = path.join(directory.skrapaRoot, d, 'index.html');
            if (fs.existsSync(p))
                return {
                    html: fs.readFileSync(p, 'utf-8'),
                    file: p,
                    dir: d.split(path.sep).join('/'),
                };
            if (d === '') break;
        }
        return null;
    };

    // Every `<dir>/index.tsx` in the skrapa root is a candidate page; anything else
    // (shared components, helpers, client.ts) is ignored. Searching the source
    // tree rather than every compiled `index.js` keeps anything else tsc emits
    // from being required as a page. Dot-dirs, node_modules and the output and
    // assets dirs are not source (see isSkippedPath).
    const notSource = [directory.output, directory.assets];
    const findPages = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                return isSkippedPath(directory.skrapaRoot, full, notSource) ? [] : findPages(full);
            }
            return entry.name === 'index.tsx' ? [full] : [];
        });

    const pageFiles = findPages(directory.skrapaRoot).map((src) =>
        path.join(compiledDir, path.relative(directory.skrapaRoot, src)).replace(/\.tsx$/, '.js')
    );

    let pageCount = 0;

    for (const file of pageFiles) {
        // tsc succeeded but did not emit this one: the tsconfig's own
        // include/exclude/files left it out, or it has noEmit set. Say which
        // file and why, rather than let require() fail with a bare path.
        if (!fs.existsSync(file)) {
            const source = path.join(directory.skrapaRoot, path.relative(compiledDir, file));
            log.error(
                `Error: ${path.relative(CWD_DIR, source).replace(/\.js$/, '.tsx')} was not compiled. ` +
                    `Check that "include" in ${CONFIG_FILE} covers it and that noEmit is off.`
            );
            process.exit(1);
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamically getting all pages, allowed
        const mod = require(file);
        const PageFn = mod.Page;
        // A page is an index module that exports a `Page` function, so skip the rest.
        if (typeof PageFn !== 'function') continue;

        // Page directory relative to the project: '' (home), 'about', 'a/b'.
        const pageDir = path.relative(compiledDir, path.dirname(file));

        const result: Skrapa.Page = PageFn();
        // Returning markup directly is shorthand for `{ body: <that markup> }`.
        const page: Exclude<Skrapa.Page, JSX.Element> = isElement(result)
            ? { body: result }
            : result;
        const { head = '', title, shellAttrs } = page;
        // An element stringifies to its HTML; everything downstream wants the
        // string, not the box.
        const body = page.body === undefined ? '' : String(page.body);

        // A page's own JSX (not just its template) can also include a client
        // `<script src="....ts">` or a stylesheet `<link>`. Both resolve
        // against the page's own directory (where the .tsx file lives), and
        // both have to run before the body is merged into the shared template,
        // which resolves against the template's directory below. Without this
        // pass a page's `./style.css` would fall through and be looked for
        // beside the template instead of beside the page.
        const pagePosixDir = pageDir.split(path.sep).join('/');
        const pageSource = path.join(directory.skrapaRoot, pageDir, 'index.tsx');
        const bodyWithScripts = rewriteShellImports(body, pagePosixDir, dirs, pageSource);

        // Each page renders into its own index.html template (or the nearest
        // ancestor's, so a shared root template still works).
        const template = findTemplate(pageDir);
        if (!template) {
            log.error(`Error: no index.html template found for page "${pageDir || '/'}".`);
            process.exit(1);
        }

        // <base> goes first in <head> so it governs every later URL (favicon,
        // page `head`, body assets). \b avoids matching <header>.
        let html = template.html
            .replace(/<head\b[^>]*>/, (m) => `${m}<base href="${base}" />`)
            .replace('</head>', () => `${head}</head>`);
        // Escaped, unlike `head`: a title is text, and `head` is the documented
        // slot for raw markup. Without this a title of `</title><script>...`
        // closes the element and injects a live script, which is exactly the
        // hole that escaping string children elsewhere is meant to close.
        if (title)
            html = html.replace(
                /<title>[\s\S]*?<\/title>/,
                () => `<title>${escapeText(title)}</title>`
            );
        // Both run before the page's body is spliced in below, so a `<body>`
        // written inside the page's own markup can never be mistaken for the
        // shell's opening tag.
        html = applyTagAttrs(html, 'html', shellAttrs?.html);
        html = applyTagAttrs(html, 'body', shellAttrs?.body);

        // The template's own imports, resolved against the template's dir.
        // Deliberately before the body is spliced in: the body already had its
        // page-relative pass above, so rescanning it here would warn a second
        // time about anything that pass could not resolve, and would give a
        // body path a second (undocumented) chance to resolve against the
        // template's directory instead of the page's.
        html = rewriteShellImports(html, template.dir, dirs);

        html = html.replace('</body>', () => `${bodyWithScripts}</body>`);

        const full = path.join(directory.output, pageDir, 'index.html');
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, pretty ? formatHtml(html) : html);
        emitted.record(full, { kind: 'page', sources: [template.file, pageSource] });
        pageCount++;
    }

    if (pageCount === 0) {
        log.error(
            `Error: no pages found in ${path.relative(CWD_DIR, directory.skrapaRoot) || 'this directory'} (a page is a <dir>/index.tsx that exports \`Page\`).`
        );
        process.exit(1);
    }

    // `dev`'s assets watcher copies a changed file straight through without a
    // rebuild, so it has to make the same check against the same set of paths.
    // It runs in a different process from every rebuild after the first, hence
    // a file rather than a value passed back.
    writeManifest(WORKING_DIR, emitted);

    // Fail rather than warn: a silent overwrite is never intentional, and a
    // warning in a CI log is exactly what gets missed. Two things are reported
    // without failing, both because a dev server is already up and serving and
    // taking its updates down helps nobody: a problem only the assets copy
    // would cause, which a dev rebuild never reaches, and a broken reference,
    // which mid-edit is usually a link to a file that is about to exist.
    //
    // Reported line by line because dev forwards a rebuild's warnings by
    // picking out the yellow ones, and a single multi-line call colours only
    // the first.
    const report = (problems: Problem[]): boolean => {
        let fatal = false;

        for (const [index, problem] of problems.entries()) {
            const blocks = problem.rule === 'link' ? !devMode : !(skipAssets && problem.assetOnly);
            fatal ||= blocks;
            const write = blocks ? log.error : log.warn;
            if (index > 0) write('');
            for (const line of formatProblem(problem).split('\n')) write(line);
        }

        return fatal;
    };

    const hasAssets = Boolean(directory.assets) && fs.existsSync(directory.assets);

    if (hasAssets && report(checkCopy(directory.assets, directory.output, emitted))) {
        process.exit(1);
    }

    if (!skipAssets && hasAssets) {
        fs.cpSync(directory.assets, directory.output, { recursive: true });
    }

    // Last, and deliberately after the copy above: the check reads the output
    // tree as the deployed site, and an asset that has not been copied yet is
    // indistinguishable from one that does not exist. A dev rebuild skips the
    // copy but is running against an output dir a full build already filled.
    if (report(checkLinks(directory.output, config.base, config.linkCheckIgnore))) {
        process.exit(1);
    }

    return cfg;
}
