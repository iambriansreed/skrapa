/**
 * Every local URL the built site references has to name a file the build
 * actually emitted.
 *
 * output-paths.ts checks the paths the build *writes*; nothing checked the
 * paths it *points at*. A page can link `/fonts/archivo.woff2` while the
 * emitted file is `fonts/Archivo.woff2`, and the build still exits 0. The site
 * looks right locally, because macOS (APFS) and Windows fold case when
 * resolving a path, and 404s the moment it is served by a host that does not:
 * a dead PDF download, or a preload plus `@font-face` pair that silently falls
 * back to a system font. Neither is reproducible on the machine the site was
 * previewed on, which is what makes it worth failing a build over.
 *
 * Which is also why the comparison never touches the filesystem:
 *
 *     fs.existsSync(path.join(output, url))   // case-folds on macOS and
 *                                             // Windows, so it passes exactly
 *                                             // the reference being looked for
 *
 * The output tree is walked once into a set of the paths that are really there
 * and every reference is compared against it with string equality, which gives
 * the same answer on every filesystem.
 *
 * References are read from HTML (`href`, `src`, `srcset`) and from CSS
 * (`url()`, `@import`, `image-set()`). Anything that cannot name a file in the
 * build is skipped: another origin, a `data:`/`mailto:`/`tel:` URI, a bare
 * `#fragment`, and whatever matches a glob in `ignore` (the escape hatch for
 * paths something other than the build serves).
 *
 * Resolution goes through `base`, which is the other half of the same failure.
 * A relative URL resolves against the `<base href>` skrapa injects, exactly as
 * a browser would, and a root-relative one has to carry the base itself,
 * because `<base>` does not apply to those. On a project site under `/repo/`,
 * a hand-written `/style.css` is a request to the domain root: it works
 * against a dev server rooted at `/` and 404s once deployed, which is the same
 * shape of bug as the case mismatch above.
 *
 * A message names the closest real file, since a reference that differs from
 * one only in case is unreadable next to it otherwise: the two spellings have
 * to be seen together to be seen at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { unescapeAttr } from './jsx';
import { ATTR } from './rewrite-shell-imports';
import { walk, type Problem } from './output-paths';

/**
 * Files whose references are read. A `.js` bundle can hold a URL too, but only
 * as a string literal indistinguishable from every other string, so guessing
 * there would report the guesses.
 */
const SCANNED = new Set(['.html', '.htm', '.css']);

/** What a directory URL is actually served by. */
const INDEX_FILE = 'index.html';

// ============================================================================
// READING REFERENCES OUT OF A FILE
// ============================================================================

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
// Attribute-aware for the reason given in rewrite-shell-imports.ts: a quoted
// value may contain `>`, which ends a `[^>]*` tag early and leaves the rest of
// it to be read as markup. Each keeps its opening tag and drops only what is
// between the tags, since `<script src>` is a reference like any other.
const SCRIPT_RE = new RegExp(`(<script(?:\\s+${ATTR})*\\s*>)[\\s\\S]*?</script\\s*>`, 'gi');
const STYLE_RE = new RegExp(`(<style(?:\\s+${ATTR})*\\s*>)([\\s\\S]*?)</style\\s*>`, 'gi');
const BASE_TAG_RE = new RegExp(`<base(?:\\s+${ATTR})*\\s*/?>`, 'gi');
const BASE_HREF_RE = new RegExp(
    `<base(?:\\s+${ATTR})*?\\s+href\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i'
);
// A tag, as a name plus its whole attributes, so an attribute is only ever
// read from inside one. Text that merely looks like markup is not markup: this
// project's own docs page renders `&lt;script src="....ts"&gt;` as an example,
// and scanning the raw HTML for attributes reports that escaped sample as a
// missing file.
const TAG_RE = new RegExp(`<[a-zA-Z][^\\s/>]*((?:\\s+${ATTR})*)\\s*/?>`, 'g');
const URL_ATTR_RE = new RegExp(
    `\\s(href|src|srcset|imagesrcset)\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'\`<>]+))`,
    'gi'
);

