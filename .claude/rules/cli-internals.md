# CLI internals (`src/bin/`)

## Module map
- `index.ts`: entry and dispatch (`init | build | dev | page | fix`). Assigns `jsx`, `Fragment`, `raw`, `VERSION` onto `globalThis` before any compiled page is `require`d. `VERSION` is the placeholder `__SKRAPA_VERSION__`, replaced with the real version by `src/scripts/utils.ts` at bundle time.
- One `cmd-*.ts` per command. Every command has the shape `Command<Result> = (overrides?: Skrapa.Config) => Result` (see `types.d.ts`).
- `config.ts`: precedence and normalization. `jsx.ts`: build-time JSX runtime. `bundle.ts`: CommonJS bundler. `tag-parser.ts` + `rewrite-shell-imports.ts`: rewriting `src`/`href` on tags. `output-paths.ts`: "nothing may be written twice by different sources" rule plus the emitted-files manifest. `link-check.ts`: every local URL must name an emitted file. `format-html.ts`: dev-only pretty printer. `utils.ts`: `CONFIG_KEYS`, `DEFAULT_CONFIG`, `log`, `exe`, `versionBanner` (pads itself with a blank line above and below; its `npm unlink -g skrapa` hint shows only when `isGlobalLink(process.argv[1])`, i.e. a dev bin reached through a symlink outside `node_modules`).
- Every module has a sibling `*.test.ts`. Add one when adding a module.
- `bin/index.js` is `.skrapa/src/bin/index.js` (tsc output) bundled by `bundle.ts` into one file: it walks the `require(...)` graph and inlines everything reachable under the entry's directory; Node builtins and npm packages stay as literal `require(...)`. Only `bin/` ships, so the CLI cannot `require` sibling compiled modules. `cmd-build.ts` reuses the same bundler for a project's `<script src="...ts">` tags.

## Build pipeline (`cmd-build.ts`), in order
1. `initContext`: load config, then **overwrite `<root>/skrapa.d.ts`** from the package copy whenever contents differ. `.skrapa/` is never cleaned on purpose (tsc incremental state).
2. Clean the output dir (refuses if output is or contains root/input/assets/cwd).
3. `tsc` with the project's own `tsconfig.json`; compiled tree mirrors input under `.skrapa/<input>/`.
4. Walk the **source** tree for `index.tsx`, `require` the matching `.skrapa/.../index.js`, skip modules without an exported `Page` function. Zero pages is fatal.
5. Per page, position-dependent: call `Page()`; a bare element becomes `{ body }`. `rewriteShellImports(body, pageDir)` runs *before* splicing (page-relative `./x.css` resolves against the page dir). Find the nearest ancestor `index.html` shell (none is fatal). Insert `<base href>` right after `<head>`, `head` raw before `</head>`, replace `<title>` text escaped. `applyTagAttrs` for `shellAttrs`. `rewriteShellImports(shell, shellDir)` on the shell *before* the body is spliced in. Splice body before `</body>`. Write pretty (dev) or dense.
6. Write the emitted manifest, run the output-paths collision check, copy assets, then run `link-check` last since it reads the output tree as deployed.

Fatality: collisions are fatal unless dev-mode-with-skip-assets and asset-only; link problems are fatal unless dev mode. Dev mode is detected by `process.argv[2] === 'dev'` or the positional `pretty`; `skip-assets` is another positional. These positionals are the internal dev-to-build protocol, not user flags.

## Dev server (`cmd-dev.ts`)
- Initial build is in-process, then `postbuildCommand` (`npm run --if-present postbuild-skrapa`, only when `<root>/package.json` exists) runs synchronously before the server listens; a failure logs and serves anyway. Every subsequent rebuild is a subprocess: `node bin build skip-assets pretty --<flag> ...` for each key in `BUILD_KEYS`, then `&&` the same postbuild command.
- On rebuild error, stdout is printed (tsc writes diagnostics to stdout). On success, **only lines containing the yellow ANSI code are forwarded**, so `log.warn` must stay stdout plus yellow or warnings vanish in dev.
- Input dir: `fs.watch` recursive, debounced, full rebuild. Assets dir: single-file `cpSync` per event, filtered for editor temp files, checked against the manifest for collisions (refuses, no rebuild).
- The HMR `<script>` is injected at **serve time** for `text/html` responses, not written to disk. `/hmr` WebSocket handshake and frames are hand-rolled; other upgrade paths are destroyed.
- HTTP: strips the base prefix, percent-decodes, maps extensionless paths to `/index.html`, 403s path traversal. `EADDRINUSE` prints a message and exits 1.

