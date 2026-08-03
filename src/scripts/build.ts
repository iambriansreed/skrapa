import { execSync } from 'node:child_process';
import path from 'node:path';
import { buildBin, ROOT_DIR } from './utils';

buildBin();

// Run the CLI we just built, by path. Not `npx skrapa`: that resolves through
// the global bin, so a missing/stale `npm link` would silently build this site
// with the published skrapa instead of this checkout (green CI, wrong output).
execSync(`node ${JSON.stringify(path.join('bin', 'index.js'))} build`, {
    stdio: 'inherit',
    cwd: ROOT_DIR,
});
