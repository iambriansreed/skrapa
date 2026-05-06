/**
 * scratch.ts
 *
 * Scratch.ts is a simple build tool and dev server for quickly prototyping static HTML/CSS/JS projects using a custom JSX runtime. It allows you to write your HTML structure in TypeScript with JSX syntax, and then compiles it into a static index.html file with embedded CSS and JS. It also supports an optional assets directory for static files like images or fonts.
 *
 * Dev mode runs a local server on port 8080 with live reload via WebSocket. File changes in the input directory trigger automatic rebuilds, and asset changes are copied on-the-fly, providing instant feedback during development.
 *
 * Usage:
 *   tsx scratch.ts init     # Set up a new Scratch project
 *   tsx scratch.ts build    # Build once
 *   tsx scratch.ts dev      # Dev server with HMR
 */
import { execSync, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import type { Socket } from 'net';
import type { Properties as CSSProperties } from 'csstype';

function exe(cmd: string) {
    execSync(cmd, { stdio: 'inherit' });
}
interface Config {
    /**
     *
     * Input directory containing index.tsx and style.css, defaults to "src".
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
    output?: string;
    /**
     * Optional assets directory to copy to output, defaults to "assets".
     *
     * If it doesn't exist, it will be skipped with a warning. It can be used for static files like images or fonts that are referenced in the input directory.
     *
     * In dev mode, this directory is watched for changes and changed or created files are copied automatically.
     *
     * @default "assets"
     * */
    assets?: string;
    /**
     * Optional port number for dev server, defaults to 8080. If the port is already in use, it will log an error and exit.
     *
     * @default 8080
     */
    port?: number;
}

const DEFAULT_CONFIG = {
    input: 'src',
    output: 'dist',
    assets: 'assets',
    port: 8080,
} as const;

// ============================================================================
// UTILS
// ============================================================================

declare global {
    type Props = { children?: never; style?: CSSProperties };

    type PropsWithChildren = { children?: unknown; style?: CSSProperties };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    type Tag = string | Function;

    function jsx(tag: Tag, props: Props | undefined, ...children: unknown[]): string;

    var Fragment: 'Fragment';

    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX {
        interface IntrinsicElements {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            [elemName: string]: any;
        }
        type Element = string;
    }
}

globalThis.Fragment = 'Fragment';

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

const ROOT_DIR = path.resolve(__dirname);

export const VERSION = '1.0.0';

const tmp = path.join(ROOT_DIR, '.scratch');

export const Fragment = 'Fragment';
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

function parseFlags(): Partial<Config> {
    const args = process.argv.slice(3);
    const flags: Partial<Config> = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--input') flags.input = args[++i];
        else if (args[i] === '--output') flags.output = args[++i];
        else if (args[i] === '--assets') flags.assets = args[++i];
        else if (args[i] === '--port') flags.port = parseInt(args[++i]);
    }
    return flags;
}

function initConfig() {
    const configPath = path.resolve(ROOT_DIR, 'scratch.config.json');
    const flagConfig = parseFlags();

    let config: Config = { ...DEFAULT_CONFIG };
    if (fs.existsSync(configPath)) {
        const fileConfig: Config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config = { ...DEFAULT_CONFIG, ...fileConfig, ...flagConfig };
        log.success(`Loaded config from: ${path.relative(ROOT_DIR, configPath)}`);
    } else {
        config = { ...DEFAULT_CONFIG, ...flagConfig };
        log.gray(`No config file found, using defaults: ${JSON.stringify(config, null, 2)}`);
    }

    const input = config.input ? path.resolve(ROOT_DIR, config.input) : '';

    const output = config.output ? path.resolve(ROOT_DIR, config.output) : '';

    const assets = config.assets ? path.resolve(ROOT_DIR, config.assets) : '';

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

    return { directory: { input, output, assets }, config };
}

function styleToCss(style: CSSProperties | undefined): string {
    if (!style) return '';
    return Object.entries(style)
        .map(([key, value]) => {
            const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            return `${cssKey}:${value}`;
        })
        .join(';');
}

