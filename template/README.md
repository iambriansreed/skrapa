# Skrapa

A minimal static site built with [Skrapa](https://skrapa.iambrian.com): native TypeScript, JSX without the framework overhead, live reload in dev, and static HTML deployable to GitHub Pages via the built-in Actions workflow.

## Project structure

```
src/index.html            # shared HTML shell (head + body)
src/index.tsx             # home page, Page() returns the body JSX
src/about/index.html      # per-page shell overriding the shared one for /about
src/about/index.tsx       # /about page (a nested dir becomes a nested route)
src/about/client.ts       # browser JS scoped to /about
src/about/style.css       # per-page styles, linked from the about shell
src/components/button.tsx # example component (imported, never routed)
src/client.ts             # browser JS, compiled and linked via <script src>
assets/                   # copied as-is to dist/ (CSS, images, fonts)
skrapa.config.ts         # build + dev-server settings
tsconfig.json             # TypeScript config
```

Any page can override the shared shell: add an `index.html` to that page's directory (e.g. `src/about/index.html`) and Skrapa builds that page from it instead. Pages without their own `index.html` fall back to `src/index.html`.

## Commands

```bash
npm run dev       # dev server with live reload (http://localhost:8080)
npm run build     # production build to dist/
```