/**
 * HTML with everything that is not markup taken out of it.
 *
 * What a comment or a script body contains is not a reference: a commented-out
 * tag was deliberately switched off, and a `src="..."` inside client JS is a
 * string whose meaning belongs to the browser and not to the build. Each keeps
 * its opening tag, since `<script src>` is a reference like any other.
 *
 * Everything that reads a file goes through this, so a `<base href>` that only
 * exists inside a comment cannot govern where the rest of the file's URLs
 * resolve from while contributing nothing itself.
 * @param html - the file as it was written
 */
export function sanitizeHtml(html: string): string {
    return html.replace(HTML_COMMENT_RE, '').replace(SCRIPT_RE, (_, open: string) => open);
}

/** Every URL an HTML file references, in document order and as authored. */
export function htmlReferences(html: string): string[] {
    const refs: string[] = [];

    // Idempotent, so this is a no-op when the caller has already done it. A
    // commented-out `<style>` block is as switched off as a commented-out
    // `<img>`, and a stylesheet written into a string inside client JS is that
    // program's business; reading the raw HTML first collects the url()s of
    // both and fails the build over them.
    const sanitized = sanitizeHtml(html);

    // An inline <style> holds CSS, and its url()s are references like any other.
    for (const style of sanitized.matchAll(STYLE_RE)) refs.push(...cssReferences(style[2]));

    // The style bodies just read, and `<base>`, whose href says where the other
    // URLs resolve from rather than naming a file.
    const markup = sanitized.replace(STYLE_RE, (_, open: string) => open).replace(BASE_TAG_RE, '');

    for (const tag of markup.matchAll(TAG_RE)) {
        for (const attr of tag[1].matchAll(URL_ATTR_RE)) {
            const name = attr[1].toLowerCase();
            // Decoded, so `&amp;` is compared as the character it stands for.
            const value = unescapeAttr(attr[2] ?? attr[3] ?? attr[4] ?? '');
            refs.push(...(name.endsWith('srcset') ? srcsetUrls(value) : [value]));
        }
    }

    return refs.map((ref) => ref.trim()).filter(Boolean);
}

/**
 * The URLs in a `srcset` / `imagesrcset` value: several candidates, each a URL
 * followed by an optional descriptor (`logo.png 2x`, `hero.jpg 640w`). All of
 * them, since a check that read only the first would pass a build whose 2x
 * image is missing.
 *
 * Split on whitespace rather than on commas, which is what the HTML srcset
 * grammar actually does: a candidate's URL is a run of non-whitespace, so the
 * commas inside a `data:` URI's base64 payload belong to it. Splitting on
 * commas instead breaks one of those into fragments that read as relative
 * paths, and skipping any value containing a `data:` URI to avoid that (which
 * is what this did first) drops the real candidates sitting beside it.
 * @param value - the attribute value, already entity-decoded
 */
function srcsetUrls(value: string): string[] {
    const urls: string[] = [];
    const isSpace = (char: string) => /\s/.test(char);
    let i = 0;

    while (i < value.length) {
        // Whitespace and the commas between candidates.
        while (i < value.length && (isSpace(value[i]) || value[i] === ',')) i++;
        if (i >= value.length) break;

        // The URL: everything up to the next whitespace, commas included.
        const start = i;
        while (i < value.length && !isSpace(value[i])) i++;
        const raw = value.slice(start, i);
        const url = raw.replace(/,+$/, '');
        if (url) urls.push(url);

        // A URL ending in a comma has closed its own candidate. Otherwise a
        // descriptor follows, and it runs to the comma that closes it, which
        // need not have a space after it: in `/a.png 1x,/b.png 2x` that comma
        // is what separates the two candidates, and reading the descriptor as
        // a whitespace-delimited token swallows the second URL with it.
        if (raw.endsWith(',')) continue;
        for (let depth = 0; i < value.length; i++) {
            const char = value[i];
            if (char === '(') depth++;
            else if (char === ')') depth = Math.max(0, depth - 1);
            else if (char === ',' && depth === 0) {
                i++;
                break;
            }
        }
    }

    return urls;
}

