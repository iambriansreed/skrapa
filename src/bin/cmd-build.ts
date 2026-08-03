/**
 * `skrapa build` renders the site to static HTML.
 *
 * Compiles the source tree with `tsc`, then renders every `<dir>/index.tsx`
 * that exports `Page` into a page under the output dir: each is spliced into
 * its nearest `index.html` shell, its client scripts and stylesheets are
 * bundled/copied, and the assets dir is copied across. Returns the resolved
 * {@link InitContext} (which `dev` reuses).
 * @param overrideConfig - {@link ConfigOverrides} applied on top of
 *   `skrapa.config.json` and the CLI flags below (all optional):
 *   - `--input <dir>`   source dir with index.html/index.tsx/client.ts (default `"src"`)
 *   - `--output <dir>`  build output dir (default `"dist"`)
 *   - `--assets <dir>`  static files copied as-is to the output (default `"assets"`)
 *   - `--base <path>`   base URL injected as `<base href>` (default `"/"`)
 *   - `--root <dir>`    dir the paths above resolve against (default cwd)
 */

import { CWD_DIR, DEFAULT_CONFIG, exe, log } from './utils';
import { loadConfig, positionalArgs } from './config';
import { bundleModules } from './bundle';
import { formatHtml } from './format-html';
import { renderAttrs } from './jsx';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Initialize the build context by loading the config, resolving paths, and syncing type declarations.
 *
 * It returns the resolved directory paths, the final config, and the working directory for temporary build files.
 */
function initContext(overrideConfig?: ConfigOverrides): InitContext {
    log.info(`Skrapa v${VERSION}\n`);

    // Shared precedence (defaults < config file < CLI flags < overrideConfig);
    // see config.ts. `config.root` comes back already resolved to absolute.
    const { config, configPath, fileExists } = loadConfig(overrideConfig);

    if (fileExists) {
        log.success(`Loaded config from: ${path.relative(CWD_DIR, configPath)}`);
    } else {
        log.gray(`No config file found, using defaults: ${JSON.stringify(config, null, 2)}`);
    }

    // Sync the project's skrapa.d.ts with the type declarations bundled in
    // the installed skrapa package.
    {
        const sourcePath = path.join(__dirname, '../skrapa.d.ts');
        const destPath = path.join(config.root, 'skrapa.d.ts');
        const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
        const destContent = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf-8') : null;

        if (destContent !== sourceContent) {
            fs.writeFileSync(destPath, sourceContent);
            log.success(`${destContent === null ? 'Added' : 'Updated'} skrapa.d.ts`);
        }
    }

    const WORKING_DIR = path.join(config.root, '.skrapa');
    const input = config.input ? path.resolve(config.root, config.input) : '';

    const output = config.output ? path.resolve(config.root, config.output) : '';

    const assets = config.assets ? path.resolve(config.root, config.assets) : '';

    if (!fs.existsSync(input)) {
        log.error(`Error: input directory does not exist at ${input}`);
        process.exit(1);
    }

    if (!fs.existsSync(output)) {
        fs.mkdirSync(output, { recursive: true });
    }

    if (!assets || !fs.existsSync(assets)) {
        if (config.assets !== DEFAULT_CONFIG.assets) {
            log.error(`Error: assets directory does not exist at ${assets}`);
            process.exit(1);
        }

        log.gray(`Assets directory (${assets}) does not exist. Continuing without copying assets.`);
    }

    return { directory: { input, output, assets }, config, WORKING_DIR };
}

/**
 * Empty the output dir so a build only ever reflects the current source.
 *
 * Without this, a page that gets renamed or deleted leaves its old
 * `index.html` behind forever, and an asset removed from the assets dir stays
 * in the deployed site. The output dir is recreated empty rather than deleted,
 * since a dev server may already be serving from it.
 * @param output - absolute output dir
 * @param directory - the resolved input/assets dirs, which must never sit
 *   inside the output dir
 * @param directory.input
 * @param directory.assets
 * @param root - the resolved project root
 */
