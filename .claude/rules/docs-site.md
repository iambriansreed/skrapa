# Docs website (`web/`)

## Structure
- `web/` is a skrapa root whose project root is the repo root: `web/tsconfig.json` holds its `skrapa` key (`output: "../dist"`, port 8090, `host: "localhost"`, `origin: https://skrapa.localhost`, `projectRoot: "../"`), its assets are `web/assets/` (the default), and `npm run build` runs the CLI with cwd `web/`. Its builds sync `skrapa.d.ts` into the repo root, which is the source copy itself.
- Three routes: `web/index.tsx` (home), `web/about/`, `web/docs/`. Shared chrome is `web/components/top-nav.tsx` and `footer.tsx` (footer prints `v{VERSION}`).
- `web/components/code-card.tsx` is the code block figure (`<code data-no-copy>` opts out of the copy button). It only highlights when passed `highlight`; without it the code is plain escaped text, which is how non-TypeScript samples (the JSON config, HTML shells) are shown. `highlight.tsx` is a build-time, TypeScript-only tokenizer returning `raw()` markup; it imports `esc` from `code-card.tsx`, which imports it back (a deliberate circular import). `data-table.tsx` is a div-based ARIA table whose roles are also its CSS selectors.
- Docs content is hand-written JSX with data arrays at the top of `web/docs/index.tsx` (`TREE`, `CONFIG_SAMPLE`, `CONFIG`, `LINK_ERROR`, `PORT_BUSY`, `COMMANDS`, `TOC`, sample code as template strings). It is **not** generated from README. The `TOC` array must be kept in sync by hand with the `<h2 id="...">` headings below it.
- The home page's routing card (`INPUT`/`OUTPUT` in `web/index.tsx`) is labelled `src/` to `dist/`, the template's layout.
- `web/client.ts` adds a Copy button to `<pre>` blocks whose `<code>` lacks `data-no-copy`. `web/docs/client.ts` is an empty stub.

## SEO plumbing
- `web/site.ts` holds the production origin, name, tagline and author. `web/tsconfig.json`'s `skrapa.origin` is the dev proxy, not this.
- Every page returns `{ ...seo({ path, title, description, ... }), body }` (`web/components/seo.tsx`), which emits the canonical link, meta description, Open Graph and Twitter tags, and a JSON-LD graph (page + BreadcrumbList + shared WebSite/SoftwareApplication/Person nodes). The shell (`web/index.html`) carries **no** description or OG tags on purpose, so a page that skips `seo()` ships without them.
- `web/assets/sitemap.xml` is a **committed, generated asset**: `src/scripts/build.ts` regenerates it before the CLI runs, from the `index.tsx` files under `web/` that export `Page` (`src/scripts/sitemap.ts`, walking with `isSkippedPath` and the assets dir excluded), and `sitemap.test.ts` fails when the committed copy is behind. It is an asset, not a post-build write into `dist/`, because the dev server's initial build empties `dist/` and re-copies assets without running `build.ts`. `web/assets/robots.txt` names it.
- `web/assets/og.png` (1200x630) is rendered by `npm run og-image` via headless Chrome, not by the build. Re-run it and commit when `TAGLINE` or the brand colours change.

## README and the docs page duplicate each other
Edit both, or say why not. Duplicated content:
- Commands and flags: README's flags table, the paragraphs under it (the busy-port sample, `postbuild-skrapa`) and "New or existing project", vs `COMMANDS`, `PORT_BUSY` and the "Initialize a project" and "Commands" sections in `web/docs/index.tsx`.
- The two roots: README's "Two roots" vs the docs "Two roots" section.
- The config sample and config table (`CONFIG_SAMPLE`, a JSON excerpt of the template's `src/tsconfig.json` in a non-highlighted `CodeCard`, and `CONFIG`), and the surrounding paragraphs (the required key, the skrapa root, validation, ignored `outDir`/`rootDir`, flags over the file).
- The scaffold tree (README's "A new project gets" block vs `TREE`; docs adds `package.json` and `.gitignore` rows). `template/README.md` lists the same files.
- The link-check error sample (`LINK_ERROR`), a verbatim copy of `formatProblem`'s case-only output (`output-paths.ts`); `link-check.test.ts` asserts the same headline and hint text.
- "How src and href resolve" and "Every reference has to resolve" sections, near-verbatim (docs splits the first across "Client scripts" and "Stylesheets"). The `linkCheckIgnore` explanation in the second (README's `jsonc` block and the paragraph after it, vs `LINK_IGNORE_SAMPLE` and the paragraphs around it) is also said in `Skrapa.Config.linkCheckIgnore` in `skrapa.d.ts`.
- README's "Upgrading an older project" is the long form of the `fix` row in `COMMANDS` and the upgrade paragraph in the docs "Commands" section.
- The `Skrapa.Page` snippet in docs is a hand-copied, abridged root `skrapa.d.ts` and already drifts.

## Facts that go stale
- The `DEPS` package counts and their measurement date on the home page (`web/index.tsx`).
- `Node >=24` mentions (home page, docs, and `softwareRequirements` in `web/components/seo.tsx`).
- The footer copyright year.
- The "Five commands" line in `web/docs/index.tsx` must match the length of `COMMANDS`.
- The scaffold trees (README, `TREE`, `template/README.md`) whenever `template/` gains, loses or moves a file.

## CSS (`web/assets/style.css`, one file, dark theme only)
- Tokens on `:root`: `--bg/--surface/--surface-2/--text/--muted`; `--accent-bg` (fills) and `--accent-text` (text), one per contrast direction; `--border/--border-strong`; spacing `--sp-1..6` on a 4px grid (bigger values via `calc(var(--sp-6) * 2)`, never a new step); `--fs-xs/base/md/lg/xl/display`; `--radius`, `--measure`, `--nav-h` (hand-computed; recompute if nav padding changes). `html { font-size: 18px }` scales everything.
- Naming: flat hyphenated classes (`.code-card`, `.tree-row`), `.is-*` for state, suffix for variant (`.code-card-out`). No BEM, no utilities. Prefers element, structural, and attribute selectors.
- Uses native nesting, `@media (width <= 700px)`, `color-mix()`, `:has()`. Stylelint enforces `no-descending-specificity`, so rule order matters; the file has ordering comments where it does.
- `.tok-*` colors pair with `highlight.tsx`. `.copy-btn` styles the element `web/client.ts` injects.
- The table's narrow-viewport rules are nested inside `[role='table']` on purpose.
