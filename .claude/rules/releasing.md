# Releasing (do not do this unprompted)

Push to `main`. `.github/workflows/release.yml` is the only entry point:
1. Lint, unit-test, and build *before* cutting a version, so a broken commit never becomes a release commit.
2. `commit-and-tag-version` bumps the version, writes CHANGELOG, commits, tags, pushes with `--follow-tags`.
3. Calls `publish.yml` (`workflow_call`-only, because npm trusted publishing over OIDC is bound to `release.yml`'s filename and only one trusted publisher is allowed per package; there is no `NPM_TOKEN`).
4. Calls `skrapa-pages.yml` with that tag so the site matches the registry version rather than whatever `main` had.

`skrapa-pages.yml` has no push trigger of its own for that reason; it also runs on pull requests and by manual dispatch.

`npm run release` exists locally but is CI's job. `src/scripts/publish-guard.ts` refuses `npm publish` outside GitHub Actions unless `SKRAPA_LOCAL_PUBLISH=1` (for a registry outage only).

To re-publish a tag that already exists (a run that failed for a reason unrelated to the code), dispatch the **Release** workflow from the Actions tab with `tag` filled in.
