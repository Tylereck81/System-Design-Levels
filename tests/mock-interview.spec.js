import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { fastForward, state, logText, reloadGame, trackErrors } from './helpers.js';

// Mock interview: a real-system level (14–21) as a timed problem on a blank canvas, with a self-check at the end.
// The problem is kept in localStorage (sdl-mock-problem); each problem has its own save (sdl-mock-<id>-v1).

/** Open the mock interview on problem `id` (a level id), with empty saved progress. */
async function openMock(page, id, tab = 'build') {
  await page.goto('/');
  await page.evaluate((x) => { localStorage.clear(); if (x) localStorage.setItem('sdl-mock-problem', String(x)); }, id);
  await page.goto('about:blank');
  await page.goto(`/#mock/${tab}`);
  await page.waitForFunction(() => !!window.__sdl);
}
const steps = (page) => page.locator('#mockSteps li');
/** Build a working URL shortener through the test hooks: load balancer, link service, database and cache. */
const buildShortener = (page) => page.evaluate(() => {
  const s = window.__sdl, S = s.S, add = (type, props) => { s.addNode(type); const n = S.nodes.at(-1); Object.assign(n, props); return n.id; };
  const dns = add('dns', {}), lb = add('lb', {}), web = add('web', { size: 'L', scaling: 'auto' }), db = add('db', { size: 'XL', kind: 'sql' }), c = add('cache', { size: 'L', ttl: '3600' });
  s.tryConnect('u', dns); s.tryConnect('u', lb); s.tryConnect(lb, web); s.tryConnect(web, db); s.tryConnect(web, c);
  s.afterDesignChange();
});

