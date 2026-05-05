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

    function jsx(
        tag: Tag,
        props: Props | undefined,
        ...children: unknown[]
    ): string;

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

function initConfig() {
    const configPath = path.resolve(ROOT_DIR, 'scratch.config.json');

    let workingConfig: Config = { ...DEFAULT_CONFIG };
    if (fs.existsSync(configPath)) {
        const fileConfig = JSON.parse(
            fs.readFileSync(configPath, 'utf-8')
        ) as Config;
        workingConfig = { ...DEFAULT_CONFIG, ...fileConfig };
        log.success(`Loaded config from: ${configPath}`);
    } else {
        log.gray(
            `No config file found, using defaults: ${JSON.stringify(workingConfig, null, 2)}`
        );
    }

    const input = workingConfig.input
        ? path.resolve(ROOT_DIR, workingConfig.input)
        : '';

    const output = workingConfig.output
        ? path.resolve(ROOT_DIR, workingConfig.output)
        : '';

    const assets = workingConfig.assets
        ? path.resolve(ROOT_DIR, workingConfig.assets)
        : '';

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
        if (workingConfig.assets !== DEFAULT_CONFIG.assets) {
            log.error(`Error: assets directory does not exist at ${assets}`);
            process.exit(1);
        }

        log.gray(
            `Assets directory (${assets}) does not exist. Continuing without copying assets.`
        );
    }

    return { directory: { input, output, assets }, config: workingConfig };
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

function jsx(
    tag: Tag,
    props: Props | undefined,
    ...children: unknown[]
): string {
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
            throw new Error(
                `Invalid JSX: void element <${tag}> cannot have children.`
            );
        }
        return `<${tag}${attrs} />`;
    }

    return `<${tag}${attrs}>${childStr}</${tag}>`;
}

// ============================================================================
// BUILD
// ============================================================================

export async function build() {
    const { directory, config } = initConfig();

    // Dynamically import the Root function from inputDir/index
    const { Root } = await import(path.join(directory.input, 'index'));

    if (!process.argv.includes('skip-assets')) {
        execSync(
            `rm -rf ${directory.output} ${tmp} && mkdir -p ${directory.output} ${tmp}`,
            {
                stdio: 'inherit',
            }
        );
    }

    execSync(`tsc -p ${path.join(ROOT_DIR, 'tsconfig.client.json')}`, {
        stdio: 'inherit',
    });

    const clientJs = fs.readFileSync(
        path.join(tmp, config.input, 'client.js'),
        'utf-8'
    );
    const css = fs.readFileSync(
        path.join(directory.input, 'style.css'),
        'utf-8'
    );

    const html = Root()
        .replace('</body>', `<script>${clientJs}</script></body>`)
        .replace('</head>', `<style>${css}</style></head>`);

    fs.writeFileSync(path.join(directory.output, 'index.html'), html);

    if (!process.argv.includes('skip-assets') && directory.assets) {
        if (fs.existsSync(directory.assets)) {
            execSync(`cp ${directory.assets}/* ${directory.output}/`, {
                stdio: 'inherit',
            });
        }
    }

    // Clean up temporary build directory
    execSync(`rm -rf ${tmp}`);
}

// ============================================================================
// DEV
// ============================================================================

export async function dev() {
    const { directory, config } = initConfig();

    // Initial build
    await build();

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
        const filePath = path.join(
            directory.output,
            req.url === '/' ? 'index.html' : req.url!
        );
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
                    res.end(
                        content
                            .toString()
                            .replace('</body>', `${hmrScript}</body>`),
                        'utf-8'
                    );
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
            execSync(
                `cp ${path.join(directory.assets, filename)} ${path.join(directory.output, filename)}`
            );
            broadcast('reload');
            log.success(
                `${directory.assets}/${filename} → ${directory.output}/${filename}`
            );
        });
    }

    server.listen(config.port);
    log.success(
        `\n⚡ ${color.cyan}http://localhost:${config.port}${color.reset}  ${color.gray}⌘ ⌃C to stop${color.reset}\n`
    );
    execSync(`open http://localhost:${config.port}`);
}

// ============================================================================
// INIT
// ============================================================================

