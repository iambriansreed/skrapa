# Scratch

A minimal static site generator using TypeScript and a simple JSX factory that produces static HTML strings directly — no React, no virtual DOM.

## How it works

JSX in `src/` is transformed via a custom factory (`.sys/jsx.ts`) that renders to raw HTML strings at build time. The build script imports the page component directly, calls it, embeds the compiled client JS and CSS, and writes a single `dist/index.html`.

```
src/index.tsx   →  Page() returns an HTML string
src/client.ts   →  compiled by tsc, inlined into the HTML
src/style.css   →  inlined into the HTML
                         ↓
                  dist/index.html
```

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Starts a local server at `http://localhost:3000`. The server watches `src/` for changes, runs the build, and triggers a live reload in the browser via WebSocket — no extra packages.

## Build

```bash
npm run build
```

Runs `.sys/build.ts` which:

1. Compiles `src/client.ts` with `tsc -p tsconfig.client.json`
2. Calls `Page()` to get the HTML string
3. Embeds the compiled JS and CSS into the HTML
4. Formats the output with Prettier
5. Writes `dist/index.html`

## Linting

```bash
npm run lint      # ESLint (TypeScript + React rules, flat config)
npm run lint:css  # Stylelint
```
