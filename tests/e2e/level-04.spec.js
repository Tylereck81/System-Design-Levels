import { test, expect } from '../fixtures.js';
import { registerCommonTests } from '../shared-checks.js';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors, sampleRoutes, openMission, selectNode, calm, pressEnterOn } from '../helpers.js';

// Level 4: cache tier.
// The level starts with two load balancers, two XL web servers, an XL primary ('b') and two XL replicas ('r1', 'r2').

/** Optionally remove replica r2, then add caches ([size, ttl, onWrite]) connected to both web servers. */
async function setup(page, { caches = [], dropReplica = true } = {}) {
  return page.evaluate(({ caches, dropReplica }) => {
    const s = window.__sdl, S = s.S, ids = [];
    if (dropReplica) { S.nodes = S.nodes.filter((n) => n.id !== 'r2'); S.edges = S.edges.filter((e) => e.to !== 'r2'); }
    for (const [size, ttl, onWrite] of caches) {
      s.addNode('cache');
      const n = S.nodes.at(-1); n.size = size; n.ttl = ttl; n.onWrite = onWrite || 'ttl'; ids.push(n.id);
      for (const w of ['w1', 'w2']) s.tryConnect(w, n.id);
    }
    s.afterDesignChange();
    return ids;
  }, { caches, dropReplica });
}
const measure = (page) => page.evaluate(() => {
  const s = window.__sdl, m = s.model();
  const dbs = s.S.nodes.filter((n) => n.type === 'db').map((n) => ({ id: n.id, role: n.role, ...(m.node[n.id] || {}) }));
  return { served: m.servedPct, latency: m.latency, cost: m.cost, spof: m.spof, hitRate: m.hitRate, staleSecs: m.staleSecs, dbs };
});
// Pause and go back to t = 0, where traffic has no wobble, so numbers can be pinned exactly.

test.describe('Level 4 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-4/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 4 / 21');

    // Mission 1: estimate the memory, drop a replica, add an 8 GB cache with a 10-minute TTL.
    await page.fill('#estIn', '4 GB');
    await page.click('#estBtn');
    const [c1] = await setup(page, { caches: [['L', '600']] });
    expect((await measure(page)).cost).toBe(1925); // start $2,295 − XL replica $450 + L cache $80
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);

    // Mission 2: a second cache, then crash one.
    await page.click('#mission .complete button');
    await setup(page, { caches: [['L', '600']], dropReplica: false });
    expect((await measure(page)).cost).toBe(2005); // $1,925 + a second L cache $80
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash-cache');
    await fastForward(page, 2);
    await page.click('#exp-crash-cache');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    expect(await logText(page)).toContain('one cache down');

    // Mission 3: delete changed products from both caches (through the inspector), then change prices.
    await page.click('#mission .complete button');
    const caches = await state(page, () => window.__sdl.S.nodes.filter((n) => n.type === 'cache').map((n) => n.id));
    expect(caches[0]).toBe(c1);
    for (const id of caches) {
      await selectNode(page, id);
      await page.locator('#insp').getByRole('button', { name: /^Delete the cached copy/ }).click();
    }
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-price-change');
    await fastForward(page, 2);
    await page.click('#exp-price-change');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 4 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 4 · numbers', () => {
  test('pinned designs match the simulation model', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await openMission(page, 0, { estimate: true });
    await calm(page);
    // Start: two XL replicas, no cache. Each gets 800 reads + 400 copied writes: 75% busy.
    let r = await measure(page);
    expect(r.cost).toBe(2295); // DNS $5 + 2 LB × $20 + 2 XL web × $450 + XL primary and 2 XL replicas 3 × $450
    expect(r.hitRate).toBeNull();
    expect(r.dbs.filter((d) => d.role === 'replica').map((d) => d.util)).toEqual([0.75, 0.75]);
    // One replica and an 8 GB cache, 10-minute TTL: hit = 0.4^0.1386 × 600/610 = 86.6%.
    await setup(page, { caches: [['L', '600']] });
    await calm(page);
    r = await measure(page);
    expect(r.hitRate).toBeCloseTo(0.8662, 3);
    expect(r.dbs.find((d) => d.role === 'replica').util).toBeCloseTo(0.384, 3); // 1,600 × 0.134 + 400 = 614 of 1,600
    expect(r.latency).toBeCloseTo(100.6, 1);
    expect(r.cost).toBe(1925); // $2,295 − XL replica $450 + L cache $80
  });

  test('hit rate follows memory and TTL; two caches hold as much as one twice the size', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    const hit = async (caches) => {
      await page.evaluate(() => { const S = window.__sdl.S; S.nodes = S.nodes.filter((n) => n.type !== 'cache'); S.edges = S.edges.filter((e) => window.__sdl.S.nodes.some((n) => n.id === e.to)); });
      await setup(page, { caches, dropReplica: false });
      return (await measure(page)).hitRate;
    };
    expect(await hit([['M', '600']])).toBeCloseTo(0.787, 3); // 4 GB holds 80% of reads; 1 in 61 expire
    expect(await hit([['L', '60']])).toBeCloseTo(0.755, 3); // 1-minute TTL: 1 in 7 expire
    expect(await hit([['M', '600'], ['M', '600']])).toBeCloseTo(0.866, 3); // = one 8 GB cache
    expect(await hit([['XL', '3600']])).toBeCloseTo(0.967, 3);
  });

  test('levels 1 to 3 have no caches: their model ignores the new rule', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    const r = await measure(page);
    expect(r.hitRate).toBeNull();
    expect(r.staleSecs).toBe(0);
  });
});

