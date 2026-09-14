/**
 * Facts about the deployed site that more than one file needs: the pages (for
 * canonical URLs, Open Graph and JSON-LD), the sitemap the build writes, and
 * the social card `npm run og-image` renders.
 *
 * Kept apart from the `skrapa` key in `web/tsconfig.json` on purpose. Its
 * `origin` is where the dev server is reached through a local proxy, not
 * where the site is deployed, and nothing in the config knows the production
 * hostname. That lives in `web/assets/CNAME` for GitHub Pages and here for
 * everything the pages have to say about themselves.
 */

/** The production origin, with no trailing slash. */
export const SITE_URL = 'https://skrapa.iambrian.com';

export const SITE_NAME = 'Skrapa';

/** The hero heading, also the line under the wordmark on the social card. */
export const TAGLINE = 'The static site generator for TypeScript JSX';

export const GITHUB_URL = 'https://github.com/iambriansreed/skrapa';

export const NPM_URL = 'https://www.npmjs.com/package/skrapa';

export const AUTHOR = {
    name: 'Brian Reed',
    url: 'https://iambrian.com',
    github: 'https://github.com/iambriansreed',
};

/**
 * A site-absolute path as the full URL it is served at, e.g. `/docs/` to
 * `https://skrapa.iambrian.com/docs/`. Canonical links, `og:url` and sitemap
 * entries all have to be absolute; a relative one is read against whatever
 * page (or scraper) happens to be looking.
 */
export function absoluteUrl(sitePath: string): string {
    return new URL(sitePath, SITE_URL).href;
}
