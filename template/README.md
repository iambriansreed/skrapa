# Skrapa

A minimal static site built with [Skrapa](https://skrapa.iambrian.com): native TypeScript, JSX without the framework overhead, live reload in dev, and static HTML deployable to GitHub Pages via the built-in Actions workflow.

## Project structure

```
src/tsconfig.json          # TypeScript config, plus Skrapa's settings under "skrapa"
src/index.html             # shared HTML shell (head + body)
src/index.tsx              # home page, Page() returns the body JSX
src/client.ts              # browser JS, compiled and linked via <script src>
src/components/button.tsx  # example component (imported, never routed)
src/about/index.html       # per-page shell overriding the shared one for /about
src/about/index.tsx        # /about page (a nested dir becomes a nested route)
src/about/client.ts        # browser JS scoped to /about
src/about/about.ts         # helper module imported by src/about/client.ts
src/about/style.css        # per-page styles, linked from the about shell
assets/                    # copied as-is to dist/ (CSS, images, fonts)
skrapa.d.ts                # global types, managed by Skrapa
.github/workflows/skrapa-pages.yml  # GitHub Pages deploy
```

Skrapa runs from `src/`, the directory holding `tsconfig.json`. Its `skrapa` key builds the site to `../dist` with the files in `../assets`, and names this directory as the project root (`"projectRoot": "../"`), which is where every build writes `skrapa.d.ts`.

Every `index.tsx` under `src/` that exports `Page` becomes a page, except under `node_modules` and dot-directories.

Any page can override the shared shell: add an `index.html` to that page's directory (e.g. `src/about/index.html`) and Skrapa builds that page from it instead. Pages without their own `index.html` fall back to the nearest one above them, up to `src/index.html`.

## Commands

```bash
npm run dev       # dev server with live reload (http://localhost:8080)
npm run build     # production build to dist/
```

Both change into `src/` first, since Skrapa only reads the `tsconfig.json` in the directory it runs in.

The GitHub Pages workflow deploys on a push whose commit message starts with `deploy:`, on a pull request, or when run by hand from the Actions tab.
