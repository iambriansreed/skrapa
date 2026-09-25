# Skrapa

[![npm version](https://img.shields.io/npm/v/skrapa.svg)](https://www.npmjs.com/package/skrapa)

Build static sites with TypeScript JSX templates and TypeScript client-side code. No framework, no virtual DOM, no config. A single zero-dependency script, run with `npx`, does all of it and never becomes a dependency of your project.

Requires Node.js v24+. Runs on macOS and Linux; the CLI shells out to Unix tools like `cp`, `rm`, and `tsc`.

**[Website](https://skrapa.iambrian.com)** · **[GitHub](https://github.com/iambriansreed/skrapa)** · **[npm](https://www.npmjs.com/package/skrapa)**

## How it works

A site lives in the directory holding its `tsconfig.json`, and Skrapa runs from there. JSX in that directory renders to raw HTML strings at build time. Every `index.tsx` under it that exports `Page` becomes its own page, `client.ts` is compiled to a standalone `.js` and linked via `<script src>`, and assets are copied as-is. CSS is yours to manage, so drop it in `assets/` and link it from `index.html`.

A new project keeps the site in `src/`:

```
src/tsconfig.json     →  TypeScript config, plus skrapa's settings under "skrapa"
src/index.html        →  shared HTML shell (head + body)
src/index.tsx         →  Page()  →  dist/index.html
src/about/index.tsx   →  Page()  →  dist/about/index.html
src/about/index.html  →  optional per-page shell, overrides the shared one for /about
src/client.ts         →  compiled to its own .js, linked via <script src>
assets/               →  copied as-is to dist/ (CSS, images, fonts)
```

Pages are found anywhere under that directory except under dot-directories (`.skrapa`, `.git`, `.github`, ...), `node_modules`, the output dir and the assets dir.

### Two roots

- The **skrapa root** is the directory holding a `tsconfig.json` with a `skrapa` key (`src/` in a new project). Skrapa runs from it and reads only the `tsconfig.json` there. Pages live under it, `.skrapa/` (scratch space for the compiled output) is written in it while a build runs, and `output` and `assets` resolve against it.
- The **project root** is where the project's own files live: `package.json`, `.gitignore`, `.github/`, and `skrapa.d.ts`. The [`projectRoot`](#configuration) setting names it, relative to the skrapa root. It defaults to `.`, and a new project sets `"../"`.

Every build writes `skrapa.d.ts` into the project root, so a `tsconfig.json` in a subdirectory lists `"../skrapa.d.ts"` in its `include`. It is also why a new project's npm scripts change into `src/` before running skrapa: `package.json` sits in the project root, and skrapa only reads the `tsconfig.json` in the directory it runs in.

### Pages

A `Page()` returns `Skrapa.Page`, which is JSX (or an object whose `body` is JSX), not a string. Strings that land in a child position are HTML-escaped, so `<p>{text}</p>` renders `text` as visible text even when it contains markup, and interpolating content from an API, a CMS, or a form is safe by default. When you really do have markup sitting in a string, pass it through the global `raw()`:

```tsx
export function Page(): Skrapa.Page {
    return (
        <ul>
            <li>{'<b>not bold</b>'}</li>
            {raw(rows.map((r) => `<li>${r}</li>`).join(''))}
        </ul>
    );
}
```

Nothing inside `raw()` is checked, so never build one from untrusted input.

Each page renders into the nearest `index.html`, walking up from its own directory to the skrapa root. Drop an `index.html` into a page's directory to give that page (and any page nested under it without a shell of its own) a different shell. That's handy when one page needs a different `<head>`, meta tags, or favicon. Whichever shell is used, Skrapa still injects the `<base href>` and the page's `title`, `head`, `body`, and `shellAttrs` (attributes set on the shell's `<html>` and `<body>` tags). A `shellAttrs` value is normally a string, which overwrites whatever the shell had; pass a function like `` (prev) => `${prev} about` `` to build on the shell's existing value instead of replacing it.

### How `src` and `href` resolve

A `<script src="....ts">` or `<link rel="stylesheet" href="....css">` can go in a shell or in a page's own JSX. Either way the path is resolved at build time, the file is copied or bundled into `dist/`, and the tag's path is rewritten to the result:

- **Relative** (`./client.ts`, `./style.css`) resolves against the directory of the file it was written in: the shell's directory for a shell, the page's own directory for page JSX. It never reaches `assets/`.
- **Root-relative** (`/style.css`) resolves from `assets/` first, then from the skrapa root. `/client.ts` likewise resolves from the skrapa root.
- **Another origin** (`https://cdn/lib.css`, `//cdn/lib.css`) is left exactly as written, since the browser fetches it directly.

A rewritten path carries the [`base`](#configuration), which at the default base is the path you already wrote.

That asymmetry is the one worth remembering: `assets/` is copied to the **output root**, so only a root-relative path can name something in it. A stylesheet living in `assets/style.css` is `/style.css`, never `./style.css`, no matter which file references it. Get it wrong and the build says so, and names the file it found in `assets/`.

A stylesheet is only ever copied from the site's own source files: never out of the output dir, the assets dir, a dot-directory or `node_modules`, and never from outside the skrapa root (`../shared.css`). A path that lands in one of those is reported as not found.

That's why the scaffolded about page links both. `/style.css` picks up the global sheet in `assets/`, while `./style.css` picks up `src/about/style.css` sitting next to that page's shell.

`assets/` is copied over `dist/` after every page is rendered, so a file in it can land on a path the build just wrote: `assets/about/index.html` would replace the page built from `src/about/`, and nothing about the output would look wrong. The build refuses instead, naming the two sources and the output path they meet at, and exits non-zero. Paths are compared case-insensitively, so `assets/About/` is caught on Linux as well as on macOS. In dev mode the copy is skipped and logged rather than failing, so the server you are watching stays up.

### Every reference has to resolve

Once the output is written, every local URL in it is checked against the files the build actually emitted. A reference that names nothing fails the build:

```
Reference does not resolve:
  in              dist/resume/index.html
  reference       /brian_reed_resume.pdf
  did you mean    /Brian_Reed_Resume.pdf   (differs only in case)
Spell the two the same way: case is part of the URL on a case-sensitive host, and ignored on the machine you tested it on.
```

Case is called out because it is the failure local testing cannot reproduce. macOS and Windows fold case when resolving a path, so a page linking `/fonts/archivo.woff2` against an emitted `fonts/Archivo.woff2` renders perfectly on the machine that built it and 404s on GitHub Pages: a dead download, or a preload and `@font-face` pair that quietly falls back to a system font. The check compares against a list of the real filenames rather than asking the filesystem, so it gives the same answer wherever it runs. Any other broken reference gets a `did you mean` row when a close enough file exists, and ends by saying to fix it, or to add its path to `linkCheckIgnore` if something other than the build serves it.

Read from HTML (`href`, `src`, `srcset`, `imagesrcset`) and from CSS (`url()`, `@import`, `image-set()`), including inline `<style>`. Query strings and fragments are ignored, `/about` and `/about/` both resolve to `about/index.html`, and every broken reference in the build is reported in one run. Another origin (`https://`, `//cdn/`), a `data:`/`mailto:`/`tel:` URI and a bare `#fragment` name nothing in the build and are skipped.

Every other reference is checked, unless its path matches a pattern in `linkCheckIgnore`. That list is for URLs the deployed site serves but the build does not write: a proxied `/api` route, files uploaded to the host by hand, a sitemap generated after the build.

```jsonc
"skrapa": { "linkCheckIgnore": ["/api/**", "/uploads/*.pdf", "/sitemap.xml"] }
```

Each pattern is a path from the site root, starting with `/`. `*` matches within one path segment, `**` across any number of them, `?` one character, and a trailing `/**` covers the path itself too, so `/api/**` also skips a link to `/api`. A reference is matched by where it points, not how it was written, so `/uploads/*.pdf` covers `../uploads/brief.pdf` on a nested page too, and under a `base` a pattern matches with or without the base in front. As a flag the patterns are comma-separated: `--linkCheckIgnore "/api/**,/uploads/*.pdf"`.

In dev mode a broken reference is a warning, not a failure. Mid-edit it usually means a link to a file that is about to exist, and the server you are watching stays up.

Under a `base` there is a second way to get this wrong, and it is the same bug in different clothes. `<base href>` governs **relative** URLs only: a root-relative `/style.css` ignores it and means the domain root, so on a project site at `https://user.github.io/repo/` it asks for a file that is not there. It resolves against a dev server rooted at `/` and 404s once deployed. Skrapa writes the base into every path it rewrites for you, so a bundled script lands as `/repo/client.js`; links you write by hand either carry the base or stay relative (`about/`, `./`) and let `<base href>` resolve them. The check names the URL with the base on it when it finds one missing.

## Quick Start

```bash
npx skrapa
```

Scaffolds a project, installs TypeScript (the only dependency it adds, and only if the project does not have it already), and starts the dev server. Then when you're ready:

```bash
npm run build
```

Builds every page to `dist/`, with markup rendered, client JS/CSS bundled and linked, and assets copied alongside. Ready to deploy.

Bare `npx skrapa` only scaffolds in a directory with no `tsconfig.json`, no `package.json`, and no `skrapa.config.ts` or `skrapa.config.json` from an older version. Anywhere else it says why, and what to run instead (`npm run dev` and `npm run build` beside a `package.json`), and exits rather than scaffold over an existing project. To scaffold anyway, ask for it by name with `npx skrapa init`.

### New or existing project

In a terminal, `init` asks one question first: **Is this a new project?**

- **New project** (the default answer, `--new`, or no terminal to ask in): the whole template goes into the current directory as it is. That directory is the project root, and the site is in `src/`. `package.json` gets `"dev": "cd src && npx skrapa dev"` and `"build": "cd src && npx skrapa build"`, and `.gitignore` gets `src/.skrapa`, `node_modules` and `dist`.
- **Existing project** (answer `n`, or pass `--projectRoot <dir>`): `init` asks for the project root, suggesting the nearest directory at or above the current one that holds a `package.json` or `.git`. It has to be the current directory or one above it, and `init` asks again until it is. The current directory becomes the skrapa root and gets the site's own files: the template's pages, `assets/`, and a `tsconfig.json` whose key is `"skrapa": { "output": "dist", "assets": "assets", "port": 8080, "projectRoot": "<your answer>" }`, with that project root's `skrapa.d.ts` in its `include`. The build writes `dist/` there too, so nothing lands on the existing project's files. Only the project-level files go to the project root:
    - `skrapa.d.ts`;
    - `.github/workflows/skrapa-pages.yml`, which runs `npm run skrapa:build` and uploads the site's own `dist/` (left alone if the file already exists);
    - `.gitignore` entries for the site's `.skrapa` and `dist`, plus `node_modules`;
    - `skrapa:dev` and `skrapa:build` scripts in `package.json`, named so they cannot collide with the project's own `dev` and `build`.

Either way, `package.json` is created if there is none, and gets a script only where it has none by that name, plus `"engines": { "node": ">=24" }` if it names no Node version. `.gitignore` only gets the entries it does not already cover. An existing `tsconfig.json` is kept, with a warning listing what pages need from it, and given a `skrapa` key if it has none. Every other existing file is left alone unless you pass `--force`. Last, `init` starts the dev server from the skrapa root, unless you pass `--no-dev`.

---

A new project gets:

```
.github/workflows/skrapa-pages.yml  # GitHub Pages deploy, gated on a deploy: commit message
README.md                           # starter readme for your project
assets/style.css                    # global styles (linked from src/index.html)
assets/skrapa.svg                   # logo
assets/github.svg                   # icon
skrapa.d.ts                         # global types, managed by skrapa
src/tsconfig.json                   # the skrapa root: TypeScript config, plus skrapa's settings under "skrapa"
src/index.html                      # shared HTML shell (head + body)
src/index.tsx                       # home page, Page()
src/client.ts                       # browser JS entry point
src/components/button.tsx           # example component (imported, never routed)
src/about/index.html                # per-page shell that overrides the shared one for /about
src/about/index.tsx                 # /about page (nested dir = nested route)
src/about/client.ts                 # browser JS scoped to /about
src/about/about.ts                  # helper module imported by src/about/client.ts
src/about/style.css                 # per-page styles, linked from the about shell
```

plus the `package.json` and `.gitignore` that `init` creates or updates. `src/tsconfig.json` has `"skrapa": { "output": "../dist", "assets": "../assets", "port": 8080, "projectRoot": "../" }` and `"include": ["**/*.ts", "**/*.tsx", "../skrapa.d.ts"]`, so the site builds to `dist/` beside `src/`.

## Commands

```bash
npx skrapa                         # scaffold a project (only in a dir with no tsconfig.json or package.json)
npx skrapa dev                     # dev server with live reload
npx skrapa build                   # production build
npx skrapa page "<name>" [parent]  # scaffold a new page (index.tsx + shell + css + client)
npx skrapa fix                     # migrate a project written against an older skrapa
```

Per-command flags:

| Command          | Flags / args                                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init` (default) | `--new` (a new project, without asking), `--projectRoot <dir>` (add a site here to the existing project at `<dir>`; not with `--new`), `-f` / `--force` (overwrite existing files), `--no-dev` (skip the dev server) |
| `dev`            | `--port`, `--host`, `--origin`, `-v` / `--verbose`, plus the build flags                                                                                                                                             |
| `build`          | `--output`, `--assets`, `--base`, `--linkCheckIgnore`, `--projectRoot`, `--source`                                                                                                                                   |
| `page`           | `<name>` and `[parent]` positionals, plus the config flags                                                                                                                                                           |
| `fix`            | `--output` (the dir to leave alone)                                                                                                                                                                                  |

Every command except `init` runs in the skrapa root (which is why a new project's scripts `cd src` first) and accepts the [config](#configuration) flags (`--output`, `--assets`, `--port`, `--host`, `--origin`, `--base`, `--linkCheckIgnore`, `--projectRoot`, `--source`), which override the `skrapa` key in `tsconfig.json`. Through an npm script, pass them after `--`: `npm run build -- --base /repo/`. A flag with nothing after it stops the command rather than being dropped. `--root` and `--input` are gone, and `--ignore` is `--linkCheckIgnore` now: pass an old flag and the command stops and says what replaced it.

`dev` watches the skrapa root (skipping the same directories the page search skips) and the assets dir, where a changed file is copied straight to the output and a deleted one is removed from it. When its port is busy, it names what holds the port and how to free it:

```
Error: port 8090 is already in use by PID 43577 in web:
  node /usr/local/bin/skrapa dev
Stop it with `kill 43577`, or pass --port <number> to use another.
```

When `lsof` and `ps` cannot say what holds the port, it says only that the port is in use and to pass `--port <number>`.

`build` refuses to clean an output dir that is or contains the skrapa root, the project root, the assets dir or the current directory, or that sits inside the skrapa root and holds an `index.tsx`, such as `"output": "docs"` beside a `docs/` page. When `tsc` did not emit a page (the tsconfig's `include` left it out) it names the file. `page` creates `<parent>/<slug>/` in the skrapa root, and refuses a parent that climbs out of it or lands where pages are not built from (the output or assets dir, `node_modules`, a dot-directory). The new page's shell links the global `/style.css` only when the project has one, and the page links home only when there is a home page, so it builds the moment it is created.

If the project root's `package.json` has a `postbuild-skrapa` script, `dev` runs it from the project root after its first build and after every rebuild. Use it for anything that has to happen on top of the build, like generating a sitemap. Anything written after the build is not there when the link check runs, so a page linking to it needs that path in `linkCheckIgnore`.

### Upgrading an older project

Older versions read settings from `skrapa.config.ts` (or `skrapa.config.json`) and built pages from an `input` directory (`src/` by default) below it. While one of those config files is still in the project, every command but `fix` refuses to run and points you at it (`init` too, unless you pass `--force`). Run `npx skrapa fix` beside the old config to apply the migrations:

- The old config's settings move into a `skrapa` key, then the old file is deleted. They are validated first. When the pages were not in a subdirectory, the key goes into the `tsconfig.json` beside the old config, inserted as text so its comments survive. With nothing to carry over, the key is written as `"skrapa": true`. `ignore` carries over as `linkCheckIgnore`. `input` and `root` no longer exist and are dropped, as is any key skrapa never read, and each one is reported. A `.ts` config that read `process.env` is written with the values it produced during that run, so pass a flag for anything that changes per environment.
- `tsconfig.json` now sits with the pages. When the old pages were in a subdirectory (`src/` by default), that directory becomes the skrapa root: `fix` copies the template's `tsconfig.json` into it, holding the old settings rebased to reach the same places from there (`"output": "../dist"`, `"assets": "../assets"`, `"projectRoot": ".."`), and points the `package.json` scripts that were exactly `npx skrapa dev` or `npx skrapa build` at it (`"build": "cd src && npx skrapa build"`). The old `tsconfig.json` stays where it was; skrapa no longer reads it, and compiler options of your own in it are not carried over. From then on, run skrapa from `src/`.
- The global type names skrapa used to declare become their namespaced equivalents: `Page` to `Skrapa.Page`, `Props` to `Skrapa.Props`, `PropsWithChildren` to `Skrapa.PropsWithChildren`, `Tag` to `Skrapa.Tag`, `CSSProperties` to `Skrapa.CSSProps`. Only type positions are touched, so `export function Page(): Page` keeps its function name, and a type your own code declares under one of those names is left alone.

It refuses to run when both old config files exist, when the pages were not in a subdirectory and there is no `tsconfig.json` beside the old config, or when the `tsconfig.json` the settings go into already has a `skrapa` key. It changes nothing when there is nothing to change, so it is safe to run twice. Every file it touches is listed as it goes; review the result with `git diff`.

## Configuration

Settings live under a `skrapa` key in the skrapa root's `tsconfig.json`, next to the compiler options. The key is required: `"skrapa": true` takes every default, and an object sets the fields it names. A `tsconfig.json` without it is not a Skrapa project. A new project's `src/tsconfig.json`:

```jsonc
{
    "skrapa": { "output": "../dist", "assets": "../assets", "port": 8080, "projectRoot": "../" },
    "compilerOptions": { ... },
    "include": ["**/*.ts", "**/*.tsx", "../skrapa.d.ts"]
}
```

Skrapa only ever reads `./tsconfig.json` in the directory it runs in, and that directory is the skrapa root: pages live under it, and `output`, `assets` and `projectRoot` resolve against it. It never walks up from a subdirectory to find one, and a `skrapa` key inherited through `extends` is not read. Comments and trailing commas are fine, as they are for `tsc`.

Every command stops before it does anything when the config has a problem, and lists every problem in the same run, so one pass fixes them all:

- a `tsconfig.json` that is missing or will not parse;
- no `skrapa` key, or a `skrapa` value that is neither `true` nor an object;
- an unknown key;
- an invalid value: the wrong type, a `port` outside 1-65535, an empty `output`, `assets`, `host` or `projectRoot`, or a `linkCheckIgnore` pattern that does not start with `/`;
- an old `skrapa.config.ts` or `skrapa.config.json` beside it;
- a config flag with no value after it, such as `npm run build -- --base`;
- a removed flag (`--root`, `--input`, or `--ignore`, which is `--linkCheckIgnore` now).

`compilerOptions.outDir` and `rootDir` are ignored. Skrapa always runs `tsc -p tsconfig.json --outDir .skrapa --rootDir .` in the skrapa root, so compiled output lands in `.skrapa/` beside `tsconfig.json` whatever the file says. That directory is scratch space: a build deletes it when it finishes (failed builds too), and `dev` keeps it for its rebuilds until it stops.

Paths are relative to the skrapa root.

| Field             | Default     | Description                                                                                                                                                              |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `output`          | `dist`      | Build output directory                                                                                                                                                   |
| `assets`          | `assets`    | Static files copied as-is to output; skipped if not present                                                                                                              |
| `port`            | `8080`      | Dev server port                                                                                                                                                          |
| `host`            | `localhost` | Interface the dev server binds to. Use `0.0.0.0` to reach it from other devices on the network                                                                           |
| `origin`          | `""`        | Public URL when a proxy or tunnel fronts the dev server, e.g. `https://dev.localhost`. See [Behind a proxy](#behind-a-proxy)                                             |
| `base`            | `/`         | Base URL the site is served from; injected as `<base href>`. Set to `/repo/` for GitHub Pages project sites                                                              |
| `linkCheckIgnore` | `[]`        | URL paths the [link check](#every-reference-has-to-resolve) skips, for what the site serves but the build does not write, e.g. `["/api/**"]`. As a flag, comma-separated |
| `projectRoot`     | `.`         | The project root, where `package.json`, `.gitignore` and `.github/` live and every build writes `skrapa.d.ts`. `"../"` for a site in `src/`                              |
| `source`          | `.`         | Where the pages live, when `tsconfig.json` sits in the project root instead: `"src"`. Set at most one of `source` and `projectRoot`                                      |

Because the config is JSON, it cannot compute a value or read an env var. Pass a flag for anything that changes per environment. Flags override the `skrapa` key, which overrides the defaults:

```bash
npx skrapa dev --port 3000
npx skrapa build --output public --base "$BASE"
```

### Behind a proxy

If a reverse proxy or tunnel maps a nicer URL onto the dev server, set `origin` to that URL. The server still binds to `host:port`, but the URL logged at startup is the one you actually open:

```bash
npx skrapa dev --origin https://dev.localhost
```

```json
{
    "skrapa": { "port": 8080, "origin": "https://dev.localhost" }
}
```

The port is optional inside `origin`, so a proxy listening on 443 gives you a URL with no port on it. Include the scheme; a bare hostname is treated as `http://`.

Live reload needs no extra configuration. The injected client derives its WebSocket URL from the page's own location, so loading `https://dev.localhost` opens `wss://dev.localhost/hmr` on its own. Your proxy does have to forward WebSocket upgrade requests on `/hmr` through to the dev server, otherwise the page loads fine but never reloads.

## About

All too often I wanted to spin up a simple static site and found the usual stack of Vite plus React plus TypeScript plus a pile of config to be total overkill. I didn't need a virtual DOM, client-side routing, or a hydration step. I just wanted to write some markup, get a few interactive bits, and ship plain HTML.

Skrapa is the result. It keeps the one thing I actually missed, writing layout as JSX in TypeScript, and throws out the rest. Pages compile to static HTML at build time with their client JS bundled into standalone files, so there's no framework and no runtime in the browser. A dev server with live reload keeps the feedback loop tight while you work.

I built it for myself and still use it daily: [my personal site](https://iambrian.com), throwaway prototypes, quick dashboards, and one-off reports. If you've ever wanted a static page without booting up an entire toolchain to get there, it might suit you too.

## License

[MIT](LICENSE) © [iambriansreed](https://github.com/iambriansreed)
