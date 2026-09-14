#!/usr/bin/env node

/**
 * index.ts
 *
 * Skrapa is a simple build tool and dev server for quickly prototyping static HTML/CSS/JS projects using a custom JSX runtime. It allows you to write your HTML structure in TypeScript with JSX syntax, and then compiles every `<dir>/index.tsx` that exports `Page` into a static HTML page rendered through that directory's `index.html` template. Any `<script src="./client.ts">` in the template is bundled into a single `.js` file in the output, with its `require`/import graph resolved by a small built-in bundler and the tag's `src` rewritten to point at it. It also supports an optional assets directory for static files like images or fonts.
 *
 * Every command runs in the skrapa root: the directory holding a tsconfig.json with a `skrapa` key, which is where the pages live (see config.ts).
 *
 * Dev mode runs a local server on port 8080 with live reload via WebSocket. File changes in the skrapa root trigger automatic rebuilds, and asset changes are copied on-the-fly, providing instant feedback during development.
 *
 * Usage:
 *   npx skrapa                # Set up a new Skrapa project (asks whether it is a new one)
 *   npx skrapa init --no-dev  # The same, without starting the dev server afterwards
 *   npx skrapa build          # Build once
 *   npx skrapa dev            # Dev server with HMR
 *   npx skrapa page "<name>"  # Scaffold a new page
 *   npx skrapa fix            # Migrate a project written against an older skrapa
 *
 */
import fs from 'node:fs';
import path from 'node:path';
import { CWD_DIR, log } from './utils';
import { CONFIG_FILE, LEGACY_CONFIG_FILES } from './config';
import { build } from './cmd-build';
import { dev } from './cmd-dev';
import { fix } from './cmd-fix';
import { init } from './cmd-init';
import { page } from './cmd-page';
import { Fragment, jsx, raw } from './jsx';

// Wire up the build-time JSX runtime (see jsx.ts) as the globals the compiled
// `.tsx` pages call, before any page module is required below.
globalThis.Fragment = Fragment;
globalThis.VERSION = '__SKRAPA_VERSION__';
globalThis.jsx = jsx;
globalThis.raw = raw;

// ============================================================================
// MAIN
// ============================================================================

(async () => {
    // A project from an older skrapa still has its config file, and a
    // tsconfig.json means a project skrapa can already run in. Without these,
    // bare `npx skrapa` reads either as an empty directory and scaffolds the
    // template over a real project.
    const legacyConfig = LEGACY_CONFIG_FILES.find((name) =>
        fs.existsSync(path.join(CWD_DIR, name))
    );
    const hasTsconfig = fs.existsSync(path.join(CWD_DIR, CONFIG_FILE));
    // Some other project entirely, or one whose site lives in a subdirectory
    // (this repo, whose site is web/). Scaffolding into it takes asking for.
    const hasPackageJson = fs.existsSync(path.join(CWD_DIR, 'package.json'));

    // Bare `npx skrapa` scaffolds, but only where there is nothing to scaffold
    // over. In a project that already exists, say so instead of falling
    // through to a bare usage line.
    const cmd: string =
        process.argv[2] || (legacyConfig || hasTsconfig || hasPackageJson ? '' : 'init');

    if (!cmd && legacyConfig) {
        log.error(`This project uses ${legacyConfig}, which this version no longer reads.`);
        log.error(`Run \`npx skrapa fix\` to move its settings into ${CONFIG_FILE}.`);
        process.exit(1);
    }

    if (!cmd && hasTsconfig) {
        log.error(`This directory already has a ${CONFIG_FILE}.`);
        log.error('Run `npx skrapa dev`, `build`, `page "<name>"`, or `fix`.');
        log.error('To scaffold a project over it, run `npx skrapa init --force`.');
        process.exit(1);
    }

    if (!cmd) {
        log.error(
            'This directory already has a package.json, so bare `npx skrapa` leaves it alone.'
        );
        log.error('In a Skrapa project, run `npm run dev` or `npm run build`.');
        log.error('To scaffold a project into it anyway, run `npx skrapa init`.');
        process.exit(1);
    }

    switch (cmd) {
        case 'init':
        case 'build':
        case 'dev':
        case 'page':
        case 'fix': {
            // Every command conforms to the shared `Command` type (see
            // types.d.ts): each takes optional Skrapa.Config.
            const commands = { init, build, dev, page, fix } satisfies Record<
                string,
                Command<void | Promise<void> | InitContext>
            >;
            await commands[cmd]();
            break;
        }
        default:
            log.error('Usage: npx skrapa init | build | dev | page | fix');
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
