// ESLint: catches dead code, unreachable code and unsafe patterns before review does. Run with `npm run lint`
// (part of `npm test`).
import js from '@eslint/js';
import globals from 'globals';

// The helpers in levels/shared/goals.js, under their names there and the names their old copies had.
const GOAL_HELPERS = '/^(servedGoal|latGoal|costGoal|spofGoal|servedAtLeast|served99|fmtPct|pct|fmtMoney|money)$/';
const SLEEP = 'Wait for a state instead of a fixed time: playFor, fastForward or a web-first assertion (tests/helpers.js).';

export default [
  { ignores: ['node_modules/', 'test-results/', 'playwright-report/', 'coverage/'] },
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
    // Storage throws when it is blocked or full: the game reads and writes it only through js/storage.js.
    files: ['js/**/*.js', 'levels/**/*.js'],
    ignores: ['js/storage.js'],
    rules: {
      'no-restricted-globals': ['error',
        { name: 'localStorage', message: 'Use readStorage/writeStorage from js/storage.js.' },
        { name: 'sessionStorage', message: 'Use readStorage/writeStorage from js/storage.js.' },
      ],
    },
  },
  {
    files: ['js/**/*.js', 'levels/**/*.js'],
    ignores: ['js/route.js'],
    rules: {
      'no-restricted-properties': ['error',
        { object: 'history', property: 'replaceState', message: 'Use replaceHash from js/route.js.' },
      ],
    },
  },
  {
    // Only boot.js loads the app's entry point. Other modules call main.js's functions through js/hooks.js, which
    // imports nothing, so importing main.js (and the import cycle that makes) is an error.
    files: ['js/**/*.js'],
    ignores: ['js/boot.js'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ regex: '(^|/)main\\.js$', message: "Import { hooks } from js/hooks.js instead of importing main.js." }],
      }],
      'no-restricted-syntax': ['error', { // no-restricted-imports does not see import()
        selector: 'ImportExpression[source.value=/(^|\\/)main\\.js$/]',
        message: "Import { hooks } from js/hooks.js instead of importing main.js.",
      }],
    },
  },
  {
    // The engine knows nothing about the page: it reports through callbacks it is given (see js/engine/sim.js).
    // This block replaces the main.js rule above for js/engine/, so it repeats it.
    files: ['js/engine/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { regex: '(^|/)main\\.js$', message: "Import { hooks } from js/hooks.js instead of importing main.js." },
          { regex: '^(\\.\\./)+(ui|view)/', message: 'The engine does not draw: report through callbacks; js/view/loop.js draws.' },
          { regex: '^(\\.\\./)+(dom|hooks)\\.js$', message: 'The engine does not touch the page: report through callbacks instead.' },
        ],
      }],
    },
  },
  {
    files: ['js/hooks.js'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'ImportDeclaration, ImportExpression',
        message: 'hooks.js imports nothing, so any module can import it without making a cycle.',
      }],
    },
  },
  {
    // Level files import the goal helpers from levels/shared/goals.js; a level defining its own copy is an error.
    // Binding one to the level's numbers is fine: `const served99 = servedAtLeast(targets.servedPct)`.
    files: ['levels/level-*.js'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: `:matches(VariableDeclarator[init.type=/^(ArrowFunctionExpression|FunctionExpression|ObjectExpression)$/], FunctionDeclaration)[id.name=${GOAL_HELPERS}]`,
        message: 'Goal helpers live in levels/shared/goals.js: import them instead of defining them in a level.',
      }],
      // A level never reads another level's data, so opening one level loads only that level and levels/shared/.
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['./level-*'], message: 'Import shared parts from levels/shared/ instead of another level.' }],
      }],
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
  {
    // Browser specs take `test` from tests/fixtures.js, which adds code coverage under npm run coverage.
    files: ['tests/**/*.spec.js'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{
        name: '@playwright/test', importNames: ['test', 'expect'],
        message: "Import test and expect from '../fixtures.js', so the spec counts in npm run coverage.",
      }] }],
    },
  },
];
