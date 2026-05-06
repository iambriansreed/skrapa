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
                      return ` ${k}="${JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;

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
    const root = (...paths: string[]) => path.join(ROOT_DIR, ...paths);
    fs.mkdirSync(root('src'), { recursive: true });
    fs.mkdirSync(root('assets'), { recursive: true });
    fs.mkdirSync(root('.github/workflows'), { recursive: true });

    const FILE_CREATION_MAP = {
        'src/client.ts':
            "document.querySelectorAll('pre').forEach((pre) => {\n    const code = pre.querySelector('code:not([data-no-copy])');\n    if (!code) return;\n\n    const btn = document.createElement('button');\n    btn.className = 'copy-btn';\n    btn.textContent = 'Copy';\n    pre.appendChild(btn);\n\n    btn.addEventListener('click', () => {\n        navigator.clipboard.writeText(code.textContent ?? '').then(() => {\n            btn.textContent = 'Copied!';\n            setTimeout(() => (btn.textContent = 'Copy'), 2000);\n        });\n    });\n});\n",
        'src/features.tsx':
            "const features = [\n    {\n        title: 'TypeScript First<br /><i>TypeScript Only</i>',\n        desc: 'Full type safety from day one for TSX and client-side code.',\n    },\n    { title: 'Live Reload<br /><i>for Development</i>', desc: 'Instant feedback in the browser as you save.' },\n    {\n        title: 'Static Output<br /><i>for Production</i>',\n        desc: 'Builds to a single index.html with embedded CSS and JS.',\n    },\n    {\n        title: 'Devops Headaches<br /><i>Solved</i>',\n        desc: 'No setup required. Drop in scratch.ts and go — sane defaults handle the rest.',\n    },\n];\nexport function Features() {\n    return (\n        <section class=\"features\">\n            <h2>Features</h2>\n            <ul class=\"feature-grid\">\n                {' '}\n                {features.map((f) => (\n                    <li class=\"feature-card\">\n                        <strong>{f.title}</strong>\n                        <p>{f.desc}</p>\n                    </li>\n                ))}{' '}\n            </ul>\n        </section>\n    );\n}\n",
        'src/index.tsx':
            'import { Features } from \'./features\';\nexport function Root() {\n    return (\n        <html lang="en">\n            <head>\n                <meta charset="UTF-8" />\n                <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n                <title>Scratch.ts</title>\n            </head>\n            <body>\n                <header>\n                    <img src="scratch.svg" alt="Scratch Logo" width="64" height="64" />\n                    <h1>Scratch.ts</h1>\n                    <p class="tagline"> A minimal JSX build tool for rapid prototyping </p>\n                </header>\n                <main>\n                    <Features />\n                    <section class="getting-started">\n                        <h2>Get Started</h2>\n                        <p>Download the script</p>\n                        <pre>\n                            <code>curl -o scratch.ts https://iambrian.com/scratch/scratch.ts</code>\n                        </pre>\n                        <br />\n                        <p>Initialize your project</p>\n                        <pre>\n                            <code>npx tsx scratch.ts init</code>\n                        </pre>\n                        <br />\n                        <p>Start the dev server</p>\n                        <pre>\n                            <code>tsx scratch.ts dev</code>\n                        </pre>\n                    </section>\n                </main>\n                <footer>\n                    <div>\n                        <p>\n                            Built with{\' \'}\n                            <a href="https://iambrian.com/scratch" target="_blank" rel="noopener">\n                                Scratch.ts\n                            </a>\n                        </p>\n                        <p>\n                            Made with ♥ by{\' \'}\n                            <a href="https://iambrian.com" target="_blank" rel="noopener">\n                                iambrian.com\n                            </a>\n                        </p>\n                    </div>\n                </footer>\n            </body>\n        </html>\n    );\n}\n',
        'src/style.css':
            "*,\n*::before,\n*::after {\n    box-sizing: border-box;\n    margin: 0;\n    padding: 0;\n}\nhtml {\n    -webkit-text-size-adjust: 100%;\n    tab-size: 4;\n}\nimg,\npicture,\nvideo,\ncanvas,\nsvg {\n    display: block;\n    max-width: 100%;\n}\ninput,\nbutton,\ntextarea,\nselect {\n    font: inherit;\n}\np,\nh1,\nh2,\nh3,\nh4,\nh5,\nh6 {\n    overflow-wrap: break-word;\n}\na {\n    color: inherit;\n}\n:root {\n    --bg: #0f0f11;\n    --surface: #1a1a1f;\n    --border: #2a2a32;\n    --text: #e8e8f0;\n    --muted: #888899;\n    --accent: #7c6af7;\n}\n@keyframes bg-spin {\n    from {\n        transform: rotate(0deg);\n    }\n    to {\n        transform: rotate(90deg);\n    }\n}\nbody::before {\n    content: '';\n    position: fixed;\n    bottom: -10%;\n    right: -10%;\n    width: 70vmin;\n    height: 70vmin;\n    background: url(scratch.svg) center / contain no-repeat;\n    filter: invert(1);\n    opacity: 0.04;\n    pointer-events: none;\n    z-index: -1;\n    animation: bg-spin linear both;\n    animation-timeline: scroll();\n}\nbody {\n    font-family: system-ui, -apple-system, sans-serif;\n    font-size: 1rem;\n    line-height: 1.6;\n    color: var(--text);\n    background: var(--bg);\n    min-height: 100dvh;\n    display: flex;\n    flex-direction: column;\n}\nheader {\n    text-align: center;\n    padding: 5rem 2rem 3rem;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    gap: 1rem;\n}\nheader img {\n    width: 64px;\n    height: 64px;\n    color: var(--accent);\n    filter: invert(50%) sepia(80%) saturate(500%) hue-rotate(220deg);\n}\nh1 {\n    font-size: 3rem;\n    font-weight: 700;\n    letter-spacing: -0.03em;\n    line-height: 1.1;\n}\n.tagline {\n    font-size: 1.15rem;\n    color: var(--muted);\n    max-width: 38ch;\n}\nmain {\n    flex: 1;\n    width: 100%;\n    max-width: 1100px;\n    margin: 0 auto;\n    padding: 0 2rem 4rem;\n    display: flex;\n    flex-direction: column;\n    gap: 4rem;\n}\nh2 {\n    font-size: 1.25rem;\n    font-weight: 600;\n    margin-bottom: 1.25rem;\n    color: var(--muted);\n    text-transform: uppercase;\n    letter-spacing: 0.08em;\n    font-size: 0.8rem;\n}\n.feature-grid {\n    list-style: none;\n    display: grid;\n    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));\n    gap: 1rem;\n}\n.feature-card {\n    background: var(--surface);\n    border: 1px solid var(--border);\n    border-radius: 10px;\n    padding: 1.25rem 1.5rem;\n    display: flex;\n    flex-direction: column;\n    gap: 0.4rem;\n}\n.feature-card strong {\n    font-size: 1rem;\n    font-weight: 600;\n}\n.feature-card p {\n    font-size: 0.9rem;\n    color: var(--muted);\n    line-height: 1.5;\n}\npre {\n    position: relative;\n}\n.copy-btn {\n    position: absolute;\n    top: 0.5rem;\n    right: 0.5rem;\n    padding: 0.2rem 0.6rem;\n    font-size: 0.75rem;\n    font-family: ui-monospace, monospace;\n    background: var(--border);\n    color: var(--muted);\n    border: 1px solid var(--border);\n    border-radius: 4px;\n    cursor: pointer;\n    transition: color 0.15s, background 0.15s;\n}\n.copy-btn:hover {\n    background: var(--accent);\n    color: #fff;\n    border-color: var(--accent);\n}\n.getting-started pre {\n    background: var(--surface);\n    border: 1px solid var(--border);\n    border-radius: 8px;\n    padding: 1rem 1.5rem;\n    font-family: ui-monospace, monospace;\n    font-size: 0.95rem;\n    color: var(--accent);\n    overflow-x: auto;\n}\nfooter {\n    font-size: 0.85rem;\n    color: var(--muted);\n    border-top: 1px solid var(--border);\n}\nfooter > div {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    max-width: 1100px;\n    margin: 0 auto;\n    padding: 1.5rem 2rem;\n}\nfooter a {\n    color: var(--accent);\n    text-decoration: none;\n}\nfooter a:hover {\n    text-decoration: underline;\n}\n",
        'assets/scratch.svg':
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">\n    <line x1="135" y1="42" x2="62" y2="52" stroke="#000000" stroke-width="5" stroke-linecap="round" />\n    <line x1="62" y1="52" x2="82" y2="102" stroke="#000000" stroke-width="5" stroke-linecap="round" />\n    <line x1="82" y1="102" x2="132" y2="92" stroke="#000000" stroke-width="5" stroke-linecap="round" />\n    <line x1="132" y1="92" x2="118" y2="152" stroke="#000000" stroke-width="5" stroke-linecap="round" />\n    <line x1="118" y1="152" x2="62" y2="158" stroke="#000000" stroke-width="5" stroke-linecap="round" />\n</svg>\n',
        '.github/workflows/deploy.yml':
            "name: Deploy to GitHub Pages\non:\n    push:\n        branches: ['main']\n    workflow_dispatch:\n\npermissions:\n    contents: read\n    pages: write\n    id-token: write\njobs:\n    deploy:\n        name: Deploy\n        concurrency:\n            group: 'deploy-to-github-pages'\n            cancel-in-progress: true\n        runs-on: ubuntu-latest\n        environment:\n            name: github-pages\n            url: ${{ steps.deployment.outputs.page_url }}\n        steps:\n            - name: Checkout\n              uses: actions/checkout@v4\n            - name: Setup Node\n              uses: actions/setup-node@v4\n              with:\n                  node-version: '24'\n            - name: Build project\n              run: npm ci && npm run build\n            - name: Upload artifact\n              uses: actions/upload-pages-artifact@v3\n              with:\n                  path: './dist'\n            - name: Deploy to GitHub Pages\n              id: deployment\n              uses: actions/deploy-pages@v4\n",
        'scratch.config.json': '{ "input": "src", "output": "dist", "assets": "assets", "port": 8080 }\n',
        'tsconfig.client.json':
            '{\n    "compilerOptions": {\n        "target": "ES2020",\n        "module": "ESNext",\n        "strict": true,\n        "esModuleInterop": true,\n        "skipLibCheck": true,\n        "forceConsistentCasingInFileNames": true,\n        "outDir": "./.scratch",\n        "rootDir": "./",\n        "lib": ["DOM", "ES2020"],\n        "moduleResolution": "bundler"\n    },\n    "include": ["src/client.ts"],\n    "exclude": ["node_modules", "dist"]\n}\n',
        'tsconfig.json':
            '{\n    "compilerOptions": {\n        "target": "ES2020",\n        "module": "ESNext",\n        "jsx": "react",\n        "jsxFactory": "jsx",\n        "jsxFragmentFactory": "Fragment",\n        "strict": true,\n        "esModuleInterop": true,\n        "skipLibCheck": true,\n        "forceConsistentCasingInFileNames": true,\n        "outDir": "./.scratch",\n        "rootDir": "./",\n        "lib": ["ES2020"],\n        "types": ["node"],\n        "typeRoots": ["./node_modules/@types"]\n    },\n    "include": ["**/*.ts", "**/*.tsx"],\n    "exclude": ["node_modules", "dist", "src/client.ts"]\n}\n',
    };

    Object.entries(FILE_CREATION_MAP).forEach(([file, content]) => {
        if (fs.existsSync(root(file))) log.gray(`Skipped existing file: ${file}`);
        else fs.writeFileSync(root(file), content);
    });

    // install dependencies
    exe(`npm install --save-dev csstype typescript tsx @types/node`);

    log.info(`\n Add these to your package.json under "scripts":\n`);
    log.info(`  "dev": "tsx scratch.ts dev",`);
    log.info(`  "build": "tsx scratch.ts build",\n`);

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