const CSS_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const CSS_URL_RE = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;
// The bare-string form; `@import url(...)` is already found by CSS_URL_RE.
const CSS_IMPORT_RE = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
const IMAGE_SET_RE = /(?:-webkit-)?image-set\(/gi;
const CSS_STRING_RE = /"([^"]*)"|'([^']*)'/g;
// An image-set candidate's `type("image/avif")`: a MIME type, not a file.
const CSS_TYPE_DESCRIPTOR_RE = /\btype\(\s*(?:"[^"]*"|'[^']*')\s*\)/gi;

/** Every URL a stylesheet references, in source order and as authored. */
export function cssReferences(css: string): string[] {
    const source = css.replace(CSS_COMMENT_RE, '');
    const refs: string[] = [];

    for (const url of source.matchAll(CSS_URL_RE)) refs.push(url[1] ?? url[2] ?? url[3] ?? '');
    for (const imported of source.matchAll(CSS_IMPORT_RE)) refs.push(imported[1] ?? imported[2]);
    refs.push(...imageSetStrings(source));

    return refs.map((ref) => ref.trim()).filter(Boolean);
}

/**
 * The bare-string candidates in every `image-set()`.
 *
 * `image-set()` takes several candidates, each a `url()` *or* a plain string,
 * plus a resolution or type descriptor. The `url()` ones are already found by
 * {@link CSS_URL_RE}, so only the strings are read here. The body is scanned by
 * counting parentheses rather than matched with a regex, since a nested
 * `url(...)` closes a `[^)]*` body early and hides every candidate after it.
 *
 * A `type()` descriptor is dropped first. Its argument is a quoted MIME type,
 * so reading every string in the body turns the perfectly ordinary
 * `image-set("hero.avif" type("image/avif"))` into a build failure over a file
 * named `image/avif`.
 * @param css - stylesheet source, comments already removed
 */
function imageSetStrings(css: string): string[] {
    const refs: string[] = [];

    for (const start of css.matchAll(IMAGE_SET_RE)) {
        const from = (start.index ?? 0) + start[0].length;
        let depth = 1;
        let to = from;
        for (; to < css.length && depth > 0; to++) {
            if (css[to] === '(') depth++;
            else if (css[to] === ')') depth--;
        }

        const body = css.slice(from, to - 1).replace(CSS_TYPE_DESCRIPTOR_RE, '');
        for (const string of body.matchAll(CSS_STRING_RE)) refs.push(string[1] ?? string[2]);
    }

    return refs;
}

// ============================================================================
// RESOLVING A REFERENCE TO AN OUTPUT PATH
// ============================================================================

/** A reference that cannot name a file in the build, whatever is on disk. */
function isExternal(url: string): boolean {
    return (
        url === '' ||
        url.startsWith('#') || // same document
        url.startsWith('//') || // protocol-relative: another origin
        // http:, https:, data:, mailto:, tel:, and every other scheme
        /^[a-z][a-z0-9+.-]*:/i.test(url)
    );
}

/**
 * A reference reduced to the path part it names, or `null` when it names
 * nothing in the build.
 *
 * The query and the fragment go first: `/style.css?v=2` and `/about#team` are
 * the same two files with or without them. Percent-encoding is decoded, since
 * `/my%20file.png` is the file `my file.png`, and the result is NFC-normalized
 * to match the emitted paths (macOS hands back decomposed filenames where git
 * and Linux keep them composed).
 * @param url - the URL exactly as it was authored
 */
function cleanUrl(url: string): string | null {
    if (isExternal(url)) return null;

    const withoutSuffix = url.split(/[?#]/)[0];
    if (!withoutSuffix) return null;

    try {
        return decodeURIComponent(withoutSuffix).normalize('NFC');
    } catch {
        // A malformed escape (`%zz`) is not decodable; compare it as written
        // rather than dropping the reference.
        return withoutSuffix.normalize('NFC');
    }
}

/** Where a reference points, once resolved. */
type Resolved = {
    /** The site-absolute URL path, e.g. `/repo/style.css`. */
    absolute: string;
    /** Where that lands in the output tree, e.g. `style.css`. */
    target: string;
    /**
     * Whether it points outside the site's base path, and so at nothing this
     * build produced. `target` is still filled in, from the path the URL would
     * have named at the root, so the message can suggest it with the base on.
     */
    outsideBase: boolean;
};

/**
 * @param url - a cleaned, local URL
 * @param fromDir - the site-absolute directory a relative URL resolves
 *   against, ending in a slash (see {@link referenceDir})
 * @param base - the site's normalized base path, always slash-terminated
 */
function resolveUrl(url: string, fromDir: string, base: string): Resolved {
    const absolute = url.startsWith('/')
        ? path.posix.normalize(url)
        : // resolve() drops a trailing slash, which is the difference between a
          // directory URL and a file of the same name; put it back.
          path.posix.resolve(fromDir, url) + (url.endsWith('/') ? '/' : '');

    // The base prefix is not part of any path in the output tree, so it comes
    // off. A URL that does not carry it is not below the site at all: with
    // `<base href="/repo/">` injected, `/style.css` means the domain root,
    // which is not where the build was deployed, and only relative URLs are
    // resolved against the base by the browser. At the default base nothing can
    // be outside it, so this only ever fires on a subpath deploy.
    const atBase = `${absolute}/` === base || absolute.startsWith(base);

    return {
        absolute,
        target: atBase ? absolute.slice(base.length) : absolute.replace(/^\/+/, ''),
        outsideBase: !atBase,
    };
}

/**
 * The output paths a resolved URL could legitimately name.
 *
 * A directory is served by the index.html inside it, so `/about/` and `/about`
 * both mean `about/index.html`, and `/` means `index.html`.
 * @param target - an output-relative path from {@link resolveUrl}
 */
function candidates(target: string): string[] {
    const clean = target.replace(/\/+$/, '');
    return clean === '' ? [INDEX_FILE] : [clean, `${clean}/${INDEX_FILE}`];
}

/**
 * The directory a relative reference inside `rel` resolves against, as a
 * site-absolute path ending in a slash.
 *
 * For CSS it is always the stylesheet's own directory: a `url()` is relative to
 * the sheet, never to the page that linked it. For HTML it is the document's
 * `<base href>`, which every page skrapa renders carries (that is what makes
 * `<link href="skrapa.svg">` resolve the same from `/` and from `/about/`), and
 * the document's own directory otherwise, which is the case for an HTML file
 * copied straight out of the assets dir.
 * @param rel - the file's own output-relative path
 * @param base - the site's normalized base path
 * @param html - the file's contents when it is HTML, `null` when it is CSS
 */
function referenceDir(rel: string, base: string, html: string | null): string {
    const own = path.posix.dirname(`${base}${rel}`);
    const ownDir = own.endsWith('/') ? own : `${own}/`;

    // Only the first <base> counts, and only a root-relative one is followed:
    // a document based on another origin has nothing here to resolve against.
    // Two groups because the value may be quoted either way, and exactly one of
    // them is set.
    const found = html === null ? null : html.match(BASE_HREF_RE);
    const declared = found ? (found[1] ?? found[2]) : undefined;
    if (!declared?.startsWith('/')) return ownDir;

    return declared.endsWith('/') ? declared : `${path.posix.dirname(declared)}/`;
}

// ============================================================================
// THE OUTPUT TREE, AND THE CLOSEST THING IN IT
// ============================================================================

/** One emitted file, under the two names it needs. */
type OutputFile = {
    /**
     * Output-relative, posix-separated and NFC-normalized: the form every URL
     * is compared against.
     */
    key: string;
    /**
     * Its absolute path, spelled the way the filesystem spells it.
     *
     * Kept apart from `key` because normalizing is not free: a name stored
     * decomposed is a *different* name to a filesystem that does not fold the
     * two (Linux does not), so reading the NFC form back throws ENOENT and
     * takes the build down with it. macOS hands back decomposed names as a
     * matter of course, so this is one `git clone` away on CI.
     */
    file: string;
};

/** The emitted files, as the deployed host would see them. */
type OutputFiles = {
    /** Every emitted file, in walk order. */
    all: OutputFile[];
    /** Just the keys, for the near-match search. */
    keys: string[];
    /** Exact, case-sensitive membership: the whole point of this module. */
    has(key: string): boolean;
    /** Lowercased key to the real key, for the case-only near match. */
    byLower: Map<string, string>;
    /** Lowercased filename to the keys carrying it. */
    byName: Map<string, string[]>;
};

/** The contents of `file`, or `null` when it cannot be read at all. */
function readOrSkip(file: string): string | null {
    try {
        return fs.readFileSync(file, 'utf-8');
    } catch {
        return null;
    }
}

/** Walk `output` once into the lookups every reference is checked against. */
function readOutputFiles(output: string): OutputFiles {
    const all = walk(output).map((rel) => ({
        key: rel.split(path.sep).join('/').normalize('NFC'),
        file: path.join(output, rel),
    }));
    const keys = all.map(({ key }) => key);
    const exact = new Set(keys);
    const byLower = new Map<string, string>();
    const byName = new Map<string, string[]>();

    for (const key of keys) {
        // First writer wins, so the suggestion is stable rather than depending
        // on which of two case variants the walk reached last.
        const lower = key.toLowerCase();
        if (!byLower.has(lower)) byLower.set(lower, key);

        const name = path.posix.basename(lower);
        byName.set(name, [...(byName.get(name) ?? []), key]);
    }

    return { all, keys, has: (key) => exact.has(key), byLower, byName };
}

/**
 * The real file a broken reference most likely meant, or `undefined` when
 * nothing is close enough to be worth naming.
 * @param target - the output-relative path the reference resolved to
 * @param files - the emitted tree
 */
function closestFile(target: string, files: OutputFiles): string | undefined {
    const wanted = candidates(target);

    // A case-only difference first. It is the failure this module exists for,
    // and the one that cannot be reproduced on the machine that shipped it.
    for (const candidate of wanted) {
        const hit = files.byLower.get(candidate.toLowerCase());
        if (hit) return hit;
    }

    // Then the same filename somewhere else in the tree, which is what a moved
    // file, or one referenced from the wrong directory, looks like.
    const sameName = files.byName.get(path.posix.basename(wanted[0]).toLowerCase());
    if (sameName?.length) return nearest(wanted[0], sameName);

    // Then whatever is closest overall, if it is close enough to be a typo, a
    // wrong extension or a dropped word rather than a coincidence.
    const best = nearest(wanted[0], files.keys);
    const limit = Math.max(2, Math.floor(wanted[0].length / 4));
    return best && distance(wanted[0].toLowerCase(), best.toLowerCase()) <= limit
        ? best
        : undefined;
}

/** The entry of `files` with the smallest {@link distance} to `target`. */
function nearest(target: string, files: string[]): string | undefined {
    let best: string | undefined;
    let bestDistance = Infinity;

    for (const file of files) {
        const d = distance(target.toLowerCase(), file.toLowerCase());
        if (d < bestDistance) {
            best = file;
            bestDistance = d;
        }
    }

    return best;
}

/** Levenshtein distance, computed one row at a time. */
function distance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(
                previous[j] + 1, // deletion
                row[j - 1] + 1, // insertion
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
            );
        }
        previous = row;
    }

    return previous[b.length];
}

