// The first-mission guide (js/ui/guide.js): notes that walk a first-time player through Level 1, Mission 1. Each
// step moves on from the real action, the note never covers what it points at or blocks the page, and only
// "finished" is remembered (sdl-guide-v1). Other specs never see it: freshPage marks it finished unless asked.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../fixtures.js';
import { freshPage, reloadGame, trackErrors, tap, dragBetween, center, nodeIds, buildBasic, fastForward, openMission } from '../helpers.js';
import L1 from '../../levels/level-01.js';
import { T } from '../../js/engine/catalog.js';

const note = (page) => page.locator('#guide');
const expectStep = (page, n) => expect(page.locator('#guide .guide-step')).toHaveText(`Step ${n} of 7`);
const stored = (page) => page.evaluate(() => localStorage.getItem('sdl-guide-v1'));

/** A first-time player: empty storage, Mission 1 opened from the lesson. */
async function openGuide(page) {
  await freshPage(page, '#lesson', { guide: true });
  await page.getByRole('button', { name: 'Start Mission 1' }).click();
  await expect(note(page)).toBeVisible();
}

/** The note and the element `selector` do not overlap, and the Play button is not under the note. */
async function expectClear(page, selector) {
  const [n, t, play] = await Promise.all(['#guide', selector, '#playBtn'].map((s) => page.locator(s).first().boundingBox()));
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap(n, t), `the note covers ${selector}`).toBe(false);
  expect(overlap(n, play), 'the note covers Play').toBe(false);
}

