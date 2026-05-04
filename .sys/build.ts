import { execSync } from 'child_process';
import fs from 'fs';

import './jsx';
import { Root } from '../src/index';

async function _() {
    if (!process.argv.includes('--skip-public'))
        execSync('rm -rf dist .tmp && mkdir dist .tmp', { stdio: 'inherit' });

    execSync('tsc -p tsconfig.client.json', { stdio: 'inherit' });

    const clientJs = fs.readFileSync('./.tmp/src/client.js', 'utf-8');
    const css = fs.readFileSync('./src/style.css', 'utf-8');

    const html = Root()
        .replace('</body>', `<script>${clientJs}</script></body>`)
        .replace('</head>', `<style>${css}</style></head>`);

    fs.writeFileSync('./dist/index.html', html);

    if (!process.argv.includes('--skip-public')) {
        execSync(`cp ./public/* ./dist/`, { stdio: 'inherit' });
    }
    execSync(`prettier --write ./dist/index.html`, { stdio: 'inherit' });
}

_();
