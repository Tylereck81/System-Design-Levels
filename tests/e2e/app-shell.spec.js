// tests/e2e/: Playwright tests (npm run test:e2e) of what a player does in the real page: one spec per level, the app
// shell, the canvas, the mock interview, and checks every level shares. Import test and expect from ../fixtures.js.
import { test, expect } from '../fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, reloadGame, trackErrors, buildBasic, playFor } from '../helpers.js';

test.describe('App shell · level picker, routing, saved progress', () => {
  test('the header names the level; the picker lists playable levels and closes with Esc or a click outside', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page);
    await expect(page.locator('#lvlChip')).toHaveText('Level 1 / 21');
    await expect(page.locator('#lvlName')).toHaveText('One server to two tiers');
    await expect(page.locator('#lvlMenu')).toBeHidden();

    await page.click('#lvlBtn');
    await expect(page.locator('#lvlMenu')).toBeVisible();
    await expect(page.locator('#lvlBtn')).toHaveAttribute('aria-expanded', 'true');
    const current = page.locator('#lvlList a[aria-current="page"]');
    await expect(current).toHaveText(/Level 1\s*One server to two tiers/);
    await expect(current).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#lvlMenu')).toBeHidden();
    await expect(page.locator('#lvlBtn')).toBeFocused();

    await page.click('#lvlBtn');
    await page.mouse.click(700, 600);
    await expect(page.locator('#lvlMenu')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('picking a level from the picker opens its lesson', async ({ page }) => {
    await freshPage(page, '#quiz');
    await page.click('#lvlBtn');
    await page.click('#lvlList a[aria-current="page"]');
    await expect(page.locator('#view-lesson')).toBeVisible();
    await expect(page.locator('#lvlMenu')).toBeHidden();
  });

  test('routes: Level 1 keeps #lesson / #build / #quiz, and #level-1/<tab> works too', async ({ page }) => {
    await freshPage(page, '#level-1/build');
    await expect(page.locator('#view-build')).toBeVisible();
    await page.click('#tab-quiz');
    await expect(page).toHaveURL(/#quiz$/);
    await page.goto('/#lesson');
    await expect(page.locator('#view-lesson')).toBeVisible();
  });

  test('an unknown level falls back to Level 1 and fixes the address', async ({ page }) => {
    await freshPage(page, '#level-99/quiz');
    await expect(page.locator('#lvlChip')).toHaveText('Level 1 / 21');
    await expect(page.locator('#view-quiz')).toBeVisible();
    await expect(page).toHaveURL(/#quiz$/);
    // Changing the address to an unknown level while playing does not reload the page.
    await page.evaluate(() => { window.__notReloaded = true; location.hash = '#level-99/build'; });
    await expect(page.locator('#view-build')).toBeVisible();
    await expect(page).toHaveURL(/#build$/);
    expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
  });

  for (const [address, tab, fixed] of [['#level-2/', 'lesson', '#level-2/lesson'], ['#LEVEL-2/build', 'build', '#level-2/build'], ['#level-2/xyz', 'lesson', '#level-2/lesson']]) {
    test(`the address ${address} opens Level 2 and is corrected to ${fixed}`, async ({ page }) => {
      await freshPage(page, address);
      await expect(page.locator('#lvlChip')).toHaveText('Level 2 / 21');
      await expect(page.locator(`#view-${tab}`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(fixed + '$'));
    });
  }

  test('Level 1 progress is saved under its own key and still loads', async ({ page }) => {
    await freshPage(page, '#build');
    await page.evaluate(() => { window.__sdl.addNode('dns'); window.__sdl.S.quiz = { 0: 2 }; window.__sdl.afterChange(); });
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['sdl-level1-v1']);
    await reloadGame(page);
    expect(await page.evaluate(() => window.__sdl.S.nodes.some((n) => n.type === 'dns'))).toBe(true);
    expect(await page.evaluate(() => window.__sdl.S.quiz[0])).toBe(2);
  });

  test('a save that passes the checks but fails to load starts fresh and says so in the console', async ({ page }) => {
    const errors = trackErrors(page);
    const warnings = [];
    page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
    await freshPage(page);
    // The save checks don't look at connection ids; one that can't be turned into text makes loading throw.
    await page.evaluate(() => localStorage.setItem('sdl-level1-v1', JSON.stringify({
      nodes: [{ id: 'u', type: 'users', x: 380, y: 76 }], edges: [{ id: { toString: 0 }, from: 'u', to: 'u' }], mission: 1,
    })));
    await reloadGame(page);
    await expect.poll(() => warnings.filter((w) => w.startsWith('Saved progress could not be loaded; starting fresh.')).length).toBe(1);
    expect(await page.evaluate(() => window.__sdl.S.mission)).toBe(0);
    await expect(page.locator('#tab-lesson')).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`open picker has no accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await freshPage(page);
      await page.click('#lvlBtn');
      const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
      expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    });
  }

  test('a quote, < or & in level text shows as written and adds no markup', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#build');
    const odd = 'A "quoted" <b>&</b> title';
    await page.evaluate(async (odd) => {
      const { MISSIONS } = await import('/js/state.js'); // the game's own module instance
      MISSIONS[0].title = odd;
      MISSIONS[0].goals[0].text = odd;
      window.__sdl.afterChange();
    }, odd);
    await expect(page.locator('#mstrip')).toContainText(`Mission 1: ${odd}`);
    await expect(page.locator('#mstrip b')).toHaveCount(1); // only "Mission 1:"; the title's <b> is text
    await expect(page.locator('#goals li').first()).toContainText(odd);
    await expect(page.locator('#goals li').first().locator('b')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('phone: the open picker fits the screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await freshPage(page);
    await page.click('#lvlBtn');
    const box = await page.locator('#lvlMenu').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});

test.describe('Live panels · repainted only when they change', () => {
  test('while a steady design plays, the HUD and goals are not rewritten', async ({ page }) => {
    await freshPage(page, '#level-1/build');
    await buildBasic(page);
    await page.click('#playBtn');
    await playFor(page, 1); // the first paints swap the "—" placeholders for numbers
    // Watch for 30 animation frames (at least two 0.2 s paints at 60 frames a second), counted in the page, not timed.
    const rewritten = await page.evaluate(() => new Promise((done) => {
      const changed = [];
      const obs = new MutationObserver((list) => list.forEach((m) => changed.push(m.target.id || m.target.className)));
      ['hud', 'goals'].forEach((id) => obs.observe(document.getElementById(id), { childList: true, subtree: true, characterData: true }));
      let frames = 0;
      const tick = () => { if (++frames < 30) requestAnimationFrame(tick); else { obs.disconnect(); done(changed); } };
      requestAnimationFrame(tick);
    }));
    expect(await page.evaluate(() => window.__sdl.run.playing)).toBe(true);
    expect(rewritten).toEqual([]);
  });
});
