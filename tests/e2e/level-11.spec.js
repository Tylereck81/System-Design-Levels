import { test, expect } from '../fixtures.js';
import { registerCommonTests } from '../shared-checks.js';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors, sampleRoutes, openMission, selectNode, setProps, calm, pressEnterOn } from '../helpers.js';

// Level 11: Consistent hashing.
// The level starts inside one data center: Users ('u'), DNS ('d'), one load balancer ('l'), two autoscaled groups of
// L web servers ('w1', 'w2'), a cache cluster of five L servers placed by hash % 5 ('k') and an L database ('b').
// Every page reads one profile; 5% are edits.

const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model(), k = m.node.k || {}, b = m.node.b || {};
  return { served: m.servedPct, latency: m.latency, cost: m.cost, moved: m.ringMoved, spread: m.ringSpread, hit: k.hit, db: b.load, spof: m.spof, servers: (k.servers || []).map((x) => x.name).join('') };
});
/** Run a Break-it experiment's resize without the clock: the model right after the move. */
const during = (page, id) => page.evaluate((e) => { window.__sdl.run.on = { [e]: {} }; }, id);

// The cache's hit rate with every key in memory: profiles stay an hour and are read about once a minute each.
const FRESH = 3600 / 3660;
const A = Math.log(0.8) / Math.log(0.2);

