// ESLint: catches dead code, unreachable code and unsafe patterns before review does. Run with `npm run lint`.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'test-results/', 'playwright-report/', 'tests/snapshot/designs/', 'tests/snapshot/expected/'] },
  js.configs.recommended,
  {
    // Everything: plain ES modules, no build step.
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }], // `x == null` stays: it means null or undefined
      'prefer-const': 'error',
      'no-var': 'error',
      'no-shadow': 'error',
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'all' }],
      // No code built from strings; a test that needs it says so on the line.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Warnings for now: they mark code to split up, which later refactors do.
      complexity: ['warn', 15],
      'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-len': ['warn', { code: 160, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreUrls: true }],
    },
  },
  {
    // The game: runs in the browser.
    files: ['js/**/*.js', 'levels/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Tests and tooling run in Node; code inside page.evaluate runs in the browser.
    files: ['tests/**/*.{js,mjs}', '*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // A page.evaluate callback runs in the browser and cannot see the test's variables, so it takes its arguments
      // under the same names on purpose.
      'no-shadow': 'off',
      'no-restricted-properties': ['error', {
        object: 'page',
        property: 'waitForTimeout',
        message: 'Wait for a state instead of a fixed time: playFor, fastForward or a web-first assertion (tests/helpers.js).',
      }],
    },
  },
];
