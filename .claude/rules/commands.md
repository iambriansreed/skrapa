# Commands

```bash
npm run build         # regenerate web/assets/sitemap.xml -> tsc -p src/tsconfig.json -> bundle bin/index.js -> run that freshly built CLI in web/ to build dist/ (the docs site)
npm run dev           # build once, npm link the checkout, then two dev servers: web/ (port 8090) + a scaffolded .tmp/project served from .tmp/project/src (port 8080). Ctrl+C unlinks and removes .tmp/project
npm run og-image      # re-render web/assets/og.png in headless Chrome; commit it when the tagline or brand colours change
npm run test          # test:unit then test:e2e. Local only: e2e leaves a dev server running, so never wire it into CI
npm run test:unit     # node:test via tsx over src/**/*.test.ts. No server; this is what CI runs
npm run test:e2e      # scaffolds template/ into .tmp/project, starts its dev server, verifies the built site
npm run lint          # eslint . (Prettier runs as an ESLint rule, so this flags formatting too)
npm run lint:fix      # eslint . --fix
npm run lint:css      # stylelint over web/**/*.css, template/**/*.css
npm run clean         # rm -rf dist bin .tmp .skrapa web/.skrapa template/dist template/.skrapa
```

Run a single unit test file: `npx tsx --test src/bin/jsx.test.ts`.

Never build the site with a bare `npx skrapa`. `npx` resolves through the _global_ bin, so a missing or stale `npm link` would silently build the site with the published package and still pass. Use `npm run build`, or `node ../bin/index.js build` from inside `web/` (skrapa only reads `./tsconfig.json`, so it has to run there). Bare `npx skrapa` at the repo root does not scaffold either: the root has a `package.json`, so it prints why and exits. Only `npm run dev` and `npm run test:e2e` touch the global link (both run `src/scripts/dev.ts`, which `npm link`s the checkout and unlinks it on SIGINT, SIGTERM or SIGHUP).

There is no standalone `format` script. Prettier runs through ESLint and on save.
