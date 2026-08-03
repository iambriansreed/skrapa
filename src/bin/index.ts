#!/usr/bin/env node

/**
 * index.ts
 *
 * Skrapa is a simple build tool and dev server for quickly prototyping static HTML/CSS/JS projects using a custom JSX runtime. It allows you to write your HTML structure in TypeScript with JSX syntax, and then compiles every `<dir>/index.tsx` that exports `Page` into a static HTML page rendered through that directory's `index.html` template. Any `<script src="./client.ts">` in the template is bundled into a single `.js` file in the output, with its `require`/import graph resolved by a small built-in bundler and the tag's `src` repointed at it. It also supports an optional assets directory for static files like images or fonts.
 *
 * Dev mode runs a local server on port 8080 with live reload via WebSocket. File changes in the input directory trigger automatic rebuilds, and asset changes are copied on-the-fly, providing instant feedback during development.
 *
 * Usage:
 *   npx skrapa               # Set up a new Skrapa project
 *   npx skrapa init --no-dev # Set up a new Skrapa project without starting the dev server
 *   npx skrapa build         # Build once
 *   npx skrapa dev           # Dev server with HMR
 *
 */
import fs from 'node:fs';
import path from 'node:path';
import { CWD_DIR, log } from './utils';
import { build } from './cmd-build';
import { dev } from './cmd-dev';
import { init } from './cmd-init';
import { page } from './cmd-page';
import { jsx } from './jsx';

// Wire up the build-time JSX runtime (see jsx.ts) as the global `jsx` the
// compiled `.tsx` pages call, before any page module is required below.
globalThis.Fragment = 'Fragment';
globalThis.VERSION = '__SKRAPA_VERSION__';
globalThis.jsx = jsx;

// ============================================================================
// MAIN
// ============================================================================

// check if skrapa.config.json exists

(async () => {
    const isInitiated = fs.existsSync(path.resolve(CWD_DIR, 'skrapa.config.json'));

    // Bare `npx skrapa` scaffolds, but only where there is nothing to scaffold
    // over. In a project that already has a config, say so instead of falling
    // through to a bare usage line.
    const cmd: string = process.argv[2] || (isInitiated ? '' : 'init');

    if (!cmd) {
        log.error('This project is already initialized (skrapa.config.json exists).');
        log.error('Run `npx skrapa dev`, `build`, or `page "<name>"`.');
        log.error('To re-scaffold over it, run `npx skrapa init --force`.');
        process.exit(1);
    }

    switch (cmd) {
        case 'init':
        case 'build':
        case 'dev':
        case 'page': {
            // Every command conforms to the shared `Command` type (see
            // types.d.ts): each takes optional ConfigOverrides.
            const commands = { init, build, dev, page } satisfies Record<
                string,
                Command<void | Promise<void> | InitContext>
            >;
            await commands[cmd]();
            break;
        }
        default:
            log.error('Usage: npx skrapa init | build | dev | page');
            process.exit(1);
    }
})().catch((err: unknown) => {
    // Every subprocess this shells out to (tsc above all) inherits stdio, so
    // it has already printed the real diagnostics by the time we get here.
    // Print the one-line reason and stop: an unhandled rejection would dump a
    // Node stack on top of tsc's output, burying the errors that matter.
    log.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
