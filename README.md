# Scratch.tsx

Build static sites with TypeScript JSX templates and TypeScript client-side code — no framework, no virtual DOM, no bundler config.

Requires Node.js v24+.

## How it works

JSX in `src/` renders to raw HTML strings at build time. Client JS and CSS are inlined, assets are copied as-is, and everything ships as a single `dist/index.html`.

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
npx stsx
```

Scaffolds a new project, installs dependencies, and starts the dev server. Creates:

```
src/button.tsx           # example component
src/client.ts            # browser JS entry point
src/index.tsx            # root JSX component
src/style.css            # styles
assets/scratch.svg       # logo
scratch.config.json      # project config
tsconfig.json            # TypeScript config
tsconfig.client.json     # browser TypeScript config
```

## Commands

```bash
npx stsx            # scaffold a new project
npx stsx dev        # dev server with live reload
npx stsx build      # production build
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

| Field    | Default  | Description                                                 |
| -------- | -------- | ----------------------------------------------------------- |
| `input`  | `src`    | Directory containing `index.tsx`, `client.ts`, `style.css`  |
| `output` | `dist`   | Build output directory                                      |
| `assets` | `assets` | Static files copied as-is to output; skipped if not present |
| `port`   | `8080`   | Dev server port                                             |

CLI flags override config file values:

```bash
npx stsx dev --port 3000
npx stsx build --input app --output public
```