/**
 * The suggestion to print for a broken reference: the URL that file is really
 * served at, shaped like the reference so the two can be read against each
 * other. A page reached as a directory is suggested as one rather than as its
 * index.html.
 * @param file - the real output-relative path to suggest
 * @param reference - the cleaned URL that failed to resolve
 * @param base - the site's normalized base path
 */
function suggestedUrl(file: string, reference: string, base: string): string {
    const isIndex = file === INDEX_FILE || file.endsWith(`/${INDEX_FILE}`);
    const shown =
        isIndex && !reference.toLowerCase().endsWith(INDEX_FILE)
            ? file.slice(0, -INDEX_FILE.length)
            : file;

    return `${base}${shown}`;
}

/** Whether two URLs are the same but for case, trailing slashes aside. */
function sameButForCase(a: string, b: string): boolean {
    const trim = (url: string) => url.replace(/\/+$/, '').toLowerCase();
    return a !== b && trim(a) === trim(b);
}

// ============================================================================
// IGNORE GLOBS
// ============================================================================

/**
 * A glob as a regular expression: `*` matches within one path segment, `**`
 * across them, `?` matches one character. Anchored, so a pattern describes the
 * whole URL rather than a piece of it.
 *
 * A trailing `/**` covers the path itself as well as everything under it.
 * `ignore: ['/api/**']` is someone saying the API is not theirs to serve, and
 * having to write `/api` beside it to cover the bare URL is a papercut that
 * only shows up as a failed build.
 * @param glob - a pattern from the `ignore` config
 */