test.describe('Level 11 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-11/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 11 / 21');

    // Mission 1: estimate, then a hash ring (through the inspector), then server C fails.
    await page.fill('#estIn', '80');
    await page.click('#estBtn');
    await selectNode(page, 'k');
    await page.locator('#insp [data-focus-key="hashing-ring"]').click();
    await expect(page.locator('[data-node="k"] .node-sub')).toHaveText('5 × 8 GB · ring');
    expect((await measure(page)).cost).toBe(1291);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-lose-c');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('only 9.4% of the keys moved');
    await page.click('#exp-lose-c');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);

    // Mission 2: 500 virtual nodes, then a server joins.
    await page.click('#mission .complete button');
    await selectNode(page, 'k');
    await page.locator('#insp [data-focus-key="hashing-v500"]').click();
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-add-server');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('the new server took 16.0% of the keys');
    await page.click('#exp-add-server');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);

    // Mission 3: ten M servers instead of five L, then C fails during the sale.
    await page.click('#mission .complete button');
    await selectNode(page, 'k');
    await page.locator('#insp [data-focus-key="count-10"]').click();
    await page.locator('#insp [data-focus-key="size-M"]').click();
    expect((await measure(page)).cost).toBe(1659);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-lose-c');
    await fastForward(page, 2);
    await page.click('#exp-lose-c');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 11 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 11 · numbers', () => {
  test('hash % N: even, all keys held; losing C moves 80%, adding a server 5/6', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    await calm(page);
    let r = await measure(page);
    expect(r.cost).toBe(1291);
    expect(r.spread).toBeCloseTo(0, 9);
    expect(r.moved).toBe(0);
    expect(r.hit).toBeCloseTo(FRESH, 9); // 5 × 8 GB holds the whole 40 GB catalog
    expect(r.db).toBeCloseTo(100 + 1900 * (1 - FRESH), 6); // edits + misses
    expect(r.spof).toBe(2); // the load balancer and the database; a cluster of five is not one
    await during(page, 'lose-c');
    r = await measure(page);
    expect(r.servers).toBe('ABDE');
    expect(r.moved).toBeCloseTo(0.8, 9);
    // Four servers hold 32 of 40 GB (80/20 rule), and 80% of the keys just moved.
    expect(r.hit).toBeCloseTo(Math.pow(0.8, A) * FRESH * 0.2, 9);
    expect(r.served).toBeLessThan(99);
    await during(page, 'add-server');
    r = await measure(page);
    expect(r.servers).toBe('ABCDEF');
    expect(r.moved).toBeCloseTo(5 / 6, 9);
  });

  test('ring shares and moved keys come from the hash', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    await calm(page);
    const cases = [
      // hashing, spread now, moved when C fails, moved when F joins, spread after F joins
      ['ring', 2.059, 0.094, 0.266, 1.075],
      ['v10', 0.284, 0.181, 0.151, 0.251],
      ['v100', 0.163, 0.233, 0.160, 0.084],
      ['v500', 0.044, 0.203, 0.160, 0.044],
    ];
    for (const [hashing, spread, lose, add, after] of cases) {
      await setProps(page, 'k', { hashing });
      await page.evaluate(() => { window.__sdl.run.on = {}; });
      expect([hashing, (await measure(page)).spread]).toEqual([hashing, expect.closeTo(spread, 3)]);
      await during(page, 'lose-c');
      expect([hashing, (await measure(page)).moved]).toEqual([hashing, expect.closeTo(lose, 3)]);
      await during(page, 'add-server');
      const r = await measure(page);
      expect([hashing, r.moved, r.spread]).toEqual([hashing, expect.closeTo(add, 3), expect.closeTo(after, 3)]);
    }
    // The Mission 1 takeaway names E's share of a one-point ring: (1 + spread) / 5.
    const source = await (await page.request.get('/levels/level-11.js')).text();
    expect(source).toContain(`E owns ${Math.round(100 * (1 + cases[0][1]) / 5)}% of the ring`);
    // One point per server: E holds 61% of the keys but has a fifth of the memory, so it keeps fewer of them.
    await setProps(page, 'k', { hashing: 'ring' });
    await page.evaluate(() => { window.__sdl.run.on = {}; });
    const r = await measure(page);
    expect(r.hit).toBeLessThan(0.9);
    expect(r.db).toBeGreaterThan(2 * (100 + 1900 * (1 - FRESH)));
  });

  test('the sale: five L servers lose too many keys at once; ten M servers, same memory and cost, do not', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    await openMission(page, 2, { estimate: true });
    await setProps(page, 'k', { hashing: 'v500' });
    await calm(page);
    expect((await measure(page)).served).toBeCloseTo(100, 6);
    await during(page, 'lose-c');
    let r = await measure(page);
    expect(r.served).toBeLessThan(99);
    expect(r.db).toBeGreaterThan(800);
    await setProps(page, 'k', { count: '10', size: 'M' });
    await page.evaluate(() => { window.__sdl.run.on = {}; });
    r = await measure(page);
    expect(r.cost).toBe(1659);
    expect(r.spread).toBeLessThan(0.1);
    await during(page, 'lose-c');
    r = await measure(page);
    expect(r.moved).toBeCloseTo(0.105, 3);
    expect(r.served).toBeCloseTo(100, 6);
    // Eight L servers survive too, but cost more than the sale's budget.
    await setProps(page, 'k', { count: '8', size: 'L' });
    await page.evaluate(() => { window.__sdl.run.on = {}; });
    expect((await measure(page)).cost).toBeGreaterThan(1700);
  });

  test('levels without a cache cluster ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    const r = await page.evaluate(() => { const m = window.__sdl.model(); return { moved: m.ringMoved, spread: m.ringSpread, cost: m.cost }; });
    expect(r.moved).toBeNull();
    expect(r.spread).toBeNull();
    expect(r.cost).toBe(2283);
  });
});

