/**
 * End-to-end test: runs `src/scripts/dev.ts test`, which builds & links
 * skrapa, scaffolds a fresh project from `template/` into `.tmp/`, and
 * starts its dev server on the default port (skipping the root dev server
 * and file watchers, since a one-shot test run has no use for either). It then
 * verifies the site, including that the about page picks up its own
 * index.html/style.css/client.ts instead of the root template's.
 *
 * Run with: npx tsx src/scripts/test.ts
 *
 * Leaves the scaffolded project's dev server running on completion so the
 * site can be poked at manually. Stop it with ctrl+C.
 */
import { execSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DEFAULT_CONFIG } from '../bin/utils';
import { ROOT_DIR, TMP_DIR, TEMPLATE_DIR } from './utils';

const PORT = Number(DEFAULT_CONFIG.port);
const BASE_URL = `http://localhost:${PORT}`;

const color = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
    cyan: '\x1b[36m',
};

let pass = 0;
let fail = 0;

function ok(label: string) {
    pass++;
    console.log(`  ${color.green}ok${color.reset}   - ${label}`);
}

function bad(label: string) {
    fail++;
    console.log(`  ${color.red}FAIL${color.reset} - ${label}`);
}

function assertFile(relPath: string) {
    if (fs.existsSync(path.join(TMP_DIR, relPath))) ok(`${relPath} exists`);
    else bad(`${relPath} is missing`);
}

function assertContains(label: string, haystack: string, needle: string) {
    if (haystack.includes(needle)) ok(label);
    else bad(`${label} (expected to find: ${needle})`);
}

function get(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        }).on('error', reject);
    });
}

async function waitForHttp(url: string, tries = 50): Promise<boolean> {
    for (; tries > 0; tries--) {
        try {
            const { status } = await get(url);
            if (status > 0) return true;
        } catch {
            // not up yet
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    return false;
}

function listFiles(dir: string, base = dir): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
    });
}

let devServer: ChildProcess | null = null;

function stopDevServer() {
    // SIGINT (not the default SIGTERM) so dev.ts's own SIGINT handler runs
    // and gracefully stops the grandchild `skrapa dev` process it spawned,
    // rather than leaving it orphaned and still bound to the port.
    if (devServer && !devServer.killed) devServer.kill('SIGINT');
}

async function main() {
    // if dev is already running kill it
    try {
        const pids = execSync(`lsof -ti :${PORT}`, { encoding: 'utf-8' }).trim();
        if (pids) {
            pids.split('\n').forEach((pid) => process.kill(Number(pid), 'SIGKILL'));
            console.log(
                `${color.gray}stopped dev server left running on port ${PORT}${color.reset}`
            );
        }
    } catch {
        // nothing listening on the port
    }

    console.log('== 1. start dev server (builds/links skrapa + scaffolds a fresh project) ==');
    let devOutput = '';
    devServer = spawn('npx', ['tsx', 'src/scripts/dev.ts', 'test'], {
        cwd: ROOT_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServer.stdout?.on('data', (chunk: Buffer) => (devOutput += chunk.toString()));
    devServer.stderr?.on('data', (chunk: Buffer) => (devOutput += chunk.toString()));

    if (await waitForHttp(`${BASE_URL}/`)) {
        ok(`dev server responds on ${BASE_URL}/`);
    } else {
        bad(`dev server never responded on ${BASE_URL}/`);
        console.log(color.gray + devOutput + color.reset);
        stopDevServer();
        process.exitCode = 1;
        return;
    }

    console.log('== 2. verify scaffold contents ==');
    for (const relPath of listFiles(TEMPLATE_DIR)) {
        assertFile(relPath);
    }

    console.log('== 3. verify home page ==');
    const home = await get(`${BASE_URL}/`);
    assertContains('home page has expected title', home.body, '<title>Skrapa - Template</title>');

    console.log('== 4. verify about page uses its own template/css/js ==');
    const about = await get(`${BASE_URL}/about/`);
    assertContains('about page has its own title', about.body, '<title>Skrapa - About</title>');
    assertContains(
        'about page links its own style.css (not just the root style.css)',
        about.body,
        'href="/about/style.css"'
    );
    assertContains(
        "about page's client.ts was rewritten to /about/client.js",
        about.body,
        'src="/about/client.js"'
    );

    const aboutCss = await get(`${BASE_URL}/about/style.css`);
    if (aboutCss.status === 200) ok('/about/style.css resolves');
    else bad('/about/style.css does not resolve');

    const clientJs = await get(`${BASE_URL}/about/client.js`);
    if (clientJs.status === 200) {
        ok('/about/client.js resolves');
        assertContains(
            '/about/client.js contains the bundled about module',
            clientJs.body,
            'aboutLog'
        );
    } else {
        bad('/about/client.js does not resolve');
    }

    console.log(`\n== results: ${pass} passed, ${fail} failed ==`);
    if (fail > 0) {
        stopDevServer();
        process.exitCode = 1;
        return;
    }

    console.log(
        `\n${color.cyan}${BASE_URL}${color.reset}  ${color.gray}dev server left running, ctrl+C to stop${color.reset}`
    );
}

main().catch((err) => {
    console.error(err);
    stopDevServer();
    process.exitCode = 1;
});
