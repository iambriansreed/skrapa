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
    const entries = Object.entries(map)
        .map(([key, value]) => {
            const escaped = value.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
            return `        ${JSON.stringify(key)}: \`${escaped}\``;
        })
        .join(',\n');

    const scratchPath = path.join(ROOT, 'scratch.ts');
    const content = fs.readFileSync(scratchPath, 'utf-8');
    const before = Buffer.byteLength(content, 'utf-8');

    const newContent = content.replace(
        /\/\* FILE_CREATION_MAP > \*\/[\s\S]*\/\* < FILE_CREATION_MAP \*\//,
        `/* FILE_CREATION_MAP > */\n    const FILE_CREATION_MAP = {\n${entries}\n    };\n    /* < FILE_CREATION_MAP */`
    );
    fs.writeFileSync(scratchPath, newContent);

    const after = Buffer.byteLength(newContent, 'utf-8');
    const kb = (n: number) => `${(n / 1024).toFixed(1)}kb`;
    const diff = after - before;
    const sign = diff >= 0 ? '+' : '';
    console.log(
        `Updated scratch.ts with ${Object.keys(map).length} files — ${kb(before)} → ${kb(after)} (${sign}${kb(diff)})`
    );
}

writeMap();
//clean();