## Config (`config.ts`)
Precedence, lowest to highest: `DEFAULT_CONFIG` < `skrapa.config.ts` < `--flags` < programmatic overrides. Each layer is stripped of `undefined` so a hole cannot punch through. The config file is found in `overrides.root ?? --root ?? cwd` and loaded via `createRequire`, not `import()`. Unknown keys warn. Normalization: `port` through `Number`, integer 1..65535 else exit; `base` gets leading and trailing `/`; `origin` gets `http://` if scheme-less and trailing slashes stripped; `ignore` accepts an array or comma string; `root` is `path.resolve`d.

**Adding a config key** touches four places: `CONFIG_KEYS` and `DEFAULT_CONFIG` in `utils.ts`, `Skrapa.Config` in `skrapa.d.ts` plus `ResolvedConfig` in `types.d.ts`, and `BUILD_KEYS` in `cmd-dev.ts` if a rebuild subprocess needs it.

## JSX runtime (`jsx.ts`)
- Elements are `RawHtml` instances branded `__jsx: 'element'`; `isElement` is `instanceof`. `raw()` wraps any string in one. Tests compare with `String(el)`.
- Children: elements pass through, arrays flatten recursively, `null`/`undefined`/booleans render as `''`, `0` is kept, everything else is escaped text.
- Attributes: emitted **as written**, so use `class`, not `className`. There is **no boolean shorthand**: `disabled={true}` emits `disabled="true"`; use `disabled=""` or omit. `style` accepts a string or an object (camelCase to kebab; `--custom` untouched). `undefined`/`null` attrs are dropped; other objects are `JSON.stringify`ed. `children`/`key` are skipped.
- A void element with children throws at build time.
- `escapeAttr` handles `& " <`; `escapeText` handles `& < >`. `unescapeAttr` is the inverse and is used by `applyTagAttrs` and `link-check`.

## Bundler (`bundle.ts`)
CJS only (tsc output). Only literal, `.`-prefixed specifiers are resolved (`rel`, `rel.js`, `rel/index.js`). Unresolved relative imports log an error but are **not fatal**; the literal `require` is kept. Bare specifiers are left as `require(...)`; when bundling for the browser this only warns, and the browser throws at runtime. The scanner skips comments, strings, template literals (entering `${}`), and regex literals.

## Path resolution, the most common bug class
- **Relative** (`./client.ts`) resolves against the directory of the file that wrote it (shell dir for a shell, page dir for page JSX). Never reaches `assets/`.
- **Root-relative** (`/style.css`) resolves from `assets/` first, then the input root.
- `assets/` is copied over `dist/` *after* pages render; a collision with a generated path fails the build because the asset would otherwise silently win. Assets are deliberately not recorded in the emitted manifest, or the dev watcher would refuse its own re-copy.
- Under a non-default `base`, `<base href>` governs relative URLs only. A hand-written root-relative link means the domain root.
- `link-check` compares by string equality against a walked set, never `fs.existsSync`, so it is case-sensitive on every OS. It skips `.js` files. `ignore` globs match both the URL as written and its resolved absolute path.

## Scaffolding and migration commands
- `init` locates the template as `path.join(__dirname, '../template')`, which resolves to `<pkg>/template` from the bundled bin. It installs only `typescript`. `-f`/`--force` is `cpSync({ force })`; `--no-dev` skips the trailing dev server.
- `page "<name>" [parent]` slugifies the name (lowercase, non-alphanumerics to `-`), refuses a parent that climbs (`..`), and creates `index.tsx`, `index.html`, `style.css`, `client.ts`. Refuses if `index.tsx` already exists.
- `fix` migrates pre-0.5 projects: `skrapa.config.json` to `skrapa.config.ts`, and the old global types `Page`/`Props`/`PropsWithChildren`/`Tag`/`CSSProperties` to `Skrapa.*`. Renames only in `:`, `as`, `satisfies` positions (generic positions are untouched since `<` is ambiguous with JSX); files declaring their own type of that name are skipped. Idempotent.

## Cross-file couplings
- `ATTR` regex: exported from `rewrite-shell-imports.ts`, privately duplicated in `format-html.ts`. Change both.
- `VOID_ELEMENTS` (`jsx.ts`) and `VOID_TAGS` (`format-html.ts`) are separate sets and already differ (format-html lacks SVG).
- `.tok-*` classes in `assets/style.css` pair with the tokenizer in `src/components/highlight.tsx`.
- `data-table.tsx` uses ARIA roles as its CSS selectors (`[role='table']` etc.); removing a role breaks layout.
