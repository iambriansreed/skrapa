import { absoluteUrl, AUTHOR, GITHUB_URL, NPM_URL, SITE_NAME, SITE_URL, TAGLINE } from '../site';

/**
 * Everything a page has to say about itself to a crawler or a link unfurler,
 * in one call. Returns the `title` and `head` halves of a `Skrapa.Page`, so a
 * page spreads it: `return { ...seo({ ... }), body: <main>...</main> }`.
 *
 * The shell (`src/index.html`) deliberately carries no description or Open
 * Graph tags of its own. A tag that lives in the shell is the same on every
 * page, and three pages sharing one title and description is what a search
 * engine reads as three copies of one page. Every page therefore goes
 * through here, and a new page that skips this ships without a description.
 *
 * What is emitted, and why each is there:
 * - `<link rel="canonical">`: the one URL this page should rank under, so
 *   `/docs`, `/docs/` and `/docs/index.html` all count as the same page.
 * - `<meta name="description">`: the snippet under the result.
 * - Open Graph and Twitter card tags: the title, blurb and image a link gets
 *   when pasted into Slack, GitHub, X, LinkedIn, iMessage. Without an image a
 *   link is a bare URL.
 * - JSON-LD: the page, the site, the software and its author as one graph,
 *   so a crawler learns that Skrapa is a free developer tool by a named
 *   person, rather than inferring it from prose.
 */
type PageSeo = {
    /** Site-absolute path of the page, with its trailing slash: `/`, `/docs/`. */
    path: string;
    /** The document `<title>`, also the social title. Under about 60 characters. */
    title: string;
    /** The meta and social description. Under about 155 characters. */
    description: string;
    /**
     * `og:type`. `website` for the home page; `article` for a page that is
     * about one thing, which gets it a richer unfurl on some platforms.
     */
    type?: 'website' | 'article';
    /**
     * The schema.org type of the page node. `WebPage` unless the page is one
     * of the more specific kinds a crawler can do something with.
     */
    schemaType?: 'WebPage' | 'AboutPage' | 'TechArticle';
    /**
     * The page's label in a `Home > Label` breadcrumb trail. Omit for the home
     * page, which is the trail's root.
     */
    breadcrumb?: string;
};

/** The one social image, shared by every page. Rendered by `npm run og-image`. */
const OG_IMAGE = {
    url: absoluteUrl('/og.png'),
    width: '1200',
    height: '630',
    alt: `${SITE_NAME}: ${TAGLINE}`,
};

// Stable node ids, so the page-specific nodes can point at the shared ones
// instead of repeating them.
const WEBSITE_ID = `${SITE_URL}/#website`;
const SOFTWARE_ID = `${SITE_URL}/#software`;
const AUTHOR_ID = `${SITE_URL}/#author`;

const SITE_DESCRIPTION =
    'A zero-dependency static site generator that renders TypeScript JSX to static HTML at build time and compiles client TypeScript to standalone scripts. Run with npx, never installed.';

/** The nodes every page's graph carries: the site, the tool, and who made it. */
const SHARED_NODES = [
    {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: SITE_DESCRIPTION,
        inLanguage: 'en',
        about: { '@id': SOFTWARE_ID },
        publisher: { '@id': AUTHOR_ID },
    },
    {
        '@type': 'SoftwareApplication',
        '@id': SOFTWARE_ID,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: SITE_DESCRIPTION,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'macOS, Linux',
        softwareRequirements: 'Node.js >=24',
        // Baked in at bundle time, so the deployed site names the version on
        // the registry (the site is deployed from the release tag).
        softwareVersion: VERSION,
        license: 'https://opensource.org/license/mit',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        downloadUrl: NPM_URL,
        sameAs: [GITHUB_URL, NPM_URL],
        author: { '@id': AUTHOR_ID },
    },
    {
        '@type': 'Person',
        '@id': AUTHOR_ID,
        name: AUTHOR.name,
        url: AUTHOR.url,
        sameAs: [AUTHOR.github],
    },
];

export function seo(page: PageSeo): Pick<Exclude<Skrapa.Page, JSX.Element>, 'title' | 'head'> {
    const url = absoluteUrl(page.path);
    const breadcrumbId = `${url}#breadcrumb`;

    const pageNode: Record<string, unknown> = {
        '@type': page.schemaType ?? 'WebPage',
        '@id': url,
        url,
        name: page.title,
        headline: page.title,
        description: page.description,
        inLanguage: 'en',
        isPartOf: { '@id': WEBSITE_ID },
        about: { '@id': SOFTWARE_ID },
        author: { '@id': AUTHOR_ID },
        primaryImageOfPage: { '@type': 'ImageObject', url: OG_IMAGE.url },
    };

    const nodes: object[] = [pageNode];

    if (page.breadcrumb) {
        pageNode.breadcrumb = { '@id': breadcrumbId };
        nodes.push({
            '@type': 'BreadcrumbList',
            '@id': breadcrumbId,
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
                { '@type': 'ListItem', position: 2, name: page.breadcrumb, item: url },
            ],
        });
    }

    nodes.push(...SHARED_NODES);

    // `<` escaped so a description containing `</script>` cannot end the
    // block early; JSON allows the escape and every parser reads it back as
    // the same character.
    const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(
        /</g,
        '\\u003c'
    );

    const head = (
        <>
            <link rel="canonical" href={url} />
            <meta name="description" content={page.description} />
            <meta property="og:type" content={page.type ?? 'website'} />
            <meta property="og:site_name" content={SITE_NAME} />
            <meta property="og:locale" content="en_US" />
            <meta property="og:url" content={url} />
            <meta property="og:title" content={page.title} />
            <meta property="og:description" content={page.description} />
            <meta property="og:image" content={OG_IMAGE.url} />
            <meta property="og:image:type" content="image/png" />
            <meta property="og:image:width" content={OG_IMAGE.width} />
            <meta property="og:image:height" content={OG_IMAGE.height} />
            <meta property="og:image:alt" content={OG_IMAGE.alt} />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={page.title} />
            <meta name="twitter:description" content={page.description} />
            <meta name="twitter:image" content={OG_IMAGE.url} />
            <meta name="twitter:image:alt" content={OG_IMAGE.alt} />
            <script type="application/ld+json">{raw(jsonLd)}</script>
        </>
    );

    return { title: page.title, head: String(head) };
}
