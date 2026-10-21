import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.git/**',
      '**/.vscode/**',
      '**/.doc/**',
      '**/.artifacts/**',
      '**/.verification/**',
      '**/.compiled/**',
      '**/.cache/**',
      '**/.vite/**',
      '**/data/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['apps/api/**/*.ts', 'scripts/**/*.mjs', '**/*.config.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
