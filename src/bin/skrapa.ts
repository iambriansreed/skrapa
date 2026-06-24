#!/usr/bin/env node

/**
 * skrapa.ts
 *
 * Skrapa is a simple build tool and dev server for quickly prototyping static HTML/CSS/JS projects using a custom JSX runtime. It allows you to write your HTML structure in TypeScript with JSX syntax, and then compiles every `<dir>/index.tsx` that exports `Page` into a static HTML page with its client JS inlined. It also supports an optional assets directory for static files like images or fonts.
 *
 * Dev mode runs a local server on port 8080 with live reload via WebSocket. File changes in the input directory trigger automatic rebuilds, and asset changes are copied on-the-fly, providing instant feedback during development.
 *
 * Usage:
 *   npx skrapa          # Set up a new Skrapa project
 *   npx skrapa build    # Build once
 *   npx skrapa dev      # Dev server with HMR
 *
 */
import { execSync, exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import type { Socket } from 'node:net';

export const Fragment = 'Fragment';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamically getting the version number allowed
const VERSION: string = require('../package.json').version;

const CWD_DIR = path.join(process.cwd());

const VOID_ELEMENTS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
]);

function styleToCss(style: CSSProperties | undefined): string {
    if (!style) return '';
    return Object.entries(style)
        .map(([key, value]) => {
            const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            return `${cssKey}:${value}`;
        })
        .join(';');
}
//

export function jsx(tag: Tag, props: Props | undefined, ...children: unknown[]): string {
    if (typeof tag === 'function') {
        return tag({ ...props, children }, ...children);
    }

    const attrs = props
        ? Object.keys(props)
              // children are handled separately
              // keys are never used but in case someone passes them, we should ignore them to avoid invalid attributes in the output
              .filter((k) => k !== 'children' && k !== 'key')
              .map((k) => {
                  const value = props[k as keyof Props] as unknown;

                  if (k === 'style') return ` ${k}="${styleToCss(props[k])}"`;

                  if (value === undefined || value === null) return '';

                  if (value && typeof value === 'object')
                      return ` ${k}="${
                          JSON.stringify(value)
                              //
                              .replace(/&/g, '&amp;')
                              .replace(/"/g, '&quot;')
                              .replace(/</g, '&lt;')
                          //
                      }"`;

                  return ` ${k}="${value}"`;
              })
              .join('')
        : '';

    const childStr = children
        .flat()
        .map((c) =>
            typeof c === 'string'
                ? c
                : c !== null && c !== undefined && c !== false
                ? String(c)
                : ''
        )
        .join('');

    if (tag === 'Fragment' || tag === '') return childStr;

    const tagName = String(tag).toLowerCase();
    if (VOID_ELEMENTS.has(tagName)) {
        if (childStr !== '') {
            throw new Error(`Invalid JSX: void element <${tag}> cannot have children.`);
        }
        return `<${tag}${attrs}>`;
    }

    return `<${tag}${attrs}>${childStr}</${tag}>`;
}

globalThis.jsx = jsx;
globalThis.Fragment = Fragment;
globalThis.VERSION = VERSION;

function exe(cmd: string) {
    execSync(cmd, { stdio: 'inherit' });
}

type Config = {
    /**
     *
     * Input directory containing index.tsx and client.ts, defaults to "src".
     *
     * It will error if the directory doesn't exist or if index.tsx is missing.
     *
     * This directory is watched in dev mode for changes to trigger rebuilds.
     *
     * @default "src"
     */
    input: string;
    /**
     * Output directory for built files, defaults to "dist".
     *
     * If it doesn't exist, it will be created.
     *
     * In dev mode, this directory is served and watched for changes to trigger reloads.
     *
     * @default "dist"
     */
    output: string;
    /**
     * Optional assets directory to copy to output, defaults to "assets".
     *
     * If it doesn't exist, it will be skipped with a warning. It can be used for static files like images or fonts that are referenced in the input directory.
     *
     * In dev mode, this directory is watched for changes and changed or created files are copied automatically.
     *
     * @default "assets"
     * */
    assets: string;
    /**
     * Optional port number for dev server, defaults to 8080. If the port is already in use, it will log an error and exit.
     *
     * @default 8080
     */
    port: string;
    /**
     * Optional host for the dev server, defaults to "localhost". Used to build the served URLs and the HMR WebSocket address.
     *
     * @default "localhost"
     */
    host: string;
    /**
     * Optional base URL path the site is served from, defaults to "/". It is
     * injected as `<base href>` into every page's <head> so relative asset and
     * link URLs resolve correctly from nested pages (e.g. /about/) instead of
     * 404ing at /about/asset.svg. For a GitHub Pages project site served under
     * a subpath, set it to the repo name, e.g. "/my-site/". A trailing slash is
     * added if missing.
     *
     * @default "/"
     */
    base: string;
    /**
     * Optional root directory for resolving input/output/assets paths, defaults to the current working directory. This can be used to run Skrapa from a different location than the project root, but it's generally recommended to run it from the project root for simplicity.
     *
     * @default process.cwd()
     */
    root: string;
};

