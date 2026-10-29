// ============================================================================
// ESLint flat config. Correctness rules are errors; the sdk/ folder is held
// to the strictest set because it is copied into every partner's app.
// ============================================================================

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

const MP_GLOBALS = {
  wx: 'readonly',
  getApp: 'readonly',
  getCurrentPages: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  Promise: 'readonly',
  globalThis: 'readonly',
};

const NODE_GLOBALS = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
};

export default [
  { ignores: ['node_modules/**', 'coverage/**', 'dist/**'] },
  js.configs.recommended,
  prettier,
  {
    files: ['sdk/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: MP_GLOBALS },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-undef': 'error',
      'no-implicit-globals': 'error',
      // The SDK never logs on its own: the app passes a logger to configure().
      'no-console': 'error',
      complexity: ['warn', 15],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-depth': ['warn', 4],
    },
  },
  {
    files: ['cli/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: NODE_GLOBALS },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['**/*.test.js', 'vitest.setup.js', 'vitest.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...MP_GLOBALS,
        ...NODE_GLOBALS,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: { 'max-lines-per-function': 'off', 'no-console': 'off' },
  },
];
