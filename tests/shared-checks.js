import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { routeHash } from '../js/route.js';
import { LEVELS } from '../levels/index.js';
import { freshPage, selectNode, reloadGame, finishMissions } from './helpers.js';

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
 * The checks every level with a one-page lesson must pass: the page's order with every section shown, the links to
 * each part with its mission's state in words, the questions after the sections, a wrong answer's feedback, each
 * mission card in both states and where its buttons lead, New part cards, axe and no sideways scroll at 390 px and
 * on a laptop, in both themes.
 */
export function registerPageLessonTests({ level }) {
  const loadLevel = async () => (await LEVELS.find((l) => l.id === level).load()).default;
  const load = async () => (await loadLevel()).lesson;
  const plain = (t) => t.replace(/<[^>]*>/g, '');

  test('one-page lesson: the intro, the links, each part in mission order with all its sections, then the wrap-up', async ({ page }) => {
    const lesson = await load();
    await freshPage(page, routeHash(level, 'lesson'));
    const root = page.locator('#pageLesson');
    // In page order: the intro's heading, the links, each part's heading, the wrap-up's heading.
    const order = await root.locator('#lp-intro, .onpage, .lpart > h2, #lp-wrap').evaluateAll((els) => els.map((e) => e.id || e.className));
    expect(order).toEqual(['lp-intro', 'onpage', ...lesson.parts.map((_, i) => `lp-part-${i}`), 'lp-wrap']);
    await finishMissions(page, lesson.parts.map(() => true), 0); // every part open
    for (const [i, part] of lesson.parts.entries()) {
      await expect(page.locator(`#lp-part-${i}`)).toHaveText(`Part ${i + 1} · ${plain(part.title)}`);
      const sections = root.locator('.lpart').nth(i).locator('.lsec');
      await expect(sections).toHaveCount(part.sections.length);
      for (const [s, section] of part.sections.entries()) {
        await expect(sections.nth(s).locator('h3')).toHaveText(plain(section.title));
        await expect(sections.nth(s)).toBeVisible();
      }
    }
    // With every mission done, nothing is hidden but each mission card's Start state and the lock lines, and there is
    // no page-by-page navigation and no Game rules button.
    const hidden = await root.locator('[hidden]').evaluateAll((els) => els.map((e) => e.id || e.className));
    expect(hidden).toEqual([...lesson.parts.flatMap((_, i) => (i ? ['part-lock', 'mcard-start'] : ['mcard-start'])), 'part-lock']);
    await expect(root.locator('[data-go], [data-act="reveal"], [data-act="rules"]')).toHaveCount(0);
  });

  test('one-page lesson: each link opens its part, and says its mission\'s state in words', async ({ page }) => {
    const lesson = await load(), last = lesson.parts.length - 1;
    await freshPage(page, routeHash(level, 'lesson'));
    const links = page.locator('.onpage .jump');
    await expect(links).toHaveCount(lesson.parts.length + 1);
    for (const [i, part] of lesson.parts.entries()) await expect(links.nth(i)).toHaveText(`${i + 1} · ${plain(part.title)} · ${i ? 'Locked' : 'Not started'}`);
    await expect(links.nth(last + 1)).toHaveText('Wrap-up');
    await links.nth(last).click();
    await expect(page.locator(`#lp-part-${last}`)).toBeFocused();
    await expect(page.locator(`#lp-part-${last}`)).toBeInViewport();
    await links.nth(last + 1).click();
    await expect(page.locator('#lp-wrap')).toBeFocused();
    await finishMissions(page, lesson.parts.map((_, i) => i === 0), 1);
    await expect(links.nth(0)).toHaveText(`1 · ${plain(lesson.parts[0].title)} · Done`);
    await expect(links.nth(1)).toContainText('Not started');
    if (last > 1) await expect(links.nth(2)).toContainText('Locked');
  });

  /** The text of each shown child of part `i`, or of the wrap-up for `i` equal to the number of parts. */
  const shownIn = (page, i) => page.locator('.lpart, .lwrap').nth(i).evaluate((e) => [...e.children]
    .filter((c) => !(/** @type {HTMLElement} */ (c).hidden)).map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
  /** What a locked part shows: its heading and the line saying which mission opens it. */
  const lockedPart = (part, i) => [`Part ${i + 1} · ${plain(part.title)}`, `Finish Mission ${i} to unlock this part.`];
  const lockedWrap = (count) => ['Wrap-up', `Finish Mission ${count} to unlock the wrap-up.`];

  test('one-page lesson: on a fresh level Part 1 is open and every later part shows only its heading and the mission that opens it', async ({ page }) => {
    const lesson = await load(), count = lesson.parts.length;
    await freshPage(page, routeHash(level, 'lesson'));
    expect((await shownIn(page, 0)).length).toBeGreaterThan(2);
    for (const [i, part] of lesson.parts.entries()) if (i) expect(await shownIn(page, i)).toEqual(lockedPart(part, i));
    expect(await shownIn(page, count)).toEqual(lockedWrap(count));
    // A locked part's text is out of the page, not covered: a section title of Part 2 is not shown anywhere.
    await expect(page.getByText(plain(lesson.parts[1].sections[0].title), { exact: true })).toBeHidden();
    await expect(page.locator('.onpage .jump').nth(1)).toContainText('Locked');
  });

  test('one-page lesson: a locked part has no focusable element; its heading takes focus only from its link', async ({ page }) => {
    const lesson = await load();
    await freshPage(page, routeHash(level, 'lesson'));
    const locked = page.locator('.lpart, .lwrap').filter({ has: page.locator('.part-lock:not([hidden])') });
    await expect(locked).toHaveCount(lesson.parts.length); // Part 2 onwards and the wrap-up
    const focusable = await locked.evaluateAll((secs) => secs.flatMap((sec) => [...sec.querySelectorAll('*')]
      .filter((e) => e.checkVisibility() && /** @type {HTMLElement} */ (e).tabIndex >= 0).map((e) => e.outerHTML.slice(0, 60))));
    expect(focusable).toEqual([]);
    await page.locator('.onpage .jump').nth(1).click();
    await expect(page.locator('#lp-part-1')).toBeFocused();
    await expect(page.locator('#lp-part-1')).toBeInViewport();
  });

  test('one-page lesson: Part 2 opens when Mission 1 is done, stays open after a reload, and locks again on "Reset level progress"', async ({ page }) => {
    const lesson = await load();
    await freshPage(page, routeHash(level, 'build'));
    await finishMissions(page, lesson.parts.map((_, i) => i === 0), 1);
    await reloadGame(page);
    await page.click('#tab-lesson');
    const open = await shownIn(page, 1);
    expect(open).toContain(`Part 2 · ${plain(lesson.parts[1].title)}`);
    expect(open).not.toContain(lockedPart(lesson.parts[1], 1)[1]);
    for (const section of await page.locator('.lpart').nth(1).locator('.lsec').all()) await expect(section).toBeVisible();
    await expect(page.locator('.mcard[data-part="1"] .mcard-start')).toBeVisible();
    await expect(page.locator('.onpage .jump').nth(1)).toContainText('Not started');
    await page.click('#tab-build');
    await page.click('#resetLevel');
    await page.click('#resetLevel'); // it asks for a second click
    await page.click('#tab-lesson');
    expect(await shownIn(page, 1)).toEqual(lockedPart(lesson.parts[1], 1));
    await expect(page.locator('.onpage .jump').nth(1)).toContainText('Locked');
  });

  test('one-page lesson: the wrap-up opens only once the last mission is done', async ({ page }) => {
    const lesson = await load(), count = lesson.parts.length, last = count - 1;
    await freshPage(page, routeHash(level, 'lesson'));
    await finishMissions(page, lesson.parts.map((_, i) => i < last), last);
    expect(await shownIn(page, last)).not.toEqual(lockedPart(lesson.parts[last], last)); // the last part is open
    expect(await shownIn(page, count)).toEqual(lockedWrap(count));
    await finishMissions(page, lesson.parts.map(() => true), last);
    const wrap = await shownIn(page, count);
    expect(wrap).toContain('What you built');
    expect(wrap).not.toContain(lockedWrap(count)[1]);
    await expect(page.locator('.lwrap [data-act="quiz"]')).toBeVisible();
  });

  test('one-page lesson: every picture in a part or the wrap-up is drawn once it opens', async ({ page }) => {
    const lesson = await load();
    await freshPage(page, routeHash(level, 'lesson'));
    await finishMissions(page, lesson.parts.map(() => true), 0);
    const pictures = page.locator('.lpart .fig svg, .lwrap .fig svg');
    expect(await pictures.count()).toBeGreaterThan(0);
    for (const svg of await pictures.all()) {
      await svg.scrollIntoViewIfNeeded();
      // Its marks are there, and they take up room on the page (a picture drawn while hidden would measure 0).
      const seen = await svg.evaluate((e) => {
        const box = /** @type {SVGSVGElement} */ (e).getBBox(), rect = e.getBoundingClientRect();
        return { id: e.id, marks: e.querySelectorAll('line, path, rect, text').length > 2, drawn: box.width > 0 && box.height > 0, shown: rect.width > 0 && rect.height > 0 };
      });
      expect(seen).toEqual({ id: seen.id, marks: true, drawn: true, shown: true });
    }
  });

  test('one-page lesson: a part\'s questions come after its sections, before its mission card; a wrong answer explains itself', async ({ page }) => {
    const lesson = await load(), p = lesson.parts.findIndex((part) => part.checks?.length);
    const { options } = lesson.parts[p].checks[0], wrong = options.findIndex((o) => !o.right);
    await freshPage(page, routeHash(level, 'lesson'));
    await finishMissions(page, lesson.parts.map((_, i) => i < p), p); // the part is open
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

  test('one-page lesson: a mission is locked on the Build tab until its Start button in the lesson is pressed', async ({ page }) => {
    const lesson = await load(), count = lesson.parts.length;
    await freshPage(page, routeHash(level, 'build'));
    await expect(page.locator('#missionLocked')).toHaveText('Read Part 1 of the lesson, then press Start Mission 1.');
    await expect(page.locator('#playBtn')).toBeDisabled();
    await expect(page.locator('#mtabs button')).toHaveCount(count);
    for (const tab of await page.locator('#mtabs button').all()) await expect(tab).toBeDisabled();
    // Its button goes to the mission's card; the next mission's card waits, locked in its part, for this one.
    await page.getByRole('button', { name: 'Go to Part 1' }).click();
    await expect(page.locator('#view-lesson')).toBeVisible();
    await expect(page.locator('#lp-m0')).toBeFocused();
    await expect(page.locator('.mcard[data-part="1"]')).toBeHidden();
    await page.getByRole('button', { name: 'Start Mission 1' }).click();
    await expect(page.locator('#view-build')).toBeVisible();
    await expect(page.locator('#missionLocked')).toHaveCount(0);
    await expect(page.locator('#playBtn')).toBeEnabled();
    expect(await page.evaluate(() => window.__sdl.S.opened)).toEqual(lesson.parts.map((_, i) => i === 0));
    // Opened stays opened after a reload; the mission card leads back to its part.
    await reloadGame(page);
    await expect(page.locator('#view-build')).toBeVisible();
    await expect(page.locator('#playBtn')).toBeEnabled();
    expect(await page.evaluate(() => window.__sdl.S.opened)).toEqual(lesson.parts.map((_, i) => i === 0));
    await page.getByRole('button', { name: 'Read Part 1 again' }).click();
    await expect(page.locator('#lp-part-0')).toBeFocused();
  });

  test('one-page lesson: a finished mission leads back to its card, where the next mission opens', async ({ page }) => {
    const lesson = await load();
    await freshPage(page, routeHash(level, 'lesson'));
    await page.getByRole('button', { name: 'Start Mission 1' }).click();
    await finishMissions(page, lesson.parts.map((_, i) => i === 0), 0);
    const back = page.locator('#doneBanner [data-act="debrief"]');
    await expect(back).toHaveText('Back to the lesson →');
    await expect(page.locator('#mission .complete button')).toHaveText('Back to the lesson →'); // Mission 2 is not open yet
    await back.click();
    await expect(page.locator('#view-lesson')).toBeVisible();
    await expect(page.locator('#lp-m0')).toBeFocused();
    await expect(page.locator('.mcard[data-part="0"] .mcard-done')).toBeVisible();
    // Part 2 is open, its sections and then its mission card.
    for (const section of await page.locator('.lpart').nth(1).locator('.lsec').all()) await expect(section).toBeVisible();
    const next = page.locator('.mcard[data-part="1"] .mcard-start');
    await next.getByRole('button', { name: 'Start Mission 2' }).click();
    await expect(page.locator('#view-build')).toBeVisible();
    expect(await page.evaluate(() => [window.__sdl.S.mission, window.__sdl.S.opened[1]])).toEqual([1, true]);
  });

  test('one-page lesson: an older save without opened missions opens every mission it could open; reset closes them', async ({ page }) => {
    const data = await loadLevel(), count = data.lesson.parts.length;
    await freshPage(page, routeHash(level, 'build'));
    // A save from before missions opened from the lesson: Mission 1 done, Mission 2 the open one.
    await page.evaluate(({ key, v }) => {
      const old = JSON.parse(JSON.stringify(window.__sdl.S));
      delete old.opened;
      old.v = v; old.done[0] = true; old.verified[0] = true; old.mission = 1;
      localStorage.setItem(key, JSON.stringify(old));
    }, { key: data.saveKey, v: data.saveVersion - 1 });
    await reloadGame(page);
    const loaded = await page.evaluate(() => ({ opened: window.__sdl.S.opened, v: window.__sdl.S.v }));
    expect(loaded).toEqual({ opened: Array.from({ length: count }, (_, i) => i < 2), v: data.saveVersion });
    await expect(page.locator('#missionLocked')).toHaveCount(0);
    await page.click('#resetLevel');
    await page.click('#resetLevel'); // it asks for a second click
    expect(await page.evaluate(() => window.__sdl.S.opened)).toEqual(Array.from({ length: count }, () => false));
    await expect(page.locator('#missionLocked')).toBeVisible();
  });

  test('one-page lesson: a finished mission\'s card shows what it showed, and "Replay" opens it again', async ({ page }) => {
    const lesson = await load(), { debrief } = lesson.parts[0];
    await freshPage(page, routeHash(level, 'build'));
    await expect(page.locator('#doneBanner')).toBeHidden();
    await finishMissions(page, lesson.parts.map((_, i) => i === 0), 0);
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
    await finishMissions(page, lesson.parts.map((_, i) => i === 0), 1);
    await done.getByRole('button', { name: 'Replay Mission 1' }).click();
    await expect(page.locator('#view-build')).toBeVisible();
    expect(await page.evaluate(() => window.__sdl.S.mission)).toBe(0);
  });

  test('one-page lesson: after the last mission, its button on the canvas opens the wrap-up, which leads to the quiz', async ({ page }) => {
    const lesson = await load(), last = lesson.parts.length - 1;
    await freshPage(page, routeHash(level, 'build'));
    await finishMissions(page, lesson.parts.map(() => true), last);
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
    await finishMissions(page, lesson.parts.map(() => true), last); // the last part and the wrap-up open
    const part = page.locator('.lpart').nth(last);
    await expect(part.locator('.lsec')).toHaveCount(lesson.parts[last].sections.length);
    await expect(part.locator('.checks')).toHaveCount(0);
    await expect(part.locator('.mcard')).toBeVisible();
    const paragraphs = page.locator('.lwrap > p:not(.part-lock)');
    await expect(paragraphs).toHaveCount(2); // the label, then "Still broken"
    await expect(paragraphs.last()).toHaveText(`Still broken. ${plain(lesson.wrap.broken)}`);
  });

  test('one-page lesson: no sideways scroll at 360 px, with every mission card in its done state', async ({ page }) => {
    const lesson = await load();
    await page.setViewportSize({ width: 360, height: 780 });
    await freshPage(page, routeHash(level, 'lesson'));
    await finishMissions(page, lesson.parts.map(() => true), 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  for (const width of [390, 1280]) {
    test(`one-page lesson at ${width} px: one column, at most 760 px wide (the lesson's width); text, boxes, tables, pictures, mission cards and lock lines share its edges`, async ({ page }) => {
      const lesson = await load();
      await page.setViewportSize({ width, height: 844 });
      await freshPage(page, routeHash(level, 'lesson'));
      const edges = () => page.evaluate(() => {
        const root = document.querySelector('#pageLesson').getBoundingClientRect();
        const blocks = '.lede, .lintro > ul, .fig, .lsec-body > p, .lsec-body > ul, .newpart, .tbl-wrap, .check, .mcard, .lwrap > ol, .part-lock';
        const off = [...document.querySelectorAll(blocks)].filter((e) => e.checkVisibility()).flatMap((e) => {
          const r = e.getBoundingClientRect();
          return Math.round(r.left) === Math.round(root.left) && Math.round(r.right) === Math.round(root.right) ? [] : [e.className || e.tagName];
        });
        return { column: root.width, off };
      });
      // With the later parts locked, then with every part open.
      for (const done of [false, true]) {
        if (done) await finishMissions(page, lesson.parts.map(() => true), 0);
        const { column, off } = await edges();
        expect(column).toBeLessThanOrEqual(760);
        expect(off).toEqual([]);
      }
    });
  }

  for (const width of [390, 1280]) {
    for (const colorScheme of ['light', 'dark']) {
      test.describe(`one-page lesson at ${width} px (${colorScheme})`, () => {
        test.use({ colorScheme, viewport: { width, height: 844 } });
        test('axe finds no violations with a question answered and a mission done; no sideways scroll', async ({ page }) => {
          const lesson = await load();
          await freshPage(page, routeHash(level, 'lesson'));
          await finishMissions(page, lesson.parts.map((_, i) => i === 0), 1);
          await page.locator('.checks .opt').first().click();
          const results = await new AxeBuilder({ page }).include('#view-lesson').setLegacyMode().analyze();
          expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        });
      });
    }
  }
}
