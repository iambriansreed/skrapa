/**
 * `skrapa dev` serves the site with live reload.
 *
 * Builds once, then serves the output dir over HTTP: a WebSocket pushes a
 * reload on every rebuild. Watches the skrapa root (rebuilds via a `skrapa
 * build` subprocess) and the assets dir (copies changed files through on the
 * fly, and removes deleted ones from the output). A port something else holds
 * stops it with a message naming the holder
 * (see portHolder).
 * @param overrideConfig - {@link Skrapa.Config} applied on top of the
 *   `skrapa` key in tsconfig.json and the CLI flags below (build flags also
 *   accepted):
 *   - `--port <n>`       dev server port (default `"8080"`)
 *   - `--host <host>`    interface to bind to (default `"localhost"`)
 *   - `--origin <url>`   public URL when behind a proxy (default: host:port)
 *   - `-v`, `--verbose`  log every HTTP request
 */

import { exec, execFileSync } from 'node:child_process';
import path from 'node:path';
import { build } from './cmd-build';
import { checkCopy, formatProblem, readManifest, walk } from './output-paths';
import { color, CWD_DIR, exe, isSkippedPath, log } from './utils';
import type { Socket } from 'node:net';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

/** The config keys a rebuild reads. port/host/origin belong to the server. */
const BUILD_KEYS = [
    'output',
    'assets',
    'base',
    'linkCheckIgnore',
    'projectRoot',
    'source',
] as const;

/**
 * The flags to hand the `skrapa build` subprocess each rebuild runs.
 *
 * Every rebuild is a fresh process that resolves its own config from scratch.
 * It runs in the same skrapa root and so reads the same tsconfig.json, but a
 * flag or a programmatic override this dev server was started with would be
 * lost: `skrapa dev --output public` would serve public/ while every rebuild
 * wrote to dist/.
 *
 * Resolved values are sent rather than the raw argv, so a setting that came
 * from a programmatic override survives too, not only one typed as a flag.
 * `linkCheckIgnore` goes over in the comma-separated form its flag takes, and
 * an empty list as an empty value rather than not at all, or the rebuild would
 * read back the patterns in tsconfig.json that an override had cleared.
 * @param config - the fully resolved config this dev server is serving
 * @returns a leading-space-prefixed flag string, safe to append to a command
 */
export function rebuildFlags(config: ResolvedConfig): string {
    return BUILD_KEYS.map((key) => {
        const value = config[key];
        const text = typeof value === 'string' ? value : value.join(',');
        return ` --${key} ${JSON.stringify(text)}`;
    }).join('');
}

/**
 * The files a deletion in the assets dir leaves stale in the output: every file
 * copied out of the assets dir at the deleted path or below it, since deleting
 * a directory is one watcher event and every file in it has to go.
 *
 * Only files in `copied` are ever named, so nothing the build or a
 * `postbuild-skrapa` script wrote into the output is taken along.
 * @param removed - the deleted path, relative to the assets dir
 * @param copied - every file copied out of the assets dir, relative to it
 */
export function staleAssetFiles(removed: string, copied: ReadonlySet<string>): string[] {
    const under = removed.endsWith(path.sep) ? removed : `${removed}${path.sep}`;
    return [...copied].filter((file) => file === removed || file.startsWith(under));
}

/**
 * The command that runs the project's `postbuild-skrapa` script, or `null`
 * when there is no package.json to run it from. Dev runs it after its first
 * build and after every rebuild. package.json lives in the project root, which
 * the skrapa root is inside of, so npm finds it from either.
 *
 * `npm run --if-present` tolerates a missing *script*, but still errors when
 * there is no package.json at all, and that error would fail every build in a
 * directory that was never `skrapa init`-ed. So the file is checked once, here.
 * @param projectRoot - the project root, where package.json has to be
 */
