/**
 * `skrapa page` scaffolds a new page.
 *
 * Creates `<input>/<parent>/<slug>/` with four files: `index.tsx` (the `Page`),
 * its own `index.html` shell, a `style.css`, and a `client.ts`. The pretty name
 * is slugified into the directory name and used as the page's `<h1>`/`<title>`.
 * Existing files are never overwritten.
 *
 * Positional args:
 * - `<name>`   (required) pretty name, e.g. `"About Us"`
 * - `[parent]` (optional) parent route to nest under, e.g. `"blog"`
 * @param overrideConfig - {@link Skrapa.Config}; `page` reads `input` and the
 *   resolved `root` from it, so `--input` / `--root` and a programmatic override
 *   all work the same as the other commands.
 */

import fs from 'node:fs';
import path from 'node:path';
import { color, log } from './utils';
import { loadConfig, positionalArgs } from './config';

export const slugify = (s: string): string =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

export type PagePlan = {
    /** Slugified directory name, e.g. "about-us". */
    slug: string;
    /** Input-relative posix path of the page dir, e.g. "src/blog/about-us". */
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
 * the name has no usable characters. Does not touch the filesystem.
 * @param opts
 * @param opts.name
 * @param opts.parent
 * @param opts.input
 * @param opts.root
 */
export function planPage(opts: {
    name: string;
    parent?: string;
    input?: string;
    root: string;
}): PagePlan {
    const { name, root } = opts;
    const input = opts.input || 'src';

    const slug = slugify(name);
    if (!slug) throw new Error(`"${name}" has no letters or numbers to build a page name from.`);

    // Normalize an optional parent route (strip surrounding slashes) so nesting
    // like `skrapa page "First Post" blog` lands at <input>/blog/first-post.
    const parent = path.posix.normalize((opts.parent ?? '').replace(/^\/+|\/+$/g, ''));

    // After normalizing, a parent that still climbs (`..`, `a/../../b`) would
    // scaffold outside the input dir: files land in a surprising place and the
    // page never builds, since the build only scans the input tree. Refuse it
    // rather than write somewhere the user did not mean.
    if (parent === '..' || parent.startsWith('../')) {
        throw new Error(
            `parent "${opts.parent}" points outside the input directory; pages must live under ${input}/.`
        );
    }
    const route = path.posix.join(input, parent, slug);
    const urlPath = `/${path.posix.join(parent, slug)}/`;
    const dir = path.join(root, input, parent, slug);

    const files: Record<string, string> = {
        'index.tsx': `export function Page(): Skrapa.Page {
    return (
        <main class="${slug}">
            <h1>${name}</h1>
            <p>
                New page scaffolded by Skrapa. Edit <code>${route}/index.tsx</code> and save to see
                it live-reload.
            </p>
            <p>
                <a href="/">← Home</a>
            </p>
        </main>
    );
}
`,
        'index.html': `<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${name}</title>
        <link rel="stylesheet" href="/style.css" />
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
    // appearing in any order (e.g. `page "About" --root site`).
    const [name, parent] = positionalArgs();

    if (!name) {
        log.error('Usage: npx skrapa page "<name>" [parent]');
        process.exit(1);
    }

    // Same config precedence as the other commands (see config.ts); page only
    // needs `input` and the resolved `root`, not the full build context.
    const { config } = loadConfig(overrideConfig);

    let plan: PagePlan;
    try {
        plan = planPage({
            name,
            parent,
            input: config.input,
            root: config.root,
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