export function cleanOutput(
    output: string,
    directory: { input: string; assets: string },
    root: string
): void {
    // A wrong `output` turns this into an rm -rf of the source: `--output .`
    // would delete the very project being built. Refuse whenever the output dir
    // *is* or *contains* the root, the input, the assets, or the cwd.
    const protectedDirs = [root, directory.input, directory.assets, CWD_DIR]
        .filter(Boolean)
        .map((dir) => path.resolve(dir));

    const contains = (parent: string, child: string) =>
        parent === child || child.startsWith(parent + path.sep);

    const conflict = protectedDirs.find((dir) => contains(output, dir));
    if (conflict) {
        log.error(
            `Error: refusing to clean the output dir ${path.relative(CWD_DIR, output) || '.'}; it is or contains ${path.relative(CWD_DIR, conflict) || 'the project root'}.`
        );
        process.exit(1);
    }

    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true });
}

/**
 * Merge a page's `htmlAttrs` into the shell's opening `<html>` tag.
 *
 * An attribute the shell already sets is stripped first so the page's value
 * replaces it rather than appearing twice (browsers honour the first
 * occurrence, which would otherwise be the shell's). Attributes the page does
 * not mention are left in place, so `<html lang="en">` survives a page that
 * only sets a class.
 * @param html - the full shell HTML
 * @param attrs - the page's `htmlAttrs`, if it set any
 * @returns the HTML with the `<html>` tag rewritten, or unchanged if there is
 *   nothing to merge
 */
export function applyHtmlAttrs(html: string, attrs?: Record<string, unknown>): string {
    if (!attrs || Object.keys(attrs).length === 0) return html;

    return html.replace(/<html\b([^>]*)>/i, (_match, existing: string) => {
        const stripped = Object.keys(attrs).reduce((acc, key) => {
            const name = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return acc.replace(
                new RegExp(`\\s+${name}(\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]*))?`, 'gi'),
                ''
            );
        }, existing);

        return `<html${stripped}${renderAttrs(attrs)}>`;
    });
}

