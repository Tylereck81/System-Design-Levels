import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, state, logText, reloadGame, trackErrors } from './helpers.js';

// Level 17: News feed.
// Users ('u'), DNS ('d'), a load balancer ('l'), two autoscaled groups of L web servers ('w1', 'w2'), the feed service
// ('f', fanout on read, 2 workers) and the feed cache ('c', whole posts). 3,000 feed loads and 150 posts a second.

const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; S.est = true; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model({ peak: true });
  return { qps: m.qps, served: m.servedPct, latency: m.latency, cost: m.cost, o: m.feed };
});
const select = async (page, id) => { await page.focus(`[data-node="${id}"]`); await page.keyboard.press('Enter'); };
const set = (page, id, props) => page.evaluate(([x, p]) => { Object.assign(window.__sdl.S.nodes.find((n) => n.id === x), p); window.__sdl.afterDesignChange(); }, [id, props]);
const during = (page, id) => page.evaluate((x) => { window.__sdl.run.on = x ? { [x]: {} } : {}; }, id);
const click = (page, key) => page.locator(`#insp [data-focus-key="${key}"]`).click();
const pause = (page) => page.evaluate(() => { if (window.__sdl.run.playing) window.__sdl.togglePlay(); });
const breakIt = async (page, id) => { await page.click(`#exp-${id}`); await fastForward(page, 2); await page.click(`#exp-${id}`); };

test.describe('Level 17 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-17/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 17 / 21');

    // Mission 1: estimate 120 GB, fanout on write with 4 workers, IDs in the cache, then the dinner rush.
    await page.fill('#estIn', '120');
    await page.click('#estBtn');
    await select(page, 'f');
    await click(page, 'fanout-write');
    await click(page, 'workers-4');
    await select(page, 'c');
    await click(page, 'store-ids');
    await expect(page.locator('[data-node="f"] .node-sub')).toHaveText('fanout on write · 4 workers');
    expect((await measure(page)).cost).toBe(2481);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'rush');
    await expect(page.locator('#log')).toContainText('the rush came, and 100.0% of requests were served');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await pause(page);

    // Mission 2: the hybrid; a star posts.
    await page.click('#mission .complete button');
    await select(page, 'f');
    await click(page, 'fanout-hybrid');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'star');
    await expect(page.locator('#log')).toContainText('the star posted, and posts still reached feeds within 5 s');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    await pause(page);

    // Mission 3: skip inactive users; midnight.
    await page.click('#mission .complete button');
    await select(page, 'f');
    await click(page, 'inactive-skip');
    await expect(page.locator('[data-node="f"] .node-sub')).toHaveText('hybrid · 4 workers · skips inactive');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'nye');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 17 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 17 · numbers', () => {
  test('fanout on read is slow and overloads the post store; on write it is one cached read', async ({ page }) => {
    await freshPage(page, '#level-17/build');
    // 3,000 × 1.03 loads, each pulling 300 friends' posts: 927,000 lookups against 500,000 a second.
    let r = await measure(page);
    expect(r.o.readMs).toBeCloseTo(5 + 0.3 * 300, 9);
    expect(r.served).toBeCloseTo(100 * (154.5 + 3090 * 500000 / 927000) / 3244.5, 6);
    expect([r.o.writes, r.o.cacheGB]).toEqual([0, 0]);
    await set(page, 'f', { fanout: 'write' });
    r = await measure(page);
    expect([r.o.readMs, r.served]).toEqual([5, 100]);
    expect(r.o.writes).toBeCloseTo(154.5 * 300, 6);
    expect(r.o.lag).toBe(Infinity); // 2 workers write 40,000 a second
    expect(r.o.cacheGB).toBeCloseTo(7500, 9);
    await set(page, 'c', { store: 'ids' });
    await set(page, 'f', { workers: '4' });
    r = await measure(page);
    expect([r.o.lag, r.o.cacheGB]).toEqual([1, expect.closeTo(120, 9)]);
    expect(r.cost).toBe(2041 - 300 - 200 + 300 + 400 + 240);
  });

  test('a star\'s post, the hybrid, midnight and inactive users', async ({ page }) => {
    await freshPage(page, '#level-17/build');
    await set(page, 'f', { fanout: 'write', workers: '4' });
    await set(page, 'c', { store: 'ids' });
    await during(page, 'star');
    let r = await measure(page);
    expect(r.o.lag).toBeCloseTo(5e6 / (80000 - 46350), 6);
    await set(page, 'f', { fanout: 'hybrid' });
    r = await measure(page);
    expect([r.o.lag, r.o.readMs]).toEqual([1, 6.5]);
    await during(page, 'nye');
    expect((await measure(page)).o.lag).toBe(Infinity); // 92,700 writes against 80,000
    await set(page, 'f', { inactive: 'skip' });
    r = await measure(page);
    expect(r.o.writes).toBeCloseTo(92700 * 0.6, 6);
    expect(r.o.lag).toBe(1);
  });

  test('levels without a news feed ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-16/build');
    expect(await page.evaluate(() => window.__sdl.model().feed)).toBeNull();
  });
});

