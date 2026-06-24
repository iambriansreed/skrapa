import js from '@eslint/js';
import skrapa from './eslint.plugin.mjs';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig([
    {
        files: ['**/*.{ts,tsx}'],
        plugins: {
            js,
            skrapa,
        },
        extends: ['js/recommended'],
        languageOptions: skrapa.languageOptions,
    },
    tseslint.configs.recommended,
    skrapa.configs.recommended,
]);