test.describe('Level 4 · teaching feedback', () => {
  test('dropping a replica without a cache overloads the one left', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await openMission(page, 0, { estimate: true });
    await setup(page);
    await calm(page);
    expect((await measure(page)).served).toBeCloseTo(84, 6); // 1,600 reads + 400 copied writes on a 1,600 replica
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('Read replica is over capacity');
  });

  test('a 4 GB cache holds the top 20% but misses the 80% goal once entries expire', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await openMission(page, 0, { estimate: true });
    await setup(page, { caches: [['M', '600']] });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals')).toContainText('78.7%');
  });

  test('the inspector shows the cache settings and its hit rate; the canvas shows memory and TTL', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await openMission(page, 0, { estimate: true });
    const [id] = await setup(page, { caches: [['L', '600']] });
    await expect(page.locator(`[data-node="${id}"] .node-sub`)).toHaveText('8 GB · TTL 10 min');
    await expect(page.locator('.edge-label', { hasText: 'lookups' })).not.toHaveCount(0);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await selectNode(page, id);
    await expect(page.locator('#inspLive')).toContainText('87%');
    await expect(page.locator('#inspLive')).toContainText('misses/s sent to the database');
    await page.locator('#insp').getByRole('button', { name: /^1 hour/ }).click();
    await expect(page.locator(`[data-node="${id}"] .node-sub`)).toHaveText('8 GB · TTL 1 h');
    await expect(page.locator('#insp').getByRole('button', { name: /^16 GB|^XL/ })).toHaveCount(1);
  });

  test('crashing the only cache sends every read to the database', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await openMission(page, 1, { estimate: true });
    await setup(page, { caches: [['L', '600']] });
    await page.click('#playBtn');
    await page.click('#exp-crash-cache');
    await calm(page);
    expect((await measure(page)).served).toBeCloseTo(84, 6);
    await page.click('#playBtn');
    await fastForward(page, 3);
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['crash-cache'])).toBe(false);
    await expect(page.locator('#log')).toContainText('Add a second cache server');
  });

  test('with two caches, losing one halves the hit rate and the replica copes', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await openMission(page, 1, { estimate: true });
    await setup(page, { caches: [['L', '600'], ['L', '600']] });
    expect((await measure(page)).spof).toBe(0);
    await page.click('#playBtn');
    await page.click('#exp-crash-cache');
    await calm(page);
    const r = await measure(page);
    expect(r.hitRate).toBeCloseTo(0.954 / 2, 3);
    expect(r.served).toBeCloseTo(100, 6);
  });

  test('a long TTL serves old prices; deleting on write keeps them fresh', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await openMission(page, 2, { estimate: true });
    const [a, b] = await setup(page, { caches: [['L', '600'], ['L', '600']] });
    expect((await measure(page)).staleSecs).toBe(600);
    await page.click('#playBtn');
    await page.click('#exp-price-change');
    await fastForward(page, 3);
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['price-change'])).toBe(false);
    await expect(page.locator('#log')).toContainText('old price for up to 10 minutes');
    // A 1-minute TTL is fresh enough but caps the hit rate at 60 ÷ 70, below 86%.
    await page.evaluate((ids) => { for (const id of ids) window.__sdl.S.nodes.find((n) => n.id === id).ttl = '60'; }, [a, b]);
    let r = await measure(page);
    expect(r.staleSecs).toBe(60);
    expect(r.hitRate).toBeLessThan(0.86);
    await page.evaluate((ids) => { for (const id of ids) Object.assign(window.__sdl.S.nodes.find((n) => n.id === id), { ttl: '600', onWrite: 'delete' }); }, [a, b]);
    r = await measure(page);
    expect(r.staleSecs).toBe(0);
    expect(r.hitRate).toBeGreaterThan(0.85);
  });

  test('request dots: hits end at the cache, misses and writes go to the database', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await openMission(page, 0, { estimate: true });
    const [c] = await setup(page, { caches: [['L', '600']] });
    const routes = (await sampleRoutes(page, 400)).map((x) => x.route);
    const atCache = routes.filter((r) => r.includes(c));
    expect(atCache.length).toBeGreaterThan(200);
    expect(atCache.every((r) => !r.some((id) => ['b', 'r1'].includes(id)))).toBe(true);
    expect(routes.some((r) => r.includes('b'))).toBe(true);
  });

  test('cache settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await setup(page, { caches: [['L', '3600', 'delete']] });
    await reloadGame(page);
    expect(await state(page, () => { const n = window.__sdl.S.nodes.find((x) => x.type === 'cache'); return [n.size, n.ttl, n.onWrite]; })).toEqual(['L', '3600', 'delete']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level4-v1'));
      Object.assign(saved.nodes.find((n) => n.type === 'cache'), { ttl: '5', onWrite: 'never' });
      localStorage.setItem('sdl-level4-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await state(page, () => { const n = window.__sdl.S.nodes.find((x) => x.type === 'cache'); return [n.ttl, n.onWrite]; })).toEqual(['60', 'ttl']);
  });

  test('the memory estimate shows the traffic, accepts "4 GB" and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await expect(page.locator('#hud')).toContainText('2,000');
    await page.fill('#estIn', '20');
    await page.click('#estBtn');
    await expect(page.locator('#estFb')).toContainText('whole catalog');
    await page.fill('#estIn', '4,000');
    await page.click('#estBtn');
    await expect(page.locator('#estFb')).toContainText('megabytes');
    await page.fill('#estIn', '0.4');
    await page.click('#estBtn');
    await expect(page.locator('#estFb')).toContainText('Check the units');
    await page.fill('#estIn', '4 GB');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });
});

