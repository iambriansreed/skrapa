/**
 * These are the helper scripts for the scratch development processes.
 *
 * $ tsx itch.ts --map  — update FILE_CREATION_MAP from src-example
 * $ tsx itch.ts --swap — toggle between src and src-example
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname);
const DIRS = ['src-example', 'assets', '.github/workflows/'];
const FILES = ['.nvmrc', 'scratch.config.json', 'tsconfig.client.json', 'tsconfig.json'];

const arg = process.argv[2];

function swap() {
    const isExample = fs.existsSync(path.join(ROOT, 'src-main'));
    if (isExample) {
        fs.renameSync(path.join(ROOT, 'src'), path.join(ROOT, 'src-example'));
        fs.renameSync(path.join(ROOT, 'src-main'), path.join(ROOT, 'src'));
        console.log('Swapped to src');
    } else {
        fs.renameSync(path.join(ROOT, 'src'), path.join(ROOT, 'src-main'));
        fs.renameSync(path.join(ROOT, 'src-example'), path.join(ROOT, 'src'));
        console.log('Swapped to src-example');
    }
    process.exit(0);
}

function writeMap() {
    const map: Record<string, string> = {};

    const fileNames = [
        ...DIRS.map((dir) => {
            return fs.readdirSync(path.join(ROOT, dir)).map((file) => path.join(ROOT, dir, file));
        }),
        ...FILES.map((file) => path.join(ROOT, file)).filter((file) => fs.existsSync(file)),
    ].flat();

    for (const file of fileNames) {
        const key = path.relative(ROOT, file).replace(/^src-example[\\/]/, 'src/');
        map[key] = fs.readFileSync(file, 'utf-8');
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

if (arg === '--swap') {
    swap();
} else if (arg === '--map') {
    writeMap();
} else {
    console.log(
        'Usage:\n  tsx itch.ts --map   — update FILE_CREATION_MAP from src-example\n  tsx itch.ts --swap  — toggle between src and src-example'
    );
}
