import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildBin, ROOT_DIR, WEB_DIR } from './utils';
import { writeSitemap } from './sitemap';

// Before the CLI, so the sitemap is copied to dist/ as an asset like any
// other. Written into web/assets/ rather than dist/ because the dev server's
// own initial build empties dist/ and never runs this script (see sitemap.ts).
{
    const { file, pages, changed } = writeSitemap(WEB_DIR, path.join(WEB_DIR, 'assets'));
    const rel = path.relative(ROOT_DIR, file);
    console.log(
        changed
            ? `Wrote ${rel} (${pages.length} pages); commit it.`
            : `${rel} is current (${pages.length} pages)`
    );
}

try {
    buildBin();

    // Run the CLI we just built, by path, from web/ (the directory holding the
    // site's tsconfig.json). Not `npx skrapa`: that resolves through the global
    // bin, so a missing/stale `npm link` would silently build this site with
    // the published skrapa instead of this checkout (green CI, wrong output).
    // The CLI deletes web/.skrapa itself when the build is done.
    execSync(`node ${JSON.stringify(path.join(ROOT_DIR, 'bin', 'index.js'))} build`, {
        stdio: 'inherit',
        cwd: WEB_DIR,
    });
} finally {
    // The CLI's own tsc output, already bundled into bin/index.js, and read by
    // nothing else. Removed however the build ends; bin/ and dist/ stay.
    fs.rmSync(path.join(ROOT_DIR, '.skrapa'), { recursive: true, force: true });
}
