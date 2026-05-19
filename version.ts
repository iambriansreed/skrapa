import fs from 'fs';

const VERSION: string = require('../package.json').version;

const files: [string, RegExp, string][] = [
    ['default/src/index.tsx', /Scratch\.ts v[\d.]+/g, `Scratch.ts v${VERSION}`],
    ['README.md', /Scratch\.ts `v[\d.]+`/, `Scratch.ts \`v${VERSION}\``],
];

for (const [file, pattern, replacement] of files) {
    const content = fs.readFileSync(file, 'utf-8');
    fs.writeFileSync(file, content.replace(pattern, replacement));
    console.log(`updated ${file} → v${VERSION}`);
}
