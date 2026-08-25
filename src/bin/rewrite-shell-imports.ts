// The shell-import rewrite: finds every client `<script src="....ts">` and
// `<link rel="stylesheet" href="....css">`, emits the built file, and points
// the tag at it. Lives in its own module so it can be unit-tested without
// importing the command that drives it.

import fs from 'node:fs';
import path from 'node:path';
import { bundleModules } from './bundle';
import { CWD_DIR, log } from './utils';
import type { Emitted, EmittedPaths } from './output-paths';

// One attribute: a name, optionally followed by ="value" / ='value' / bare.
// A quoted value may contain `>`, so the tag's extent has to be found by
// matching whole attributes rather than scanning to the first `>`: on
// `<body title="a > b" class="c">`, a `[^>]*` tag pattern ends the tag inside
// the title and spills the remainder into the document as text. Mirrors the
// same pattern in format-html.ts, which solves this for the pretty-printer.
export const ATTR = `[^\\s"'>/=]+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'>\`]+))?`;

/**
 * The resolved directories the rewriters below read from and write to, the base
 * path every URL they write is served under, and where to note down what they
 * wrote.
 */
export type RewriteDirs = {
    /** Absolute input dir, where the source `index.html` and CSS live. */
    input: string;
    /** Absolute output dir the build writes to. */
    output: string;
    /** Absolute assets dir, or `''` when the project has none. */
    assets: string;
    /** Absolute compiled-JS dir (`.skrapa/<input>`), for client bundles. */
    compiled: string;
    /**
     * The site's base path, always slash-terminated (`'/'`, `'/repo/'`).
     *
     * Every path written below is root-relative, and `<base href>` governs
     * relative URLs only, so the base has to be part of the path itself.
     * Without it a project site under `/repo/` gets `<script src="/client.js">`,
     * which is a request to the domain root and a 404 on the deployed site
     * while working perfectly against a dev server rooted at `/`.
     */
    base: string;
    /**
     * Where every emitted file is recorded, so the rules in output-paths.ts
     * can be checked against it before anything is copied over the output.
     * Optional: a caller with no output tree to validate, the unit tests among
     * them, can leave it out.
     */
    emitted?: EmittedPaths;
};

/**
 * Where a missing relative stylesheet probably actually is.
 *
 * `./style.css` means "next to the file that wrote this tag", so it can never
 * name a file in the assets dir no matter what is in there: assets are copied
 * to the *output root*, which only a root-relative `/style.css` reaches. That
 * is a genuinely easy thing to get wrong, and the resulting warning is baffling
 * when the file is sitting in assets in plain sight. Look for it and say so.
 * @param dirs - resolved build directories; no assets dir means no hint
 * @param rel - the missing path, relative to the input root
 * @returns the root-relative href to suggest, or undefined if nothing matches
 */
function assetsHintFor(dirs: RewriteDirs, rel: string): string | undefined {
    if (!dirs.assets) return undefined;
    // Same path first, then the bare filename: a page at src/about/ writing
    // `./style.css` is looking for assets/about/style.css if that exists, but
    // far more often just means assets/style.css.
    const candidates = [rel, path.posix.basename(rel)];
    const hit = candidates.find((c) => fs.existsSync(path.join(dirs.assets, c)));
    return hit && `/${hit}`;
}

// Report every location checked for a missing stylesheet, plus the file that
// referenced it, so a bad href is easy to track down.
function warnStylesheetNotFound(
    href: string,
    referencedIn: string,
    checked: string[],
    assetsHint?: string
) {
    const locations = checked.map((p) => path.relative(CWD_DIR, p)).join(', ');
    const hint = assetsHint
        ? ` Assets are copied to the output root, so reference it as "${assetsHint}".`
        : '';
    log.warn(
        `Stylesheet not found: ${href} (referenced in ${path.relative(CWD_DIR, referencedIn)}). Looked in: ${locations}.${hint} Skipping.`
    );
}

// Every write this module makes goes through here, so recording what came out
// of it cannot be forgotten at one of the three call sites below.
function writeOut(
    dirs: RewriteDirs,
    outPath: string,
    emitted: Emitted,
    write: (to: string) => void
) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    write(outPath);
    dirs.emitted?.record(outPath, emitted);
}

// A client script or a stylesheet link, whichever comes first. One pattern for
// both because finding the tag is the hard part and it is identical work: a
// quoted value may contain `>`, so the tag's extent has to be found by matching
// whole attributes. Scanning to the first `>` ends `<script data-x="a > b">`
// early, the pattern then fails to find `</script>`, and the tag is skipped in
// silence, shipping a `src="....ts"` that 404s in the browser.
const IMPORT_TAG_RE = new RegExp(
    `<script((?:\\s+${ATTR})*)\\s*>\\s*</script>|<link((?:\\s+${ATTR})*)\\s*/?>`,
    'gi'
);

