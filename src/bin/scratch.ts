#!/usr/bin/env node

/**
 * scratch.ts
 *
 * Scratch.tsx is a simple build tool and dev server for quickly prototyping static HTML/CSS/JS projects using a custom JSX runtime. It allows you to write your HTML structure in TypeScript with JSX syntax, and then compiles it into a static index.html file with embedded CSS and JS. It also supports an optional assets directory for static files like images or fonts.
 *
 * Dev mode runs a local server on port 8080 with live reload via WebSocket. File changes in the input directory trigger automatic rebuilds, and asset changes are copied on-the-fly, providing instant feedback during development.
 *
 * Usage:
 *   npx stsx init     # Set up a new Scratch project
 *   npx stsx build    # Build once
 *   npx stsx dev      # Dev server with HMR
 *
 */
import { execSync, exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import type { Socket } from 'node:net';

export const Fragment = 'Fragment';

const VERSION: string = require('../package.json').version;

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
        return `<${tag}${attrs} />`;
    }

    return `<${tag}${attrs}>${childStr}</${tag}>`;
}

globalThis.jsx = jsx;
globalThis.Fragment = Fragment;
globalThis.VERSION = VERSION;

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

const ROOT_DIR = process.cwd();

const WORKING_DIR = path.join(ROOT_DIR, '.scratch');

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
    log.info(`Scratch.tsx v${VERSION}\n`);

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

// ============================================================================
// BUILD
// ============================================================================

export async function build(cfg?: ReturnType<typeof initConfig>) {
    const { directory, config } = cfg ?? initConfig();

    exe(`cd ${ROOT_DIR} && tsc`);
    exe(`cd ${ROOT_DIR} && tsc -p ${path.join(ROOT_DIR, 'tsconfig.client.json')}`);

    const { Root } = require(path.join(WORKING_DIR, config.input, 'index.js'));

    let html: string = Root();

    const clientJs = fs.readFileSync(path.join(WORKING_DIR, config.input, 'client.js'), 'utf-8');
    const css = fs.readFileSync(path.join(directory.input, 'style.css'), 'utf-8');

    html = html
        .replace('</body>', () => `<script>${clientJs}</script></body>`)
        .replace('</head>', () => `<style>${css}</style></head>`);

    fs.writeFileSync(path.join(directory.output, 'index.html'), html);

    if (!process.argv.includes('skip-assets') && directory.assets) {
        if (fs.existsSync(directory.assets)) {
            exe(`cp ${directory.assets}/* ${directory.output}/`);
        }
    }

    // Clean up temporary build directory
    // exe(`rm -rf ${WORKING_DIR}`);
}

// ============================================================================
// DEV
// ============================================================================

