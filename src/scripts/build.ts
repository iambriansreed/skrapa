import { execSync } from 'node:child_process';
import path from 'node:path';
import { buildBin, ROOT_DIR } from './utils';
import { writeSitemap } from './sitemap';
import config from '../../skrapa.config';

// Before the CLI, so the sitemap is copied to dist/ as an asset like any
// other. Written into assets/ rather than dist/ because the dev server's own
// initial build empties dist/ and never runs this script (see sitemap.ts).
{
    const input = path.join(ROOT_DIR, config.input);
    const assets = path.join(ROOT_DIR, config.assets);
    const { file, pages, changed } = writeSitemap(input, assets);
    const rel = path.relative(ROOT_DIR, file);
    console.log(
        changed
            ? `Wrote ${rel} (${pages.length} pages); commit it.`
            : `${rel} is current (${pages.length} pages)`
    );
}

buildBin();

// Run the CLI we just built, by path. Not `npx skrapa`: that resolves through
// the global bin, so a missing/stale `npm link` would silently build this site
// with the published skrapa instead of this checkout (green CI, wrong output).
execSync(`node ${JSON.stringify(path.join('bin', 'index.js'))} build`, {
    stdio: 'inherit',
    cwd: ROOT_DIR,
});