function jsx(tag: Tag, props: Props | undefined, ...children: unknown[]): string {
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

                  if (typeof value === 'boolean') return value ? ` ${k}` : '';

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
        .map((c) => (typeof c === 'string' ? c : c !== null && c !== undefined && c !== false ? String(c) : ''))
        .join('');

    if (tag === 'Fragment' || tag === '') return childStr;

    const tagName = String(tag).toLowerCase();
    if (VOID_ELEMENTS.has(tagName)) {
        if (childStr !== '') {
            throw new Error(`Invalid JSX: void element <${tag}> cannot have children.`);
        }
        return `<${tag}${attrs} />`;
    }

    return `<${tag}${attrs}>${childStr}</${tag}>`;
}

// ============================================================================
// BUILD
// ============================================================================

export async function build(cfg?: ReturnType<typeof initConfig>) {
    const { directory, config } = cfg ?? initConfig();

    // Dynamically import the Root function from inputDir/index
    const { Root } = await import(path.join(directory.input, 'index'));

    if (!process.argv.includes('skip-assets')) {
        exe(`rm -rf ${tmp} && mkdir -p ${tmp}`);
    }

    exe(`tsc -p ${path.join(ROOT_DIR, 'tsconfig.client.json')}`);

    const clientJs = fs.readFileSync(path.join(tmp, config.input, 'client.js'), 'utf-8');
    const css = fs.readFileSync(path.join(directory.input, 'style.css'), 'utf-8');

    const html = Root()
        .replace('</body>', `<script>${clientJs}</script></body>`)
        .replace('</head>', `<style>${css}</style></head>`);

    fs.writeFileSync(path.join(directory.output, 'index.html'), html);

    if (!process.argv.includes('skip-assets') && directory.assets) {
        if (fs.existsSync(directory.assets)) {
            exe(`cp ${directory.assets}/* ${directory.output}/`);
        }
    }

    // Clean up temporary build directory
    exe(`rm -rf ${tmp}`);
}

// ============================================================================
// DEV
// ============================================================================

export async function dev() {
    const cfg = initConfig();
    const { directory, config } = cfg;

    log.info('Starting dev server...');

    // Initial build
    await build(cfg);

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

    const clients = new Set<Socket>();

    function broadcast(message: string) {
        const payload = Buffer.from(message);
        const frame = Buffer.alloc(2 + payload.length);
        frame[0] = 0x81; // FIN + text opcode
        frame[1] = payload.length;
        payload.copy(frame, 2);
        for (const socket of clients) socket.write(frame);
    }

    const server = http.createServer((req, res) => {
        log.info(`${req.method} ${req.url}`);
        const filePath = path.join(directory.output, req.url === '/' ? 'index.html' : req.url!);
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
                    const hmrScript = `
            <script>
              const ws = new WebSocket('ws://localhost:${config.port}/hmr');
              ws.onmessage = (event) => {
                if (event.data === 'reload') {
                  window.location.reload();
                }
              };
            </script>
          `;
                    res.end(content.toString().replace('</body>', `${hmrScript}</body>`), 'utf-8');
                } else {
                    res.end(content, 'utf-8');
                }
            }
        });
    });

    server.on('upgrade', (req, socket: Socket) => {
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
        socket.on('close', () => clients.delete(socket));
        socket.on('error', () => clients.delete(socket));
    });

    let buildTimer: NodeJS.Timeout | null = null;

    fs.watch(directory.input, { recursive: true }, () => {
        if (buildTimer) clearTimeout(buildTimer);
        buildTimer = setTimeout(() => {
            exec(`tsx ${__filename} build skip-assets`, (error) => {
                if (error) {
                    log.error(`Build failed: ${error.message}`);
                    return;
                }
                log.success('Build complete → reloading');
                broadcast('reload');
            });
        }, 100);
    });

    if (fs.existsSync(directory.assets)) {
        fs.watch(directory.assets, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            exe(`cp ${path.join(directory.assets, filename)} ${path.join(directory.output, filename)}`);
            broadcast('reload');
            log.success(`${directory.assets}/${filename} → ${directory.output}/${filename}`);
        });
    }

    server.listen(config.port);
    log.success(
        `\n⚡ ${color.cyan}http://localhost:${config.port}${color.reset}  ${color.gray}⌘ ⌃C to stop${color.reset}\n`
    );
    exe(`open http://localhost:${config.port}`);
}

