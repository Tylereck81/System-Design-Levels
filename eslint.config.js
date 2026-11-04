// ESLint: catches dead code, unreachable code and unsafe patterns before review does. Run with `npm run lint`
// (part of `npm test`).
import js from '@eslint/js';
import globals from 'globals';

const SLEEP = 'Wait for a state instead of a fixed time: playFor, fastForward or a web-first assertion (tests/helpers.js).';

export default [
  { ignores: ['node_modules/', 'test-results/', 'playwright-report/'] },
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
    },
  },
  {
    // The game: runs in the browser. Size and complexity are warnings, held by `--max-warnings` in the lint script so
    // they can only go down; the refactors that split this code lower that number.
    files: ['js/**/*.js', 'levels/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: {
      complexity: ['warn', 15],
      'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-len': ['warn', { code: 160, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreUrls: true }],
    },
  },
  {
    // Tooling at the root runs in Node.
    files: ['*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Tests run in Node, and the code inside page.evaluate runs in the browser, in the same file.
    files: ['tests/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // A page.evaluate callback cannot see the test's variables, so it takes its arguments under the same names.
      'no-shadow': 'off',
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.property.name='waitForTimeout']", message: SLEEP },
        { selector: "CallExpression[callee.name='setTimeout']", message: SLEEP },
      ],
    },
  },
];