type ConfigKeys = keyof Config;

const CONFIG_KEYS: ConfigKeys[] = ['input', 'output', 'assets', 'port', 'host', 'base', 'root'];

const DEFAULT_CONFIG: Config = {
    input: 'src',
    output: 'dist',
    assets: 'assets',
    port: '8080',
    host: 'localhost',
    base: '/',
    root: process.cwd(),
} as const;

// ============================================================================
// UTILS
// ============================================================================

const color = {
    reset: '\x1b[0m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
};

const log = {
    info: (msg: string) => console.log(`${color.blue}${msg}${color.reset}`),
    success: (msg: string) => console.log(`${color.green}${msg}${color.reset}`),
    warn: (msg: string) => console.log(`${color.yellow}${msg}${color.reset}`),
    error: (msg: string) => console.error(`${color.red}${msg}${color.reset}`),
    gray: (msg: string) => console.log(`${color.gray}${msg}${color.reset}`),
};

function parseFlags(): Partial<Config> {
    const args = process.argv.slice(3);
    const flags: Partial<Config> = {};

    CONFIG_KEYS.forEach((key) => {
        const flag = `--${key}`; // --root, --input, --output, --assets, --port
        const index = args.findIndex((arg) => arg === flag);
        if (index > -1 && index < args.length - 1) flags[key] = args[index + 1];
    });

    return flags;
}

type InitContext = {
    directory: {
        input: string;
        output: string;
        assets: string;
    };
    config: Config;
    WORKING_DIR: string;
};

/**
 * Initialize the build context by loading the config, resolving paths, and syncing type declarations.
 *
 * It returns the resolved directory paths, the final config, and the working directory for temporary build files.
 */
function initContext(): InitContext {
    log.info(`Skrapa v${VERSION}\n`);

    const flagConfig = parseFlags();

    // Look for skrapa.config.json in the --root directory when provided, so
    // `--root template` reads template/skrapa.config.json instead of the cwd's.
    const configRoot = path.resolve(CWD_DIR, flagConfig.root ?? DEFAULT_CONFIG.root);
    const configPath = path.resolve(configRoot, 'skrapa.config.json');

    let config: Config = { ...DEFAULT_CONFIG };
    if (fs.existsSync(configPath)) {
        const fileConfig: Partial<Config> = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config = { ...DEFAULT_CONFIG, ...fileConfig, ...flagConfig };
        log.success(`Loaded config from: ${path.relative(CWD_DIR, configPath)}`);
    } else {
        config = { ...DEFAULT_CONFIG, ...flagConfig };
        log.gray(`No config file found, using defaults: ${JSON.stringify(config, null, 2)}`);
    }

    // Resolve root to an absolute path so require() and all derived paths
    // (input/output/assets/WORKING_DIR) follow --root instead of the cwd.
    config.root = path.resolve(CWD_DIR, config.root);

    // Sync the project's skrapa.d.ts with the type declarations bundled in
    // the installed skrapa package.
    {
        const src = path.join(__dirname, '../skrapa.d.ts');
        const dest = path.join(config.root, 'skrapa.d.ts');
        const next = fs.readFileSync(src, 'utf-8');
        const current = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf-8') : null;

        if (current !== next) {
            fs.writeFileSync(dest, next);
            log.success(`${current === null ? 'Added' : 'Updated'} skrapa.d.ts`);
        }
    }

    const WORKING_DIR = path.join(config.root, '.skrapa');
    const input = config.input ? path.resolve(config.root, config.input) : '';

    const output = config.output ? path.resolve(config.root, config.output) : '';

    const assets = config.assets ? path.resolve(config.root, config.assets) : '';

    if (!fs.existsSync(input)) {
        log.error(`Error: input directory does not exist at ${input}`);
        process.exit(1);
    }

    if (!fs.existsSync(output)) {
        log.warn(`Warning: output directory does not exist at ${output}`);
        log.info(`Creating: ${output}`);
        fs.mkdirSync(output, { recursive: true });
    }

    if (!assets || !fs.existsSync(assets)) {
        if (config.assets !== DEFAULT_CONFIG.assets) {
            log.error(`Error: assets directory does not exist at ${assets}`);
            process.exit(1);
        }

        log.gray(`Assets directory (${assets}) does not exist. Continuing without copying assets.`);
    }

    return { directory: { input, output, assets }, config, WORKING_DIR };
}