export function globToRegExp(glob: string): RegExp {
    const subtree = glob.endsWith('/**');
    // Split on `**` first, so the single-segment `*` substitution below
    // cannot eat half of one.
    const source = (subtree ? glob.slice(0, -'/**'.length) : glob)
        .split('**')
        .map((part) =>
            part
                // Everything a regex would read as syntax, minus the glob
                // wildcards `*` and `?`, which are substituted after it.
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '[^/]*')
                .replace(/\?/g, '[^/]')
        )
        .join('.*');

    return new RegExp(`^${source}${subtree ? '(?:/.*)?' : ''}$`);
}

// ============================================================================
// THE CHECK
// ============================================================================

/**
 * Check every local reference in the built site against the files it emitted.
 *
 * Runs over the output tree rather than over the sources, so it sees the site
 * exactly as it will be served: pages, the scripts and stylesheets the render
 * emitted, and everything copied out of the assets dir. Which means it has to
 * run *after* the assets copy, or every reference to an asset would be reported
 * as missing.
 *
 * References are grouped by where they point, so a bad URL in a shared shell is
 * one problem naming the pages that carry it rather than one problem per page.
 * The same URL written in two directories is two problems, since a relative URL
 * means something different in each.
 * @param output - absolute output dir
 * @param base - the site's normalized base path, always slash-terminated
 * @param ignore - globs for URLs served by something other than the build
 * @returns every unresolved reference, in walk order
 */
