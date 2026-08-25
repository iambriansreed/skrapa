# Contributing

Skrapa is self-hosted: its own docs site (`src/`) is built with the Skrapa CLI (`src/bin/`), and the CLI itself is a TypeScript project compiled and bundled into a single `bin/index.js`.

## Layout

- `src/bin/` is the CLI source: `index.ts` (entry and command dispatch), one `cmd-*.ts` per command (`cmd-build.ts`, `cmd-dev.ts`, `cmd-init.ts`, `cmd-page.ts`), and the shared modules they build on (`config.ts` for flag/config-file precedence, `jsx.ts` for the build-time JSX runtime, `bundle.ts` for the CommonJS bundler, `format-html.ts` for the dev-only pretty printer, `tag-parser.ts` and `rewrite-shell-imports.ts` for the tag machinery, `utils.ts`, `types.d.ts`).
- `src/` (everything outside `bin/`) is the docs site itself, built by the CLI.
- `src/scripts/` holds maintainer-only scripts (not shipped) that drive local dev and packaging.
- `template/` is the scaffold copied into new projects by `skrapa init`.
- `.skrapa/` is `tsc` output, mirroring the source tree. Never shipped.
- `bin/index.js` is the CLI, bundled from `.skrapa/src/bin/index.js` and everything it `require`s (see `src/bin/bundle.ts`) into one file with no relative-`require` dependencies on its siblings, since only `bin/` ships in the published package.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run build` | Compiles the CLI (`tsc`), bundles `.skrapa/src/bin/index.js` into `bin/index.js`, then runs that freshly built CLI on itself (`node bin/index.js build`) to produce the docs site in `dist/`. Invoked by path, never as `npx skrapa`: `npx` resolves through the global bin, so a missing or stale `npm link` would silently build this site with the *published* skrapa and still go green. Nothing here touches the global link; `npm run dev` does that. |
| `npm run dev` | Runs `npm run build` once and `npm link`s the checkout (so the `npx skrapa` calls below resolve here), then starts two dev servers in parallel: one in the repo root for the docs site, one in a freshly scaffolded `.tmp/` project (built from `template/`). Each is logged with a colored `[root]`/`[tmp]` prefix. Watches `src/bin/**`: rebuilds the CLI and restarts both servers. Watches `template/**`: rescaffolds `.tmp/` and restarts its server. Ctrl+C stops both cleanly. |
| `npm run test` | Runs `test:unit` then `test:e2e`. Since the e2e run deliberately leaves a dev server up, this is a local command; never wire it into CI. |
| `npm run test:unit` | Fast `node:test` unit tests (via `tsx`) for the pure modules: the JSX runtime, the bundler, the HTML formatter, the tag parser, page planning, config loading, and the shell rewrites (`applyTagAttrs` and `rewriteShellImports`, the latter against a throwaway temp tree since it reads and writes real files). Plus a check that `template/skrapa.d.ts` is byte-identical to the root `skrapa.d.ts` (the root is the source of truth; nothing copies it any more, so that test is what holds them together). No server, so it's the one CI runs. |
| `npm run test:e2e` | End-to-end test (`src/scripts/test.ts`): scaffolds a fresh project from `template/` into `.tmp/` (reusing whatever `skrapa` is currently linked, so run `build` or `dev` first if `.tmp` or the link is stale), starts its dev server on a fixed port, and verifies the site, including that the `about/` page picks up its own `index.html`/CSS/`client.ts` instead of the root template's. Leaves the dev server running on completion so the scaffolded site can be poked at manually. |
| `npm run lint` / `lint:fix` / `lint:css` | ESLint (with `eslint-plugin-prettier`, so it flags and `--fix`es formatting too) and Stylelint for CSS. Prettier otherwise runs on save; there is no standalone `format` script. |
| `npm run clean` | Removes all build output (`dist`, `bin`, `.tmp`, `.skrapa`) from the repo and `template/`. |
| `npm run release` | Runs `commit-and-tag-version` (version bump + CHANGELOG + commit + tag), rebuilds, and pushes with `--follow-tags`. It does **not** publish, and you should not normally run it: `.github/workflows/release.yml` runs it for every commit that lands on `main`, then publishes that tag to npm and deploys the site from it. |

## Releasing

Push to `main`. `release.yml` lints, tests and builds, cuts the version from your conventional commits, pushes the tag, publishes it to npm, and deploys the docs site from that tag. Each step runs only if the one before it passed, so a failing build never becomes a version and a version that never reached the registry never becomes a deploy.

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) over OIDC, so there is no `NPM_TOKEN` anywhere. Two consequences worth knowing:

- npm validates the OIDC claim of the *calling* workflow, not the one that runs `npm publish`, and allows one trusted publisher per package. The publisher is configured against `release.yml`, which is why `publish.yml` is `workflow_call`-only: a run starting anywhere else could not authenticate.
- `npm publish` from a laptop is refused by a `prepublishOnly` guard (`src/scripts/publish-guard.ts`), since it would publish a working tree under a version with no tag behind it. `SKRAPA_LOCAL_PUBLISH=1` overrides it for a registry outage.

To publish a tag that already exists (a run that failed for a reason unrelated to the code), run the **Release** workflow from the Actions tab with its `tag` input filled in: it skips cutting a new version and publishes that one.

## Notes for the CLI itself

`bin/index.js` is a single bundled file on purpose. `package.json`'s `files` field only ships `bin/`, so the CLI can't `require` sibling compiled modules the way `.skrapa/src/bin/*.js` does during development. `src/bin/bundle.ts` is a small CommonJS-style bundler that walks the `require(...)` graph from a compiled entry file and inlines everything reachable under its own directory; anything it can't resolve there (Node builtins, npm packages, files outside that directory) is left as a literal `require(...)` call, which falls through to the real `require` of wherever the bundle ends up running. `cmd-build.ts` reuses the same bundler for a project's client-side `<script src="...ts">` tags, walking `.skrapa/<input>` instead.