// ============================================================================
// BUILD
// ============================================================================

// A page module exports `Page()`, which returns either the body HTML as a
// string or a `Page` object (see skrapa.d.ts) that can also set the shared
// template's head/title and the page's client JS.
function build(): InitContext {
    const cfg = initContext();
    const { directory, config, WORKING_DIR } = cfg;

    exe(`cd ${config.root} && tsc`);
    exe(`cd ${config.root} && tsc -p tsconfig.client.json`);

    const template = fs.readFileSync(path.join(directory.input, 'index.html'), 'utf-8');

    // Served-from base path, injected as <base href> so relative asset and link
    // URLs resolve the same from "/" and from nested pages like "/about/".
    const base = config.base.endsWith('/') ? config.base : `${config.base}/`;

    // The compiled output mirrors the input tree under .skrapa/<input>, so a
    // page authored at src/about/index.tsx compiles to
    // .skrapa/src/about/index.js. Skrapa does not handle CSS — load it yourself
    // from a page's `head` or the shared index.html (e.g. a <link> to assets).
    const compiledDir = path.join(WORKING_DIR, config.input);

    // Read the compiled client bundle for `<relDir>/client.ts`, if it exists.
    const readClient = (relDir: string): string | null => {
        const p = path.join(compiledDir, relDir, 'client.js');
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
    };

    // Resolve an explicit `clientJs` entry (e.g. "/about/client.ts", rooted at
    // the input dir) to its compiled bundle and read it.
    const readClientPath = (entry: string, pageDir: string): string | null => {
        const rel = entry.startsWith('/') ? entry.slice(1) : path.join(pageDir, entry);
        const p = path.join(compiledDir, rel.replace(/\.tsx?$/, '.js'));
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
    };

    // Every compiled `<dir>/index.js` is a candidate page; anything else
    // (shared components, helpers, client.js) is ignored.
    const findPages = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return findPages(full);
            return entry.name === 'index.js' ? [full] : [];
        });

    const pageFiles = fs.existsSync(compiledDir) ? findPages(compiledDir) : [];

    let pageCount = 0;

    for (const file of pageFiles) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamically getting all pages, allowed
        const mod = require(file);
        const PageFn = mod.Page;
        // A page is an index module that exports a `Page` function — skip the rest.
        if (typeof PageFn !== 'function') continue;

        // Page directory relative to the input root: '' (root), 'about', 'a/b'.
        const pageDir = path.relative(compiledDir, path.dirname(file));

        const result: Page = PageFn();
        const page: Exclude<Page, string> = typeof result === 'string' ? { body: result } : result;
        const { body = '', head = '', title } = page;

        // Client JS: an explicit `clientJs` list loads exactly those entries;
        // otherwise merge `client.ts` up the directory chain to the input root
        // (deepest first), skipping levels that have none.
        let chunks: (string | null)[];
        if (Array.isArray(page.clientJs)) {
            chunks = page.clientJs.map((entry) => readClientPath(entry, pageDir));
        } else {
            const dirs: string[] = [];
            for (let d = pageDir; ; d = path.dirname(d) === '.' ? '' : path.dirname(d)) {
                dirs.push(d);
                if (d === '') break;
            }
            chunks = dirs.map(readClient);
        }
        const clientJs = chunks.filter(Boolean).join('\n');

        // <base> goes first in <head> so it governs every later URL (favicon,
        // page `head`, body assets). \b avoids matching <header>.
        let html = template
            .replace(/<head\b[^>]*>/, (m) => `${m}<base href="${base}" />`)
            .replace('</head>', () => `${head}</head>`);
        if (title) html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`);
        html = html.replace(
            '</body>',
            () => `${body}${clientJs ? `<script data-skrapa>${clientJs}</script>` : ''}</body>`
        );

        const full = path.join(directory.output, pageDir, 'index.html');
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, html);
        pageCount++;
    }

    if (pageCount === 0) {
        log.error(
            `Error: no pages found in ${config.input} (a page is a <dir>/index.tsx that exports \`Page\`).`
        );
        process.exit(1);
    }

    if (!process.argv.includes('skip-assets') && directory.assets) {
        if (fs.existsSync(directory.assets)) {
            exe(`cp -r ${directory.assets}/* ${directory.output}/`);
        }
    }

    // Clean up temporary build directory
    // exe(`rm -rf ${WORKING_DIR}`);

    return cfg;
}

