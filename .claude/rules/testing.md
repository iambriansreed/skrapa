# Testing

- `node:test` (`test`, `describe`, `before`, `after`) with `node:assert/strict`. Runner: `npx tsx --test "src/**/*.test.ts"`. Tests are colocated as `src/bin/*.test.ts`, plus `src/scripts/template-sync.test.ts` and `src/scripts/sitemap.test.ts`.
- `describe` names are `'<file path> - <functions>'` (a check that committed files stay in sync is `'<test file path> - <what> stays in sync'`); test names are behavior sentences; a comment above a test names the regression it guards.
- `jsx()` returns a boxed element, so JSX tests wrap output in `String(el)` before `assert.equal`.

## `src/scripts/fixture.ts`, the harness for tests that need a real build
- `tempDir(prefix)`: a throwaway dir under the repo's `.tmp/` (gitignored). In-repo, not the system temp dir, so a fixture's own `tsc` resolves `@types/node` by walking up.
- `ensureBin()`: runs `buildBin()` (tsc + bundle to `bin/index.js`) once per test process. Node runs each test file in its own process, so it rebuilds once per file that calls it.
- `runBuild(fixture, args)`: spawns `bin/index.js build --assets public ...` with `node_modules/.bin` on PATH, returns `{ status, output }`. Pass `['pretty']` to simulate a dev-mode build.
- `scaffold(fixture)`: writes the template tsconfig plus a minimal shell and page, returns a `write(file, body)` helper. Fixture assets live in `public/`.
- `caseSkip`: probes case-folding once at import; use as `{ skip: caseSkip }` on tests that need two paths differing only in case.

## Patterns
- Build-once, assert-many: `before(() => { ensureBin(); fixture = tempDir(...); write(...); result = runBuild(fixture) })`, several `test`s on the one result, `after(() => fs.rmSync(fixture, ...))`.
- `config.test.ts` swaps `process.argv` via `withArgv` and uses `os.tmpdir()`.
- `npm run test:e2e` is separate (`src/scripts/test.ts`): kills whatever holds port 8080, scaffolds `.tmp/`, polls HTTP, asserts, and leaves the server running so the site can be poked at.
