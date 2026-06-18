# Skrapa (sstx)

A minimal static site built with [Skrapa](https://iambrian.com/skrapa) — native TypeScript, JSX without the framework overhead, live reload, and a single `dist/index.html` deployable to GitHub Pages via built-in Actions workflow.

## Project structure

```
src/index.html       # shared HTML shell (head + body)
src/index.tsx        # home page — export Page() returns body HTML
src/about/index.tsx  # /about page — a nested dir becomes a nested route
src/client.ts        # browser JS, compiled and inlined
assets/              # copied as-is to dist/ (CSS, images, fonts)
```

## Commands

```bash
npm run dev       # dev server with live reload (http://localhost:8080)
npm run build     # production build → dist/index.html
```
