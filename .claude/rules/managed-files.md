# Managed and lockstep files

## `skrapa.d.ts`
- The root `skrapa.d.ts` is the source of truth. It is the copy package.json `files` ships, and every `build`/`dev` run copies `<pkg>/skrapa.d.ts` over `<projectRoot>/skrapa.d.ts` whenever contents differ, so **never edit a project's `skrapa.d.ts` by hand**; edit the root one.
- The docs site's project root is the repo root, so building `web/` from this checkout compares the root `skrapa.d.ts` with itself.
- `template/skrapa.d.ts` must be byte-identical to it. Enforced by `src/scripts/template-sync.test.ts`; fix drift with `cp skrapa.d.ts template/skrapa.d.ts`.
- `src/tsconfig.json`, `web/tsconfig.json` and `template/src/tsconfig.json` all include `../skrapa.d.ts`, so the CLI compiles against the same `Skrapa.*` types it ships.
- `Skrapa.Config` documents the `skrapa` key, but nothing checks a tsconfig against the type; runtime validation is `normalizeConfig` in `config.ts`. Keep the two in step.
- `jsx`/`Fragment`/`JSX`/`VERSION` must stay bare globals, not under the `Skrapa` namespace. `jsx`/`Fragment` are the factory pair tsconfig's `jsxFactory`/`jsxFragmentFactory` name, `JSX` is where TS resolves intrinsic elements, and moving any of them makes every `<div>` fail to compile.

## `template/`
The scaffold `skrapa init` copies (bare `npx skrapa` runs it in a directory with no `tsconfig.json`, `package.json` or legacy config file). Its top level is a project root: `assets/`, `README.md`, `skrapa.d.ts` and `.github/workflows/skrapa-pages.yml`. The pages, shells and `tsconfig.json` are in `template/src/`, its skrapa root (`TEMPLATE_SKRAPA_ROOT`). No `package.json` or `.gitignore`; `init` generates them.

A new project gets the template copied as is. A site added to an existing project gets `template/src/` (minus its `tsconfig.json`, which is rewritten) and `template/assets/` in the directory `init` ran in, and only `skrapa.d.ts` and a rewritten workflow at its project root.

- `template/src/tsconfig.json` settings the CLI depends on:
  - a `skrapa` key that validates (checked by `template-sync.test.ts`; an invalid one would stop the first `npm run dev` after `init`), with `projectRoot` resolving back to `template/` (checked by `cmd-init.test.ts`), plus `output: "../dist"` and `assets: "../assets"`;
  - `jsx: react` with `jsxFactory: jsx` / `jsxFragmentFactory: Fragment`;
  - `module: commonjs`;
  - `include` covering `**/*.ts`, `**/*.tsx` and `../skrapa.d.ts` (a page it leaves out is a build error naming the file);
  - `lib` including DOM (client code compiles through this same tsconfig);
  - `composite: true` for incremental `.skrapa`;
  - **no** `outDir`/`rootDir`: the CLI ignores them and always passes `--outDir .skrapa --rootDir .`.
- `init`'s warning when it keeps an existing `tsconfig.json` (`keepTsconfig` in `cmd-init.ts`) repeats the jsx/module/include requirements above; keep it in step.
- `existingProjectTsconfig` (`cmd-init.ts`) starts from this file: it keeps the compiler options and replaces the `skrapa` paths and `include`.
- `scaffold()` in `src/scripts/fixture.ts` reads this file into every real-build test fixture (replacing its `skrapa` key and `include`), so a change to its compiler options changes those tests too.
- `template/.github/workflows/skrapa-pages.yml` **intentionally differs** from the root one (push trigger gated on a `deploy:` commit prefix, no test step, no `workflow_call`). Do not sync them. `existingProjectWorkflow` rewrites its `npm run build` and `path: './dist'` for an existing project, so keep both strings (`cmd-init.test.ts` fails otherwise).
- `template/src/index.tsx` uses the global `VERSION`, baked in from `__SKRAPA_VERSION__` at bundle time.
- `src/scripts/test.ts` asserts every template file lands in `.tmp/project` and hardcodes the titles `Skrapa - Template` and `Skrapa - About`. Renaming template pages breaks e2e.
- `template/README.md` documents the scaffolded file tree by name; keep it current when adding or renaming template files. README.md's "A new project gets" tree and `TREE` in `web/docs/index.tsx` list the same files.

## Web vs template config
The repo root is not a skrapa root (it has no `tsconfig.json`). `web/tsconfig.json`'s `skrapa` key has `output: "../dist"`, port 8090, `host: "localhost"`, `origin: https://skrapa.localhost` and `projectRoot: "../"`, with `assets` left at its default (`web/assets/`). `template/src/tsconfig.json`'s has `output: "../dist"`, `assets: "../assets"`, port 8080 and `projectRoot: "../"`. Don't copy one over the other.