export async function dev() {
    const cfg = initConfig();
    const { directory, config } = cfg;

    log.info('\nDev mode starting...\n');

    // Initial build
    await build(cfg);

    //

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
        const frame = Buffer.alloc(2 + payload.length);
        frame[0] = 0x81; // FIN + text opcode
        frame[1] = payload.length;
        payload.copy(frame, 2);
        for (const socket of clients) socket.write(frame);
    }

    const server = http.createServer((req, res) => {
        server.setMaxListeners(0);
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
                    //console.log('Injecting hmr script');
                    const hmrScript = `
            <script>
              (function() {
                let reconnecting = false;
                let reloading = false;
                let overlayTimer = null;
                let overlay = null;
                const originalTitle = document.title;

                function reload() { reloading = true; window.location.reload(); }

                function flashTitle() {
                  let count = 0;
                  const id = setInterval(() => {
                    document.title = count++ % 2 === 0 ? '⚡ Reconnected' : originalTitle;
                    if (count > 6) { clearInterval(id); document.title = originalTitle; }
                  }, 400);
                }

                function showOverlay() {
                  if (overlay) return;
                  overlay = document.createElement('div');
                  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);color:#fff;display:flex;align-items:center;justify-content:center;font:24px/1 monospace;z-index:99999';
                  overlay.innerHTML = 'Dev server disconnected — Reconnecting<span style="animation:blink 1s step-start infinite">.</span><span style="animation:blink 1s step-start infinite 0.33s">.</span><span style="animation:blink 1s step-start infinite 0.66s">.</span>';
                  const style = document.createElement('style');
                  style.textContent = '@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}';
                  overlay.appendChild(style);
                  document.body.appendChild(overlay);
                }
                function showReconnected() {
                  if (overlay) { overlay.innerHTML = '✓ Reconnected'; overlay.style.background = 'rgba(0,120,0,0.7)'; }
                }
                function hideOverlay() {
                  if (overlay) { overlay.remove(); overlay = null; }
                }
                function connect() {
                  const ws = new WebSocket('ws://localhost:${config.port}/hmr');
                  ws.onopen = () => {
                    if (reconnecting) {
                      clearTimeout(overlayTimer);
                      if (overlay) { flashTitle(); showReconnected(); setTimeout(() => { hideOverlay(); reload(); }, 600); }
                      else { reload(); }
                    }
                  };
                  ws.onmessage = (event) => { if (event.data === 'reload') reload(); };
                  ws.onclose = () => {
                    if (reloading) return;
                    reconnecting = true;
                    overlayTimer = setTimeout(showOverlay, 1500);
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
        // log.gray(`WebSocket upgrade: ${req.url}`);
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
        // log.gray(`WebSocket connected (${clients.size} total)`);
        socket.on('close', () => {
            clients.delete(socket);
            log.gray(`WebSocket closed (${clients.size} remaining)`);
        });
        socket.on('error', (err) => {
            clients.delete(socket);
            log.error(`WebSocket error: ${err.message}`);
        });
    });

    let buildTimer: NodeJS.Timeout | null = null;

    fs.watch(directory.input, { recursive: true }, () => {
        if (buildTimer) clearTimeout(buildTimer);
        buildTimer = setTimeout(() => {
            exec(
                `npx stsx build skip-assets && npm run --if-present postbuild-scratch`,
                (error) => {
                    if (error) {
                        log.error(`Build failed: ${error.message}`);
                        return;
                    }
                    log.success(
                        `${color.reset}[${new Date().toLocaleTimeString()}]${color.green} Build complete → reloading (${clients.size} client${clients.size === 1 ? '' : 's'})`
                    );
                    broadcast('reload');
                }
            );
        }, 100);
    });

    if (fs.existsSync(directory.assets)) {
        fs.watch(directory.assets, { recursive: true }, (_event, filename) => {
            if (!filename) return;
            exe(
                `cp ${path.join(directory.assets, filename)} ${path.join(directory.output, filename)}`
            );
            broadcast('reload');
            log.success(`${directory.assets}/${filename} → ${directory.output}/${filename}`);
        });
    }

    server.listen(config.port, () => {
        log.success(
            `\n⚡ ${color.cyan}http://localhost:${config.port}${color.reset}  ${color.gray}ctrl+C to stop${color.reset}\n`
        );
        setTimeout(() => {
            if (clients.size === 0) exe(`open http://localhost:${config.port}`);
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

export async function init() {
    console.log(`\n${color.cyan}Scratch.tsx${color.reset} ${color.gray}v${VERSION}${color.reset}`);
    log.gray('Initializing...\n');

    const rootPath = (...paths: string[]) => path.join(ROOT_DIR, ...paths);

    const templateDir = path.join(__dirname, '../template');

    const force = process.argv.includes('-f') || process.argv.includes('--force');

    execSync(`cp -r${force ? ' -f' : ''} ${templateDir}/* ${rootPath()}`);

    fs.writeFileSync(
        rootPath('src/index.tsx'),
        fs.readFileSync(rootPath('src/index.tsx'), { encoding: 'utf-8' }).replace('v0.0.0', VERSION)
    );

    // ensure .scratch, node_modules, and dist are in .gitignore, creating it if needed
    const gitIgnorePath = rootPath('.gitignore');
    const gitIgnoreEntries = ['.scratch', 'node_modules', 'dist'];
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

    // copy ./global.d.ts to  rootPath(relPath)
    const globalTypes = path.join(__dirname, '../global.d.ts');
    fs.copyFileSync(globalTypes, rootPath('global.d.ts'));

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
        pkg.scripts.dev = 'npx stsx dev';
        pkgJsonUpdated = true;
    }
    if (!pkg.scripts.build) {
        pkg.scripts.build = 'npx stsx build';
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
    console.log(`${color.cyan}  npx stsx dev${color.reset}   — start dev server`);
    console.log(`${color.cyan}  npx stsx build${color.reset} — build for production\n`);
    exe('npx stsx dev');
}

// ============================================================================
// MAIN
// ============================================================================

// check if scratch.config.json exists
const initiated = fs.existsSync(path.resolve(ROOT_DIR, 'scratch.config.json'));

(async () => {
    const cmd = process.argv[2] || (!initiated && 'init') || '';

    if (['init', 'build', 'dev'].includes(cmd)) {
        // @ts-expect-error - dynamic command execution
        await { init, build, dev }[cmd]();
    } else {
        log.error('Usage: npx scratch init | build | dev');
        process.exit(1);
    }
})();
