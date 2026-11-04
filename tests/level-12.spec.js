import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors } from './helpers.js';

// Level 12: Distributed key-value store.
// The level starts inside one data center: Users ('u'), DNS ('d'), one load balancer ('l'), two autoscaled groups of
// L web servers ('w1', 'w2') and a key-value store ('k') with N = 3, W = 1, R = 1 and a strict quorum.

const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; S.est = true; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model(), k = m.node.k || {};
  return { served: m.servedPct, latency: m.latency, cost: m.cost, stale: m.kvStalePct, fail: m.kvFailPct, readMs: m.kvReadMs, quorum: m.kvQuorum, spof: m.spof, ms: k.ms };
});
const select = async (page, id) => { await page.focus(`[data-node="${id}"]`); await page.keyboard.press('Enter'); };
const set = (page, props) => page.evaluate((p) => { Object.assign(window.__sdl.S.nodes.find((n) => n.id === 'k'), p); window.__sdl.afterDesignChange(); }, props);
/** The partition without the clock: the model while the network is split. */
const split = (page, on = true) => page.evaluate((o) => { window.__sdl.run.on = o ? { partition: {} } : {}; }, on);
const click = (page, key) => page.locator(`#insp [data-focus-key="${key}"]`).click();
/** Pause the simulation, so the panels stay still while a slow browser clicks through them. */
const pause = (page) => page.evaluate(() => { if (window.__sdl.run.playing) window.__sdl.togglePlay(); });

test.describe('Level 12 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-12/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 12 / 21');

    // Mission 1: estimate R = 2, then W = R = 2 with a strict quorum (through the inspector), then the partition.
    await page.fill('#estIn', '2');
    await page.click('#estBtn');
    await select(page, 'k');
    await click(page, 'w-2');
    await click(page, 'r-2');
    await expect(page.locator('[data-node="k"] .node-sub')).toHaveText('N 3 · W 2 · R 2 · strict');
    expect((await measure(page)).cost).toBe(1509);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-partition');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('no read returned an old seat map');
    await page.click('#exp-partition');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await pause(page);

    // Mission 2: a sloppy quorum keeps carts working through the partition.
    await page.click('#mission .complete button');
    await select(page, 'k');
    await click(page, 'mode-sloppy');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-partition');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('of requests were still served');
    await page.click('#exp-partition');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    await pause(page);

    // Mission 3: fast reads: R = 1, so W = N, with a strict quorum.
    await page.click('#mission .complete button');
    await select(page, 'k');
    await click(page, 'mode-strict');
    await click(page, 'w-3');
    await click(page, 'r-1');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-partition');
    await fastForward(page, 2);
    await page.click('#exp-partition');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 12 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 12 · numbers', () => {
  test('quorums: waits, stale reads and W + R > N', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    // N = 3, W = R = 1: 20% of reads come while a write spreads; one replica of three has it, so 2 in 3 of those miss.
    let r = await measure(page);
    expect(r.cost).toBe(1509);
    expect(r.readMs).toBe(2);
    expect(r.stale).toBeCloseTo(20 * 2 / 3, 9);
    expect(r.spof).toBe(1); // the load balancer; a store with three replicas is not one
    for (const [w, rr, stale, readMs, writeMs] of [['2', '1', 20 / 3, 2, 4], ['2', '2', 0, 4, 4], ['3', '1', 0, 2, 10], ['1', '3', 0, 10, 2]]) {
      await set(page, { w, r: rr });
      r = await measure(page);
      expect([w, rr, r.stale, r.readMs]).toEqual([w, rr, expect.closeTo(stale, 9), readMs]);
      // The store's time: 90% reads, 10% writes.
      expect(r.ms).toBeCloseTo(0.9 * readMs + 0.1 * writeMs, 9);
    }
    // W and R count at most N.
    await set(page, { n: '1', w: '3', r: '3' });
    r = await measure(page);
    expect(r.quorum).toEqual({ N: 1, W: 1, R: 1, sloppy: false });
    expect(r.stale).toBe(0);
    expect(r.spof).toBe(2);
    expect(r.cost).toBe(1209);
  });

  test('the partition: a strict quorum fails the cut-off side, a sloppy one answers with old data', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    await set(page, { w: '2', r: '2' });
    await split(page);
    let r = await measure(page);
    expect(r.fail).toBeCloseTo(30, 9); // 30% of users reach one replica of three, fewer than 2
    expect(r.served).toBeCloseTo(70, 6);
    expect(r.stale).toBe(0);
    await set(page, { mode: 'sloppy' });
    r = await measure(page);
    expect(r.fail).toBe(0);
    // Both sides take writes: a recently written key's last write came from the other side for 30% (or 70%) of reads.
    expect(r.stale).toBeCloseTo(20 * (0.7 * 0.3 + 0.3 * 0.7), 9);
    await split(page, false);
    expect((await measure(page)).stale).toBe(0); // a sloppy quorum is consistent while nothing fails
    // W = 3, R = 1: no side can write, every side can read.
    await set(page, { mode: 'strict', w: '3', r: '1' });
    await split(page);
    r = await measure(page);
    expect(r.fail).toBeCloseTo(10, 9); // the writes, 10% of requests
    expect(r.stale).toBe(0);
  });

  test('levels without a key-value store ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    const r = await page.evaluate(() => { const m = window.__sdl.model(); return { stale: m.kvStalePct, fail: m.kvFailPct, cost: m.cost }; });
    expect(r.stale).toBeNull();
    expect(r.fail).toBeNull();
    expect(r.cost).toBe(1291);
  });
});

