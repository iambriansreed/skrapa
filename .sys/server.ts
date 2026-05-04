/**
 * Development server for HMR and static file serving.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec, execSync } from 'child_process';
import type { Socket } from 'net';

const PORT = 3000;
const STATIC_DIR = path.join(__dirname, '../dist');
const PUBLIC_DIR = path.join(__dirname, '../public');
const MIME_TYPES = {
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

const c = {
    reset: '\x1b[0m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
};

const log = {
    info: (msg: string) => console.log(`${c.blue}${msg}${c.reset}`),
    success: (msg: string) => console.log(`${c.green}${msg}${c.reset}`),
    warn: (msg: string) => console.log(`${c.yellow}${msg}${c.reset}`),
    error: (msg: string) => console.error(`${c.red}${msg}${c.reset}`),
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
    const filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url!);
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType =
        MIME_TYPES[extname as keyof typeof MIME_TYPES] || 'application/octet-stream';

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
              const ws = new WebSocket('ws://localhost:${PORT}/hmr');
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

fs.watch(path.join(__dirname, '../src'), { recursive: true }, () => {
    if (buildTimer) clearTimeout(buildTimer);
    buildTimer = setTimeout(() => {
        exec('tsx .sys/build.ts --skip-public', (error) => {
            if (error) {
                log.error(`Build failed: ${error.message}`);
                return;
            }
            log.success('Build complete → reloading');
            broadcast('reload');
        });
    }, 100);
});

fs.watch(PUBLIC_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    execSync(`cp ${path.join(PUBLIC_DIR, filename)} ${path.join(STATIC_DIR, filename)}`);
    broadcast('reload');
    log.success(`public/${filename} → dist`);
});

server.listen(PORT);
console.log(`\n⚡ ${c.cyan}http://localhost:${PORT}${c.reset}  \x1b[2m⌘ ⌃C to stop\x1b[0m\n`);
execSync(`open http://localhost:${PORT}`);