// ============================================================================
// DEV
// ============================================================================
async function dev() {
    log.info('\nDev mode starting...\n');

    // Initial build
    const { directory, config } = build();

    const MIME_TYPES: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.wasm': 'application/wasm',
    };

    //

    const clients = new Set<Socket>();

    function broadcast(message: string) {
        const payload = Buffer.from(message);
        const len = payload.length;
        let frame: Buffer;
        if (len <= 125) {
            frame = Buffer.alloc(2 + len);
            frame[0] = 0x81;
            frame[1] = len;
            payload.copy(frame, 2);
        } else if (len <= 65535) {
            frame = Buffer.alloc(4 + len);
            frame[0] = 0x81;
            frame[1] = 126;
            frame.writeUInt16BE(len, 2);
            payload.copy(frame, 4);
        } else {
            frame = Buffer.alloc(10 + len);
            frame[0] = 0x81;
            frame[1] = 127;
            frame.writeBigUInt64BE(BigInt(len), 2);
            payload.copy(frame, 10);
        }
        for (const socket of clients) socket.write(frame);
    }

    const server = http.createServer((req, res) => {
        server.setMaxListeners(0);
        log.info(`${req.method} ${req.url}`);
        // Resolve clean URLs to their index.html: "/" and "/about/" -> .../index.html,
        // and extension-less paths like "/about" -> "/about/index.html".
        let urlPath = (req.url ?? '/').split('?')[0];
        // Strip the configured base prefix so a subpath deploy (base "/repo/")
        // still previews locally at the URLs the injected <base> produces.
        const basePrefix = config.base.replace(/\/+$/, '');
        if (basePrefix && (urlPath === basePrefix || urlPath.startsWith(`${basePrefix}/`)))
            urlPath = urlPath.slice(basePrefix.length) || '/';
        if (urlPath.endsWith('/')) urlPath += 'index.html';
        else if (!path.extname(urlPath)) urlPath += '/index.html';
        const filePath = path.join(directory.output, urlPath);
        const extname = String(path.extname(filePath)).toLowerCase();
        const contentType = MIME_TYPES[extname] || 'application/octet-stream';

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end('<h1>404 Not Found</h1>', 'utf-8');
                } else {
                    res.writeHead(500);
                    res.end(`Server Error: ${error.code}`);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });

                if (contentType === 'text/html') {
                    //console.log('Injecting hmr script');
                    const hmrScript = `
            <script>
              (function() {
                let reconnecting = false;
                let reloading = false;
                let toastTimer = null;
                let fadeTimer = null;
                let toast = null;

                function reload() { reloading = true; window.location.reload(); }

                function getToast() {
                  if (!toast) {
                    toast = document.createElement('div');
                    toast.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:5px 16px;border-radius:99px;font:12px/1.6 monospace;z-index:99999;transition:opacity 0.35s;pointer-events:none;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.25)';
                    document.body.appendChild(toast);
                  }
                  clearTimeout(fadeTimer);
                  toast.style.opacity = '1';
                  return toast;
                }

                function showToast(msg, bg, fade) {
                  const t = getToast();
                  t.textContent = msg;
                  t.style.background = bg;
                  t.style.color = '#fff';
                  if (fade) {
                    fadeTimer = setTimeout(() => {
                      t.style.opacity = '0';
                      fadeTimer = setTimeout(() => { if (toast) { toast.remove(); toast = null; } }, 400);
                    }, 1800);
                  }
                }

                function hideToast() {
                  clearTimeout(fadeTimer);
                  if (toast) { toast.remove(); toast = null; }
                }

                function connect() {
                  const ws = new WebSocket('ws://${config.host}:${config.port}/hmr');
                  ws.onopen = () => {
                    if (reconnecting) {
                      clearTimeout(toastTimer);
                      if (toast) {
                        showToast('✓ Reconnected', 'rgba(30,160,60,0.92)', false);
                        setTimeout(() => { hideToast(); reload(); }, 700);
                      } else { reload(); }
                    }
                  };
                  ws.onmessage = (event) => {
                    if (event.data === 'reload') reload();
                  };
                  ws.onclose = () => {
                    if (reloading) return;
                    reconnecting = true;
                    toastTimer = setTimeout(() => showToast('Reconnecting…', 'rgba(200,80,20,0.92)', false), 1500);
                    setTimeout(connect, 1000);
                  };
                }
                connect();
              })();
            </script>
          `;
                    res.end(
                        content.toString().replace('</body>', () => `${hmrScript}</body>`),
                        'utf-8'
                    );
                } else {
                    res.end(content, 'utf-8');
                }
            }
        });
    });

    server.on('upgrade', (req, socket: Socket) => {
        // log.gray(`WS upgrade: ${req.url}`);
        if (req.url !== '/hmr') {
            socket.destroy();
            return;
        }

        const key = req.headers['sec-websocket-key'] as string;
        const accept = crypto
            .createHash('sha1')
            .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
            .digest('base64');

        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `Sec-WebSocket-Accept: ${accept}\r\n` +
                '\r\n'
        );

        clients.add(socket);
        // log.gray(`WS connected (${clients.size} total)`);
        socket.on('close', () => {
            clients.delete(socket);
            log.gray(
                `WS closed (${clients.size} remaining) — reopen http://${config.host}:${config.port}`
            );
        });
        socket.on('error', (err) => {
            clients.delete(socket);
            log.error(`WS error: ${err.message}`);
        });
    });

    let buildTimer: NodeJS.Timeout | null = null;

    const triggerBuild = () => {
        if (buildTimer) clearTimeout(buildTimer);
        buildTimer = setTimeout(() => {
            exec(
                `npx skrapa build skip-assets && npm run --if-present postbuild-skrapa`,
                (error) => {
                    if (error) {
                        log.error(`Build failed: ${error.message}`);
                        return;
                    }
                    log.success(
                        `${color.reset}[${new Date().toLocaleTimeString()}]${
                            color.green
                        } Build complete → reloading (${clients.size} client${
                            clients.size === 1 ? '' : 's'
                        })`
                    );
                    broadcast('reload');
                }
            );
        }, 100);
    };

    let inputTimer: NodeJS.Timeout | null = null;

    fs.watch(directory.input, { recursive: true }, () => {
        if (inputTimer) clearTimeout(inputTimer);
        inputTimer = setTimeout(triggerBuild, 100);
    });

    if (fs.existsSync(directory.assets)) {
        fs.watch(directory.assets, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            const src = path.join(directory.assets, filename);
            const dest = path.join(directory.output, filename);
            // Editors save atomically (write `*.tmp.*` then rename), so the
            // watcher fires for a temp file that's already gone by the time we
            // copy. Skip those and any source that no longer exists, and never
            // let a copy failure crash the dev server.
            if (/\.tmp[.\d]*$|~$/.test(filename) || !fs.existsSync(src)) return;
            try {
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.cpSync(src, dest, { recursive: true });
            } catch (err) {
                log.error(`Asset copy failed: ${(err as Error).message}`);
                return;
            }
            broadcast('reload');
            log.success(`${directory.assets}/${filename} → ${directory.output}/${filename}`);
        });
    }

    server.listen(Number(config.port), config.host, () => {
        log.success(
            `\n⚡ ${color.cyan}http://${config.host}:${config.port}${color.reset}  ${color.gray}ctrl+C to stop${color.reset}\n`
        );
        setTimeout(() => {
            // if (clients.size === 0) exe(`open http://${config.host}:${config.port}`);
        }, 1500);
    });

    process.on('SIGINT', () => {
        log.info('\nEnding dev mode...\n');
        for (const socket of clients) socket.destroy();
        server.closeAllConnections();
        server.close(() => process.exit(0));
    });
}

