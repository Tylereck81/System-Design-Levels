import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { routeHash } from '../js/route.js';
import { LEVELS } from '../levels/index.js';
import { freshPage, selectNode } from './helpers.js';

/**
 * The layout and accessibility checks every level must pass. Call it inside the level's layout describe block.
 *
 * - `level`: the level number.
 * - `phone`: `{ title, setup(page), select }` adds "phone: canvas on the first screen and no sideways scroll <title>".
 *   `setup` builds the design to check. `select` is a node id opened in the inspector after the canvas check, so the
 *   scroll check covers the inspector too. Each is optional. Leave `phone` out when the level checks the phone layout
 *   in its own way.
 * - `onTab`: `{ build(page), quiz(page) }` runs before axe checks that tab, so the check covers a running design and
 *   the inspector. Each is optional.
 */
export function registerCommonTests({ level, phone, onTab = {} }) {
  if (phone) {
    const title = ['phone: canvas on the first screen and no sideways scroll', phone.title].filter(Boolean).join(' ');
    test(title, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await freshPage(page, routeHash(level, 'build'));
      await phone.setup?.(page);
      const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
      expect(top).toBeLessThan(844);
      if (phone.select) await selectNode(page, phone.select);
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

/** Presses Tab until `test(activeElement)` holds; fails after 60 presses. */
async function tabUntil(page, test) {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(test)) return;
  }
  throw new Error('Tab never reached the wanted control');
}

/**
 * The checks every level with a step lesson (`lesson`) must pass: a keyboard-only walk to the recap and into
 * Mission 1, the Guess-first gate, feedback on a wrong answer, "Show all steps", 360 px width, axe on every step.
 */
export function registerLessonTests({ level }) {
  const load = async () => (await LEVELS.find((l) => l.id === level).load()).default.lesson;

  test('step lesson: keyboard only, every step to the recap and into Mission 1', async ({ page }) => {
    const lesson = await load(), count = lesson.steps.length;
    await freshPage(page, routeHash(level, 'lesson'));
    for (let s = 0; s < count; s++) {
      await tabUntil(page, () => document.activeElement?.matches('.lstep:not([hidden]) .lstep-nav .btn.primary'));
      await page.keyboard.press('Enter');
      await expect(page.locator(`#st-${s + 1}`)).toBeFocused();
      await expect(page.locator(`.dot[data-go="${s + 1}"]`)).toHaveAttribute('aria-current', 'step');
    }
    await tabUntil(page, () => document.activeElement?.matches('[data-act="build"]'));
    await page.keyboard.press('Enter');
    await expect(page.locator('#view-build')).toBeVisible();
    expect(await page.evaluate(() => window.__sdl.S.mission)).toBe(0);
  });

  test('step lesson: a Guess-first step hides its explanation until answered or skipped', async ({ page }) => {
    const lesson = await load(), s = lesson.steps.findIndex((st) => st.check?.kind === 'guess');
    await freshPage(page, routeHash(level, 'lesson'));
    await page.click(`.dot[data-go="${s}"]`);
    const step = page.locator(`.lstep[data-step="${s}"]`);
    await expect(step.locator('.lstep-body')).toBeHidden();
    await step.locator('[data-act="reveal"]').click();
    await expect(step.locator('.lstep-body')).toBeVisible();
  });

  test('step lesson: a wrong answer shows the reason and the right answer', async ({ page }) => {
    const lesson = await load(), s = lesson.steps.findIndex((st) => st.check);
    const { options } = lesson.steps[s].check, wrong = options.findIndex((o) => !o.right);
    const plain = (t) => t.replace(/<[^>]*>/g, '');
    await freshPage(page, routeHash(level, 'lesson'));
    await page.click(`.dot[data-go="${s}"]`);
    const step = page.locator(`.lstep[data-step="${s}"]`);
    await step.locator(`.opt[data-opt="${wrong}"]`).click();
    const fb = step.locator('.check-fb');
    await expect(fb).toHaveAttribute('aria-live', 'polite');
    await expect(fb).toContainText('Not quite.');
    await expect(fb).toContainText(plain(options[wrong].why));
    await expect(fb).toContainText(plain(options.find((o) => o.right).t));
  });

  test('step lesson: "Show all steps" shows every step; no sideways scroll at 360 px', async ({ page }) => {
    const lesson = await load();
    await page.setViewportSize({ width: 360, height: 780 });
    await freshPage(page, routeHash(level, 'lesson'));
    await page.click('[data-act="all"]');
    await expect(page.locator('.lstep:visible')).toHaveCount(lesson.steps.length + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`step lesson axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations with every step and explanation shown', async ({ page }) => {
        await freshPage(page, routeHash(level, 'lesson'));
        await page.click('[data-act="all"]');
        for (const skip of await page.locator('[data-act="reveal"]').all()) await skip.click();
        await page.click('[data-act="rules"]');
        const results = await new AxeBuilder({ page }).include('#view-lesson').setLegacyMode().analyze();
        expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
      });
    });
  }
}
