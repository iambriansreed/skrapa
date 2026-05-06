# Scratch.ts `v1.0.0`

A minimal build tool and dev server for prototyping static sites with JSX. Write HTML structure in TypeScript — no React, no virtual DOM, no bundler config.

## How it works

JSX in `src/` renders to raw HTML strings at build time. Client JS and CSS are inlined, assets are copied, and everything ships as a single `dist/index.html`.

```
src/index.tsx  →  Root() returns an HTML string
src/client.ts  →  compiled and inlined as browser JS
src/style.css  →  inlined into the HTML
assets/        →  copied as-is to dist/
                       ↓
                 dist/index.html
```

## Quick Start

```bash
curl -Lo scratch.ts https://s.iamb.dev
npx tsx scratch.ts init
```

`init` creates the following files, installs dependencies, and starts the dev server:

```
src/client.ts                    # browser JS entry point
src/features.tsx                 # example component
src/index.tsx                    # root JSX component
src/style.css                    # styles
assets/scratch.svg               # logo
.github/workflows/deploy.yml     # GitHub Pages deploy action
scratch.config.json              # project config
tsconfig.json                    # Node/build TypeScript config
tsconfig.client.json             # browser TypeScript config
```

## Commands

```bash
tsx scratch.ts init    # scaffold a new project
tsx scratch.ts dev     # dev server with live reload
tsx scratch.ts build   # production build
```

## Configuration

`scratch.config.json` in the project root — all fields optional:

```json
{
    "input": "src",
    "output": "dist",
    "assets": "assets",
    "port": 8080
}
```

| Field    | Default  | Description                                                |
| -------- | -------- | ---------------------------------------------------------- |
| `input`  | `src`    | Directory containing `index.tsx`, `client.ts`, `style.css` |
| `output` | `dist`   | Build output directory                                     |
| `assets` | `assets` | Static files copied as-is to output                        |
| `port`   | `8080`   | Dev server port                                            |

CLI flags override config file values:

```bash
tsx scratch.ts dev --port 3000
tsx scratch.ts build --input app --output public
```

## Assets

Files in `assets/` are copied to `dist/` on every build. In dev mode they are watched — changes are copied immediately without a full rebuild.

If the directory doesn't exist at the default path it is silently skipped; a custom path that doesn't exist is an error.
