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

Each page uses `src/index.html` as its HTML shell. Drop an `index.html` into a page's own directory to override it for that page alone. That's handy when one page needs a different `<head>`, meta tags, or favicon. Whichever shell is used, Skrapa still injects the `<base href>` and the page's `title`, `head`, `body`, and `shellAttrs` (attributes set on the shell's `<html>` and `<body>` tags). A `shellAttrs` value is normally a string, which overwrites whatever the shell had; pass a function like `` (prev) => `${prev} about` `` to build on the shell's existing value instead of replacing it.

### How `src` and `href` resolve

A `<script src="....ts">` or `<link rel="stylesheet" href="....css">` can go in a shell or in a page's own JSX. Either way the path is resolved at build time, the file is copied or bundled into `dist/`, and the tag's path is rewritten to the result:

- **Relative** (`./client.ts`, `./style.css`) resolves against the directory of the file it was written in: the shell's directory for a shell, the page's own directory for page JSX. It never reaches `assets/`.
- **Root-relative** (`/style.css`) resolves from `assets/` first, then from the input root. `/client.ts` likewise resolves from the input root.

Either way the tag is rewritten to the built file's URL, with the [`base`](#configuration) on it, which at the default base is the path you already wrote.

That asymmetry is the one worth remembering: `assets/` is copied to the **output root**, so only a root-relative path can name something in it. A stylesheet living in `assets/style.css` is `/style.css`, never `./style.css`, no matter which file references it. Get it wrong and the build says so, and names the file it found in `assets/`.
- **Another origin** (`https://cdn/lib.css`, `//cdn/lib.css`) is left exactly as written, since the browser fetches it directly.

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

Case is called out because it is the failure local testing cannot reproduce. macOS and Windows fold case when resolving a path, so a page linking `/fonts/archivo.woff2` against an emitted `fonts/Archivo.woff2` renders perfectly on the machine that built it and 404s on GitHub Pages: a dead download, or a preload and `@font-face` pair that quietly falls back to a system font. The check compares against a list of the real filenames rather than asking the filesystem, so it gives the same answer wherever it runs.

