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

/** Shows every page of a chapter lesson with every explanation, and the game rules, so a check covers all its text. */
export async function showEveryPage(page) {
  await page.evaluate(() => {
    for (const e of document.querySelectorAll('#chapterLesson .lpage, #chapterLesson .lstep-body')) e.hidden = false;
  });
  await page.click('[data-act="rules"]');
}

/**
 * The checks every level with a chapter lesson must pass: a keyboard-only walk through Chapter 1 into Mission 1, the
 * chapter states in words, the Guess-first gate, feedback on a wrong answer, the debrief and the wrap-up from the
 * canvas, the Briefing dialog, a locked mission, 360 px width, axe on every page in both themes.
 */
export function registerChapterLessonTests({ level }) {
  const load = async () => (await LEVELS.find((l) => l.id === level).load()).default.lesson;
  const plain = (t) => t.replace(/<[^>]*>/g, '');
  /** Setup only: marks missions done (and checked) as a finished mission leaves them, with mission `open` open. */
  const finish = (page, done, open) => page.evaluate(({ done, open }) => {
    const { S } = window.__sdl;
    done.forEach((d, i) => { S.done[i] = d; S.verified[i] = d; });
    S.mission = open;
    window.__sdl.afterChange();
  }, { done, open });
  /** Clicks Next through chapter `c` from its first screen to its last. */
  const nextThrough = async (scope, c, screens) => {
    for (let s = 0; s < screens - 1; s++) await scope.locator(`[data-page="b${c}-${s}"] [data-go="b${c}-${s + 1}"]`).click();
  };

  test('chapter lesson: keyboard only, from the intro through Chapter 1 into Mission 1', async ({ page }) => {
    const lesson = await load(), screens = lesson.chapters[0].screens.length;
    await freshPage(page, routeHash(level, 'lesson'));
    await expect(page.locator('#lp-intro')).toBeVisible();
    await tabUntil(page, () => document.activeElement?.matches('.lintro .btn[data-go="b0-0"]'));
    await page.keyboard.press('Enter');
    for (let s = 0; s < screens; s++) {
      await expect(page.locator(`#lp-b0-${s}`)).toBeFocused();
      await tabUntil(page, () => document.activeElement?.matches('.lpage:not([hidden]) .lstep-nav .btn.primary'));
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('#view-build')).toBeVisible();
    expect(await page.evaluate(() => window.__sdl.S.mission)).toBe(0);
  });

  test('chapter lesson: each chapter says its state in words, from its briefing and its mission', async ({ page }) => {
    const lesson = await load(), screens = lesson.chapters[0].screens.length;
    await freshPage(page, routeHash(level, 'lesson'));
    const states = page.locator('.chapter-state');
    await expect(states).toHaveCount(lesson.chapters.length);
    for (const state of await states.all()) await expect(state).toHaveText('Not started');
    await page.click('.chapter[data-go="b0-0"]');
    await nextThrough(page, 0, screens);
    await finish(page, lesson.chapters.map((_, i) => i === 1), 0);
    for (let s = screens - 1; s >= 0; s--) await page.click(`[data-page="b0-${s}"] .lstep-nav .btn:not(.primary)`); // Back to the intro
    await expect(states.nth(0)).toHaveText('Briefing read');
    await expect(states.nth(1)).toHaveText('Mission done');
    await expect(states.nth(2)).toHaveText('Not started');
  });

  test('chapter lesson: a Guess-first screen hides its explanation until answered or skipped', async ({ page }) => {
    const lesson = await load();
    const c = lesson.chapters.findIndex((ch) => ch.screens.some((sc) => sc.check?.kind === 'guess'));
    const s = lesson.chapters[c].screens.findIndex((sc) => sc.check?.kind === 'guess');
    await freshPage(page, routeHash(level, 'lesson'));
    await page.click(`.chapter[data-go="b${c}-0"]`);
    await nextThrough(page, c, s + 1);
    const screen = page.locator(`[data-page="b${c}-${s}"]`);
    await expect(screen.locator('.lstep-body')).toBeHidden();
    await screen.locator('[data-act="reveal"]').click();
    await expect(screen.locator('.lstep-body')).toBeVisible();
    await expect(screen.locator('.lstep-body')).toBeFocused();
  });

  test('chapter lesson: a wrong answer shows the reason and the right answer', async ({ page }) => {
    const lesson = await load();
    const s = lesson.chapters[0].screens.findIndex((sc) => sc.check);
    const { options } = lesson.chapters[0].screens[s].check, wrong = options.findIndex((o) => !o.right);
    await freshPage(page, routeHash(level, 'lesson'));
    await page.click('.chapter[data-go="b0-0"]');
    await nextThrough(page, 0, s + 1);
    const screen = page.locator(`[data-page="b0-${s}"]`);
    await screen.locator(`.opt[data-opt="${wrong}"]`).click();
    const fb = screen.locator('.check-fb');
    await expect(fb).toHaveAttribute('aria-live', 'polite');
    await expect(fb).toContainText('Not quite.');
    await expect(fb).toContainText(plain(options[wrong].why));
    await expect(fb).toContainText(plain(options.find((o) => o.right).t));
    await expect(screen.locator('.lstep-body')).toBeVisible();
  });

  test('chapter lesson: a finished mission shows "Mission N complete" and a debrief that leads to the next chapter', async ({ page }) => {
    const lesson = await load(), { debrief } = lesson.chapters[0];
    await freshPage(page, routeHash(level, 'build'));
    await expect(page.locator('#doneBanner')).toBeHidden();
    await finish(page, lesson.chapters.map((_, i) => i === 0), 0);
    await expect(page.locator('#doneBanner')).toBeVisible();
    await expect(page.locator('#doneText')).toHaveText('Mission 1 complete');
    await page.click('#doneBanner [data-act="debrief"]');
    await expect(page.locator('#view-lesson')).toBeVisible();
    await expect(page.locator('#lp-d0')).toBeFocused();
    const page0 = page.locator('[data-page="d0"]');
    await expect(page0).toContainText(plain(debrief.saw));
    await expect(page0).toContainText(plain(debrief.number[0]));
    await expect(page0).toContainText(plain(debrief.next));
    await page0.locator('.btn.primary').click();
    await expect(page.locator('#lp-b1-0')).toBeFocused();
  });

  test('chapter lesson: after the last mission the debrief is the wrap-up, which leads to the quiz', async ({ page }) => {
    const lesson = await load(), last = lesson.chapters.length - 1;
    await freshPage(page, routeHash(level, 'build'));
    await finish(page, lesson.chapters.map(() => true), last);
    await expect(page.locator('#doneText')).toHaveText(`Mission ${last + 1} complete`);
    await page.click('#doneBanner [data-act="debrief"]');
    await expect(page.locator('#lp-wrap')).toBeFocused();
    const wrap = page.locator('[data-page="wrap"]');
    await expect(wrap.locator('ol li')).toHaveCount(lesson.wrap.say.length);
    await expect(wrap.locator('.recap-nums div')).toHaveCount(lesson.wrap.numbers.length);
    await expect(wrap).toContainText(plain(lesson.wrap.broken));
    await expect(wrap.locator(`svg#${lesson.wrap.picture} .node-box`)).not.toHaveCount(0);
    await wrap.getByRole('button', { name: 'Take the quiz' }).click();
    await expect(page.locator('#view-quiz')).toBeVisible();
  });

  test('chapter lesson: "Briefing" on the mission card opens that chapter\'s screens over the Build tab', async ({ page }) => {
    const lesson = await load(), screens = lesson.chapters[1].screens.length;
    await freshPage(page, routeHash(level, 'build'));
    await finish(page, lesson.chapters.map((_, i) => i === 0), 1);
    const link = page.locator('#mission [data-act="briefing"]');
    await link.click();
    const dialog = page.locator('#briefingDialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#lp-b1-0')).toBeVisible();
    await expect(dialog.locator('[data-page="b1-0"] [data-go="intro"]')).toBeHidden(); // no way out to the intro
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(link).toBeFocused();
    await expect(page.locator('#view-build')).toBeVisible();
    await page.click('#tab-lesson');
    await expect(page.locator('#view-lesson #lp-intro')).toBeVisible(); // the lesson is back in its tab
    await page.click('#tab-build');
    // The last screen's button closes the dialog and opens the mission.
    await link.click();
    await nextThrough(dialog, 1, screens);
    await dialog.locator(`[data-page="b1-${screens - 1}"] [data-act="mission"]`).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#view-build')).toBeVisible();
    expect(await page.evaluate(() => window.__sdl.S.mission)).toBe(1);
  });

  test('chapter lesson: every chapter opens; a mission still locked opens the first one not done and says why', async ({ page }) => {
    const lesson = await load(), last = lesson.chapters.length - 1, screens = lesson.chapters[last].screens.length;
    await freshPage(page, routeHash(level, 'lesson'));
    await page.click(`.chapter[data-go="b${last}-0"]`);
    await expect(page.locator(`#lp-b${last}-0`)).toBeFocused();
    await nextThrough(page, last, screens);
    await page.click(`[data-page="b${last}-${screens - 1}"] [data-act="mission"]`);
    await expect(page.locator('#view-build')).toBeVisible();
    expect(await page.evaluate(() => window.__sdl.S.mission)).toBe(0);
    await expect(page.locator('#log')).toContainText(`Finish Mission ${last} first. Mission 1 is open.`);
  });

  test('chapter lesson: no sideways scroll at 360 px on any page', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await freshPage(page, routeHash(level, 'lesson'));
    await showEveryPage(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`chapter lesson axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations with every page and explanation shown, nor in the Briefing dialog', async ({ page }) => {
        await freshPage(page, routeHash(level, 'lesson'));
        await showEveryPage(page);
        const lessonResults = await new AxeBuilder({ page }).include('#view-lesson').setLegacyMode().analyze();
        expect(lessonResults.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
        await page.click('#tab-build');
        await page.click('#mission [data-act="briefing"]');
        const dialogResults = await new AxeBuilder({ page }).include('#briefingDialog').setLegacyMode().analyze();
        expect(dialogResults.violations.map((v) => `dialog: ${v.id} (${v.nodes.length})`)).toEqual([]);
      });
    });
  }
}
