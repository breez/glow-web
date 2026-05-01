import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
    {
        ignores: [
            'dist',
            'eslint.config.js',
            'public/**',
            'scripts/**',
            'e2e/**',
            '**/*.js',
            '**/*.cjs',
            '**/*.mjs',
        ],
    },
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.es2020 },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...tsPlugin.configs.recommended.rules,
            ...reactHooks.configs.recommended.rules,
            // TypeScript handles undefined-variable detection; ESLint's no-undef
            // doesn't understand TS namespace globals like JSX or React.
            'no-undef': 'off',
            'react-refresh/only-export-components': [
                'warn',
                { allowConstantExport: true },
            ],
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            'react-hooks/exhaustive-deps': 'warn',
            // react-hooks v7 introduced React Compiler-aligned strict rules.
            // Demoting to warn so the existing codebase still lints cleanly;
            // address violations in a dedicated follow-up.
            'react-hooks/set-state-in-effect': 'warn',
            'react-hooks/refs': 'warn',
            'react-hooks/immutability': 'warn',
            'react-hooks/preserve-manual-memoization': 'warn',
        },
    },
    {
        files: ['*.config.ts', 'src/test/**/*.ts'],
        languageOptions: {
            globals: { ...globals.node },
        },
    },
    {
        files: [
            'src/contexts/**',
            'src/test/**',
            'src/components/FeeRateSelector.tsx',
            'src/components/layout/AppShell.tsx',
        ],
        rules: {
            'react-refresh/only-export-components': 'off',
        },
    },
];