// A page module exports `Page()`, which returns either the body HTML as a
// string or a `Page` object (see skrapa.d.ts) that can also set the shared
// template's head/title and the page's client JS.
export function build(overrideConfig?: ConfigOverrides): InitContext {
    const cfg = initContext(overrideConfig);
    const { directory, config, WORKING_DIR } = cfg;

    // Pretty-print output HTML in dev mode only. The `dev` command covers the
    // initial build the dev server runs directly, the `pretty` positional
    // covers the rebuilds it triggers via a `skrapa build` subprocess (see
    // cmd-dev.ts). Read as command + positionals, not a raw argv scan, so
    // `build --output dev` is not mistaken for dev mode.
    const markers = positionalArgs();
    const pretty = process.argv[2] === 'dev' || markers.includes('pretty');

    // Start from an empty output dir so renamed/deleted pages and removed
    // assets never linger in the build. Skipped for dev's incremental rebuilds,
    // which pass `skip-assets`: those don't re-copy the assets dir, so wiping
    // the output would strip every asset from the running site.
    if (!markers.includes('skip-assets')) {
        cleanOutput(directory.output, directory, config.root);
    }

    exe('tsc', { cwd: config.root });

    // Served-from base path, injected as <base href> so relative asset and link
    // URLs resolve the same from "/" and from nested pages like "/about/".
    const base = config.base.endsWith('/') ? config.base : `${config.base}/`;

    // The compiled output mirrors the input tree under .skrapa/<input>, so a
    // page authored at src/about/index.tsx compiles to
    // .skrapa/src/about/index.js. Skrapa does not bundle CSS, so a page's own
    // stylesheet is copied as-is (see rewriteStylesheets below); anything
    // shared belongs in the assets dir (e.g. a root-relative <link>).
    const compiledDir = path.join(WORKING_DIR, config.input);

    // Rewrite every `<script ... src="....ts"></script>`: resolve the src
    // (relative to the page's index.html dir, or the input root for absolute
    // paths) to its compiled module, bundle it into a real `.js` file written
    // to the output dir, and repoint `src` at that file (root-relative). All
    // other attributes are preserved.
    const rewriteClientScripts = (html: string, templateDir: string): string =>
        html.replace(
            /<script([^>]*?)\ssrc=(["'])([^"']+\.tsx?)\2([^>]*)>\s*<\/script>/g,
            (match, before, quote, src, after) => {
                const rel = src.startsWith('/')
                    ? src.slice(1)
                    : path.posix.normalize(path.posix.join(templateDir, src));
                const outId = rel.replace(/\.tsx?$/, '.js');
                const bundle = bundleModules(path.join(compiledDir, outId), true);
                if (bundle === null) {
                    log.warn(`Client entry not found: ${outId}. Skipping.`);
                    return match;
                }
                const outPath = path.join(directory.output, outId);
                fs.mkdirSync(path.dirname(outPath), { recursive: true });
                fs.writeFileSync(outPath, bundle);
                return `<script${before} src=${quote}/${outId}${quote}${after}></script>`;
            }
        );

    // Report every location checked for a missing stylesheet, plus the
    // template that referenced it, so a bad href is easy to track down.
    const warnStylesheetNotFound = (href: string, templateDir: string, checked: string[]) => {
        const templatePath = path.join(directory.input, templateDir, 'index.html');
        const locations = checked.map((p) => path.relative(CWD_DIR, p)).join(', ');
        log.warn(
            `Stylesheet not found: ${href} (referenced in ${path.relative(CWD_DIR, templatePath)}). Looked in: ${locations}. Skipping.`
        );
    };

    // Copy every `<link rel="stylesheet" href="....css">` the page's HTML
    // references (resolved relative to the template's dir, same as
    // rewriteClientScripts) into the output dir and repoint href at it
    // (root-relative). A root-relative href (e.g. "/style.css") may come
    // from the assets dir (copied to the output root as-is, so it's left
    // untouched here) or sit at the root of the input dir (copied explicitly
    // below, since nothing else would carry it into the output root).
    const rewriteStylesheets = (html: string, templateDir: string): string =>
        html.replace(/<link\b[^>]*>/g, (tag) => {
            if (!/\srel=(["'])stylesheet\1/.test(tag)) return tag;
            const hrefMatch = tag.match(/\shref=(["'])([^"']+\.css)\1/);
            if (!hrefMatch) return tag;
            const [attr, quote, href] = hrefMatch;

            if (href.startsWith('/')) {
                const rel = href.slice(1);
                const assetPath = directory.assets && path.join(directory.assets, rel);
                if (assetPath && fs.existsSync(assetPath)) return tag;

                const inputPath = path.join(directory.input, rel);
                if (fs.existsSync(inputPath)) {
                    const outPath = path.join(directory.output, rel);
                    fs.mkdirSync(path.dirname(outPath), { recursive: true });
                    fs.copyFileSync(inputPath, outPath);
                    return tag;
                }

                warnStylesheetNotFound(href, templateDir, [
                    assetPath || path.join(config.assets || '(no assets dir configured)', rel),
                    inputPath,
                ]);
                return tag;
            }

            const rel = path.posix.normalize(path.posix.join(templateDir, href));
            const srcPath = path.join(directory.input, rel);
            if (!fs.existsSync(srcPath)) {
                warnStylesheetNotFound(href, templateDir, [srcPath]);
                return tag;
            }
            const outPath = path.join(directory.output, rel);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.copyFileSync(srcPath, outPath);
            return tag.replace(attr, ` href=${quote}/${rel}${quote}`);
        });

    // Find the index.html that serves as a page's template: the one in the
    // page's own directory, else the nearest ancestor up to the input root.
    // Returns the template HTML and its input-relative posix dir (for resolving
    // relative client `src` paths).
    const findTemplate = (pageDir: string): { html: string; dir: string } | null => {
        for (let d = pageDir; ; d = path.dirname(d) === '.' ? '' : path.dirname(d)) {
            const p = path.join(directory.input, d, 'index.html');
            if (fs.existsSync(p))
                return { html: fs.readFileSync(p, 'utf-8'), dir: d.split(path.sep).join('/') };
            if (d === '') break;
        }
        return null;
    };

    // Every `<dir>/index.tsx` in the input tree is a candidate page; anything
    // else (shared components, helpers, client.ts) is ignored. Searching the
    // source tree (rather than every compiled `index.js`) keeps non-page
    // TypeScript elsewhere under the compiled output (e.g. this repo's own
    // CLI source compiling alongside its dogfooded site) from being required
    // as a page.
    const findPages = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return findPages(full);
            return entry.name === 'index.tsx' ? [full] : [];
        });

    const pageFiles = fs.existsSync(directory.input)
        ? findPages(directory.input).map((src) =>
              path.join(compiledDir, path.relative(directory.input, src)).replace(/\.tsx$/, '.js')
          )
        : [];

    let pageCount = 0;

    for (const file of pageFiles) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamically getting all pages, allowed
        const mod = require(file);
        const PageFn = mod.Page;
        // A page is an index module that exports a `Page` function, so skip the rest.
        if (typeof PageFn !== 'function') continue;

        // Page directory relative to the input root: '' (root), 'about', 'a/b'.
        const pageDir = path.relative(compiledDir, path.dirname(file));

        const result: Page = PageFn();
        const page: Exclude<Page, string> = typeof result === 'string' ? { body: result } : result;
        const { body = '', head = '', title, htmlAttrs } = page;

        // A page's own JSX (not just its template) can also include a client
        // `<script src="....ts">`. Resolve those relative to the page's own
        // directory (where the .tsx file lives), before the body is merged
        // into the shared template, which gets resolved against the
        // template's own directory below.
        // A stylesheet <link> written in the page's own JSX gets the same
        // page-relative pass, so `href="./style.css"` in a body means the same
        // thing as it does in that page's shell. Without it, the link would
        // fall through to the shared-template pass below and resolve against
        // the template's directory instead of the page's.
        const pagePosixDir = pageDir.split(path.sep).join('/');
        const bodyWithScripts = rewriteStylesheets(
            rewriteClientScripts(body, pagePosixDir),
            pagePosixDir
        );

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
        if (title) html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`);
        html = applyHtmlAttrs(html, htmlAttrs);
        html = html.replace('</body>', () => `${bodyWithScripts}</body>`);

        // Bundle every remaining client `<script src="....ts">`, i.e. ones
        // the template itself declares, into a real .js file and repoint
        // its src, resolving relative srcs against the template's dir.
        html = rewriteClientScripts(html, template.dir);

        // Same for `<link rel="stylesheet" href="....css">`: copy the
        // referenced file into the output dir and repoint href at it.
        html = rewriteStylesheets(html, template.dir);

        const full = path.join(directory.output, pageDir, 'index.html');
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, pretty ? formatHtml(html) : html);
        pageCount++;
    }

    if (pageCount === 0) {
        log.error(
            `Error: no pages found in ${config.input} (a page is a <dir>/index.tsx that exports \`Page\`).`
        );
        process.exit(1);
    }

    if (!markers.includes('skip-assets') && directory.assets) {
        if (fs.existsSync(directory.assets)) {
            fs.cpSync(directory.assets, directory.output, { recursive: true });
        }
    }

    // Clean up temporary build directory
    // exe(`rm -rf ${WORKING_DIR}`);

    return cfg;
}
