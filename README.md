# Skrapa

[![npm version](https://img.shields.io/npm/v/skrapa.svg)](https://www.npmjs.com/package/skrapa)

Build static sites with TypeScript JSX templates and TypeScript client-side code. No framework, no virtual DOM, no config. A single zero-dependency script, run with `npx`, does all of it and never becomes a dependency of your project.

Requires Node.js v24+. Runs on macOS and Linux; the CLI shells out to Unix tools like `cp`, `rm`, and `tsc`.

**[Website](https://skrapa.iambrian.com)** · **[GitHub](https://github.com/iambriansreed/skrapa)** · **[npm](https://www.npmjs.com/package/skrapa)**

## How it works

JSX in `src/` renders to raw HTML strings at build time. Every `src/**/index.tsx` that exports `Page` becomes its own page, `client.ts` is compiled to a standalone `.js` and linked via `<script src>`, and assets are copied as-is. CSS is yours to manage, so drop it in `assets/` and link it from `index.html`.

```
src/index.html        →  shared HTML shell (head + body)
src/index.tsx         →  Page()  →  dist/index.html
src/about/index.tsx   →  Page()  →  dist/about/index.html
src/about/index.html  →  optional per-page shell, overrides the shared one for /about
src/client.ts         →  compiled to its own .js, linked via <script src>
assets/               →  copied as-is to dist/ (CSS, images, fonts)
```

Each page uses `src/index.html` as its HTML shell. Drop an `index.html` into a page's own directory to override it for that page alone. That's handy when one page needs a different `<head>`, meta tags, or favicon. Whichever shell is used, Skrapa still injects the `<base href>` and the page's `title`, `head`, `body`, and `htmlAttrs` (attributes merged onto the shell's `<html>` element).

### How `src` and `href` resolve

A `<script src="....ts">` or `<link rel="stylesheet" href="....css">` can go in a shell or in a page's own JSX. Either way the path is resolved at build time, the file is copied or bundled into `dist/`, and the tag is repointed at the result:

- **Relative** (`./client.ts`, `./style.css`) resolves against the directory of the file it was written in: the shell's directory for a shell, the page's own directory for page JSX.
- **Root-relative** (`/style.css`) resolves from `assets/` first, then from the input root.

That's why the scaffolded about page links both. `/style.css` picks up the global sheet in `assets/`, while `./style.css` picks up `src/about/style.css` sitting next to that page's shell.

## Quick Start

```bash
npx skrapa
```

Scaffolds a new project, installs TypeScript (the only dependency it adds), and starts the dev server. Then when you're ready:

```bash
npx skrapa build
```

Builds every `index.tsx` to a page under `dist/`, with markup rendered, client JS/CSS bundled and linked, and assets copied alongside. Ready to deploy.

---

Creates:

```
src/index.html                # shared HTML shell (head + body)
src/index.tsx                 # home page, Page()
src/about/index.html          # per-page shell that overrides the shared one for /about
src/about/index.tsx           # /about page (nested dir = nested route)
src/about/client.ts           # browser JS scoped to /about
src/about/about.ts            # helper module imported by /about/client.ts
src/about/style.css           # per-page styles, linked from the about shell
src/components/button.tsx     # example component (imported, never routed)
src/client.ts                 # browser JS entry point
assets/style.css              # global styles (linked from index.html)
assets/skrapa.svg             # logo
assets/github.svg             # icon
skrapa.config.json            # project config
tsconfig.json                 # TypeScript config (wires the jsx / Fragment runtime)
skrapa.d.ts                   # global types, managed by skrapa
README.md                     # starter readme for your project
.github/workflows/deploy.yml  # GitHub Pages deploy, gated on the commit message
```

## Commands

```bash
npx skrapa                     # scaffold a new project (only in a dir with no skrapa.config.json)
npx skrapa dev                 # dev server with live reload
npx skrapa build               # production build
npx skrapa page "<name>" [parent]  # scaffold a new page (index.tsx + shell + css + client)
```

Per-command flags:

| Command | Flags / args |
| ------- | ------------ |
| `init` (default) | `-f` / `--force` (overwrite existing files), `--no-dev` (skip the dev server) |
| `dev` | `--port`, `--host`, `-v` / `--verbose`, plus the build flags |
| `build` | `--input`, `--output`, `--assets`, `--base`, `--root` |
| `page` | `<name>` and `[parent]` positionals, plus `--input` / `--root` |

Every command accepts the [config](#configuration) flags (`--input`, `--output`, `--assets`, `--port`, `--host`, `--base`, `--root`), which override `skrapa.config.json`.

If your `package.json` has a `postbuild-skrapa` script, `dev` runs it after each rebuild. Use it for anything that has to happen on top of the build, like generating a sitemap.

## Configuration

`skrapa.config.json` in the project root. Every field is optional:

```json
{
    "input": "src",
    "output": "dist",
    "assets": "assets",
    "port": 8080
}
```

| Field    | Default  | Description                                                                                                 |
| -------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `input`  | `src`    | Directory containing `index.html`, `index.tsx`, `client.ts`                                                 |
| `output` | `dist`   | Build output directory                                                                                      |
| `assets` | `assets` | Static files copied as-is to output; skipped if not present                                                 |
| `port`   | `8080`   | Dev server port                                                                                             |
| `host`   | `localhost` | Dev server host; also used for the served URL and the live-reload WebSocket                               |
| `base`   | `/`      | Base URL the site is served from; injected as `<base href>`. Set to `/repo/` for GitHub Pages project sites |

CLI flags override config file values:

```bash
npx skrapa dev --port 3000
npx skrapa build --input app --output public
```

## About

All too often I wanted to spin up a simple static site and found the usual stack of Vite plus React plus TypeScript plus a pile of config to be total overkill. I didn't need a virtual DOM, client-side routing, or a hydration step. I just wanted to write some markup, get a few interactive bits, and ship plain HTML.

Skrapa is the result. It keeps the one thing I actually missed, writing layout as JSX in TypeScript, and throws out the rest. Pages compile to static HTML at build time with their client JS bundled into standalone files, so there's no framework and no runtime in the browser. A dev server with live reload keeps the feedback loop tight while you work.

I built it for myself and still use it daily: [my personal site](https://iambrian.com), throwaway prototypes, quick dashboards, and one-off reports. If you've ever wanted a static page without booting up an entire toolchain to get there, it might suit you too.

## License

[MIT](LICENSE) © [iambriansreed](https://github.com/iambriansreed)
