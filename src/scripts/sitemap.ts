/**
 * Keeps `assets/sitemap.xml` in step with the pages under `src/`.
 *
 * The sitemap is an asset rather than a build output on purpose. Assets reach
 * `dist/` the same way on every path there: `npm run build`, and the dev
 * server's own initial build, which empties the output dir and re-copies
 * assets without ever going through build.ts. The first version of this wrote
 * `dist/sitemap.xml` after the CLI had finished, and `npm run dev` wiped it
 * seconds later.
 *
 * build.ts regenerates the file before the CLI runs, so it can never be behind
 * on a deploy, and sitemap.test.ts fails when the committed copy is behind, so
 * a new page cannot land without its entry being committed alongside it.
 *
 * A page is what the CLI says it is: a `<dir>/index.tsx` that exports `Page`.
 * The export is detected from the source text, which is enough for this site
 * (the CLI itself decides by requiring the compiled module).
 *
 * No `<lastmod>`, `<changefreq>` or `<priority>`: the last two are ignored by
 * every major crawler, and a `lastmod` that is not accurate is worse than none.
 */

import fs from 'node:fs';
import path from 'node:path';
import { absoluteUrl } from '../site';

const PAGE_FILE = 'index.tsx';

const SITEMAP_FILE = 'sitemap.xml';

// `export function Page`, `export async function Page`, `export const Page`.
const EXPORTS_PAGE = /\bexport\s+(?:async\s+)?function\s+Page\b|\bexport\s+(?:const|let)\s+Page\b/;

/**
 * The URL path a page is served at: the root `index.tsx` is `/`, and
 * `about/index.tsx` is `/about/`. Directory URLs, with the trailing slash,
 * because that is what the site links and what the canonical tags name.
 * @param file - input-relative, posix-separated path of a page's `index.tsx`
 */
export function pageUrl(file: string): string {
    return `/${file.replace(/index\.tsx$/, '')}`;
}

/**
 * Every page under `input`, as input-relative posix paths of its `index.tsx`.
 * Walks the source tree the way the CLI does (every `index.tsx`, anywhere),
 * then keeps the ones that export `Page`.
 * @param input - absolute path of the site's input dir
 */
export function sourcePages(input: string): string[] {
    const walk = (dir: string, rel: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const child = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) return walk(path.join(dir, entry.name), child);
            if (entry.name !== PAGE_FILE) return [];
            const source = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
            return EXPORTS_PAGE.test(source) ? [child] : [];
        });

    return walk(input, '');
}

const escapeXml = (s: string): string =>
    s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

/**
 * The sitemap document for a set of pages, sorted so the file is the same
 * from one run to the next whatever order the walk found them in.
 * @param files - input-relative, posix-separated paths of every page file
 */
export function sitemapXml(files: readonly string[]): string {
    const urls = [...files]
        .map(pageUrl)
        .sort()
        .map((url) => `  <url><loc>${escapeXml(absoluteUrl(url))}</loc></url>`);

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls,
        '</urlset>',
        '',
    ].join('\n');
}

/**
 * Regenerate `<assets>/sitemap.xml` from the pages under `input`. Leaves the
 * file untouched when it is already current, so a build does not dirty the
 * working tree for nothing.
 * @param input - absolute path of the site's input dir
 * @param assets - absolute path of the site's assets dir
 * @returns the pages listed and whether the file changed
 */
export function writeSitemap(
    input: string,
    assets: string
): { file: string; pages: string[]; changed: boolean } {
    const file = path.join(assets, SITEMAP_FILE);
    const pages = sourcePages(input);
    const next = sitemapXml(pages);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
    const changed = current !== next;
    if (changed) fs.writeFileSync(file, next);
    return { file, pages, changed };
}
