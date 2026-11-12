import { test, expect } from '../fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, savedKeys, trackErrors } from '../helpers.js';

// The home page: the bare address shows what the game is, how a level works, the course map with each level's
// state read from its save, Continue, and the mock interview. It writes no saved data.

/** Put saves in place (key → object), then open the home page again. */
async function withSaves(page, saves) {
  await page.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }, saves);
  await page.reload();
  await expect(page.locator('#view-home')).toBeVisible();
}
const save = (done, mission = 0) => ({ nodes: [{ id: 'u', type: 'users', x: 380, y: 76 }], edges: [], mission, done });
const level = (page, id) => page.locator('.home-level').nth(id - 1);

test.describe('Home page', () => {
  test('the bare address opens home: the name and tagline, four steps, 21 levels in three parts, and the mock interview', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '');
    await expect(page.locator('#homeTitle')).toHaveText('System Design Levels');
    await expect(page.locator('#homeTitle + p')).toHaveText('Ace your interview.');
    await expect(page.locator('.home-steps li')).toHaveText(['Read a part of the lesson.', 'Do its mission.', 'Come back and read on.', 'Take the quiz.']);
    await expect(page.locator('.home-part h2')).toHaveText(['Part 1 · Grow one app', 'Part 2 · Building blocks', 'Part 3 · Design real systems', 'Mock interview']);
    await expect(page.locator('.home-level')).toHaveCount(21);
    await expect(level(page, 1)).toContainText('One server to two tiers');
    await expect(level(page, 1)).toContainText('Not started · 30 min'); // 3 + 7 + 9 + 11: Start here and the parts
    await expect(level(page, 2).locator('.home-state')).toHaveText('○Not started'); // no minutes until its lesson is on one page
    await expect(page.locator('#homeContinue')).toHaveText('Start: Level 1 · One server to two tiers →');
    // The level's own page is hidden, and so are its tabs; the header shows only the product name.
    await expect(page.locator('#view-lesson')).toBeHidden();
    await expect(page.locator('.tabs')).toBeHidden();
    await expect(page.locator('header.top > :not([hidden])')).toHaveCount(1);
    await expect(page.locator('#brand')).toHaveText('System Design Levels');
    expect(await savedKeys(page)).toEqual([]); // home saves nothing
    expect(await page.evaluate(() => window.__sdl)).toBeUndefined(); // and loads no level
    expect(errors).toEqual([]);
  });

  test('each level shows its state from its save, in words and an icon; Continue goes to the first one not done', async ({ page }) => {
    await freshPage(page, '');
    await withSaves(page, {
      'sdl-level1-v1': save([true, true, true]),
      'sdl-level2-v1': save([true, false, false], 1),
      'sdl-level3-v1': '{not a save', // stored as a JSON string: the level would start fresh
    });
    await expect(level(page, 1).locator('.home-state')).toHaveText('✓Done · 30 min');
    await expect(level(page, 2).locator('.home-state')).toHaveText('◐In progress · 1 of 3 missions');
    await expect(level(page, 3).locator('.home-state')).toHaveText('○Not started');
    await expect(page.locator('#homeContinue')).toHaveText('Continue: Level 2 · Load balancer and horizontal scaling →');
    await page.click('#homeContinue');
    await page.waitForFunction(() => !!window.__sdl);
    await expect(page.locator('#lvlChip')).toHaveText('Level 2 / 21');
    await expect(page.locator('#view-build')).toBeVisible();
  });

  test('a level opens from the map; Home and Back return home', async ({ page }) => {
    await freshPage(page, '');
    await level(page, 3).click();
    await page.waitForFunction(() => !!window.__sdl);
    await expect(page.locator('#lvlChip')).toHaveText('Level 3 / 21');
    await page.goBack();
    await expect(page.locator('#view-home')).toBeVisible();
    await page.goForward();
    await expect(page.locator('#lvlChip')).toHaveText('Level 3 / 21');
    await page.click('#homeBtn');
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#homeBtn')).toBeHidden();
  });

  test('#lesson, #build and #quiz still open Level 1', async ({ page }) => {
    for (const tab of ['lesson', 'build', 'quiz']) {
      await freshPage(page, '#' + tab);
      await expect(page.locator('#lvlChip')).toHaveText('Level 1 / 21');
      await expect(page.locator(`#view-${tab}`)).toBeVisible();
      await expect(page.locator('#view-home')).toBeHidden();
    }
  });

  test('works by keyboard: Continue, and Home from a level', async ({ page }) => {
    await freshPage(page, '');
    await page.locator('#homeContinue').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!window.__sdl);
    await expect(page.locator('#view-lesson')).toBeVisible();
    await page.locator('#homeBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#view-home')).toBeVisible();
  });

  test('phone: fits 360 px without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await freshPage(page, '');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const box = await level(page, 8).boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`no accessibility violations, with every state shown (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await freshPage(page, '');
      await withSaves(page, { 'sdl-level1-v1': save([true, true, true]), 'sdl-level2-v1': save([true, false, false]) });
      const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
      expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    });
  }
});
