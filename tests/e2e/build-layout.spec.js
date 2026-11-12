import { test, expect } from '../fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, openMission, selectNode, pressEnterOn } from '../helpers.js';

// The Build screen around the canvas: where the component list, the inspector and the mission sit, and that opening
// the inspector never hides the mission or the Play button.

const box = (page, selector) => page.locator(selector).first().boundingBox();
const bottom = (b) => b.y + b.height;
const focusedNode = (page) => page.evaluate(() => document.activeElement.getAttribute('data-node'));
/** Add a web server; the game selects a component it has just added, so the inspector opens on it. */
const addWeb = (page) => page.evaluate(() => { const s = window.__sdl; s.addNode('web'); return s.S.nodes.at(-1).id; });
/** Select a web server of the level's start design with the keyboard; gives its id. */
async function selectWeb(page) {
  const id = await page.evaluate(() => window.__sdl.S.nodes.find((n) => n.type === 'web').id);
  await selectNode(page, id);
  return id;
}

test.describe('Build layout · desktop', () => {
  // Level 1's third mission is left out at 720 px: with its estimate box open, its card is taller than that window
  // before anything is selected (its last goal ends 748 px down), so it scrolls inside its own column.
  for (const { w, h, missions } of [{ w: 1440, h: 900, missions: [0, 1, 2] }, { w: 1280, h: 720, missions: [0, 1] }]) {
    test(`${w}×${h}: with a component selected, the mission title, every goal and Play are in the window`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-1/build');
      for (const i of missions) {
        await openMission(page, i);
        const before = await box(page, '#missionCard');
        await addWeb(page);
        await expect(page.locator('#inspCard')).toBeVisible();
        expect(await box(page, '#missionCard'), `mission ${i + 1}: the card does not move`).toEqual(before);
        await expect(page.locator('#mission h2')).toBeInViewport({ ratio: 1 });
        const goals = page.locator('#goals li');
        expect(await goals.count()).toBeGreaterThan(0);
        for (const goal of await goals.all()) await expect(goal).toBeInViewport({ ratio: 1 });
        await expect(page.locator('#playBtn')).toBeInViewport({ ratio: 1 });
        await page.click('#resetBtn');
      }
    });
  }

  test('three columns: components and inspector on the left, canvas in the middle, the mission alone on the right', async ({ page }) => {
    await freshPage(page, '#level-1/build');
    await addWeb(page);
    const [pal, insp, cv, mission] = await Promise.all(['.palette', '#inspCard', '#cv', '#missionCard'].map((s) => box(page, s)));
    expect(pal.x + pal.width).toBeLessThanOrEqual(cv.x);
    expect(insp.x + insp.width).toBeLessThanOrEqual(cv.x);
    expect(insp.y).toBeGreaterThanOrEqual(bottom(pal)); // under the component list
    expect(mission.x).toBeGreaterThanOrEqual(cv.x + cv.width);
    expect(cv.width).toBeGreaterThan(700); // 1440 − 2 × 16 margin − 260 − 340 − 2 × 16 gap = 776
    expect(await page.locator('.panel > *').count()).toBe(1); // the right column holds the mission card only
    await expect(page.locator('#insp .insp-close')).toBeHidden(); // the Close button belongs to the narrow-screen sheet
  });

  test('with nothing selected the inspector is hidden and the component list says how to open it', async ({ page }) => {
    await freshPage(page, '#level-1/build');
    await expect(page.locator('#inspCard')).toBeHidden();
    await expect(page.locator('.pal-hint')).toContainText('Select a component to change its size and connections');
    const id = await addWeb(page);
    await expect(page.locator('#insp h2')).toHaveText('Web server');
    await selectNode(page, id);
    await page.keyboard.press('Escape');
    await expect(page.locator('#inspCard')).toBeHidden();
    expect(await focusedNode(page)).toBe(id); // Escape on a component leaves the focus on it
  });

  test('closing the inspector from one of its controls returns focus to the component; removing it, to another one', async ({ page }) => {
    await freshPage(page, '#level-1/build');
    const id = await addWeb(page);
    await page.focus('#insp [data-focus-key="size-M"]');
    await page.keyboard.press('Escape');
    await expect(page.locator('#inspCard')).toBeHidden();
    expect(await focusedNode(page)).toBe(id);
    await selectNode(page, id);
    await pressEnterOn(page, '#insp [data-focus-key="remove"]');
    await expect(page.locator('#inspCard')).toBeHidden();
    expect(await focusedNode(page)).toBe('u'); // the web server is gone; the first component takes the focus
  });

  test('a goal that needs the inspector says where the setting is', async ({ page }) => {
    await freshPage(page, '#level-1/build');
    await openMission(page, 1);
    const id = await page.evaluate(() => { const s = window.__sdl; s.addNode('db'); return s.S.nodes.at(-1).id; });
    await selectNode(page, id);
    // The goal names the component and the inspector label the player has to find.
    await expect(page.locator('#insp .label', { hasText: 'Database type' })).toBeVisible();
    await expect(page.locator('#goals')).toContainText('(select the Database, then Database type)');
  });
});

test.describe('Build layout · narrow screens', () => {
  // Level 6 has the longest component list (7), which puts the canvas and everything under it lowest on the page.
  for (const { w, h, strip } of [{ w: 1024, h: 768, strip: false }, { w: 390, h: 844, strip: true }, { w: 390, h: 667, strip: true }]) {
    test(`${w}×${h}: the inspector is a bottom sheet that leaves ${strip ? 'the mission strip and ' : ''}Play uncovered`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-6/build');
      const id = await selectWeb(page);
      await page.evaluate(() => scrollTo(0, 0));
      const sheet = await box(page, '#inspCard');
      expect(await page.locator('#inspCard').evaluate((e) => getComputedStyle(e).position)).toBe('fixed');
      expect(Math.round(bottom(sheet))).toBe(h);
      expect(bottom(await box(page, '#playBtn'))).toBeLessThanOrEqual(sheet.y);
      await expect(page.locator('#playBtn')).toBeInViewport({ ratio: 1 });
      if (strip) expect(bottom(await box(page, '#mstrip'))).toBeLessThanOrEqual(sheet.y);
      else expect(sheet.x + sheet.width).toBeLessThanOrEqual((await box(page, '#missionCard')).x); // beside the mission, not over it
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);

      // The page grows by the sheet's height, so its last line can be scrolled clear of the sheet.
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      expect(bottom(await box(page, '#log'))).toBeLessThanOrEqual((await box(page, '#inspCard')).y);

      await page.click('#insp .insp-close');
      await expect(page.locator('#inspCard')).toBeHidden();
      expect(await focusedNode(page)).toBe(id);

      await selectNode(page, id);
      await page.focus('#insp [data-focus-key="size-M"]');
      await page.keyboard.press('Escape');
      await expect(page.locator('#inspCard')).toBeHidden();
      expect(await focusedNode(page)).toBe(id);
    });
  }
});

test.describe('Build layout · accessibility', () => {
  for (const colorScheme of ['light', 'dark']) {
    for (const [w, h] of [[1440, 900], [1280, 720], [1024, 768], [390, 844]]) {
      test(`no violations with the inspector open at ${w}×${h} (${colorScheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width: w, height: h });
        await freshPage(page, '#level-6/build');
        await selectWeb(page);
        await expect(page.locator('#inspCard')).toBeVisible();
        const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
        expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
      });
    }
  }
});
