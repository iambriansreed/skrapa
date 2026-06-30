# Skrapa

[![npm version](https://img.shields.io/npm/v/skrapa.svg)](https://www.npmjs.com/package/skrapa)

Build static sites with TypeScript JSX templates and TypeScript client-side code — no framework, no virtual DOM, no bundler config.

Requires Node.js v24+.

**[Website](https://skrapa.iambrian.com)** · **[GitHub](https://github.com/iambriansreed/skrapa)** · **[npm](https://www.npmjs.com/package/skrapa)**

## How it works

JSX in `src/` renders to raw HTML strings at build time. Every `src/**/index.tsx` that exports `Page` becomes its own page, `client.ts` is compiled and inlined, and assets are copied as-is. CSS is yours to manage — drop it in `assets/` and link it from `index.html`.

```
src/index.html        →  shared HTML shell (head + body)
src/index.tsx         →  Page()  →  dist/index.html
src/about/index.tsx   →  Page()  →  dist/about/index.html
src/client.ts         →  compiled + inlined (per page, merged up the tree)
assets/               →  copied as-is to dist/ (CSS, images, fonts)
```

## Quick Start

```bash
npx skrapa
```

Scaffolds a new project, installs dependencies, and starts the dev server. Then when you're ready:

```bash
npx skrapa build
```

Builds every `index.tsx` to a self-contained page under `dist/` — markup and client JS inlined, assets copied alongside — ready to deploy.

---

Creates:

```
src/index.html            # shared HTML shell
src/index.tsx             # home page — Page()
src/about/index.tsx       # /about page (nested dir = nested route)
src/components/button.tsx # example component
src/client.ts             # browser JS entry point
assets/style.css          # styles (linked from index.html)
assets/skrapa.svg         # logo
skrapa.config.json        # project config
tsconfig.json             # TypeScript config
tsconfig.client.json      # browser TypeScript config
```

## Commands

```bash
npx skrapa            # scaffold a new project
npx skrapa dev        # dev server with live reload
npx skrapa build      # production build
```

## Configuration

`skrapa.config.json` in the project root — all fields optional:

```json
{
    "input": "src",
    "output": "dist",
    "assets": "assets",
    "port": 8080
}
```

| Field    | Default  | Description                                                 |
| -------- | -------- | ----------------------------------------------------------- |
| `input`  | `src`    | Directory containing `index.html`, `index.tsx`, `client.ts` |
| `output` | `dist`   | Build output directory                                      |
| `assets` | `assets` | Static files copied as-is to output; skipped if not present |
| `port`   | `8080`   | Dev server port                                             |
| `base`   | `/`      | Base URL the site is served from; injected as `<base href>`. Set to `/repo/` for GitHub Pages project sites |

CLI flags override config file values:

```bash
npx skrapa dev --port 3000
npx skrapa build --input app --output public
```

## About

All too often I wanted to spin up a simple static site and found the usual stack — Vite + React + TypeScript + a pile of config — to be total overkill. I didn't need a virtual DOM, client-side routing, or a hydration step. I just wanted to write some markup, get a few interactive bits, and ship plain HTML.

Skrapa is the result. It keeps the one thing I actually missed — writing layout as JSX in TypeScript — and throws out the rest. Pages compile to static HTML at build time with their client JS inlined, so there's no framework and no runtime in the browser. A dev server with live reload keeps the feedback loop tight while you work.

I built it for myself and still use it daily: [my personal site](https://iambrian.com), throwaway prototypes, quick dashboards, and one-off reports. If you've ever wanted a static page without booting up an entire toolchain to get there, it might suit you too.

## License

[ISC](LICENSE) © [iambriansreed](https://github.com/iambriansreed)