test.describe('Level 4 · fixes from QA', () => {
  test('Mission 3: a 1-minute TTL with lots of memory falls short of 86%; delete-on-change passes', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await openMission(page, 2, { estimate: true });
    const ids = await setup(page, { caches: [['L', '60', 'ttl'], ['L', '60', 'ttl'], ['L', '60', 'ttl']] });
    await calm(page);
    const r = await measure(page);
    expect(r.hitRate).toBeCloseTo(60 / 70, 3); // memory holds every read; the TTL alone caps it
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'hit rate' }).first()).toHaveClass(/fail/);
    await page.evaluate((list) => {
      const s = window.__sdl;
      s.S.nodes = s.S.nodes.filter((n) => n.id !== list[2]); s.S.edges = s.S.edges.filter((e) => e.to !== list[2]);
      for (const id of list.slice(0, 2)) Object.assign(s.S.nodes.find((n) => n.id === id), { ttl: '600', onWrite: 'delete' });
      s.afterDesignChange();
    }, ids);
    expect((await measure(page)).hitRate).toBeGreaterThan(0.86);
    await fastForward(page, 5);
    await page.click('#exp-price-change');
    await fastForward(page, 2);
    await page.click('#exp-price-change');
    expect(await state(page, () => window.__sdl.S.done[2])).toBe(true);
  });
});

test.describe('Level 4 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    await page.fill('#estIn', '4');
    await pressEnterOn(page, '#estBtn');
    await pressEnterOn(page, '[data-node="r2"]');
    await pressEnterOn(page, '#insp [data-focus-key="remove"]');
    await pressEnterOn(page, '.pal-item[data-type="cache"]');
    const id = await state(page, () => window.__sdl.S.nodes.find((n) => n.type === 'cache').id);
    await pressEnterOn(page, `[data-node="${id}"]`);
    await pressEnterOn(page, '#insp [data-focus-key="size-L"]');
    await pressEnterOn(page, '#insp [data-focus-key="ttl-600"]');
    while (await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).count()) {
      await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
      await page.keyboard.press('Enter');
    }
    expect((await measure(page)).cost).toBe(1925); // start $2,295 − XL replica $450 + L cache $80
    await pressEnterOn(page, '#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  registerCommonTests({
    level: 4,
    phone: { title: 'with three caches', setup: (page) => setup(page, { caches: [['L', '600'], ['L', '600'], ['M', '600']], dropReplica: false }) },
    onTab: {
      build: async (page) => {
        await openMission(page, 0, { estimate: true });
        const [id] = await setup(page, { caches: [['L', '600'], ['L', '600']] });
        await page.click('#playBtn'); await playFor(page, 0.5);
        await selectNode(page, id);
      },
    },
  });
});