export async function init() {
    const root = (...paths: string[]) => path.join(ROOT_DIR, ...paths);
    fs.mkdirSync(root('src'), { recursive: true });
    fs.mkdirSync(root('assets'), { recursive: true });

    const FILE_CREATION_MAP = {
        'src/client.ts': 'console.log("Hello from Scratch!")',
        'src/features.tsx':
            "const features = [ { title: 'Low Learning Curve', desc: 'Write JSX you already know — no new APIs to memorize.', }, { title: 'Few Dependencies', desc: 'Ships lean and stays lean. No bloat, no surprises.', }, { title: 'Fast Hot Reload', desc: 'Instant feedback in the browser as you save.', }, { title: 'TypeScript First', desc: 'Full type safety from day one, no config required.', }, { title: 'Static Output', desc: 'Builds to a single index.html with embedded CSS and JS.', }, { title: 'Asset Pipeline', desc: 'Drop files in the assets folder and they just work.', }, { title: 'Zero Config', desc: 'Sensible defaults get you running in seconds.', }, { title: 'Dev Server', desc: 'Local server with live reload via WebSocket on port 8080.', }, ]; export function Features() { return ( <section class=\"features\"> <h2>Features</h2> <ul class=\"feature-grid\"> {features.map((f) => ( <li class=\"feature-card\"> <strong>{f.title}</strong> <p>{f.desc}</p> </li> ))} </ul> </section> ); }",
        'src/index.tsx':
            'import { Features } from \'./features\'; export function Root() { return ( <html lang="en"> <head> <meta charset="UTF-8" /> <meta name="viewport" content="width=device-width, initial-scale=1.0" /> <title>Scratch</title> </head> <body> <header> <img src="scratch.svg" alt="Scratch Logo" width="64" height="64" /> <h1>Scratch</h1> <p class="tagline"> A minimal JSX build tool for rapid prototyping </p> </header> <main> <Features /> <section class="getting-started"> <h2>Get Started</h2> <pre> <code>tsx scratch.ts init</code> </pre> </section> </main> <footer> <p>Built with Scratch</p> </footer> </body> </html> ); }',
        'src/style.css':
            '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}html{-webkit-text-size-adjust:100%;tab-size:4;}img,picture,video,canvas,svg{display:block;max-width:100%;}input,button,textarea,select{font:inherit;}p,h1,h2,h3,h4,h5,h6{overflow-wrap:break-word;}a{color:inherit;}:root{--bg:#0f0f11;--surface:#1a1a1f;--border:#2a2a32;--text:#e8e8f0;--muted:#888899;--accent:#7c6af7;}body{font-family:system-ui,-apple-system,sans-serif;font-size:1rem;line-height:1.6;color:var(--text);background:var(--bg);min-height:100dvh;display:flex;flex-direction:column;}header{text-align:center;padding:5rem 2rem 3rem;display:flex;flex-direction:column;align-items:center;gap:1rem;}header img{width:64px;height:64px;color:var(--accent);filter:invert(50%) sepia(80%) saturate(500%) hue-rotate(220deg);}h1{font-size:3rem;font-weight:700;letter-spacing:-0.03em;line-height:1.1;}.tagline{font-size:1.15rem;color:var(--muted);max-width:38ch;}main{flex:1;width:100%;max-width:860px;margin:0 auto;padding:0 2rem 4rem;display:flex;flex-direction:column;gap:4rem;}h2{font-size:1.25rem;font-weight:600;margin-bottom:1.25rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;font-size:0.8rem;}.feature-grid{list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;}.feature-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:0.4rem;}.feature-card strong{font-size:1rem;font-weight:600;}.feature-card p{font-size:0.9rem;color:var(--muted);line-height:1.5;}.getting-started pre{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1rem 1.5rem;font-family:ui-monospace,monospace;font-size:0.95rem;color:var(--accent);overflow-x:auto;}footer{text-align:center;padding:1.5rem;font-size:0.85rem;color:var(--muted);border-top:1px solid var(--border);}',
        'assets/scratch.svg':
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><line x1="135" y1="42" x2="62" y2="52" stroke="#000000" stroke-width="5" stroke-linecap="round" /><line x1="62" y1="52" x2="82" y2="102" stroke="#000000" stroke-width="5" stroke-linecap="round" /><line x1="82" y1="102" x2="132" y2="92" stroke="#000000" stroke-width="5" stroke-linecap="round" /><line x1="132" y1="92" x2="118" y2="152" stroke="#000000" stroke-width="5" stroke-linecap="round" /><line x1="118" y1="152" x2="62" y2="158" stroke="#000000" stroke-width="5" stroke-linecap="round" /></svg>',
        'scratch.config.json': `{"input": "src","output": "dist","assets": "assets","port": 8080}`,
        'tsconfig.json': `{"compilerOptions": {"target": "ES2020","module": "ESNext","jsx": "react","jsxFactory": "jsx","jsxFragmentFactory": "Fragment","strict": true,"esModuleInterop": true,"skipLibCheck": true,"forceConsistentCasingInFileNames": true,"outDir": "./.scratch","rootDir": "./","lib": ["ES2020"],"types": ["node"],"typeRoots": ["./node_modules/@types"]},"include": ["**/*.ts","**/*.tsx"],"exclude": ["node_modules","dist"]}`,
        'tsconfig.client.json': `{"compilerOptions": {"target": "ES2020","module": "ESNext","strict": true,"esModuleInterop": true,"skipLibCheck": true,"forceConsistentCasingInFileNames": true,"outDir": "./.scratch","rootDir": "./","lib": ["DOM","ES2020"],"moduleResolution": "bundler"},"include": ["**/src/client.ts"],"exclude": ["node_modules","dist"]}`,
    };

    Object.entries(FILE_CREATION_MAP).forEach(([file, content]) =>
        fs.writeFileSync(file, content)
    );

    // install dependencies
    execSync(`npm install --save-dev csstype typescript tsx @types/node`, {
        stdio: 'inherit',
    });

    log.success(
        `\n🎉 Project set up! Run ${color.cyan}tsx scratch.ts dev${color.reset} to start the dev server.`
    );
}

// ============================================================================
// MAIN
// ============================================================================

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

globalThis.jsx = jsx;
