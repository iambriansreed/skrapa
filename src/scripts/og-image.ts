/**
 * Renders `web/assets/og.png`, the 1200x630 social card every page names in its
 * `og:image` and `twitter:image` tags (see `web/components/seo.tsx`).
 *
 * Run `npm run og-image` after changing the tagline, the wordmark or the brand
 * colours, then commit the PNG. It is a checked-in asset rather than a build
 * step on purpose: the card only changes when the brand does, and the build
 * (and CI) should not depend on a browser being installed.
 *
 * Rendering goes through a headless Chrome screenshot, because the platforms
 * that unfurl links (Slack, X, LinkedIn, iMessage) want a raster image, and
 * a browser is the only zero-dependency way to rasterize text in the site's
 * own font stack. Set `CHROME=/path/to/binary` if none of the usual
 * locations has one.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT_DIR, WEB_DIR } from './utils';
import { SITE_NAME, SITE_URL, TAGLINE } from '../../web/site';

const WIDTH = 1200;
const HEIGHT = 630;
const OUT = path.join(WEB_DIR, 'assets', 'og.png');

const CHROME_CANDIDATES = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
].filter((p): p is string => Boolean(p));

// The same five strokes as web/components/logo.tsx and web/assets/skrapa.svg.
const LOGO = /* html */ `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round">
  <line x1="135" y1="42" x2="62" y2="52" />
  <line x1="62" y1="52" x2="82" y2="102" />
  <line x1="82" y1="102" x2="132" y2="92" />
  <line x1="132" y1="92" x2="118" y2="152" />
  <line x1="118" y1="152" x2="62" y2="158" />
</svg>`;

// Colours and the font stack are copied from web/assets/style.css: the card is a
// standalone document, so it cannot link the sheet, and the tokens it needs
// are few enough to carry.
const CARD = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 72px 80px 64px;
    background: #0d0d10;
    color: #f0f0f7;
    font-family: Seravek, 'Gill Sans Nova', Ubuntu, Calibri, 'DejaVu Sans', source-sans-pro, sans-serif;
    font-weight: 300;
  }
  .glow {
    position: absolute; right: -180px; top: -260px; width: 760px; height: 760px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgba(107, 87, 232, 0.38), transparent);
  }
  .brand { position: relative; display: flex; align-items: center; gap: 24px; }
  .brand svg { width: 96px; height: 96px; color: #a396ff; }
  .brand span { font-size: 68px; font-weight: 600; letter-spacing: -0.02em; }
  h1 {
    position: relative;
    margin: 0;
    max-width: 19ch;
    font-size: 80px;
    line-height: 1.08;
    font-weight: 200;
    letter-spacing: -0.03em;
    background: linear-gradient(120deg, #f0f0f7 20%, #a396ff 50%, #f0f0f7 80%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .foot { position: relative; display: flex; justify-content: space-between; align-items: center; }
  .cli {
    padding: 12px 36px 12px 28px;
    background: #191920;
    border: 1px solid #6b6b85;
    border-radius: 12px;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 34px;
  }
  .cli::before { content: '$ '; color: #9d9db5; }
  .host { font-size: 30px; color: #9d9db5; }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="brand">${LOGO}<span>${SITE_NAME}</span></div>
  <h1>${TAGLINE}</h1>
  <div class="foot">
    <div class="cli">npx skrapa</div>
    <div class="host">${new URL(SITE_URL).host}</div>
  </div>
</body>
</html>
`;

const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) {
    console.error(
        'No Chrome, Chromium, Brave or Edge found. Set CHROME=/path/to/the/binary and rerun.'
    );
    process.exit(1);
}

// A throwaway profile, so a Chrome that is already open on this machine does
// not answer the request and hand back nothing.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-og-'));
const source = path.join(work, 'og.html');
fs.writeFileSync(source, CARD);

// A PNG always ends with an IEND chunk (zero length, the type, a fixed CRC). A
// file without one is a screenshot Chrome was killed partway through writing.
function isCompletePng(file: string): boolean {
    if (!fs.existsSync(file)) return false;
    const bytes = fs.readFileSync(file);
    return (
        bytes.subarray(1, 4).toString('latin1') === 'PNG' &&
        bytes.subarray(-8, -4).toString('latin1') === 'IEND'
    );
}

// Chrome writes the screenshot within a second or two and then, on some
// builds, never exits (seen with Chrome 152's new headless mode on macOS). So
// the run is capped, and a cap that fires is only a failure if a complete
// image did not appear first. Its stderr is held back for the same reason: the
// updater Chrome spawns logs pages of noise on every run, which is only worth
// reading when there is no image to show for it.
//
// The screenshot lands in the throwaway dir and replaces the committed card
// only once it is whole, so a failed or killed run leaves the old card alone.
const TIMEOUT_MS = 15_000;
const shot = path.join(work, 'og.png');

try {
    let failure: unknown;
    try {
        execFileSync(
            chrome,
            [
                '--headless=new',
                '--disable-gpu',
                '--hide-scrollbars',
                '--no-first-run',
                '--no-default-browser-check',
                `--user-data-dir=${path.join(work, 'profile')}`,
                '--force-device-scale-factor=1',
                `--window-size=${WIDTH},${HEIGHT}`,
                `--screenshot=${shot}`,
                pathToFileURL(source).href,
            ],
            { stdio: ['ignore', 'ignore', 'pipe'], timeout: TIMEOUT_MS, killSignal: 'SIGKILL' }
        );
    } catch (error) {
        failure = error;
    }
    if (!isCompletePng(shot)) {
        const stderr = (failure as { stderr?: Buffer } | undefined)?.stderr?.toString() ?? '';
        if (stderr) console.error(stderr);
        throw failure ?? new Error('Chrome exited without writing a screenshot.');
    }
    fs.copyFileSync(shot, OUT);
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}

const { size } = fs.statSync(OUT);
console.log(
    `Wrote ${path.relative(ROOT_DIR, OUT)} (${WIDTH}x${HEIGHT}, ${Math.round(size / 1024)} KB)`
);
