// Text sizes: nothing in a lesson is smaller than 14 px and nothing on the Build screen is smaller than 13 px, in every
// level; the lesson's type scale; and how a worked calculation is laid out on a laptop and on a phone.
// Text drawn inside a diagram (svg) is not measured: it is sized in the diagram's own units and scales with it.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures.js';
import { routeHash } from '../../js/route.js';
import { LEVELS } from '../../levels/index.js';
import { freshPage } from '../helpers.js';

/** The visible HTML text under `selector` that is smaller than `min` px, as "tag.class size: text". */
const smallText = (page, selector, min) => page.evaluate(({ selector, min }) => {
  const found = new Set();
  const walker = document.createTreeWalker(document.querySelector(selector), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!node.data.trim() || el instanceof SVGElement || !el.checkVisibility() || el.closest('.sr-only')) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < min) found.add(`${el.tagName.toLowerCase()}.${el.className} ${size}px: ${node.data.trim().slice(0, 30)}`);
  }
  return [...found];
}, { selector, min });

/**
 * Shows the whole lesson: every step of a step lesson with each explanation, or the game rules of a one-page lesson
 * (everything else on it is shown already). A hand-written lesson needs nothing.
 */
async function showWholeLesson(page) {
  if (await page.locator('#pageLesson').count()) return page.click('#pageLesson [data-act="rules"]');
  if (!(await page.locator('[data-act="all"]').count())) return;
  await page.click('[data-act="all"]');
  for (const skip of await page.locator('[data-act="reveal"]').all()) await skip.click();
  await page.click('[data-act="rules"]');
}

const fontSize = (page, selector) => page.locator(selector).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));

for (const { id } of LEVELS) {
  test(`Level ${id}: lesson text is at least 14 px, Build text at least 13 px`, async ({ page }) => {
    await freshPage(page, routeHash(id, 'lesson'));
    await showWholeLesson(page);
    expect(await smallText(page, '#view-lesson', 14)).toEqual([]);
    await page.click('#tab-build');
    await page.locator('#cv [data-node]').first().click(); // the settings card, too
    await expect(page.locator('#inspCard')).toBeVisible();
    expect(await smallText(page, 'body', 13)).toEqual([]);
  });
}

test.describe('lesson type scale (Level 1)', () => {
  test('laptop: body 18 px with line height 1.6, hook 20 px, title 28 px, table cells 16 px, labels 14 px', async ({ page }) => {
    await freshPage(page, routeHash(1, 'lesson'));
    await showWholeLesson(page);
    expect(await fontSize(page, '.lsec-body > p')).toBe(18);
    // 18 px × 1.6 = 28.8 px
    expect(await page.locator('.lsec-body > p').first().evaluate((e) => parseFloat(getComputedStyle(e).lineHeight))).toBeCloseTo(28.8, 1);
    expect(await fontSize(page, '.hook')).toBe(20);
    expect(await fontSize(page, '.lpart h2')).toBe(28);
    expect(await fontSize(page, 'table.t td')).toBe(16);
    expect(await fontSize(page, '.lpart > .label')).toBe(14);
    expect(await fontSize(page, '.fig figcaption')).toBe(14);
  });

  test('laptop: no line of body text is longer than 60 characters', async ({ page }) => {
    await freshPage(page, routeHash(1, 'lesson'));
    await showWholeLesson(page);
    // Each character is put on its line by its vertical middle; the longest line of each paragraph is counted.
    const longest = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.lsec-body > p, .lsec-body > ul > li, .lsec-body > ol > li')].map((p) => {
      const top = p.getBoundingClientRect().top, lineHeight = parseFloat(getComputedStyle(p).lineHeight);
      const lines = new Map(), range = document.createRange();
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let i = 0; i < node.length; i++) {
          range.setStart(node, i); range.setEnd(node, i + 1);
          const box = range.getBoundingClientRect();
          if (!box.width) continue; // the space a line was broken at
          const line = Math.floor(((box.top + box.bottom) / 2 - top) / lineHeight);
          lines.set(line, (lines.get(line) ?? 0) + 1);
        }
      }
      return Math.max(0, ...lines.values());
    })));
    expect(longest).toBeGreaterThan(40); // the text does wrap in a column, not far short of the limit
    expect(longest).toBeLessThanOrEqual(60);
  });

  test('phone: body text is 17 px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, routeHash(1, 'lesson'));
    await showWholeLesson(page);
    expect(await fontSize(page, '.lsec-body > p')).toBe(17);
    expect(await fontSize(page, '.hook')).toBe(20);
  });
});

