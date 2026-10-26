import { test, expect } from '@playwright/test';
import { freshPage, unlockMissions, buildBasic, fastForward, logText, state } from './helpers.js';

// Engine features for Break-it experiments that later levels rely on. Level 1's own experiments
// don't use them, so these tests add them to the loaded level the way a level file would.

/** Mission 3 with the estimate accepted and both tiers at L, ready to run experiments. */
async function mission3(page) {
  await freshPage(page, '#build');
  await unlockMissions(page, 2);
  await buildBasic(page);
  await page.fill('#estIn', '463');
  await page.click('#estBtn');
  await page.evaluate(() => { for (const n of window.__sdl.S.nodes) { if (n.size) n.size = 'L'; if (n.type === 'db') n.kind = 'sql'; } window.__sdl.afterDesignChange(); });
  await page.click('#playBtn');
}
/** Change the loaded level's crash experiment (same object the game reads). */
const patchCrash = (page, fn) => page.evaluate(async (src) => {
  const { level } = await import('/js/level.js');
  const crash = level.experiments.find((e) => e.id === 'crash');
  new Function('crash', src)(crash); // eslint-disable-line no-new-func
}, fn);

test.describe('Experiments', () => {
  test('buttons have namespaced ids', async ({ page }) => {
    await freshPage(page, '#build');
    await expect(page.locator('#exp-crash')).toHaveCount(1);
    await expect(page.locator('#exp-spike')).toHaveCount(1);
    await expect(page.locator('#crashBtn, #spikeBtn')).toHaveCount(0);
  });

  test('a required outcome must hold for the whole run before the experiment counts', async ({ page }) => {
    await mission3(page);
    await patchCrash(page, `crash.expect = (m) => m.servedPct >= 99; crash.notMet = (m) => 'Only ' + m.servedPct.toFixed(0) + '% served.';`);
    await page.click('#exp-crash');
    await fastForward(page, 3); // the only web server is down: 0% served, so it never counts
    expect(await state(page, () => window.__sdl.S.exp.crash)).toBe(false);
    // The live display loop (real time, not simulated steps) writes this message, so wait for it.
    await expect(page.locator('#log')).toContainText('Only 0% served.');
    await patchCrash(page, `crash.expect = () => true;`);
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp.crash)).toBe(true);
  });

  test('the "observed" message can describe what actually happened', async ({ page }) => {
    await mission3(page);
    await patchCrash(page, `crash.observed = (m) => 'Observed: ' + m.servedPct.toFixed(0) + '% served during the crash.';`);
    await page.click('#exp-crash');
    await fastForward(page, 2);
    expect(await logText(page)).toContain('Observed: 0% served during the crash.');
  });

  test('a crash whose target finds no component warns and starts nothing', async ({ page }) => {
    await mission3(page);
    await patchCrash(page, `crash.target = () => null;`);
    await page.click('#exp-crash');
    await expect(page.locator('#exp-crash')).toHaveAttribute('aria-pressed', 'false');
    const log = await logText(page);
    expect(log).toContain('Build the design first');
    expect(log).not.toContain('restarted');
  });

  test('a level whose experiment goals have no matching experiment is rejected at start-up', async ({ page }) => {
    await freshPage(page);
    const problems = await page.evaluate(async () => {
      const { validateLevel, level } = await import('/js/level.js');
      const ok = validateLevel(level);
      const bad = {
        experiments: [{ id: 'crash', kind: 'crash', target: () => null }, { id: 'crash', kind: 'flood' }],
        missions: [{ goals: [{ id: 'spike', type: 'exp' }] }],
      };
      return { ok, bad: validateLevel(bad) };
    });
    expect(problems.ok).toEqual([]);
    expect(problems.bad).toEqual([
      'two experiments use the id "crash"',
      'experiment "crash" has unknown kind "flood"',
      'Mission 1 goal "spike" has no matching experiment',
    ]);
  });
});