test.describe('Level 12 · teaching feedback', () => {
  test('W + R not more than N: the log explains the old values', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    await goTo(page, 0);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('13.3% of reads return an old value: W + R = 2, not more than N = 3');
    await expect(page.locator('#goals li', { hasText: 'No read returns an old seat map' })).toHaveClass(/fail/);
  });

  test('a sloppy quorum sells seats twice in a partition; a strict one fails instead', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    await goTo(page, 0);
    await set(page, { w: '2', r: '2', mode: 'sloppy' });
    await page.click('#playBtn');
    await page.click('#exp-partition');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission].partition)).toBe(false);
    await expect(page.locator('#log')).toContainText('8.4% of reads return an old seat map');
    await expect(page.locator('#log')).toContainText('Keep W + R > N with a strict quorum');
  });

  test('carts with a strict quorum fail on the cut-off side, and the log says to go sloppy', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    await goTo(page, 1);
    await set(page, { w: '2', r: '1' });
    await page.click('#playBtn');
    await page.click('#exp-partition');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('fail on the cut-off side');
    await expect(page.locator('#log')).toContainText('Use a sloppy quorum');
    // W = 1 would keep carts up, but a change must be on 2 replicas.
    await set(page, { w: '1' });
    await page.click('#exp-partition');
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'confirmed by at least 2 replicas' })).toHaveClass(/fail/);
  });

  test('a sloppy quorum with W + R > N: the log blames the partition, not W + R', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    await goTo(page, 1);
    await set(page, { w: '2', r: '2', mode: 'sloppy' });
    await page.click('#exp-partition');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('8.4% of reads return an old value: in the partition both sides keep answering');
    expect(await logText(page)).not.toContain('not more than N');
  });

  test('W = 3 with a strict quorum: the log says writes fail on both sides', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    await goTo(page, 2);
    await set(page, { w: '3', r: '1' });
    await page.click('#exp-partition');
    await fastForward(page, 2);
    // The larger side has 2 of the 3 replicas, so no side can write; the 5% of requests that are writes fail.
    await expect(page.locator('#log')).toContainText('5% of requests fail (strict quorum). Writes fail on both sides: neither has 3 replicas.');
    expect(await logText(page)).not.toContain('cut-off side');
  });

  test('the inspector shows the waits, old values and failures', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    await goTo(page, 0);
    await set(page, { w: '2', r: '2' });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await select(page, 'k');
    await expect(page.locator('#inspLive')).toContainText('a read waits for 2 of 3 replicas, a write for 2');
    await expect(page.locator('#inspLive')).toContainText('0.0%');
    await page.click('#exp-partition');
    await fastForward(page, 1);
    await expect(page.locator('#inspLive')).toContainText('no quorum on their side of the partition');
  });

  test('store settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    await set(page, { n: '5', w: '3', r: '4', mode: 'sloppy' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = window.__sdl.S.nodes.find((x) => x.id === 'k'); return [n.n, n.w, n.r, n.mode]; });
    expect(await get()).toEqual(['5', '3', '4', 'sloppy']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level12-v1'));
      Object.assign(saved.nodes.find((n) => n.id === 'k'), { n: '4', w: '9', r: 'x', mode: 'eventual' });
      localStorage.setItem('sdl-level12-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['3', '1', '1', 'strict']);
  });

  test('the estimate accepts 2 and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    for (const [v, hint] of [['1', 'hasn\'t reached yet'], ['3', 'waits for the slowest']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', 'R = 2');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });

  test('the lesson diagrams are drawn', async ({ page }) => {
    await freshPage(page, '#level-12/lesson');
    await expect(page.locator('#figQuorum')).toContainText('Replica c');
    await expect(page.locator('#figPartition')).toContainText('partition');
  });
});

test.describe('Level 12 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    await page.focus('#estIn');
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
    await enter('[data-node="k"]');
    await enter('#insp [data-focus-key="w-3"]');
    await enter('#insp [data-focus-key="r-1"]');
    await enter('#playBtn');
    await fastForward(page, 5);
    await enter('#exp-partition');
    await fastForward(page, 2);
    await enter('#exp-partition');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-12/build');
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    await select(page, 'k');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-12/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-12/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            await page.evaluate(() => { window.__sdl.S.est = true; window.__sdl.afterChange(true); });
            await page.click('#playBtn'); await playFor(page, 0.5);
            await select(page, 'k');
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
