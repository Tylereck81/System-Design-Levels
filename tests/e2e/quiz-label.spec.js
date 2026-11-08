import { test, expect } from '../fixtures.js';
import { freshPage } from '../helpers.js';
import { LEVELS } from '../../levels/index.js';

// Every level's quiz tab names the level, the number of questions and the pass score. The quiz rules themselves
// (10 questions, pass score 8, balance, length, answer keys) are checked without a browser in tests/unit/levels.test.mjs.
test.describe('Quiz label', () => {
  for (const { id } of LEVELS) {
    test(`Level ${id} shows 10 questions and 8 to pass`, async ({ page }) => {
      await freshPage(page, `#level-${id}/quiz`);
      await expect(page.locator('#quizLabel')).toHaveText(`Level ${id} quiz · 10 questions · 8 to pass`);
    });
  }
});
