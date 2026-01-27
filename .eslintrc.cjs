module.exports = {
    root: true,
    env: { browser: true, es2020: true },
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:react-hooks/recommended',
    ],
    ignorePatterns: ['dist', '.eslintrc.cjs'],
    parser: '@typescript-eslint/parser',
    plugins: ['react-refresh'],
    rules: {
        // React Fast Refresh — ensures HMR works during development
        'react-refresh/only-export-components': [
            'warn',
            { allowConstantExport: true },
        ],
        // Unused vars are warnings, not blockers. Prefix with _ to ignore.
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        // Allow `any` — warn only, don't block contributors
        '@typescript-eslint/no-explicit-any': 'warn',
        // Don't require explicit return types
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        // exhaustive-deps: warn so people notice, but don't block PRs
        'react-hooks/exhaustive-deps': 'warn',
    },
    overrides: [
        {
            // Context files and test utils export hooks + providers — this is standard React pattern
            files: ['src/contexts/**', 'src/test/**', 'src/components/FeeRateSelector.tsx', 'src/components/layout/AppShell.tsx'],
            rules: {
                'react-refresh/only-export-components': 'off',
            },
        },
    ],
};