test.describe('Level 11 · teaching feedback', () => {
  test('losing C under hash % N: the log says how many keys moved and what to do', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    await openMission(page, 0, { estimate: true });
    await page.click('#playBtn');
    await page.click('#exp-lose-c');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['lose-c'])).toBe(false);
    await expect(page.locator('#log')).toContainText('80.0% of the keys moved to another server');
    await expect(page.locator('#log')).toContainText('Set the hashing to a hash ring');
  });

  test('a ring with one point per server is uneven; the spread goal needs many virtual nodes', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    await openMission(page, 1, { estimate: true });
    const spreadGoal = page.locator('#goals li', { hasText: 'above the average' });
    for (const [hashing, ok] of [['ring', false], ['v100', false], ['v500', true]]) {
      await setProps(page, 'k', { hashing });
      await page.click('#playBtn');
      await fastForward(page, 1);
      await expect(spreadGoal).toHaveClass(ok ? /pass/ : /fail/);
      await page.click('#playBtn');
    }
    await setProps(page, 'k', { hashing: 'ring' });
    await page.click('#playBtn');
    await page.click('#exp-add-server');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('26.6% of the keys moved to another server');
  });

  test('the sale with five L servers: the log blames the database and suggests smaller servers', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    await openMission(page, 2, { estimate: true });
    await setProps(page, 'k', { hashing: 'v500' });
    await page.click('#playBtn');
    await page.click('#exp-lose-c');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('use more, smaller cache servers');
  });

  test('the inspector shows the ring, each server\'s share, and the move', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    await openMission(page, 0, { estimate: true });
    await selectNode(page, 'k');
    await expect(page.locator('#ringView')).toContainText('No ring: hash(key) % 5 picks the server.');
    await expect(page.locator('#ringView .ring-bars .row')).toHaveCount(5);
    await page.locator('#insp [data-focus-key="hashing-ring"]').click();
    await expect(page.locator('#ringView svg line.tick')).toHaveCount(5);
    await expect(page.locator('#ringView svg text.lbl')).toHaveCount(5);
    await page.locator('#insp [data-focus-key="hashing-v10"]').click();
    await expect(page.locator('#ringView svg line.tick')).toHaveCount(50);
    await page.click('#playBtn');
    await page.click('#exp-add-server');
    await expect(page.locator('#ringView .ring-bars .row')).toHaveCount(6);
    await expect(page.locator('#ringView')).toContainText('Server F joined: 15.1% of keys moved.');
    await expect(page.locator('#ringView svg line.tick.new')).toHaveCount(10);
    await expect(page.locator('#inspLive')).toContainText('hit rate');
  });

  test('request dots: hits end at the cache cluster, misses go on to the database', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    const routes = (await sampleRoutes(page, 600)).map((x) => x.route);
    const viaCache = routes.filter((r) => r.includes('k'));
    expect(viaCache.length).toBeGreaterThan(400);
    expect(routes.filter((r) => r.includes('b')).length).toBeGreaterThan(0);
  });

  test('cluster settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    await setProps(page, 'k', { count: '8', hashing: 'v100', size: 'M' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = window.__sdl.S.nodes.find((x) => x.id === 'k'); return [n.count, n.hashing, n.size]; });
    expect(await get()).toEqual(['8', 'v100', 'M']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level11-v1'));
      Object.assign(saved.nodes.find((n) => n.id === 'k'), { count: '7', hashing: 'magic' });
      localStorage.setItem('sdl-level11-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['5', 'mod', 'M']);
  });

  test('the estimate accepts 80% and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    for (const [v, hint] of [['20', 'C\'s own keys'], ['25', 'Not a quarter'], ['0.8', 'Type it as a percentage']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '80%');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });

  test('the lesson rings are drawn from the game\'s hash', async ({ page }) => {
    await freshPage(page, '#level-11/lesson');
    await expect(page.locator('#figRing rect.ic-data')).toHaveCount(4);
    await expect(page.locator('#figRing')).toContainText('user:17 → A');
    await expect(page.locator('#figRing')).toContainText('user:3311 → C');
    await expect(page.locator('#figAdd')).toContainText('user:3311 → E (was C)');
    await expect(page.locator('#figAdd path.d-arc')).toHaveCount(1);
  });
});

test.describe('Level 11 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-11/build');
    await page.focus('#estIn');
    await page.keyboard.type('80');
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
    await pressEnterOn(page, '[data-node="k"]');
    await pressEnterOn(page, '#insp [data-focus-key="hashing-v100"]');
    await pressEnterOn(page, '#playBtn');
    await fastForward(page, 5);
    await pressEnterOn(page, '#exp-lose-c');
    await fastForward(page, 2);
    await pressEnterOn(page, '#exp-lose-c');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen, inspector ring fits, no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-11/build');
    await setProps(page, 'k', { hashing: 'v500' });
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    await selectNode(page, 'k');
    await expect(page.locator('#ringView svg')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  registerCommonTests({
    level: 11,
    onTab: {
      build: async (page) => {
        await openMission(page, 0, { estimate: true });
        await setProps(page, 'k', { hashing: 'ring' });
        await page.click('#playBtn'); await playFor(page, 0.5);
        await selectNode(page, 'k');
      },
    },
  });
});