// ============================================================================
// INIT
// ============================================================================

async function init() {
    console.log(`\n${color.cyan}Skrapa${color.reset} ${color.gray}v${VERSION}${color.reset}`);

    log.gray('Initializing...\n');

    const rootPath = (...paths: string[]) => path.join(CWD_DIR, ...paths);

    const templateDir = path.join(__dirname, '../template');

    const force = process.argv.includes('-f') || process.argv.includes('--force');

    execSync(`cp -r${force ? ' -f' : ''} ${templateDir}/* ${rootPath()}`);

    fs.writeFileSync(
        rootPath('src/index.tsx'),
        fs.readFileSync(rootPath('src/index.tsx'), { encoding: 'utf-8' }).replace('v0.0.0', VERSION)
    );

    // ensure .skrapa, node_modules, and dist are in .gitignore, creating it if needed
    const gitIgnorePath = rootPath('.gitignore');
    const gitIgnoreEntries = ['.skrapa', 'node_modules', 'dist'];
    if (fs.existsSync(gitIgnorePath)) {
        const content = fs.readFileSync(gitIgnorePath, 'utf-8');
        const existing = new Set(content.split('\n'));
        const toAdd = gitIgnoreEntries.filter((e) => !existing.has(e));
        if (toAdd.length > 0) {
            fs.appendFileSync(
                gitIgnorePath,
                (content.endsWith('\n') ? '' : '\n') + toAdd.join('\n') + '\n'
            );
        }
    } else {
        fs.writeFileSync(gitIgnorePath, gitIgnoreEntries.join('\n') + '\n');
    }

    const pkgPath = rootPath('package.json');

    // ensure package.json exists before installing
    if (!fs.existsSync(pkgPath)) {
        execSync(`npm init -y`, { stdio: 'pipe' });
    }

    const pkgRaw = fs.readFileSync(pkgPath, 'utf-8');
    const pkgIndent = pkgRaw.match(/^([ \t]+)/m)?.[1] ?? '    ';
    const pkg = JSON.parse(pkgRaw);
    pkg.scripts = pkg.scripts ?? {};
    let pkgJsonUpdated = false;

    // add dev/build scripts if not already present
    if (!pkg.scripts.dev) {
        pkg.scripts.dev = 'npx skrapa dev';
        pkgJsonUpdated = true;
    }
    if (!pkg.scripts.build) {
        pkg.scripts.build = 'npx skrapa build';
        pkgJsonUpdated = true;
    }

    if (!pkg?.engines?.node) {
        pkg.engines = { ...pkg.engines, node: '>=24' };
        pkgJsonUpdated = true;
    }

    if (pkgJsonUpdated) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, pkgIndent));
        log.success('Added dev and build scripts to package.json');
    }

    // install dependencies
    exe(`npm install --save-dev typescript`);

    log.success('\nProject initialized.\n');
    console.log(`${color.cyan}  npx skrapa dev${color.reset}   — start dev server`);
    console.log(`${color.cyan}  npx skrapa build${color.reset} — build for production\n`);
    exe('npx skrapa dev');
}

// ============================================================================
// MAIN
// ============================================================================

// check if skrapa.config.json exists
const initiated = fs.existsSync(path.resolve(CWD_DIR, 'skrapa.config.json'));

(async () => {
    let cmd = process.argv[2] || '';

    if (!cmd && !initiated) {
        cmd = 'init';
    }

    if (['init', 'build', 'dev'].includes(cmd)) {
        // @ts-expect-error - dynamic command execution
        await { init, build, dev }[cmd]();
    } else {
        log.error('Usage: npx skrapa init | build | dev');
        process.exit(1);
    }
})();