// ============================================================================
// INIT
// ============================================================================

export async function init() {
    const rootPath = (...paths: string[]) => path.join(ROOT_DIR, ...paths);
    fs.mkdirSync(rootPath('src'), { recursive: true });
    fs.mkdirSync(rootPath('assets'), { recursive: true });
    fs.mkdirSync(rootPath('.github/workflows'), { recursive: true });

    /* FILE_CREATION_MAP > */
    const FILE_CREATION_MAP = {
        'src/client.ts': `const btn = document.getElementById('counter') as HTMLButtonElement;
let count = 0;
btn?.addEventListener('click', () => {
    count++;
    btn.textContent = \`count is \${count}\`;
});
`,
        'src/index.tsx': `export function Root() {
    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Scratch.ts</title>
            </head>
            <body>
                <a
                    class="github-link"
                    href="https://github.com/iambriansreed/scratch"
                    target="_blank"
                    rel="noopener"
                    aria-label="GitHub"
                >
                    <img src="github.svg" alt="GitHub" width="22" height="22" />
                </a>
                <div class="center">
                    <img src="scratch.svg" class="logo" alt="Scratch.ts Logo" width="80" height="80" />
                    <h1>Scratch.ts</h1>
                    <button id="counter">count is 0</button>
                    <p class="hint">
                        Edit <code>src/index.tsx</code> and save to test live reload
                    </p>
                    <p class="sub">
                        Built with{' '}
                        <a href="https://iambrian.com/scratch" target="_blank" rel="noopener">
                            Scratch.ts v1.0.0
                        </a>
                    </p>
                </div>
            </body>
        </html>
    );
}
`,
        'src/style.css': `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
img, svg { display: block; max-width: 100%; }
a { color: inherit; }

:root {
    --bg: #0f0f11;
    --surface: #1a1a1f;
    --border: #2a2a32;
    --text: #e8e8f0;
    --muted: #888899;
    --accent: #7c6af7;
}

body {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 1rem;
    line-height: 1.6;
    color: var(--text);
    background: var(--bg);
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
}

.center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    text-align: center;
    padding: 2rem;
}

.github-link {
    position: fixed;
    top: 1.25rem;
    right: 1.25rem;
    opacity: 0.4;
    transition: opacity 0.15s;
    z-index: 10;
}
.github-link:hover { opacity: 1; }
.github-link img { filter: invert(1); }

.logo {
    filter: invert(50%) sepia(80%) saturate(500%) hue-rotate(220deg);
    animation: spin linear both;
    animation-timeline: scroll();
}

@keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
}
h1 {
    font-size: 2.5rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    background: linear-gradient(120deg, var(--text) 35%, var(--accent) 50%, var(--text) 65%);
    background-size: 400% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: shimmer 12s linear infinite;
}

button {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.6rem 1.5rem;
    font-size: 1rem;
    cursor: pointer;
    transition: border-color 0.15s;
}

button:hover {
    border-color: var(--accent);
}

.hint {
    color: var(--muted);
    font-size: 0.95rem;
}

code {
    font-family: ui-monospace, monospace;
    font-size: 0.875rem;
    color: var(--text);
}

.sub {
    font-size: 0.85rem;
    color: var(--muted);
}

.sub a {
    color: var(--accent);
    text-decoration: none;
}

.sub a:hover { text-decoration: underline; }

@keyframes spin {
    to { transform: rotate(360deg); }
}
`,
        'assets/github.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.04.13 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.82.58C20.56 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/></svg>
`,
        'assets/scratch.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <line x1="135" y1="42" x2="62" y2="52" stroke="#000000" stroke-width="5" stroke-linecap="round" />
    <line x1="62" y1="52" x2="82" y2="102" stroke="#000000" stroke-width="5" stroke-linecap="round" />
    <line x1="82" y1="102" x2="132" y2="92" stroke="#000000" stroke-width="5" stroke-linecap="round" />
    <line x1="132" y1="92" x2="118" y2="152" stroke="#000000" stroke-width="5" stroke-linecap="round" />
    <line x1="118" y1="152" x2="62" y2="158" stroke="#000000" stroke-width="5" stroke-linecap="round" />
</svg>
`,
        '.github/workflows/deploy.yml': `name: Deploy to GitHub Pages
on:
    push:
        branches: ['main']
    workflow_dispatch:

permissions:
    contents: read
    pages: write
    id-token: write
jobs:
    deploy:
        name: Deploy
        concurrency:
            group: 'deploy-to-github-pages'
            cancel-in-progress: true
        runs-on: ubuntu-latest
        environment:
            name: github-pages
            url: \${{ steps.deployment.outputs.page_url }}
        steps:
            - name: Checkout
              uses: actions/checkout@v4
            - name: Setup Node
              uses: actions/setup-node@v4
              with:
                  node-version: '24'
            - name: Build project
              run: npm ci && npm run build
            - name: Upload artifact
              uses: actions/upload-pages-artifact@v3
              with:
                  path: './dist'
            - name: Deploy to GitHub Pages
              id: deployment
              uses: actions/deploy-pages@v4
`,
        '.nvmrc': `24
`,
        'scratch.config.json': `{ "input": "src", "output": "dist", "assets": "assets", "port": 8080 }
`,
        'tsconfig.client.json': `{
    "compilerOptions": {
        "target": "ES2020",
        "module": "ESNext",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "outDir": "./.scratch",
        "rootDir": "./",
        "lib": ["DOM", "ES2020"],
        "moduleResolution": "bundler"
    },
    "include": ["src/client.ts"],
    "exclude": ["node_modules", "dist"]
}
`,
        'tsconfig.json': `{
    "compilerOptions": {
        "target": "ES2020",
        "module": "ESNext",
        "jsx": "react",
        "jsxFactory": "jsx",
        "jsxFragmentFactory": "Fragment",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "outDir": "./.scratch",
        "rootDir": "./",
        "lib": ["ES2020"],
        "types": ["node"],
        "typeRoots": ["./node_modules/@types"]
    },
    "include": ["**/*.ts", "**/*.tsx"],
    "exclude": ["node_modules", "dist", "src/client.ts"]
}
`,
    };
    /* < FILE_CREATION_MAP */

    const force = process.argv.includes('-f') || process.argv.includes('--force');

    Object.entries(FILE_CREATION_MAP).forEach(([file, content]) => {
        if (!force && fs.existsSync(rootPath(file))) return log.gray(`Skipped existing file: ${file}`);
        fs.writeFileSync(rootPath(file), content);
    });

    // ensure package.json exists before installing
    if (!fs.existsSync(rootPath('package.json'))) {
        exe(`npm init -y`);
    }

    // install dependencies
    exe(`npm install --save-dev csstype typescript tsx @types/node`);

    // add dev/build scripts if not already present
    const pkgPath = rootPath('package.json');
    const pkgRaw = fs.readFileSync(pkgPath, 'utf-8');
    const pkgIndent = pkgRaw.match(/^([ \t]+)/m)?.[1] ?? '    ';
    const pkg = JSON.parse(pkgRaw);
    const scripts = pkg.scripts ?? {};
    let scriptsUpdated = false;
    if (!scripts.dev) {
        scripts.dev = 'tsx scratch.ts dev';
        scriptsUpdated = true;
    }
    if (!scripts.build) {
        scripts.build = 'tsx scratch.ts build';
        scriptsUpdated = true;
    }
    if (scriptsUpdated) {
        pkg.scripts = scripts;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, pkgIndent));
        log.success('Added dev and build scripts to package.json');
    }

    console.log(`
${color.green}╔══════════════════════════════════════╗
║   🎉  Project ready!                 ║
╚══════════════════════════════════════╝${color.reset}

${color.cyan}  tsx scratch.ts dev${color.reset}   — start dev server
${color.cyan}  tsx scratch.ts build${color.reset} — build for production
`);
    exe('tsx scratch.ts dev');
}

// ============================================================================
// MAIN
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        const cmd = process.argv[2];

        if (['init', 'build', 'dev'].includes(cmd)) {
            // @ts-expect-error - dynamic command execution
            await { init, build, dev }[cmd]();
        } else {
            log.error('Usage: tsx scratch.ts build | dev');
            process.exit(1);
        }
    })();
}

globalThis.jsx = jsx;
