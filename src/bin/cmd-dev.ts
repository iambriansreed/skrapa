/**
 * `skrapa dev` serves the site with live reload.
 *
 * Builds once, then serves the output dir over HTTP: a WebSocket pushes a
 * reload on every rebuild. Watches the input dir (rebuilds via a `skrapa build`
 * subprocess) and the assets dir (copies changed files through on the fly).
 * @param overrideConfig - {@link ConfigOverrides} applied on top of
 *   `skrapa.config.json` and the CLI flags below (build flags also accepted):
 *   - `--port <n>`       dev server port (default `"8080"`)
 *   - `--host <host>`    dev server host (default `"localhost"`)
 *   - `-v`, `--verbose`  log every HTTP request
 */

import { exec } from 'node:child_process';
import path from 'node:path';
import { build } from './cmd-build';
import { color, log } from './utils';
import type { Socket } from 'node:net';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

// ============================================================================
export async function dev(overrideConfig?: ConfigOverrides): Promise<void> {
    log.info('\nDev mode starting...\n');

    const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

    // Initial build
    const { directory, config } = build(overrideConfig);

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
        if (verbose) log.info(`${req.method} ${req.url}`);
        // Resolve clean URLs to their index.html: "/" and "/about/" -> .../index.html,
        // and extension-less paths like "/about" -> "/about/index.html".
        let urlPath = (req.url ?? '/').split('?')[0];
        // Percent-decode before touching the filesystem, so "/my%20file.css"
        // finds "my file.css". A malformed escape is the client's error.
        try {
            urlPath = decodeURIComponent(urlPath);
        } catch {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h1>400 Bad Request</h1>', 'utf-8');
            return;
        }
        // Strip the configured base prefix so a subpath deploy (base "/repo/")
        // still previews locally at the URLs the injected <base> produces.
        const basePrefix = config.base.replace(/\/+$/, '');
        if (basePrefix && (urlPath === basePrefix || urlPath.startsWith(`${basePrefix}/`)))
            urlPath = urlPath.slice(basePrefix.length) || '/';
        if (!urlPath.startsWith('/')) urlPath = `/${urlPath}`;
        if (urlPath.endsWith('/')) urlPath += 'index.html';
        else if (!path.extname(urlPath)) urlPath += '/index.html';

        // Resolve inside the output dir and refuse anything that escapes it:
        // `req.url` is attacker-controlled and "/../package.json" would
        // otherwise be served straight off disk (worse with --host 0.0.0.0).
        const outputRoot = path.resolve(directory.output);
        const filePath = path.resolve(outputRoot, `.${urlPath}`);
        if (filePath !== outputRoot && !filePath.startsWith(outputRoot + path.sep)) {
            res.writeHead(403, { 'Content-Type': 'text/html' });
            res.end('<h1>403 Forbidden</h1>', 'utf-8');
            return;
        }
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
            /* This is code added in the dev process by Skrapa. This will not appear in production. */
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
                  const ws = new WebSocket('ws://' + location.host + '/hmr');
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
                `WS closed (${clients.size} remaining). Reopen http://${config.host}:${config.port}`
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
                `npx skrapa build skip-assets pretty && npm run --if-present postbuild-skrapa`,
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
            // Editors save atomically (write a sibling temp file, then rename),
            // so the watcher fires for a temp file that is already gone by the
            // time we copy. The suffix varies by editor: VS Code appends a pid
            // and a hex nonce (`style.css.tmp.57884.2efe548`), vim leaves `~`
            // and `.swp`, Emacs writes `.#name`. Copying one through leaves it
            // in the output dir for good, where it ships with the site.
            const isEditorTempFile = /(^|[/\\])\.#|\.tmp(\.[\w-]+)*$|~$|\.swp$/i.test(filename);
            if (isEditorTempFile || !fs.existsSync(src)) return;
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

    // Without this the listen failure surfaces as an unhandled 'error' event
    // and a raw stack trace; a busy port is an ordinary thing to hit.
    server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            log.error(
                `\nError: port ${config.port} is already in use. Pass --port <number> to use another.\n`
            );
        } else {
            log.error(`\nDev server error: ${err.message}\n`);
        }
        process.exit(1);
    });

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
