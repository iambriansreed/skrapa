# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Skrapa is a zero-dependency static site generator: TypeScript JSX templates render to static HTML at build time, `client.ts` files compile to standalone bundled `.js`, and a dev server gives live reload. It ships as one bundled CLI script (`bin/index.js`) run via `npx skrapa`, and never becomes a dependency of the projects it builds.

User-facing behavior is documented in [README.md](../README.md); the npm scripts and release flow are in [CONTRIBUTING.md](../CONTRIBUTING.md). The topic files in `.claude/rules/` cover what those don't: internals, couplings, and conventions that cause wrong edits when unknown.

The repo is self-hosted in two senses at once:
- `src/bin/` is the CLI's own source.
- `src/` (everything outside `bin/`) is the marketing/docs site at skrapa.iambrian.com, built *by* that same CLI.

Keep this straight when editing: a change under `src/bin/` affects the tool; a change elsewhere under `src/` affects the website.

## Commands

```bash
npm run build         # regenerate assets/sitemap.xml -> tsc -> bundle bin/index.js -> run that freshly built CLI on itself to build dist/ (the docs site)
npm run dev           # build once, npm link the checkout, then two dev servers: repo root (port 8090) + a scaffolded .tmp/ project (port 8080). Ctrl+C unlinks
npm run og-image      # re-render assets/og.png in headless Chrome; commit it when the tagline or brand colours change
npm run test          # test:unit then test:e2e. Local only: e2e leaves a dev server running, so never wire it into CI
npm run test:unit     # node:test via tsx over src/**/*.test.ts. ~2-3s, no server; this is what CI runs
npm run test:e2e      # scaffolds template/ into .tmp/, starts its dev server, verifies the built site
npm run lint          # eslint . (Prettier runs as an ESLint rule, so this flags formatting too)
npm run lint:fix      # eslint . --fix
npm run lint:css      # stylelint over assets/**/*.css, src/**/*.css, template/**/*.css
npm run clean         # rm -rf dist bin .tmp .skrapa template/dist template/.skrapa
```

Run a single unit test file: `npx tsx --test src/bin/jsx.test.ts`.

Never build this repo with a bare `npx skrapa`. `npx` resolves through the *global* bin, so a missing or stale `npm link` would silently build the site with the published package and still pass. Use `npm run build` or `node bin/index.js build`. Only `npm run dev` and `npm run test:e2e` touch the global link (both run `src/scripts/dev.ts`, which `npm link`s the checkout; its SIGINT handler unlinks it).

There is no standalone `format` script. Prettier runs through ESLint and on save.

## Environment

- Node v24+; the CLI shells out to `cp`, `rm`, `tsc`, so macOS/Linux only.
- `.skrapa/` is `tsc` output mirroring the source tree. Never edit or ship it.
- Only `bin/`, `template/`, and `skrapa.d.ts` ship to npm (see `files` in package.json).

## Topic files (`.claude/rules/`)

- `cli-internals.md`: module map, build pipeline order, dev server, config precedence, JSX runtime, bundler, path resolution, cross-file couplings.
- `managed-files.md`: `skrapa.d.ts` overwrite behavior and what in `template/` must stay in lockstep (or deliberately not).
- `docs-site.md`: the website's structure, README duplication map, CSS token system, facts that go stale.
- `testing.md`: `node:test` conventions and the `fixture.ts` harness.
- `code-style.md`: Prettier settings, the custom ESLint rules, prose rules, commit format.
- `releasing.md`: the CI release pipeline and why you should not run it by hand.
