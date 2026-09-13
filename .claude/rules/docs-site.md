# Docs website (`src/` outside `bin/`, plus `assets/`)

## Structure
- Three routes: `index.tsx` (home), `about/`, `docs/`. Shared chrome is `components/top-nav.tsx` and `footer.tsx` (footer prints `v{VERSION}`).
- `components/code-card.tsx` is the code block figure (`<code data-no-copy>` opts out of the copy button). `highlight.tsx` is a build-time, TypeScript-only tokenizer returning `raw()` markup; it imports `esc` from `code-card.tsx`, which imports it back (a deliberate circular import). `data-table.tsx` is a div-based ARIA table whose roles are also its CSS selectors.
- Docs content is hand-written JSX with data arrays at the top of `docs/index.tsx` (`COMMANDS`, `CONFIG`, `TREE`, `TOC`, sample code as template strings). It is **not** generated from README. The `TOC` array must be kept in sync by hand with the `<h2 id="...">` headings below it.
- `src/client.ts` adds a Copy button to `<pre>` blocks whose `<code>` lacks `data-no-copy`. `src/docs/client.ts` is a stub.

## SEO plumbing
- `src/site.ts` holds the production origin, name, tagline and author. `skrapa.config.ts`'s `origin` is the dev proxy, not this.
- Every page returns `{ ...seo({ path, title, description, ... }), body }` (`components/seo.tsx`), which emits the canonical link, meta description, Open Graph and Twitter tags, and a JSON-LD graph (page + BreadcrumbList + shared WebSite/SoftwareApplication/Person nodes). The shell carries **no** description or OG tags on purpose, so a page that skips `seo()` ships without them.
- `assets/sitemap.xml` is a **committed, generated asset**: `src/scripts/build.ts` regenerates it from the `src/**/index.tsx` files that export `Page` before the CLI runs (`src/scripts/sitemap.ts`), and `sitemap.test.ts` fails when the committed copy is behind. It is an asset, not a post-build write into `dist/`, because the dev server's initial build empties `dist/` and re-copies assets without running `build.ts`. `assets/robots.txt` names it.
- `assets/og.png` (1200x630) is rendered by `npm run og-image` via headless Chrome, not by the build. Re-run it and commit when `TAGLINE` or the brand colours change.

## README and the docs page duplicate each other
Edit both, or say why not. Duplicated content:
- Commands and flags (README table vs `COMMANDS` in `docs/index.tsx`).
- The config sample and config table (`CONFIG_SAMPLE`, `CONFIG`), and the surrounding paragraphs.
- The scaffold tree (`TREE`; docs adds `package.json` and `.gitignore` rows).
- The link-check error sample (`LINK_ERROR`), which `link-check.test.ts` also asserts against.
- The `ignore` sample (`IGNORE_SAMPLE`).
- "How src and href resolve" and "Every reference has to resolve" sections, near-verbatim.
- The `Skrapa.Page` snippet in docs is a hand-copied, abridged `skrapa.d.ts` and already drifts.

## Facts that go stale
- The `DEPS` package counts and their measurement date on the home page (`index.tsx`).
- `Node >=24` mentions (home page, docs, and `softwareRequirements` in `components/seo.tsx`).
- The footer copyright year.
- The "Five commands" line in `docs/index.tsx` must match the length of `COMMANDS`.

## CSS (`assets/style.css`, one file, dark theme only)
- Tokens on `:root`: `--bg/--surface/--surface-2/--text/--muted`; `--accent-bg` (fills) and `--accent-text` (text), one per contrast direction; `--border/--border-strong`; spacing `--sp-1..6` on a 4px grid (bigger values via `calc(var(--sp-6) * 2)`, never a new step); `--fs-xs/base/md/lg/xl/display`; `--radius`, `--measure`, `--nav-h` (hand-computed; recompute if nav padding changes). `html { font-size: 18px }` scales everything.
- Naming: flat hyphenated classes (`.code-card`, `.tree-row`), `.is-*` for state, suffix for variant (`.code-card-out`). No BEM, no utilities. Prefers element, structural, and attribute selectors.
- Uses native nesting, `@media (width <= 700px)`, `color-mix()`, `:has()`. Stylelint enforces `no-descending-specificity`, so rule order matters; the file has ordering comments where it does.
- `.tok-*` colors pair with `highlight.tsx`. `.copy-btn` styles the element `client.ts` injects.
- The table's narrow-viewport rules are nested inside `[role='table']` on purpose.
