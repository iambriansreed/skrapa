/**
 * These are the helper scripts for the scratch development processes.
 *
 * $ tsx helper.ts
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname);
const DIRS = ['src', 'assets', '.github/workflows/'];
const FILES = ['scratch.config.json', 'tsconfig.client.json', 'tsconfig.json'];

function writeMap() {
    const map: Record<string, string> = {};

    const fileNames = [
        ...DIRS.map((dir) => {
            return fs.readdirSync(path.join(ROOT, dir)).map((file) => path.join(ROOT, dir, file));
        }),
        ...FILES.map((file) => path.join(ROOT, file)).filter((file) => fs.existsSync(file)),
    ].flat();

    for (const file of fileNames) {
        map[path.relative(ROOT, file)] = fs.readFileSync(file, 'utf-8');
    }

    // update scratch.ts with the new map
    const content = fs.readFileSync(path.join(ROOT, 'scratch.ts'), 'utf-8');
    const newContent = content.replace(
        /\/\* FILE_CREATION_MAP > \*\/[\s\S]*\/\* < FILE_CREATION_MAP \*\//,
        `/* FILE_CREATION_MAP > */\n    const FILE_CREATION_MAP = ${JSON.stringify(map, null, 4)};\n    /* < FILE_CREATION_MAP */`
    );
    fs.writeFileSync(path.join(ROOT, 'scratch.ts'), newContent);

    console.log(`Updated scratch.ts with ${Object.keys(map).length} files.`);
}

writeMap();
//clean();