test.describe('First-mission guide', () => {
  test('shows on a fresh Level 1, Mission 1 as a labelled region with the order line, Next and Skip', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGuide(page);
    await expect(page.getByRole('region', { name: 'Guide' })).toBeVisible();
    await expectStep(page, 1);
    await expect(note(page)).toContainText('Your goals. The mission is done when every line here is ticked.');
    await expect(note(page).locator('[aria-live="polite"]')).toContainText('Step 1 of 7');
    // The current word is in bold and named for screen readers; the arrows are hidden from them.
    await expect(note(page).locator('.guide-order')).toHaveText('Order: Add, this step → Connect → Edit → Play → Read');
    await expect(note(page).locator('.guide-order b')).toHaveText('Add, this step');
    expect(await note(page).locator('.guide-order b').evaluate((b) => getComputedStyle(b).fontWeight)).toBe('700');
    for (const name of ['Next', 'Skip the guide']) {
      const box = await note(page).getByRole('button', { name }).boundingBox();
      expect(box.height, `${name} is at least 44 px tall`).toBeGreaterThanOrEqual(44);
    }
    await expectClear(page, '#missionCard');
    // It jumps to each new spot: sliding there would pass over what it points at.
    expect(await note(page).evaluate((e) => getComputedStyle(e).transitionDuration)).toBe('0s');
    await expect(page.locator('#guideShow')).toHaveCount(0); // the guide is already showing
  });

  test('each step moves on from the real action, and Done ends it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = trackErrors(page);
    await openGuide(page);
    await note(page).getByRole('button', { name: 'Next' }).click();
    await expectStep(page, 2);
    await expect(note(page).getByRole('button', { name: 'Next' })).toBeHidden(); // it waits for the design
    await expectClear(page, '#palList');
    await page.click('.pal-item[data-type="dns"]');
    await expectStep(page, 3);
    await page.click('.pal-item[data-type="web"]');
    await expectStep(page, 4);
    await expect(note(page).locator('.guide-order b')).toContainText('Connect');
    const ids = await nodeIds(page);
    await expectClear(page, `[data-handle="${ids.users}"]`);
    await dragBetween(page, `[data-handle="${ids.users}"]`, `[data-node="${ids.dns}"]`);
    await expectStep(page, 4); // Users must reach both
    await dragBetween(page, `[data-handle="${ids.users}"]`, `[data-node="${ids.web}"]`);
    await expectStep(page, 5);
    // The new arrow selected the Web server, so the note already points at the edit box; Escape clears the selection
    // (and does not skip the guide while something is selected).
    await expect(note(page)).toContainText('This box edits the part you selected');
    await page.keyboard.press('Escape');
    await expect(note(page)).toContainText('Change a part. Click the Web server on the canvas.');
    // Selecting an arrow is not selecting the Web server.
    const edge = await page.evaluate(() => window.__sdl.S.edges[0].id);
    await tap(page, `[data-edge="${edge}"] .edge-line`);
    await expect(page.locator(`[data-edge="${edge}"]`)).toHaveClass(/sel/);
    await expect(note(page)).toContainText('Click the Web server on the canvas.');
    await page.keyboard.press('Escape'); // clears the arrow's selection, so the guide stays
    await expectClear(page, `[data-node="${ids.web}"]`);
    await tap(page, `[data-node="${ids.web}"]`);
    await expect(note(page)).toContainText('This box edits the part you selected: its size and its connections.');
    await expectClear(page, '#inspCard');
    await note(page).getByRole('button', { name: 'Next' }).click();
    await expectStep(page, 6);
    await expectClear(page, '#playBtn');
    await page.click('#playBtn');
    await expectStep(page, 7);
    // The numbers are the level's own targets and hold time.
    await expect(note(page)).toContainText(`Served must stay at least ${L1.targets.servedPct}% and Response under ${L1.targets.latencyMs} ms for ${T.hold} seconds.`);
    await expectClear(page, '#hud');
    // Done from the keyboard: the button goes, so focus moves to "Show the guide".
    await note(page).getByRole('button', { name: 'Done' }).focus();
    await page.keyboard.press('Enter');
    await expect(note(page)).toBeHidden();
    expect(await stored(page)).toBe('finished');
    await expect(page.locator('#guideShow')).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('completing the mission ends the guide', async ({ page }) => {
    await openGuide(page);
    await buildBasic(page, { db: false });
    await page.evaluate(() => window.__sdl.afterDesignChange());
    await note(page).getByRole('button', { name: 'Next' }).click(); // step 1
    await note(page).getByRole('button', { name: 'Next' }).click(); // step 5
    await page.click('#playBtn');
    await expectStep(page, 7);
    await fastForward(page, T.hold + 2);
    await expect(note(page)).toBeHidden();
    expect(await stored(page)).toBe('finished');
  });

  test('doing two steps at once jumps ahead, and working out of order is never asked again', async ({ page }) => {
    await openGuide(page);
    await note(page).getByRole('button', { name: 'Next' }).click();
    await page.click('.pal-item[data-type="web"]'); // the Web server first
    await expectStep(page, 2);
    await page.click('.pal-item[data-type="dns"]'); // steps 2 and 3 are both done now
    await expectStep(page, 4);
    await buildBasic(page, { db: false }); // a second set of parts cannot be added, so this only connects
    await page.evaluate(() => window.__sdl.afterDesignChange());
    await expectStep(page, 5);
  });

  test('"Skip the guide" survives a reload, and "Show the guide" brings it back at the first step not done', async ({ page }) => {
    await openGuide(page);
    await note(page).getByRole('button', { name: 'Next' }).click();
    await page.click('.pal-item[data-type="dns"]');
    await expectStep(page, 3);
    await note(page).getByRole('button', { name: 'Skip the guide' }).focus();
    await page.keyboard.press('Enter');
    await expect(note(page)).toBeHidden();
    await expect(page.locator('#guideShow')).toBeFocused();
    await page.locator('#guideShow').click();
    await expectStep(page, 3); // step 1 was read and DNS is on the canvas
    await expect(note(page)).toBeFocused();
    await page.keyboard.press('Escape'); // Escape skips too
    await expect(note(page)).toBeHidden();
    await reloadGame(page);
    await expect(note(page)).toBeHidden();
    expect(await stored(page)).toBe('finished');
    await page.locator('#guideShow').click();
    await expectStep(page, 1); // a new page has not read step 1 yet
  });

  test('Escape on the page skips the guide when nothing is selected', async ({ page }) => {
    await openGuide(page);
    await page.locator('body').click({ position: { x: 5, y: 5 } }); // focus on the page, not the note
    await page.keyboard.press('Escape');
    await expect(note(page)).toBeHidden();
    expect(await stored(page)).toBe('finished');
  });

  test('"Reset level progress" brings the guide back', async ({ page }) => {
    await openGuide(page);
    await note(page).getByRole('button', { name: 'Skip the guide' }).click();
    await page.click('#resetLevel');
    await page.click('#resetLevel');
    expect(await stored(page)).toBe(null);
    await expect(note(page)).toBeHidden(); // Mission 1 is closed until it is started from the lesson again
    await page.click('#tab-lesson');
    await page.getByRole('button', { name: 'Start Mission 1' }).click();
    await expect(note(page)).toBeVisible();
    await expectStep(page, 1);
  });

  test('is not shown in Mission 2, in Level 2 or in a mock interview', async ({ page }) => {
    await openGuide(page);
    await openMission(page, 1);
    await expect(note(page)).toBeHidden();
    await expect(page.locator('#guideShow')).toHaveCount(0);
    await freshPage(page, '#level-2/build', { guide: true });
    await expect(note(page)).toHaveCount(0);
    await freshPage(page, '#mock/build', { guide: true });
    await expect(note(page)).toHaveCount(0);
  });

  test('a drag that starts under the note\'s target still works', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGuide(page);
    await note(page).getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('.guide-ring')).toBeVisible();
    // Neither the outline nor the note takes the pointer over the component list.
    const p = await center(page, '.pal-item[data-type="dns"]');
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.pal-item')?.dataset.type, p)).toBe('dns');
    await dragBetween(page, '.pal-item[data-type="dns"]', await center(page, '#cv'));
    expect((await nodeIds(page)).dns).toBeTruthy();
    await expectStep(page, 3);
  });

  test('at 1024 px the note keeps off the settings sheet and Play', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openGuide(page);
    const ids = await buildBasic(page, { db: false });
    await page.evaluate(() => window.__sdl.afterDesignChange());
    await note(page).getByRole('button', { name: 'Next' }).click();
    await expectStep(page, 5);
    await tap(page, `[data-node="${ids.web}"]`);
    await expect(page.locator('#inspCard')).toBeVisible();
    await expect(note(page)).toContainText('This box edits the part you selected');
    await expectClear(page, '#inspCard');
  });

  test('at 390 px the note is a strip near the bottom, with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGuide(page);
    await note(page).getByRole('button', { name: 'Next' }).click();
    await expectStep(page, 2);
    const box = await note(page).boundingBox();
    expect(box.width).toBeGreaterThan(390 - 2 * 16 - 1);
    expect(box.y + box.height).toBeGreaterThan(844 - 40);
    await expectClear(page, '#palList');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`no accessibility violations with a note showing (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openGuide(page);
      await note(page).getByRole('button', { name: 'Next' }).click();
      await expectStep(page, 2);
      const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
      expect(results.violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    });
  }
});