export function checkLinks(
    output: string,
    base: string,
    ignore: readonly string[] = []
): Problem[] {
    if (!fs.existsSync(output)) return [];

    const files = readOutputFiles(output);
    const ignored = ignore.map(globToRegExp);
    const groups = new Map<
        string,
        { reference: string; absolute: string; target: string; files: string[] }
    >();

    for (const { key: rel, file } of files.all) {
        const extension = path.posix.extname(rel).toLowerCase();
        if (!SCANNED.has(extension)) continue;

        const isCss = extension === '.css';

        // A path the walk found is not always a file that can be read: a
        // dangling symlink is copied through as the link it is, and in dev the
        // assets watcher can move one out from under this loop mid-run. Neither
        // has references to check, and neither is worth ending a build with a
        // stack trace over. `walk`'s other caller only ever compared path
        // strings, so this is the first code here to actually open them.
        const text = readOrSkip(file);
        if (text === null) continue;
        // Sanitized once, and used for both the references and the `<base>`
        // that says where they resolve from. Reading the base off the raw text
        // instead lets a commented-out `<base href>` govern every URL in the
        // file while contributing nothing itself.
        const source = isCss ? text : sanitizeHtml(text);
        const fromDir = referenceDir(rel, base, isCss ? null : source);
        // One report per URL per file: a stylesheet linked in every page of a
        // nav is still one reference to check.
        const seen = new Set<string>();

        for (const authored of isCss ? cssReferences(source) : htmlReferences(source)) {
            const url = cleanUrl(authored);
            if (url === null || seen.has(url)) continue;
            seen.add(url);

            const { absolute, target, outsideBase } = resolveUrl(url, fromDir, base);

            // Matched against both spellings, so `/uploads/**` covers a
            // page-relative `../uploads/brief.pdf` as well as the literal one.
            if (ignored.some((glob) => glob.test(url) || glob.test(absolute))) continue;

            if (!outsideBase && candidates(target).some((candidate) => files.has(candidate)))
                continue;

            // A pair rather than a joined string: no separator character
            // is impossible in both halves, and two references sharing a
            // key would be reported as one.
            const key = JSON.stringify([url, target]);
            const group = groups.get(key) ?? { reference: url, absolute, target, files: [] };
            group.files.push(file);
            groups.set(key, group);
        }
    }

    return [...groups.values()].map((group) => {
        const closest = closestFile(group.target, files);
        const url = closest && suggestedUrl(closest, group.reference, base);

        return {
            rule: 'link',
            outPath: group.files[0],
            files: group.files,
            reference: group.reference,
            // A suggestion identical to the reference would say nothing; that
            // it did not resolve is already the message.
            //
            // Judged against where the reference points rather than how it was
            // spelled, since the suggestion is a URL from the site root and the
            // reference need not be: comparing `x/Resume.pdf` with a relative
            // `resume.pdf` finds a difference beyond case that is not there,
            // and withholds the one explanation that would have helped.
            suggestion:
                url && url !== group.reference
                    ? { url, caseOnly: sameButForCase(url, group.absolute) }
                    : undefined,
            assetOnly: false,
        };
    });
}
