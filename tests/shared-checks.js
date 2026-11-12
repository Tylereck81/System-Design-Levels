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

/**
 * The checks every level with a one-page lesson must pass: the page's order with every section shown, the links to
 * each part with its mission's state in words, the questions after the sections, a wrong answer's feedback, each
 * mission card in both states and where its buttons lead, New part cards, axe and no sideways scroll at 390 px and
 * on a laptop, in both themes.
 */
export function registerPageLessonTests({ level }) {
  const loadLevel = async () => (await LEVELS.find((l) => l.id === level).load()).default;
  const load = async () => (await loadLevel()).lesson;
  const plain = (t) => t.replace(/<[^>]*>/g, '');
  /** Setup only: marks missions done (and checked) as a finished mission leaves them, with mission `open` open. */
  const finish = (page, done, open) => page.evaluate(({ done, open }) => {
    const { S } = window.__sdl;
    done.forEach((d, i) => { S.done[i] = d; S.verified[i] = d; });
    S.mission = open;
    window.__sdl.afterChange();
  }, { done, open });

  test('one-page lesson: the intro, the links, each part in mission order with all its sections, then the wrap-up', async ({ page }) => {
    const lesson = await load();
    await freshPage(page, routeHash(level, 'lesson'));
    const root = page.locator('#pageLesson');
    // In page order: the intro's heading, the links, each part's heading, the wrap-up's heading.
    const order = await root.locator('#lp-intro, .onpage, .lpart > h2, #lp-wrap').evaluateAll((els) => els.map((e) => e.id || e.className));
    expect(order).toEqual(['lp-intro', 'onpage', ...lesson.parts.map((_, i) => `lp-part-${i}`), 'lp-wrap']);
    for (const [i, part] of lesson.parts.entries()) {
      await expect(page.locator(`#lp-part-${i}`)).toHaveText(`Part ${i + 1} · ${plain(part.title)}`);
      const sections = root.locator('.lpart').nth(i).locator('.lsec');
      await expect(sections).toHaveCount(part.sections.length);
      for (const [s, section] of part.sections.entries()) {
        await expect(sections.nth(s).locator('h3')).toHaveText(plain(section.title));
        await expect(sections.nth(s)).toBeVisible();
      }
    }
    // Nothing is hidden but a mission card's done state and the game rules, and there is no page-by-page navigation.
    const hidden = await root.locator('[hidden]').evaluateAll((els) => els.map((e) => e.id || e.className));
    expect(hidden).toEqual(['lessonRules', ...lesson.parts.map(() => 'mcard-done')]);
    await expect(root.locator('[data-go], [data-act="reveal"]')).toHaveCount(0);
  });

  test('one-page lesson: each link opens its part, and says its mission\'s state in words', async ({ page }) => {
    const lesson = await load(), last = lesson.parts.length - 1;
    await freshPage(page, routeHash(level, 'lesson'));
    const links = page.locator('.onpage .jump');
    await expect(links).toHaveCount(lesson.parts.length + 1);
    for (const [i, part] of lesson.parts.entries()) await expect(links.nth(i)).toHaveText(`${i + 1} · ${plain(part.title)} · Not started`);
    await expect(links.nth(last + 1)).toHaveText('Wrap-up');
    await links.nth(last).click();
    await expect(page.locator(`#lp-part-${last}`)).toBeFocused();
    await expect(page.locator(`#lp-part-${last}`)).toBeInViewport();
    await links.nth(last + 1).click();
    await expect(page.locator('#lp-wrap')).toBeFocused();
    await finish(page, lesson.parts.map((_, i) => i === 0), 1);
    await expect(links.nth(0)).toHaveText(`1 · ${plain(lesson.parts[0].title)} · Done`);
    await expect(links.nth(1)).toContainText('Not started');
  });

  test('one-page lesson: a part\'s questions come after its sections, before its mission card; a wrong answer explains itself', async ({ page }) => {
    const lesson = await load(), p = lesson.parts.findIndex((part) => part.checks?.length);
    const { options } = lesson.parts[p].checks[0], wrong = options.findIndex((o) => !o.right);
    await freshPage(page, routeHash(level, 'lesson'));
    const part = page.locator('.lpart').nth(p);
    const kids = await part.evaluate((e) => [...e.children].map((c) => c.className));
    expect(kids.lastIndexOf('lsec')).toBeLessThan(kids.indexOf('checks'));
    expect(kids.indexOf('checks')).toBeLessThan(kids.indexOf('mcard'));
    await expect(part.locator('.checks h3')).toHaveText('Check yourself');
    await expect(part.locator('.checks .check')).toHaveCount(lesson.parts[p].checks.length);
    const question = part.locator('.checks .check').first();
    await question.locator(`.opt[data-opt="${wrong}"]`).click();
    const fb = question.locator('.check-fb');
    await expect(fb).toHaveAttribute('aria-live', 'polite');
    await expect(fb).toContainText('Not quite.');
    await expect(fb).toContainText(plain(options[wrong].why));
    await expect(fb).toContainText(plain(options.find((o) => o.right).t));
    await expect(question.locator(`.opt[data-opt="${wrong}"]`)).toHaveAttribute('aria-pressed', 'true');
    // Then the right one: its own explanation replaces the feedback, and only it is pressed.
    const right = options.findIndex((o) => o.right);
    await question.locator(`.opt[data-opt="${right}"]`).click();
    await expect(fb).toHaveText(`Right. ${plain(options[right].why)}`);
    await expect(question.locator(`.opt[data-opt="${right}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(question.locator(`.opt[data-opt="${wrong}"]`)).toHaveAttribute('aria-pressed', 'false');
  });

  test('one-page lesson: Mission 1\'s card names it and lists "You will"; keyboard only, "Start Mission 1" opens it', async ({ page }) => {
    const data = await loadLevel(), lesson = data.lesson;
    await freshPage(page, routeHash(level, 'lesson'));
    const card = page.locator('.mcard').first();
    await expect(card.locator('h3')).toHaveText(data.missions[0].title);
    await expect(card.locator('.mcard-start li')).toHaveText(lesson.parts[0].youWill.map(plain));
    await expect(card.locator('.mcard-done')).toBeHidden();
    await tabUntil(page, () => document.activeElement?.matches('.mcard [data-act="mission"][data-mission="0"]'));
    await expect(page.locator(':focus')).toHaveText('Start Mission 1 →');
    await page.keyboard.press('Enter');
    await expect(page.locator('#view-build')).toBeVisible();
    expect(await page.evaluate(() => window.__sdl.S.mission)).toBe(0);
  });

  test('one-page lesson: a mission still locked opens the first one not done and says why', async ({ page }) => {
    const lesson = await load(), last = lesson.parts.length - 1;
    await freshPage(page, routeHash(level, 'lesson'));
    await page.click(`.mcard[data-part="${last}"] .mcard-start [data-act="mission"]`);
    await expect(page.locator('#view-build')).toBeVisible();
    expect(await page.evaluate(() => window.__sdl.S.mission)).toBe(0);
    await expect(page.locator('#log')).toContainText(`Finish Mission ${last} first. Mission 1 is open.`);
  });

  test('one-page lesson: a finished mission\'s card shows what it showed, and "Replay" opens it again', async ({ page }) => {
    const lesson = await load(), { debrief } = lesson.parts[0];
    await freshPage(page, routeHash(level, 'build'));
    await expect(page.locator('#doneBanner')).toBeHidden();
    await finish(page, lesson.parts.map((_, i) => i === 0), 0);
    await expect(page.locator('#doneText')).toHaveText('Mission 1 complete');
    await page.click('#doneBanner [data-act="debrief"]');
    await expect(page.locator('#view-lesson')).toBeVisible();
    await expect(page.locator('#lp-m0')).toBeFocused();
    const card = page.locator('.mcard').first();
    await expect(card.locator('.mcard-start')).toBeHidden();
    const done = card.locator('.mcard-done');
    await expect(done).toContainText('✓ Mission 1 complete');
    await expect(done).toContainText(plain(debrief.saw));
    await expect(done).toContainText(plain(debrief.number[0]));
    await expect(done).toContainText(plain(debrief.next));
    await expect(page.locator('.mcard').nth(1).locator('.mcard-start')).toBeVisible(); // the next mission is still to do
    await finish(page, lesson.parts.map((_, i) => i === 0), 1);
    await done.getByRole('button', { name: 'Replay Mission 1' }).click();
    await expect(page.locator('#view-build')).toBeVisible();
    expect(await page.evaluate(() => window.__sdl.S.mission)).toBe(0);
  });

  test('one-page lesson: after the last mission, its button on the canvas opens the wrap-up, which leads to the quiz', async ({ page }) => {
    const lesson = await load(), last = lesson.parts.length - 1;
    await freshPage(page, routeHash(level, 'build'));
    await finish(page, lesson.parts.map(() => true), last);
    await expect(page.locator('#doneText')).toHaveText(`Mission ${last + 1} complete`);
    await page.click('#doneBanner [data-act="debrief"]');
    await expect(page.locator('#lp-wrap')).toBeFocused();
    const wrap = page.locator('.lwrap');
    await expect(wrap.locator('ol li')).toHaveCount(lesson.wrap.say.length);
    await expect(wrap.locator('.recap-nums div')).toHaveCount(lesson.wrap.numbers.length);
    await expect(wrap).toContainText(plain(lesson.wrap.broken));
    await expect(wrap.locator(`svg#${lesson.wrap.picture} .node-box`)).not.toHaveCount(0);
    await expect(page.locator(`.mcard[data-part="${last}"] .mcard-done`)).toContainText(`✓ Mission ${last + 1} complete`);
    await wrap.getByRole('button', { name: 'Take the quiz' }).click();
    await expect(page.locator('#view-quiz')).toBeVisible();
  });

  /**
   * Serves the level's file with `code` run at its end, so a test can show a lesson shape the level does not have yet.
   * `code` edits the file's `lesson` constant (every level file names its lesson so).
   */
  const serveLessonWith = (page, code) => page.route(`**/levels/level-${String(level).padStart(2, '0')}.js`, async (route) => {
    const text = await (await route.fetch()).text();
    await route.fulfill({ body: `${text}\n${code}\n`, contentType: 'text/javascript' });
  });

  test('one-page lesson: a New part card shows the component\'s icon and name, and its three lines', async ({ page }) => {
    // One card in the first part, as a level that introduces a component has.
    const card = { type: 'dns', what: 'The internet address book.', does: 'Turns a name into an address.', game: 'Five dollars a month.' };
    await serveLessonWith(page, `lesson.parts[0].newParts = [${JSON.stringify(card)}];`);
    await freshPage(page, routeHash(level, 'lesson'));
    const shown = page.locator('.lpart').first().locator('.newpart');
    await expect(shown).toHaveCount(1);
    await expect(shown.locator('.newpart-name')).toHaveText('DNS');
    await expect(shown.locator('svg.newpart-icon > g > *')).not.toHaveCount(0);
    await expect(shown.locator('dt')).toHaveText(['What it is', 'What it does', 'In the game']);
    await expect(shown.locator('dd')).toHaveText([card.what, card.does, card.game]);
  });

  test('one-page lesson: a part without questions has no Check yourself block; a wrap-up without its closing paragraph ends with "Still broken"', async ({ page }) => {
    // Both are optional (PageLesson in js/types.js): the last part loses its questions, the wrap-up its loop.
    const lesson = await load(), last = lesson.parts.length - 1;
    await serveLessonWith(page, 'delete lesson.parts[lesson.parts.length - 1].checks; delete lesson.wrap.loop;');
    await freshPage(page, routeHash(level, 'lesson'));
    const part = page.locator('.lpart').nth(last);
    await expect(part.locator('.lsec')).toHaveCount(lesson.parts[last].sections.length);
    await expect(part.locator('.checks')).toHaveCount(0);
    await expect(part.locator('.mcard')).toBeVisible();
    const paragraphs = page.locator('.lwrap > p');
    await expect(paragraphs).toHaveCount(2); // the label, then "Still broken"
    await expect(paragraphs.last()).toHaveText(`Still broken. ${plain(lesson.wrap.broken)}`);
  });

  test('one-page lesson: no sideways scroll at 360 px, with every mission card in its done state', async ({ page }) => {
    const lesson = await load();
    await page.setViewportSize({ width: 360, height: 780 });
    await freshPage(page, routeHash(level, 'lesson'));
    await page.click('#pageLesson [data-act="rules"]');
    await finish(page, lesson.parts.map(() => true), 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  for (const width of [390, 1280]) {
    for (const colorScheme of ['light', 'dark']) {
      test.describe(`one-page lesson at ${width} px (${colorScheme})`, () => {
        test.use({ colorScheme, viewport: { width, height: 844 } });
        test('axe finds no violations with a question answered, a mission done and the game rules shown; no sideways scroll', async ({ page }) => {
          const lesson = await load();
          await freshPage(page, routeHash(level, 'lesson'));
          await page.click('#pageLesson [data-act="rules"]');
          await finish(page, lesson.parts.map((_, i) => i === 0), 1);
          await page.locator('.checks .opt').first().click();
          const results = await new AxeBuilder({ page }).include('#view-lesson').setLegacyMode().analyze();
          expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        });
      });
    }
  }
}
