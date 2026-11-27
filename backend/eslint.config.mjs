import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    // `src/generated/` is the Prisma client: machine-written, rewritten on every
    // `prisma generate`, and not ours to lint.
    { ignores: ['node_modules/', 'dist/', 'coverage/', 'src/generated/'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        // .cjs too: the build scripts are CommonJS and would otherwise be linted
        // without node globals, flagging require and __dirname as undefined.
        files: ['**/*.ts', '**/*.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node },
        },
        rules: {
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
            ],
            'prefer-const': 'error',
            // Matches the other packages' formatting rules so code moving between
            // here and the rest of the monorepo reads the same.
            'semi': ['error', 'always'],
            'arrow-spacing': ['error', { before: true, after: true }],
        },
    },
    {
        // The build scripts are CommonJS on purpose: they run as plain node before
        // and after tsc, outside the compiled ESM output, so require() is correct
        // here rather than a lapse.
        files: ['**/*.cjs'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        // Tests use loose types for fixtures and stubs.
        files: ['tests/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
);
