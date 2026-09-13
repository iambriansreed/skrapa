# Managed and lockstep files

## `skrapa.d.ts`
- The root `skrapa.d.ts` is the source of truth. Every `build`/`dev` run overwrites the project's copy from the installed package, so **never edit a project's `skrapa.d.ts` by hand**; edit the root one here.
- `template/skrapa.d.ts` must be byte-identical to the root. Enforced by `src/scripts/template-sync.test.ts`; fix drift with `cp skrapa.d.ts template/skrapa.d.ts`.
- `jsx`/`Fragment`/`JSX`/`VERSION` must stay bare globals, not under the `Skrapa` namespace. `jsx`/`Fragment` are the factory pair tsconfig's `jsxFactory`/`jsxFragmentFactory` name, `JSX` is where TS resolves intrinsic elements, and moving any of them makes every `<div>` fail to compile.

## `template/`
The scaffold copied into new projects by `skrapa init` (bare `npx skrapa` in an empty dir). No `package.json` in it; `init` generates one.

- `template/tsconfig.json` settings the CLI depends on: `composite: true` (incremental `.skrapa`), `jsx: react` with `jsxFactory: jsx` / `jsxFragmentFactory: Fragment`, `module: commonjs`, `outDir: ./.skrapa`, `rootDir: ./`, `include` listing `skrapa.d.ts` and `skrapa.config.ts`, `lib` including DOM (client code compiles through this same tsconfig).
- `template/.github/workflows/deploy.yml` **intentionally differs** from the root one (push trigger gated on a `deploy:` commit prefix, no test step, no `workflow_call`). Do not sync them.
- `template/src/index.tsx` uses the global `VERSION`, baked in from `__SKRAPA_VERSION__` at bundle time.
- `src/scripts/test.ts` asserts every template file lands in `.tmp/` and hardcodes the titles `Skrapa - Template` and `Skrapa - About`. Renaming template pages breaks e2e.
- `template/README.md` documents the scaffolded file tree by name; keep it current when adding or renaming template files.

## Root vs template config
The root repo's own `skrapa.config.ts` (the docs site) uses port 8090 and `origin: https://skrapa.localhost`. The template's uses defaults. Don't copy one over the other.
