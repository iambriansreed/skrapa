# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.6.1](https://github.com/iambriansreed/skrapa/compare/v0.6.0...v0.6.1) (2026-08-12)


### Bug Fixes

* build after version bump, and scope the lowercase rule to src ([1e9495b](https://github.com/iambriansreed/skrapa/commit/1e9495baf2bdde608e82852082ce83c5f78df46b))

## [0.6.0](https://github.com/iambriansreed/skrapa/compare/v0.5.0...v0.6.0) (2026-08-12)


### ⚠ BREAKING CHANGES

* skrapa.config.json is no longer read. Page, Props,
PropsWithChildren, Tag and CSSProperties are now Skrapa.* (CSSProperties
becomes Skrapa.CSSProps). htmlAttrs is now shellAttrs.html. Run
`npx skrapa fix`.

### Features

* TypeScript config, Skrapa-namespaced types, output-path checks ([bf600e8](https://github.com/iambriansreed/skrapa/commit/bf600e804210118efd72ddbf08c29d6e614e4d1d))

## [0.5.0](https://github.com/iambriansreed/skrapa/compare/v0.4.3...v0.5.0) (2026-08-03)


### ⚠ BREAKING CHANGES

* Page.clientJs is removed, replaced by Page.htmlAttrs.
Declare client entries as <script src="./client.ts"> in the shell or page
JSX instead of listing them on the returned object.
* the bin entry moved from bin/skrapa.js to bin/index.js.
* tsconfig.client.json is gone. Client code compiles
through the project tsconfig.json, which must now include src/**/client.ts
and the DOM lib. Existing projects need this applied by hand, since skrapa
only manages skrapa.d.ts.

### Features

* enhance README and HTML metadata, update CSS styles, and refactor main page layout ([2a92710](https://github.com/iambriansreed/skrapa/commit/2a92710877aeb84e53f18484bfd44340296a32c6))
* modular CLI, per-page shells, bundled client scripts ([cc94b94](https://github.com/iambriansreed/skrapa/commit/cc94b9411fb55cf677499f370b0c1874612efa97))

## [0.4.3](https://github.com/iambriansreed/skrapa/compare/v0.4.2...v0.4.3) (2026-06-24)

## [0.4.2](https://github.com/iambriansreed/skrapa/compare/v0.4.1...v0.4.2) (2026-06-24)

## [0.4.1](https://github.com/iambriansreed/skrapa/compare/v0.4.0...v0.4.1) (2026-06-19)


### Features

* update GitHub Actions workflow and scripts for improved deployment and template management ([a48e9e2](https://github.com/iambriansreed/skrapa/commit/a48e9e2e28708ed0e64be22b9b9f7d488bbd4e73))

## [0.4.0](https://github.com/iambriansreed/skrapa/compare/v0.3.4...v0.4.0) (2026-06-18)


### ⚠ BREAKING CHANGES

* types file is now skrapa.d.ts; delete your old global.d.ts after upgrading to avoid duplicate global declarations.

### Features

* rename global.d.ts to skrapa.d.ts and auto-sync it ([b7c036f](https://github.com/iambriansreed/skrapa/commit/b7c036f7d22d0986ea045f7628e2ac47f2ef2864))

## [0.3.4](https://github.com/iambriansreed/skrapa/compare/v0.3.3...v0.3.4) (2026-06-18)


### Bug Fixes

* update release script to include npm login before publishing ([6cff298](https://github.com/iambriansreed/skrapa/commit/6cff2987e4da6eedc9e7e320d0f19c87f46e6e12))

## [0.3.3](https://github.com/iambriansreed/skrapa/compare/v0.3.2...v0.3.3) (2026-06-18)


### Features

* rename project from "stsx" to "skrapa" and update related files ([1267f50](https://github.com/iambriansreed/skrapa/commit/1267f5075153eaa8ef776ba73ab5a0cf2bb94b7a))

## 0.3.2 (2026-06-01)

Initial public release line. `skrapa` scaffolds and serves static sites built from TypeScript JSX templates and TypeScript client-side code. No framework, no virtual DOM, no bundler config.

### Features

* `skrapa` init command to scaffold a new project from the bundled template
* dev server with hot module replacement over WebSocket live reload
* configurable host for the dev server
* project layout that separates the HTML template from app logic
* landing page with GitHub link and styling

### Bug Fixes

* consistent path handling and reliable build output directory
* ensure `package.json` exists before installing dependencies
* correct script download URL in README and template
* HMR reconnect messaging and overlay improvements