test.describe('a worked calculation (Level 1)', () => {
  const load = async () => (await LEVELS.find((l) => l.id === 1).load()).default.lesson;
  /** Opens the lesson and returns its first calculation and that calculation's box on the page. */
  async function openCalc(page) {
    const sections = (await load()).parts.flatMap((p) => p.sections), s = sections.findIndex((sec) => sec.body.some((b) => 'calc' in b));
    await freshPage(page, routeHash(1, 'lesson'));
    const box = page.locator('.lpart .lsec').nth(s).locator('.calc-box'); // the parts' sections: "Start here" has one of its own
    await box.scrollIntoViewIfNeeded();
    return { calc: sections[s].body.find((b) => 'calc' in b).calc, box };
  }
  /** Each row's three parts as rectangles: label, working, result. */
  const rowBoxes = (box) => box.locator('.calc-rows li').evaluateAll((rows) => rows.map((li) => [...li.children].map((part) => {
    const { left, top, bottom } = part.getBoundingClientRect();
    return { left, top, bottom };
  })));

  test('laptop: the formula, then one row per operation in three aligned columns, then the answer', async ({ page }) => {
    const { calc, box } = await openCalc(page);
    const plain = (text) => text.replace(/<[^>]*>/g, '');
    await expect(box.locator('.calc-formula')).toHaveText(plain(calc.formula));
    await expect(box.locator('.calc-rows li')).toHaveCount(calc.rows.length);
    await expect(box.locator('.calc-result').first()).toHaveText(`${calc.rows[0].approx ? '≈' : '='} ${plain(calc.rows[0].result)}`);
    await expect(box.locator('.calc-answer')).toHaveText(plain(calc.result));
    expect(await fontSize(page, '.calc-work')).toBe(18);
    expect(await fontSize(page, '.calc-result')).toBe(18);
    expect(await fontSize(page, '.calc-label')).toBe(16);
    const rows = await rowBoxes(box);
    for (const [label, work, result] of rows) {
      expect(label.left).toBeLessThan(work.left);
      expect(work.left).toBeLessThan(result.left);
      expect(work.top).toBeLessThan(label.bottom); // side by side, not stacked
      expect(work.left).toBeCloseTo(rows[0][1].left, 0); // the columns line up down the rows
      expect(result.left).toBeCloseTo(rows[0][2].left, 0);
    }
    // The formula is above the rows and the answer below them.
    const top = (selector) => box.locator(selector).evaluate((e) => e.getBoundingClientRect().top);
    expect(await top('.calc-formula')).toBeLessThan(await top('.calc-rows'));
    expect(await top('.calc-rows')).toBeLessThan(await top('.calc-answer'));
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('each row stacks: label, working, result; no sideways scroll', async ({ page }) => {
      const { box } = await openCalc(page);
      for (const [label, work, result] of await rowBoxes(box)) {
        expect(work.top).toBeGreaterThanOrEqual(label.bottom - 1);
        expect(result.top).toBeGreaterThanOrEqual(work.bottom - 1);
        expect(work.left).toBeCloseTo(label.left, 0);
        expect(result.left).toBeCloseTo(label.left, 0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });

    for (const colorScheme of ['light', 'dark']) {
      test.describe(`axe (${colorScheme})`, () => {
        test.use({ colorScheme });
        test('no violations on a lesson with a calculation', async ({ page }) => {
          const { box } = await openCalc(page);
          await expect(box).toBeVisible();
          const results = await new AxeBuilder({ page }).include('#view-lesson').setLegacyMode().analyze();
          expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
        });
      });
    }
  });
});