test.describe('Level 17 · teaching feedback', () => {
  test('fanout on read in the rush: the log says to fan out on write', async ({ page }) => {
    await freshPage(page, '#level-17/build');
    await goTo(page, 0);
    await page.click('#playBtn');
    await page.click('#exp-rush');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[0].rush)).toBe(false);
    await expect(page.locator('#log')).toContainText('building every feed at load time is 95 ms and 300 lookups each');
  });

  test('a star on fanout on write: the log gives the lag and suggests the hybrid', async ({ page }) => {
    await freshPage(page, '#level-17/build');
    await goTo(page, 1);
    await set(page, 'f', { fanout: 'write', workers: '4' });
    await set(page, 'c', { store: 'ids' });
    await page.click('#playBtn');
    await page.click('#exp-star');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('Posts take 149 s to reach feeds');
    await expect(page.locator('#log')).toContainText('Let followers pull stars\' posts (hybrid).');
  });

  test('whole posts in the cache: the goal shows 7,500 GB', async ({ page }) => {
    await freshPage(page, '#level-17/build');
    await goTo(page, 0);
    await set(page, 'f', { fanout: 'write', workers: '4' });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'Feed cache under 200 GB' })).toHaveClass(/fail/);
    await expect(page.locator('#goals li', { hasText: 'Feed cache under 200 GB' })).toContainText('7,500 GB');
  });

  test('the inspector shows fanout writes, cache size and lag', async ({ page }) => {
    await freshPage(page, '#level-17/build');
    await goTo(page, 0);
    await set(page, 'f', { fanout: 'write', workers: '4' });
    await set(page, 'c', { store: 'ids' });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await pause(page);
    await select(page, 'f');
    await expect(page.locator('#inspLive')).toContainText('feed cache writes a second (fanout), 120 GB cached');
    await expect(page.locator('#inspLive')).toContainText('for a post to reach friends\' feeds');
  });

  test('settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-17/build');
    await set(page, 'f', { fanout: 'hybrid', workers: '8', inactive: 'skip' });
    await set(page, 'c', { store: 'ids' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = (id) => window.__sdl.S.nodes.find((x) => x.id === id); return [n('f').fanout, n('f').workers, n('f').inactive, n('c').store]; });
    expect(await get()).toEqual(['hybrid', '8', 'skip', 'ids']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level17-v1'));
      const n = (id) => saved.nodes.find((x) => x.id === id);
      Object.assign(n('f'), { fanout: 'push', workers: '3', inactive: 'some' }); n('c').store = 'json';
      localStorage.setItem('sdl-level17-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['read', '2', 'all', 'posts']);
  });

  test('the estimate accepts 120 and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-17/build');
    for (const [v, hint] of [['7500', 'That is whole posts'], ['12', 'powers of ten']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '120 GB');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });

  test('the lesson diagram is drawn', async ({ page }) => {
    await freshPage(page, '#level-17/lesson');
    await expect(page.locator('#figFanout')).toContainText('300 writes');
    await expect(page.locator('#figFanout')).toContainText('300 lookups');
  });
});

test.describe('Level 17 · quiz', () => {
  test('quiz label shows 10 questions and 8 to pass', async ({ page }) => {
    // The quiz rules (balance, length, answer key) are checked in tests/unit/levels.test.mjs.
    await freshPage(page, '#level-17/quiz');
    await expect(page.locator('#quizLabel')).toHaveText('Level 17 quiz · 10 questions · 8 to pass');
  });
});

test.describe('Level 17 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-17/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    await page.focus('#estIn');
    await page.keyboard.type('120');
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
    await enter('[data-node="f"]');
    await enter('#insp [data-focus-key="fanout-write"]');
    await enter('#insp [data-focus-key="workers-4"]');
    await enter('[data-node="c"]');
    await enter('#insp [data-focus-key="store-ids"]');
    await enter('#playBtn');
    await fastForward(page, 5);
    await enter('#exp-rush');
    await fastForward(page, 2);
    await enter('#exp-rush');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-17/build');
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    await select(page, 'f');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-17/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-17/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            await page.evaluate(() => { window.__sdl.S.est = true; window.__sdl.afterChange(true); });
            await page.click('#playBtn'); await page.waitForTimeout(500);
            await select(page, 'f');
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