Read from HTML (`href`, `src`, `srcset`, `imagesrcset`) and from CSS (`url()`, `@import`, `image-set()`), including inline `<style>`. Query strings and fragments are ignored, `/about` and `/about/` both resolve to `about/index.html`, and every broken reference in the build is reported in one run. Another origin (`https://`, `//cdn/`), a `data:`/`mailto:`/`tel:` URI and a bare `#fragment` name nothing in the build and are skipped, as is anything matching an [`ignore`](#configuration) glob, which is the way out for a URL something other than the build serves:

```ts
export default {
    ignore: ['/api/**', '/uploads/*.pdf'],
} satisfies Skrapa.Config;
```

`*` matches within one path segment, `**` across them, `?` a single character, and a trailing `/**` covers the path itself as well, so `/api/**` takes care of a link to `/api`. Patterns are matched against the URL as written and against the site-absolute path it resolves to, so one entry covers `/uploads/brief.pdf` and a page-relative `../uploads/brief.pdf` alike.

In dev mode a broken reference is a warning, not a failure. Mid-edit it usually means a link to a file that is about to exist, and the server you are watching stays up.

Under a `base` there is a second way to get this wrong, and it is the same bug in different clothes. `<base href>` governs **relative** URLs only: a root-relative `/style.css` ignores it and means the domain root, so on a project site at `https://user.github.io/repo/` it asks for a file that is not there. It resolves against a dev server rooted at `/` and 404s once deployed. Skrapa writes the base into every path it rewrites for you, so a bundled script lands as `/repo/client.js`; links you write by hand either carry the base or stay relative (`about/`, `./`) and let `<base href>` resolve them. The check names the URL with the base on it when it finds one missing.

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
skrapa.config.ts              # project config
tsconfig.json                 # TypeScript config (wires the jsx / Fragment runtime)
skrapa.d.ts                   # global types, managed by skrapa
README.md                     # starter readme for your project
.github/workflows/deploy.yml  # GitHub Pages deploy, gated on the commit message
```

## Commands

```bash
npx skrapa                     # scaffold a new project (only in a dir with no skrapa.config.ts)
npx skrapa dev                 # dev server with live reload
npx skrapa build               # production build
npx skrapa page "<name>" [parent]  # scaffold a new page (index.tsx + shell + css + client)
npx skrapa fix                 # migrate a project written against an older skrapa
```

Per-command flags:

| Command | Flags / args |
| ------- | ------------ |
| `init` (default) | `-f` / `--force` (overwrite existing files), `--no-dev` (skip the dev server) |
| `dev` | `--port`, `--host`, `--origin`, `-v` / `--verbose`, plus the build flags |
| `build` | `--input`, `--output`, `--assets`, `--base`, `--ignore`, `--root` |
| `page` | `<name>` and `[parent]` positionals, plus `--input` / `--root` |
| `fix` | `--root` (the tree to migrate), `--output` (the dir to leave alone) |

Every command accepts the [config](#configuration) flags (`--input`, `--output`, `--assets`, `--port`, `--host`, `--origin`, `--base`, `--ignore`, `--root`), which override `skrapa.config.ts`.

If your `package.json` has a `postbuild-skrapa` script, `dev` runs it after each rebuild. Use it for anything that has to happen on top of the build, like generating a sitemap.

### Upgrading an older project

`npx skrapa fix` walks the project and applies the migrations a pre-0.5 project needs:

- `skrapa.config.json` is rewritten as `skrapa.config.ts` (`export default { ... } satisfies Skrapa.Config`) and the JSON file removed. A key skrapa does not recognize is carried over and reported rather than dropped.
- The global type names skrapa used to declare become their namespaced equivalents: `Page` to `Skrapa.Page`, `Props` to `Skrapa.Props`, `PropsWithChildren` to `Skrapa.PropsWithChildren`, `Tag` to `Skrapa.Tag`, `CSSProperties` to `Skrapa.CSSProps`. Only type positions are touched, so `export function Page(): Page` keeps its function name, and a type your own code declares under one of those names is left alone.

It changes nothing when there is nothing to change, so it is safe to run twice. Every file it touches is listed as it goes; review the result with `git diff`.

## Configuration

`skrapa.config.ts` in the project root. Every field is optional:

```ts
export default {
    input: 'src',
    output: 'dist',
    assets: 'assets',
    port: 8080,
} satisfies Skrapa.Config;
```

`Skrapa.Config` is a global from the managed `skrapa.d.ts`, so there is nothing to import. The `satisfies` gets you completion and typo-checking on every field while keeping the literal types. Node runs the file directly (it strips the types itself on v24+), so the config is real code: read an env var, branch on `NODE_ENV`, compute a value.

| Field    | Default  | Description                                                                                                 |
| -------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `input`  | `src`    | Directory containing `index.html`, `index.tsx`, `client.ts`                                                 |
| `output` | `dist`   | Build output directory                                                                                      |
| `assets` | `assets` | Static files copied as-is to output; skipped if not present                                                 |
| `port`   | `8080`   | Dev server port                                                                                             |
| `host`   | `localhost` | Interface the dev server binds to. Use `0.0.0.0` to reach it from other devices on the network            |
| `origin` | `""`     | Public URL when a proxy or tunnel fronts the dev server, e.g. `https://dev.localhost`. See [Behind a proxy](#behind-a-proxy) |
| `base`   | `/`      | Base URL the site is served from; injected as `<base href>`. Set to `/repo/` for GitHub Pages project sites |
| `ignore` | `[]`     | URL globs the [link check](#every-reference-has-to-resolve) leaves alone, e.g. `['/api/**']`. As a flag, comma-separated |
| `root`   | cwd      | Directory `input`, `output` and `assets` resolve against                                                    |

`root` is really a CLI flag. Skrapa looks for `skrapa.config.ts` in the directory `--root` names (the working directory by default), so setting `root` *inside* that file moves where `input`, `output` and `assets` resolve, but not where the file itself was found.

CLI flags override config file values:

```bash
npx skrapa dev --port 3000
npx skrapa build --input app --output public
```

### Behind a proxy

If a reverse proxy or tunnel maps a nicer URL onto the dev server, set `origin` to that URL. The server still binds to `host:port`, but the URL logged at startup is the one you actually open:

```bash
npx skrapa dev --origin https://dev.localhost
```

```ts
export default {
    port: 8080,
    origin: 'https://dev.localhost',
} satisfies Skrapa.Config;
```

The port is optional inside `origin`, so a proxy listening on 443 gives you a URL with no port on it. Include the scheme; a bare hostname is treated as `http://`.

Live reload needs no extra configuration. The injected client derives its WebSocket URL from the page's own location, so loading `https://dev.localhost` opens `wss://dev.localhost/hmr` on its own. Your proxy does have to forward WebSocket upgrade requests on `/hmr` through to the dev server, otherwise the page loads fine but never reloads.

## About

All too often I wanted to spin up a simple static site and found the usual stack of Vite plus React plus TypeScript plus a pile of config to be total overkill. I didn't need a virtual DOM, client-side routing, or a hydration step. I just wanted to write some markup, get a few interactive bits, and ship plain HTML.

Skrapa is the result. It keeps the one thing I actually missed, writing layout as JSX in TypeScript, and throws out the rest. Pages compile to static HTML at build time with their client JS bundled into standalone files, so there's no framework and no runtime in the browser. A dev server with live reload keeps the feedback loop tight while you work.

I built it for myself and still use it daily: [my personal site](https://iambrian.com), throwaway prototypes, quick dashboards, and one-off reports. If you've ever wanted a static page without booting up an entire toolchain to get there, it might suit you too.

## License

[MIT](LICENSE) © [iambriansreed](https://github.com/iambriansreed)
