// The `test` every browser spec imports. Same as Playwright's, plus code coverage when COVERAGE=1 (npm run coverage):
// the page records which lines of the game ran, and the result is added to the shared report when the test ends.
// Off by default, so npm test is unaffected.
import { test as base, expect } from '@playwright/test';
import { MCR } from 'monocart-coverage-reports';
import { coverageOptions } from './coverage/options.mjs';

export const test = base.extend({
  page: async ({ page, browserName }, use) => {
    if (process.env.COVERAGE !== '1' || browserName !== 'chromium') { await use(page); return; } // only Chromium reports coverage
    await page.coverage.startJSCoverage({ resetOnNavigation: false }); // keep lines run before a reload
    try {
      await use(page);
    } finally {
      await MCR(coverageOptions).add(await page.coverage.stopJSCoverage());
    }
  },
});

export { expect };