test.describe('Mock interview · the page', () => {
  test('opens a problem on a blank canvas, with no quiz and no missions', async ({ page }) => {
    const errors = trackErrors(page);
    await openMock(page, 14, 'lesson');
    await expect(page.locator('#lvlChip')).toHaveText('Mock interview');
    await expect(page.locator('#lvlName')).toHaveText('URL shortener');
    await expect(page.locator('#tab-quiz')).toBeHidden();
    await expect(page.locator('#view-lesson')).toContainText('60 million new links a day');
    await expect(page.locator('#view-lesson')).toContainText('Stress it');
    await page.click('#startBuild');
    expect(await state(page, () => window.__sdl.S.nodes.map((n) => n.type))).toEqual(['users']);
    expect(await state(page, () => window.__sdl.S.tab)).toBe('build');
    await expect(page.locator('#palList')).toContainText('Link service');
    await expect(page.locator('#mtabs')).toBeEmpty();
    await expect(page.locator('#expGroup')).toBeHidden(); // Break-it opens in Stress it
    await expect(page).toHaveURL(/#mock\/build$/);
    expect(errors).toEqual([]);
  });

  test('the level menu offers the mock interview, and levels keep their quiz', async ({ page }) => {
    await page.goto('/#level-14/lesson');
    await page.waitForFunction(() => !!window.__sdl);
    await expect(page.locator('#lvlList a[href="#mock/lesson"]')).toContainText('Mock interview');
    await expect(page.locator('#tab-quiz')).toBeVisible();
    await expect(page.locator('#lvlChip')).toHaveText('Level 14 / 21');
  });

  test('with no saved problem, one of Levels 14–21 is picked and kept', async ({ page }) => {
    await openMock(page, null);
    const id = Number(await page.evaluate(() => localStorage.getItem('sdl-mock-problem')));
    expect(id).toBeGreaterThanOrEqual(14);
    expect(id).toBeLessThanOrEqual(21);
    const title = await page.locator('#lvlName').textContent();
    await reloadGame(page);
    await expect(page.locator('#lvlName')).toHaveText(title);
  });

  for (const [id, title] of [[14, 'URL shortener'], [15, 'Web crawler'], [16, 'Notification system'], [17, 'News feed'], [18, 'Chat system'], [19, 'Search autocomplete'], [20, 'Video platform'], [21, 'Cloud file sync']]) {
    test(`problem ${id}, ${title}: loads, and its self-check has 6 points`, async ({ page }) => {
      const errors = trackErrors(page);
      await openMock(page, id);
      await expect(page.locator('#lvlName')).toHaveText(title);
      for (let i = 0; i < 4; i++) await page.click('#mockNext');
      await expect(page.locator('#mockChecks li')).toHaveCount(6);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('Mock interview · the timer', () => {
  test('four steps with their times; a step over its time turns amber', async ({ page }) => {
    await page.clock.install();
    await openMock(page, 14);
    // Stop the page's clock, so only fastForward moves time, however slowly the browser clicks.
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
    await expect(steps(page)).toHaveCount(4);
    await expect(steps(page).nth(0)).toContainText('Scope it');
    await expect(steps(page).nth(0)).toContainText('5–8 min');
    await expect(steps(page).nth(3)).toContainText('5 min');
    await expect(page.locator('#mockPlay')).toHaveText('Start timer');
    await page.click('#mockPlay');
    await page.clock.fastForward('07:00');
    await expect(steps(page).nth(0).locator('.mock-t')).toHaveText('7:00');
    await expect(steps(page).nth(0)).not.toHaveClass(/over/);
    await page.clock.fastForward('01:30');
    await expect(steps(page).nth(0).locator('.mock-t')).toHaveText('8:30');
    await expect(steps(page).nth(0)).toHaveClass(/over/);
    // Pausing stops the clock.
    await page.click('#mockPlay');
    await expect(page.locator('#mockPlay')).toHaveText('Resume timer');
    await page.clock.fastForward('02:00');
    await expect(steps(page).nth(0).locator('.mock-t')).toHaveText('8:30');
    // The next step starts at zero; the time spent so far is logged.
    await page.click('#mockNext');
    await expect(steps(page).nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('#log')).toContainText('Scope it: 8:30 (aim for 8 min or less).');
    await expect(page.locator('#buildMeta')).toHaveText('2/4');
  });

  test('Break-it opens in Stress it; the experiments run on the real model and never finish a mission', async ({ page }) => {
    await openMock(page, 14);
    await buildShortener(page);
    await page.click('#playBtn');
    await fastForward(page, 6);
    expect(await state(page, () => window.__sdl.model({ peak: true }).servedPct)).toBe(100);
    for (let i = 0; i < 3; i++) await page.click('#mockNext');
    await expect(page.locator('#expGroup')).toBeVisible();
    await page.click('#exp-viral');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('a link went viral, and 100.0% of requests were still served');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([false]);
    expect(await logText(page)).not.toContain('Level 14 complete');
  });

  test('the self-check: ticks are counted and kept, with the step times, across a reload', async ({ page }) => {
    await openMock(page, 16);
    for (let i = 0; i < 4; i++) await page.click('#mockNext');
    await expect(page.locator('#buildMeta')).toHaveText('✓');
    await expect(page.locator('#mockCount')).toHaveText('0 of 6 covered');
    await page.check('#mockCheck0');
    await page.check('#mockCheck3');
    await expect(page.locator('#mockCount')).toHaveText('2 of 6 covered');
    await reloadGame(page);
    await expect(page.locator('#mockCount')).toHaveText('2 of 6 covered');
    await expect(page.locator('#mockCheck3')).toBeChecked();
    await page.click('#mockRestart');
    await expect(page.locator('#mockPlay')).toHaveText('Start timer');
    expect(await state(page, () => window.__sdl.S.mock)).toEqual({ step: 0, times: [0, 0, 0, 0], finished: false, checks: [false, false, false, false, false, false] });
  });

  test('a new problem keeps the old one\'s canvas in its own save', async ({ page }) => {
    await openMock(page, 14);
    await buildShortener(page);
    await page.selectOption('#mockProblem', '17');
    await page.click('#mockSwitch');
    await page.waitForFunction(() => window.__sdl && document.getElementById('lvlName').textContent === 'News feed');
    expect(await state(page, () => window.__sdl.S.nodes.length)).toBe(1);
    await page.selectOption('#mockProblem', '14');
    await page.click('#mockSwitch');
    await page.waitForFunction(() => window.__sdl && document.getElementById('lvlName').textContent === 'URL shortener');
    expect(await state(page, () => window.__sdl.S.nodes.length)).toBe(6);
  });

  test('bad saved timer data loads as a fresh timer', async ({ page }) => {
    await openMock(page, 18);
    await page.click('#mockPlay'); // saves
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-mock-18-v1'));
      saved.mock = { step: 9, times: [1, 'x'], finished: 'yes', checks: 'all' };
      localStorage.setItem('sdl-mock-18-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    await page.click('#tab-build');
    expect(await state(page, () => window.__sdl.S.mock)).toEqual({ step: 0, times: [0, 0, 0, 0], finished: false, checks: [false, false, false, false, false, false] });
  });
});

test.describe('Mock interview · layout and accessibility', () => {
  test('phone: no sideways scroll on the build tab', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openMock(page, 19);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on the lesson, the timer and the self-check', async ({ page }) => {
        await openMock(page, 20, 'lesson');
        const check = async (where) => {
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${where}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        };
        await check('lesson');
        await page.click('#tab-build');
        await page.click('#mockPlay');
        await check('timer');
        for (let i = 0; i < 4; i++) await page.click('#mockNext');
        await check('self-check');
      });
    });
  }
});