// Tells a stylesheet apart from every other use of `<link>` (icons, preload,
// preconnect). Case-insensitive because attribute names are, and because the
// `rel` keywords themselves are matched ASCII case-insensitively, so
// `REL="Stylesheet"` is the same link. That is specific to `rel`: most
// attribute values, `class` and `id` among them, are case-sensitive.
const CSS_LINK_RE = /\srel\s*=\s*(["'])stylesheet\1/i;

/**
 * Resolve, emit and rewrite the path of everything a shell imports: client
 * `<script src="....ts">` and `<link rel="stylesheet" href="....css">`.
 *
 * The two share everything up to the point of emitting:
 *
 * - Found the same way: one tag pattern matches both (see
 *   {@link IMPORT_TAG_RE}), and each names its file in a single attribute,
 *   `src` for a script, `href` for a stylesheet.
 * - Resolved the same way: a relative path resolves against `templateDir`; a
 *   leading-`/` path resolves from the input root; a URL on another origin is
 *   left untouched.
 * - Emitted differently, and completely so: a script is bundled out of the
 *   compiled tree into a new `.js`; a stylesheet is copied from the input
 *   tree byte-for-byte.
 * - Written back the same way: as `<base><output path>`, so the tag names the
 *   URL the file is actually served at under a subpath deploy.
 * @param html - the HTML to rewrite: a whole shell, or a page body before it
 *   is spliced into one
 * @param sourceDir - the directory the HTML was authored in, as a
 *   posix-style path relative to the input root (`''` for the root shell,
 *   `'blog/post'` for a nested page). Relative `src`/`href` paths resolve
 *   against it, which is what makes `./style.css` mean "next to the file that
 *   wrote this tag" whether that file is a shell or a page's JSX.
 * @param dirs - the absolute directories the rewrite reads from and writes to,
 *   plus the base every path it writes is prefixed with; see
 *   {@link RewriteDirs} for what each one is
 * @param referencedIn - the path to show as the source of a bad `href` in the
 *   "stylesheet not found" warning. Defaults to the shell at
 *   `<sourceDir>/index.html`, which is right for every shell pass; a
 *   page-body pass passes its own `index.tsx`, since blaming the shell for a
 *   link it never contained would send the reader to the wrong file.
 * @returns the HTML with every script and stylesheet it could resolve now
 *   pointing at its built path
 */
export function rewriteShellImports(
    html: string,
    sourceDir: string,
    dirs: RewriteDirs,
    referencedIn = path.join(dirs.input, sourceDir, 'index.html')
): string {
    return html.replace(IMPORT_TAG_RE, (tag: string, scriptAttrs?: string, linkAttrs?: string) => {
        // Exactly one alternative matched, so exactly one group is defined. A
        // tag with no attributes captures '', which is still defined.
        const isScript = scriptAttrs !== undefined;
        const attrText = (isScript ? scriptAttrs : linkAttrs) ?? '';

        // A <link> is only ours when it is actually a stylesheet.
        if (!isScript && !CSS_LINK_RE.test(attrText)) return tag;

        const name = isScript ? 'src' : 'href';
        const found = attrText.match(
            isScript ? /\ssrc\s*=\s*(["'])([^"']+\.tsx?)\1/i : /\shref\s*=\s*(["'])([^"']+\.css)\1/i
        );
        if (!found) return tag;
        const [attr, quote, ref] = found;

        // An absolute URL (`https://cdn/lib.css`) or a protocol-relative one
        // (`//cdn/lib.css`) belongs to another origin, so there is nothing to
        // resolve, copy or warn about. Without this the first is joined onto
        // the input dir as a path (`src/https:/cdn/lib.css`) and the second
        // reads as root-relative, and both warn about a file that was never
        // meant to be on disk.
        if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) return tag;

        // The shared resolution, and the reason these two live together.
        const rel = ref.startsWith('/')
            ? ref.slice(1)
            : path.posix.normalize(path.posix.join(sourceDir, ref));

        // Rewrites only the one attribute; every other one on the tag, and the
        // tag's own shape (`/>` or a closing tag), survives as authored. The
        // base is written into the path rather than left to the injected
        // `<base href>`, which governs relative URLs and not this one.
        const withResolvedPath = (to: string) =>
            tag.replace(attr, ` ${name}=${quote}${dirs.base}${to}${quote}`);

        if (isScript) {
            const outId = rel.replace(/\.tsx?$/, '.js');
            const bundle = bundleModules(path.join(dirs.compiled, outId), true);
            if (bundle === null) {
                log.warn(`Client entry not found: ${outId}. Skipping.`);
                return tag;
            }
            writeOut(
                dirs,
                path.join(dirs.output, outId),
                { kind: 'script', sources: [path.join(dirs.input, rel)] },
                (to) => fs.writeFileSync(to, bundle)
            );
            return withResolvedPath(outId);
        }

        // A root-relative stylesheet is already pointing at the output path it
        // will end up on, so it is only ever copied, never resolved anywhere
        // else. It comes either from the assets dir, which is copied to the
        // output root wholesale, or from the root of the input dir, which
        // nothing else would carry across. The href is still rewritten, since
        // the path it names is below the base and the href as authored is not.
        // At the default base that rewrite puts back exactly what was there.
        if (ref.startsWith('/')) {
            const assetPath = dirs.assets && path.join(dirs.assets, rel);
            if (assetPath && fs.existsSync(assetPath)) return withResolvedPath(rel);

            const inputPath = path.join(dirs.input, rel);
            if (fs.existsSync(inputPath)) {
                writeOut(
                    dirs,
                    path.join(dirs.output, rel),
                    { kind: 'stylesheet', sources: [inputPath] },
                    (to) => fs.copyFileSync(inputPath, to)
                );
                return withResolvedPath(rel);
            }

            // Only name the assets dir among the places checked when there is
            // one to check.
            warnStylesheetNotFound(
                ref,
                referencedIn,
                assetPath ? [assetPath, inputPath] : [inputPath]
            );
            return tag;
        }

        const srcPath = path.join(dirs.input, rel);
        if (!fs.existsSync(srcPath)) {
            warnStylesheetNotFound(ref, referencedIn, [srcPath], assetsHintFor(dirs, rel));
            return tag;
        }
        writeOut(
            dirs,
            path.join(dirs.output, rel),
            { kind: 'stylesheet', sources: [srcPath] },
            (to) => fs.copyFileSync(srcPath, to)
        );
        return withResolvedPath(rel);
    });
}
