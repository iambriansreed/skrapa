import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import { defineConfig } from 'eslint/config';

export default defineConfig([
    {
        files: ['**/*.{ts,tsx}'],
        plugins: { js },
        extends: ['js/recommended'],
        languageOptions: { globals: { ...globals.browser, ...globals.node } },
    },
    tseslint.configs.recommended,
    react.configs.flat.recommended,
    {
        settings: {
            react: { version: '19.0' },
        },
        rules: {
            'react/react-in-jsx-scope': 'off',
            'react/jsx-uses-react': 'off',
            'react/void-dom-elements-no-children': 'error',
        },
    },
]);
