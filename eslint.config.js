// ESLint: catches dead code, unreachable code and unsafe patterns before review does. Run with `npm run lint`
// (part of `npm test`).
import js from '@eslint/js';
import globals from 'globals';

// The helpers in levels/shared/goals.js, under their names there and the names their old copies had.
const GOAL_HELPERS = '/^(servedGoal|latGoal|costGoal|spofGoal|servedAtLeast|served99|fmtPct|pct|fmtMoney|money)$/';
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
];
