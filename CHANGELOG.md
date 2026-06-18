# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

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
