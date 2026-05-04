/**
 * Setup file
 *
 * $ npx tsx .sys/setup.ts
 */

import { execSync } from 'child_process';

execSync(
    `npm install -D  @eslint/eslintrc  @eslint/js @typescript-eslint/eslint-plugin @typescript-eslint/parser csstype eslint eslint-plugin-react globals prettier tsx typescript typescript-eslint`
);
