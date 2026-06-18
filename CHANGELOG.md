# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.3.4](https://github.com/iambriansreed/skrapa/compare/v0.3.3...v0.3.4) (2026-06-18)


### Bug Fixes

* update release script to include npm login before publishing ([6cff298](https://github.com/iambriansreed/skrapa/commit/6cff2987e4da6eedc9e7e320d0f19c87f46e6e12))

## [0.3.3](https://github.com/iambriansreed/skrapa/compare/v0.3.2...v0.3.3) (2026-06-18)


### Features

* rename project from "stsx" to "skrapa" and update related files ([1267f50](https://github.com/iambriansreed/skrapa/commit/1267f5075153eaa8ef776ba73ab5a0cf2bb94b7a))

## 0.3.2 (2026-06-01)

Initial public release line. `skrapa` scaffolds and serves static sites built from TypeScript JSX templates and TypeScript client-side code — no framework, no virtual DOM, no bundler config.

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
