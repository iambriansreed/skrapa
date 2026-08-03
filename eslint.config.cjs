const js = require('@eslint/js');
const json = require('@eslint/json').default;
const jsdoc = require('eslint-plugin-jsdoc');
const skrapa = require('./eslint.plugin.cjs');
const tseslint = require('typescript-eslint');
const prettierRecommended = require('eslint-plugin-prettier/recommended');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
    // Generated output is never linted.
    {
        ignores: [
            'dist',
            'bin',
            '.skrapa',
            '.tmp',
            '.claude',
            '**/dist',
            '**/.skrapa',
            '**/package-lock.json',
        ],
    },

    // TypeScript / JSX source. The TS, skrapa, and JSDoc rule sets are scoped
    // here (not global) so they never try to run against JSON files below.
    {
        files: ['**/*.{ts,tsx}'],
        plugins: {
            js,
            skrapa: skrapa.plugin,
        },
        extends: [
            'js/recommended',
            tseslint.configs.recommended,
            skrapa.configs.recommended,
            jsdoc.configs['flat/recommended-typescript'],
        ],
        languageOptions: skrapa.languageOptions,
        rules: {
            // Lint the JSDoc we write for correctness (param names, alignment,
            // tag names, valid types), but don't force JSDoc onto every
            // function or demand @param/@returns tags exist. That just breeds
            // empty stubs.
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns': 'off',
            'jsdoc/require-returns-description': 'off',
            'jsdoc/require-property': 'off',
            'jsdoc/require-property-description': 'off',
            'jsdoc/require-yields': 'off',
        },
    },

    // JSON: parsed by @eslint/json so Prettier (below) can format it, and so
    // `lint` / `lint:fix` cover it the same way they cover the TypeScript source.
    {
        files: ['**/*.json'],
        ignores: ['**/package-lock.json'],
        language: 'json/json',
        ...json.configs.recommended,
    },
    // JSON that allows comments (tsconfig, VS Code settings).
    {
        files: ['**/tsconfig.json', '.vscode/*.json', '**/*.jsonc'],
        language: 'json/jsonc',
        ...json.configs.recommended,
    },

    // Runs Prettier as an ESLint rule (for TS/JSX and JSON alike) and turns off
    // any stylistic rules that would conflict with it. Kept last so it wins.
    prettierRecommended,
]);
