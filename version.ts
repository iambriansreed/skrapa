import fs from 'fs';

const version = JSON.parse(fs.readFileSync('package.json', 'utf-8')).version as string;

const files: [string, RegExp, string][] = [
    ['scratch.ts',      /export const VERSION = '[^']+'/,  `export const VERSION = '${version}'`],
    ['src/index.tsx',   /Scratch\.ts v[\d.]+/g,            `Scratch.ts v${version}`],
    ['README.md',       /# Scratch\.ts `v[\d.]+`/,         `# Scratch.ts \`v${version}\``],
];

for (const [file, pattern, replacement] of files) {
    const content = fs.readFileSync(file, 'utf-8');
    fs.writeFileSync(file, content.replace(pattern, replacement));
    console.log(`updated ${file} → v${version}`);
}
