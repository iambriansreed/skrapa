# What this repo is

Skrapa is a zero-dependency static site generator: TypeScript JSX templates render to static HTML at build time, `client.ts` files compile to standalone bundled `.js`, and a dev server gives live reload. It ships as one bundled CLI script (`bin/index.js`) run via `npx skrapa`, and never becomes a dependency of the projects it builds.

A site has two roots. The **skrapa root** is the directory holding a `tsconfig.json` with a required top-level `skrapa` key; skrapa runs there and reads only that file. The **project root** (`projectRoot` in that key, relative to the skrapa root, default `.`) is where `package.json`, `.gitignore`, `.github/` and `skrapa.d.ts` live. A new project from the template has its skrapa root in `src/` and its project root one level up.

User-facing behavior is documented in [README.md](../../README.md); the npm scripts and release flow are in [CONTRIBUTING.md](../../CONTRIBUTING.md). The other files in `.claude/rules/` cover what those don't: internals, couplings, and conventions that cause wrong edits when unknown.

The repo is self-hosted in two senses at once:

- `src/bin/` is the CLI's own source (maintainer scripts sit beside it in `src/scripts/`; `src/tsconfig.json` compiles both).
- `web/` is the marketing/docs site at skrapa.iambrian.com, built _by_ that same CLI. It is a skrapa root (`web/tsconfig.json` holds its `skrapa` key) whose project root is the repo root (`"projectRoot": "../"`).

Keep this straight when editing: a change under `src/bin/` affects the tool; a change under `web/` affects the website; a change under `template/` affects every new project. There is no `tsconfig.json` at the repo root, so skrapa never runs there.

## Environment

- Node v24+; the CLI shells out to `cp`, `rm`, `tsc`, so macOS/Linux only.
- `.skrapa/` is `tsc` output mirroring the source tree. The repo root's is the CLI and scripts (`src/tsconfig.json` has `rootDir: ".."` and `outDir: "../.skrapa"`, so the bundle entry is `.skrapa/src/bin/index.js`); `web/.skrapa/` is the site's. Never edit or ship either.
- Only `bin/`, `template/`, and the root `skrapa.d.ts` ship to npm (see `files` in package.json).