export function postbuildCommand(projectRoot: string): string | null {
    return fs.existsSync(path.join(projectRoot, 'package.json'))
        ? 'npm run --if-present postbuild-skrapa'
        : null;
}

/** A process listening on a TCP port. */
export type PortHolder = {
    pid: number;
    /** Its full command line. */
    command: string;
    /** Its working directory, when that can be read. */
    cwd: string | null;
};

/**
 * What is listening on a port, so a port-in-use error can say what to stop
 * rather than only that something is there. The usual answer is a dev server
 * an earlier session left running.
 *
 * Asks `lsof`, and `ps` for the full command line, both on the macOS and Linux
 * the CLI runs on. Only called once listening has already failed, so the cost
 * is paid by the failure alone.
 * @param port - the port that could not be listened on
 * @returns the holder, or null when neither tool can say (not installed, or
 *   the listener belongs to another user)
 */
export function portHolder(port: number): PortHolder | null {
    const run = (file: string, args: string[]): string => {
        try {
            return execFileSync(file, args, {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
            });
        } catch {
            return '';
        }
    };

    // -F p: one `p<pid>` line per process; the same process listening on IPv4
    // and IPv6 is listed once.
    const listing = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']);
    const pid = Number(/^p(\d+)$/m.exec(listing)?.[1]);
    if (!pid) return null;

    const command = run('ps', ['-o', 'command=', '-p', String(pid)]).trim() || `PID ${pid}`;
    const cwd = /^n(.+)$/m.exec(run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']))?.[1];

    return { pid, command, cwd: cwd ?? null };
}

/**
 * The error for a port something else is listening on. Pure.
 * @param port - the port that could not be listened on
 * @param holder - what holds it, from {@link portHolder}
 */
export function portInUseMessage(port: number, holder: PortHolder | null): string {
    if (!holder) {
        return `Error: port ${port} is already in use. Pass --port <number> to use another.`;
    }

    // Relative when it is somewhere under here, which is the case worth
    // recognizing at a glance (this project, or its other site); absolute
    // otherwise, since a path climbing out of here reads worse than none.
    const relative = holder.cwd === null ? null : path.relative(CWD_DIR, holder.cwd) || '.';
    const where =
        holder.cwd === null
            ? ''
            : ` in ${relative === '..' || relative?.startsWith(`..${path.sep}`) ? holder.cwd : relative}`;

    return [
        `Error: port ${port} is already in use by PID ${holder.pid}${where}:`,
        `  ${holder.command}`,
        `Stop it with \`kill ${holder.pid}\`, or pass --port <number> to use another.`,
    ].join('\n');
}

// ============================================================================
export async function dev(overrideConfig?: Skrapa.Config): Promise<void> {
    log.info('\nDev mode starting...');

    const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

    // Initial build
    const { directory, config, WORKING_DIR } = build(overrideConfig);

    // After this first build too, not only after rebuilds: the build has just
    // emptied the output dir, so whatever the hook writes there (a sitemap, a
    // feed) would otherwise be missing until the first save. Synchronous, so
    // it lands before the server starts answering. A failure is reported and
    // the build served without it, the same as a failing rebuild.
    const postbuild = postbuildCommand(directory.projectRoot);
    if (postbuild) {
        try {
            exe(postbuild, { cwd: directory.projectRoot });
        } catch {
            log.error('postbuild-skrapa failed. Serving the build without it.');
        }
    }

    // The URL to point a browser at, which is not always where we bind: with a
    // proxy or tunnel in front (`origin`), the site is reached somewhere else,
    // often on the default port and so with no port in the URL at all. The
    // origin arrives from loadConfig already carrying a scheme and no trailing
    // slash, so there is nothing left to normalize here.
    const publicUrl = config.origin || `http://${config.host}:${config.port}`;

    const MIME_TYPES: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.map': 'application/json',
        '.txt': 'text/plain',
        '.xml': 'application/xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.avif': 'image/avif',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'font/otf',
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
                  // Match the page's scheme: a browser blocks an insecure
                  // socket opened from an https page as mixed content, so a
                  // dev server behind a TLS proxy or tunnel needs wss.
                  const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
                  const ws = new WebSocket(scheme + location.host + '/hmr');
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

    // Uncapped once, not per request: every HMR client holds a socket and
    // each adds listeners, so the default cap of 10 would warn spuriously.
    server.setMaxListeners(0);

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
            log.gray(`WS closed (${clients.size} remaining). Reopen ${publicUrl}`);
        });
        socket.on('error', (err) => {
            clients.delete(socket);
            log.error(`WS error: ${err.message}`);
        });
    });

    let buildTimer: NodeJS.Timeout | null = null;

    // Re-run the very binary this process started from, not `npx skrapa`:
    // same guaranteed version, and it shaves npx's package resolution
    // (~170ms of a ~590ms rebuild, measured) off every save.
    const q = (s: string) => JSON.stringify(s);
    const selfInvoke = process.argv[1]
        ? `${q(process.execPath)} ${q(process.argv[1])}`
        : 'npx skrapa';

    const buildFlags = rebuildFlags(config);

    const triggerBuild = () => {
        if (buildTimer) clearTimeout(buildTimer);
        buildTimer = setTimeout(() => {
            // cwd is the skrapa root, so the rebuild reads the same
            // tsconfig.json. npm finds the project root's package.json (the
            // one postbuildCommand checked) by walking up from there.
            const options = { cwd: directory.skrapaRoot };
            const then = postbuild ? ` && ${postbuild}` : '';
            const command = `${selfInvoke} build skip-assets pretty${buildFlags}${then}`;
            exec(command, options, (error, stdout, stderr) => {
                if (error) {
                    // tsc reports its diagnostics on *stdout*, and exec's
                    // error.message carries only the command and stderr.
                    // Without printing stdout, a type error introduced
                    // mid-session shows as a bare "Build failed" with the
                    // actual errors swallowed.
                    log.error(`Build failed:`);
                    if (stdout.trim()) console.log(stdout.trim());
                    if (stderr.trim()) console.error(stderr.trim());
                    return;
                }
                // A successful rebuild stays quiet except for its
                // warnings, which would otherwise be invisible until the
                // next manual `skrapa build`: log.warn writes to stdout
                // in yellow, so warn lines are the yellow ones.
                for (const line of stdout.split('\n')) {
                    if (line.includes(color.yellow)) console.log(line);
                }
                log.success(
                    `${color.reset}[${new Date().toLocaleTimeString()}]${
                        color.green
                    } Build complete → reloading (${clients.size} client${
                        clients.size === 1 ? '' : 's'
                    })`
                );
                broadcast('reload');
            });
        }, 100);
    };

    let sourceTimer: NodeJS.Timeout | null = null;

    // The skrapa root holds more than source: every build writes .skrapa (tsc
    // output, the manifest), and an output dir inside it, so reacting to those
    // would rebuild forever. The assets dir has its own watcher below.
    const notSource = [directory.output, directory.assets];
    fs.watch(directory.source, { recursive: true }, (_event, filename) => {
        const changed = filename && path.join(directory.source, filename);
        if (changed && isSkippedPath(directory.source, changed, notSource)) return;
        if (sourceTimer) clearTimeout(sourceTimer);
        sourceTimer = setTimeout(triggerBuild, 100);
    });

    if (fs.existsSync(directory.assets)) {
        // The output files that came out of the assets dir, relative to both:
        // everything the first build copied, plus whatever is copied while
        // this runs. A deleted asset is removed from the output only through
        // this set, so a page the build wrote at the same path, or a file a
        // postbuild-skrapa script wrote, is never taken with it.
        const copied = new Set(walk(directory.assets));

        // Without this a deleted asset goes on being served until the next
        // full build empties the output, so a page still linking it looks
        // fine in dev and 404s once deployed.
        const removeStale = (filename: string) => {
            const emitted = readManifest(WORKING_DIR, directory.output);
            const removed: string[] = [];

            try {
                for (const file of staleAssetFiles(filename, copied)) {
                    // Back under the same name already: an editor that saves by
                    // deleting the file and renaming a new one into place.
                    if (fs.existsSync(path.join(directory.assets, file))) continue;
                    copied.delete(file);

                    // A page added since took the path over; that file is the
                    // build's now.
                    const dest = path.join(directory.output, file);
                    if (emitted.heldBy(dest)) continue;

                    fs.rmSync(dest, { force: true });
                    removed.push(file);

                    // And the directories that leaves empty, so a deleted
                    // `fonts/` does not linger as an empty one.
                    let dir = path.dirname(dest);
                    while (
                        dir.startsWith(`${directory.output}${path.sep}`) &&
                        fs.existsSync(dir) &&
                        fs.readdirSync(dir).length === 0
                    ) {
                        fs.rmdirSync(dir);
                        dir = path.dirname(dir);
                    }
                }
            } catch (err) {
                log.error(`Asset removal failed: ${(err as Error).message}`);
            }

            if (removed.length === 0) return;
            broadcast('reload');
            const what =
                removed.length === 1
                    ? `${directory.output}/${removed[0]}`
                    : `${removed.length} files under ${directory.output}/${filename}`;
            log.success(`${directory.assets}/${filename} deleted → ${what} removed`);
        };

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
            if (isEditorTempFile) return;
            if (!fs.existsSync(src)) {
                removeStale(filename);
                return;
            }

            try {
                // This copy breaks the output-tree rules exactly the way the
                // assets copy in a full build does (see output-paths.ts), so
                // it gets the same check. The manifest is re-read per event
                // rather than captured once: rebuilds run in their own
                // process, and a page added mid-session would otherwise never
                // be known about here. A build refuses outright; here the
                // server is already up and serving, so say so loudly and leave
                // the output as it is.
                //
                // Inside the try with the copy because the check reads the
                // file too, and the same save-by-rename that the guard above
                // catches most of the time can still land between the two.
                const problems = checkCopy(src, dest, readManifest(WORKING_DIR, directory.output));
                if (problems.length > 0) {
                    for (const line of problems.map(formatProblem).join('\n\n').split('\n'))
                        log.error(line);
                    log.error('Not copied. The build will fail on this until it is fixed.');
                    return;
                }

                const files = fs.statSync(src).isDirectory()
                    ? walk(src).map((rel) => path.join(filename, rel))
                    : [filename];
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.cpSync(src, dest, { recursive: true });
                for (const file of files) copied.add(file);
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
            for (const line of `\n${portInUseMessage(config.port, portHolder(config.port))}\n`.split(
                '\n'
            )) {
                log.error(line);
            }
        } else {
            log.error(`\nDev server error: ${err.message}\n`);
        }
        process.exit(1);
    });

    server.listen(config.port, config.host, () => {
        log.success(
            `\n⚡ ${color.cyan}${publicUrl}${color.reset}  ${color.gray}ctrl+C to stop${color.reset}\n`
        );
        // With a proxy in front, the bind address is not where the site is
        // reached, so name both rather than leaving a silent mismatch.
        if (config.origin) log.gray(`   serving on http://${config.host}:${config.port}\n`);
        setTimeout(() => {
            // if (clients.size === 0) exe(`open ${publicUrl}`);
        }, 1500);
    });

    // Ctrl+C, a closed terminal, or a kill. Each ends in process.exit, which
    // is what runs the build's removal of .skrapa (see build() in
    // cmd-build.ts); a signal left to its default action would skip it.
    let stopping = false;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        log.info('\nEnding dev mode...\n');
        for (const socket of clients) socket.destroy();
        server.closeAllConnections();
        server.close(() => process.exit(0));
    };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(signal, stop);
    }
}
