import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { routeHash } from '../js/route.js';
import { freshPage } from './helpers.js';

/**
 * The layout and accessibility checks every level must pass. Call it inside the level's layout describe block.
 *
 * - `level`: the level number.
 * - `phone`: `{ title, setup(page) }` adds "phone: canvas on the first screen and no sideways scroll <title>" after
 *   `setup` builds the design to check. Leave it out when the level checks the phone layout in its own way.
 * - `onTab`: `{ build(page), quiz(page) }` runs before axe checks that tab, so the check covers a running design and
 *   the inspector. Each is optional.
 */
export function registerCommonTests({ level, phone, onTab = {} }) {
  if (phone) {
    test(`phone: canvas on the first screen and no sideways scroll ${phone.title}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await freshPage(page, routeHash(level, 'build'));
      await phone.setup(page);
      const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
      expect(top).toBeLessThan(844);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  }

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, routeHash(level, 'build'));
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, routeHash(level, 'lesson'));
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          await onTab[tab]?.(page);
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
}
