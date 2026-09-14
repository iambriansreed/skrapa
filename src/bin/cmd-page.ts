/**
 * `skrapa page` scaffolds a new page.
 *
 * Creates `<parent>/<slug>/` in the skrapa root with four files: `index.tsx`
 * (the `Page`), its own `index.html` shell, a `style.css`, and a `client.ts`.
 * The pretty name is slugified into the directory name and used as the page's
 * `<h1>`/`<title>`. Existing files are never overwritten.
 *
 * The page links only what the project has: the global `/style.css` when there
 * is one, and a home link when there is a home page. Either link to nothing
 * fails the build's link check, so a page that did not build the moment it was
 * scaffolded would be the first thing a new page did.
 *
 * Positional args:
 * - `<name>`   (required) pretty name, e.g. `"About Us"`
 * - `[parent]` (optional) parent route to nest under, e.g. `"blog"`
 * @param overrideConfig - {@link Skrapa.Config}; `page` reads `output` and
 *   `assets` from it, as directories a page may not be created in.
 */

import fs from 'node:fs';
import path from 'node:path';
import { color, isSkippedPath, log } from './utils';
import { loadConfig, positionalArgs } from './config';

export const slugify = (s: string): string =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

export type PagePlan = {
    /** Slugified directory name, e.g. "about-us". */
    slug: string;
    /** Project-relative posix path of the page dir, e.g. "blog/about-us". */
    route: string;
    /** URL the page builds to, e.g. "/blog/about-us/". */
    urlPath: string;
    /** Absolute page directory. */
    dir: string;
    /** File name -> contents for the scaffolded page. */
    files: Record<string, string>;
};

/**
 * Pure: work out where a page goes and what its four files contain. Throws if
 * the name has no usable characters, or if the page would land somewhere the
 * build never looks. Does not touch the filesystem.
 * @param opts
 * @param opts.name
 * @param opts.parent
 * @param opts.skrapaRoot - absolute skrapa root, the dir holding tsconfig.json
 * @param opts.notSource - absolute dirs that are not source (output, assets)
 * @param opts.globalStylesheet - whether a `/style.css` exists for the shell to
 *   link, in the assets dir or at the top of the skrapa root
 * @param opts.homePage - whether the skrapa root has an `index.tsx` to link home to
 */
export function planPage(opts: {
    name: string;
    parent?: string;
    skrapaRoot: string;
    notSource?: readonly string[];
    globalStylesheet?: boolean;
    homePage?: boolean;
}): PagePlan {
    const { name, skrapaRoot } = opts;

    const slug = slugify(name);
    if (!slug) throw new Error(`"${name}" has no letters or numbers to build a page name from.`);

    // Normalize an optional parent route (strip surrounding slashes) so nesting
    // like `skrapa page "First Post" blog` lands at blog/first-post.
    const parent = path.posix.normalize((opts.parent ?? '').replace(/^\/+|\/+$/g, ''));

    // After normalizing, a parent that still climbs (`..`, `a/../../b`) would
    // scaffold outside the skrapa root: files land in a surprising place and
    // the page never builds, since the build only scans the skrapa root.
    // Refuse it rather than write somewhere the user did not mean.
    if (parent === '..' || parent.startsWith('../')) {
        throw new Error(
            `parent "${opts.parent}" points outside the skrapa root; pages must live beside tsconfig.json.`
        );
    }
    const route = path.posix.join(parent, slug);
    const urlPath = `/${route}/`;
    const dir = path.join(skrapaRoot, parent, slug);

    // Inside the skrapa root but somewhere the build skips (the output dir, a
    // dot-dir, node_modules): the same page that never builds.
    if (isSkippedPath(skrapaRoot, dir, opts.notSource)) {
        throw new Error(
            `"${route}" is inside a directory skrapa does not build pages from (the output or assets dir, node_modules, or a dot-dir).`
        );
    }

    // Relative, so the `<base href>` every built page carries resolves it to the
    // site root. A hand-written `/` means the domain root, which is not where a
    // site deployed under a `base` such as `/repo/` lives.
    const homeLink = opts.homePage
        ? `
            <p>
                <a href="./">← Home</a>
            </p>`
        : '';
    const globalStylesheet = opts.globalStylesheet
        ? `
        <link rel="stylesheet" href="/style.css" />`
        : '';

    const files: Record<string, string> = {
        'index.tsx': `export function Page(): Skrapa.Page {
    return (
        <main class="${slug}">
            <h1>${name}</h1>
            <p>
                New page scaffolded by Skrapa. Edit <code>${route}/index.tsx</code> and save to see
                it live-reload.
            </p>${homeLink}
        </main>
    );
}
`,
        'index.html': `<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${name}</title>${globalStylesheet}
        <link rel="stylesheet" href="./style.css" />
    </head>
    <body>
        <script type="module" src="./client.ts"></script>
    </body>
</html>
`,
        'style.css': `/* Styles for the ${name} page, linked from this page's own index.html. */
.${slug} {
    padding: 2rem;
}
`,
        'client.ts': `// Client-side code for the ${name} page, bundled to a standalone .js.
console.log('${slug} page loaded');
`,
    };

    return { slug, route, urlPath, dir, files };
}

/**
 *
 * @param overrideConfig
 */
export function page(overrideConfig?: Skrapa.Config): void {
    // Positional name + optional parent, tolerant of shared config flags
    // appearing in any order (e.g. `page "About" --output public`).
    const [name, parent] = positionalArgs();

    if (!name) {
        log.error('Usage: npx skrapa page "<name>" [parent]');
        process.exit(1);
    }

    // Same config precedence and validation as the other commands (see
    // config.ts); page only needs the skrapa root and what is not source.
    const { config, skrapaRoot } = loadConfig(overrideConfig);
    const assets = path.resolve(skrapaRoot, config.assets);

    let plan: PagePlan;
    try {
        plan = planPage({
            name,
            parent,
            skrapaRoot,
            notSource: [path.resolve(skrapaRoot, config.output), assets],
            // The two places the build looks for a root-relative stylesheet
            // (see rewrite-shell-imports.ts), in the same order.
            globalStylesheet: [assets, skrapaRoot].some((dir) =>
                fs.existsSync(path.join(dir, 'style.css'))
            ),
            homePage: fs.existsSync(path.join(skrapaRoot, 'index.tsx')),
        });
    } catch (err) {
        log.error(`Error: ${(err as Error).message}`);
        process.exit(1);
    }

    if (fs.existsSync(path.join(plan.dir, 'index.tsx'))) {
        log.error(`Error: a page already exists at ${plan.route}/index.tsx.`);
        process.exit(1);
    }

    fs.mkdirSync(plan.dir, { recursive: true });
    for (const [file, contents] of Object.entries(plan.files)) {
        fs.writeFileSync(path.join(plan.dir, file), contents);
        log.success(`  created ${plan.route}/${file}`);
    }

    console.log(
        `\n${color.cyan}Page "${name}" created at ${plan.route}/${color.reset}. It will build to ${plan.urlPath}\n`
    );
}
