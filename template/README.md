# Skrapa (sstx)

A minimal static site built with [Skrapa](https://iambrian.com/scratch) — native TypeScript, JSX without the framework overhead, live reload, and a single `dist/index.html` deployable to GitHub Pages via built-in Actions workflow.

## Project structure

```
index.html        # HTML template (head + body shell)
src/app.tsx       # app JSX component — export App() returns body HTML
src/client.ts     # browser JS, compiled and inlined
src/style.css     # styles, inlined into the HTML
assets/           # static files copied as-is to dist/
```

## Commands

```bash
npm run dev       # dev server with live reload (http://localhost:8080)
npm run build     # production build → dist/index.html
```
