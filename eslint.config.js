import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

// CLAUDE.md conventions that keep drifting back in. Kept as data so the
// files exempted from one of them still get the others.
const NO_TO_LOCALE_STRING = {
    selector:
        "CallExpression[callee.property.name='toLocaleString']:not([callee.object.type='NewExpression'])",
    message:
        'Format amounts with formatWithSpaces (src/utils/formatNumber.ts): toLocaleString adds commas. Dates are fine, add an eslint-disable if the receiver is a Date held in a variable.',
};
// Class strings live in both plain literals and template literals, so a
// class-name rule has to look at both.
const inClassStrings = (pattern, message) => [
    { selector: `Literal[value=${pattern}]`, message },
    { selector: `TemplateElement[value.raw=${pattern}]`, message },
];
const NO_RED = inClassStrings(
    '/-red-[0-9]|#[eE][fF]4444/',
    'The UI has no red, even for errors: use spark-primary or the spark-warn-* tokens.',
);
// Tailwind's stock palette, minus red (NO_RED says more about that one)
// and minus white/black, which the app does use as primitives.
const NO_OFF_PALETTE = inClassStrings(
    '/(^|[^A-Za-z-])(bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|accent|caret|shadow|outline|decoration)-(slate|gray|zinc|neutral|stone|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}/',
    'Colors come from the spark-* tokens, not from Tailwind\'s stock palette.',
);
const NO_INLINE_SVG = {
    selector: "JSXOpeningElement[name.name='svg']",
    message:
        'Icons live in src/components/Icons.tsx as named components, not inline.',
};

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
            'no-restricted-syntax': [
                'error',
                NO_TO_LOCALE_STRING,
                ...NO_RED,
                ...NO_OFF_PALETTE,
                NO_INLINE_SVG,
            ],
        },
    },
    {
        files: ['*.config.ts', 'src/test/**/*.ts'],
        languageOptions: {
            globals: { ...globals.node },
        },
    },
    {
        // Icons.tsx is where icons belong; the other two are animations
        // internal to one component, which CLAUDE.md exempts.
        files: [
            'src/components/Icons.tsx',
            'src/components/LoadingSpinner.tsx',
            'src/features/send/steps/ProcessingStep.tsx',
        ],
        rules: {
            'no-restricted-syntax': [
                'error',
                NO_TO_LOCALE_STRING,
                ...NO_RED,
                ...NO_OFF_PALETTE,
            ],
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
