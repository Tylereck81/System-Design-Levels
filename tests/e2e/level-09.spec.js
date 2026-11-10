import { test, expect } from '../fixtures.js';
import { registerCommonTests } from '../shared-checks.js';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors, openMission, selectNode, setProps, calm, pressEnterOn } from '../helpers.js';

// Level 9: Scale the data tier with sharding.
// The level starts inside one data center: Users ('u'), DNS ('d'), one load balancer ('l'), two autoscaled groups of
// M web servers ('w1', 'w2'), an XL primary ('b') and an XL replica ('r'). Every page makes one query; 60% are writes.

/** Replace the primary and replica with a sharded database connected from both web servers; return its id. */
const addShards = (page, props = {}) => page.evaluate((p) => {
  const s = window.__sdl;
  s.S.nodes = s.S.nodes.filter((n) => n.type !== 'db');
  s.S.edges = s.S.edges.filter((e) => !['b', 'r'].includes(e.to));
  s.addNode('shards');
  const n = s.S.nodes.at(-1); Object.assign(n, { size: 'XL', count: '3', key: 'account', hot: 'stay', ...p });
  s.tryConnect('w1', n.id); s.tryConnect('w2', n.id);
  s.afterDesignChange();
  return n.id;
}, props);
const addNoSql = (page) => page.evaluate(() => { const s = window.__sdl; s.addNode('nosql'); const id = s.S.nodes.at(-1).id; s.tryConnect('w1', id); s.tryConnect('w2', id); s.afterDesignChange(); return id; });
const measure = (page) => page.evaluate(() => {
  const s = window.__sdl, m = s.model(), z = s.S.nodes.find((n) => n.type === 'shards');
  const st = z ? m.node[z.id] || {} : {};
  return { served: m.servedPct, latency: m.latency, cost: m.cost, max: m.maxShardUtil, loads: (st.shards || []).map((x) => Math.round(x.load)), primary: (m.node.b || {}).util };
});

test.describe('Level 9 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-9/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 9 / 21');

    // Mission 1: estimate, then three XL shards by account_id (set through the inspector).
    await page.fill('#estIn', '3');
    await page.click('#estBtn');
    const z = await addShards(page, { size: 'S', count: '2', key: 'date' });
    await selectNode(page, z);
    await page.locator('#insp').getByRole('button', { name: /^3 shards/ }).click();
    await page.locator('#insp').getByRole('button', { name: /^account_id % N/ }).click();
    await page.locator('#insp [data-focus-key="size-XL"]').click();
    await expect(page.locator(`[data-node="${z}"] .node-sub`)).toHaveText('3 × XL · account');
    expect((await measure(page)).cost).toBe(2027); // DNS $5 + LB $20 + 2 autoscaled M web groups × $326 + 3 XL shards × $450
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);

    // Mission 2: a shard for each very popular account.
    await page.click('#mission .complete button');
    await selectNode(page, z);
    await page.locator('#insp').getByRole('button', { name: /^A shard for each/ }).click();
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);

    // Mission 3: plays and likes to a NoSQL store, then add a shard.
    await page.click('#mission .complete button');
    await addNoSql(page);
    await expect(page.locator('.edge-label', { hasText: 'plays, likes' })).not.toHaveCount(0);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-reshard');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('puts 75% of accounts on a different shard');
    await page.click('#exp-reshard');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 9 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 9 · numbers', () => {
  test('pinned designs match the simulation model', async ({ page }) => {
    await freshPage(page, '#level-9/build');
    await calm(page);
    // Start: 1,800 writes a second on one XL primary.
    // Web groups: 1,500 req/s each at the peak; ceil(1,500 × day share ÷ 240) M servers an hour = 87 h → 90 × 87 ÷ 24 = $326.
    let r = await measure(page);
    expect(r.primary).toBeCloseTo(1800 / 1600, 6);
    expect(r.served).toBeLessThan(80);
    // Three XL shards by account_id: 1,000 each.
    const z = await addShards(page);
    await calm(page);
    r = await measure(page);
    expect(r.loads).toEqual([1000, 1000, 1000]);
    expect(r.max).toBeCloseTo(0.625, 6);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.cost).toBe(2027); // DNS $5 + LB $20 + 2 web groups × $326 + 3 XL shards × $450
    // Keys that pile queries onto one shard, however many shards.
    for (const [props, max] of [[{ key: 'country' }, 1260 / 1600], [{ key: 'date' }, 1500 / 1600], [{ key: 'country', count: '8' }, 1260 / 1600], [{ key: 'date', count: '8' }, 1500 / 1600]]) {
      await setProps(page, z, { count: '3', ...props });
      await calm(page);
      expect((await measure(page)).max).toBeCloseTo(max, 6);
    }
  });

  test('hot accounts: more shards don\'t help, their own shards do', async ({ page }) => {
    await freshPage(page, '#level-9/build');
    await openMission(page, 1, { estimate: true });
    const z = await addShards(page);
    await calm(page);
    expect((await measure(page)).loads).toEqual([1400, 800, 800]); // 20% of 3,000 on the first shard
    await setProps(page, z, { count: '8', size: 'L' });
    await calm(page);
    let r = await measure(page);
    expect(r.loads[0]).toBe(900);
    expect(r.served).toBeLessThan(99);
    await setProps(page, z, { count: '3', size: 'XL', hot: 'own' });
    await calm(page);
    r = await measure(page);
    expect(r.loads).toEqual([800, 800, 800, 200, 200, 200]);
    expect(r.max).toBeCloseTo(0.5, 6);
    expect(r.cost).toBe(3377); // $2,027 + 3 more XL shards for hot accounts × $450
    await setProps(page, z, { count: '8', hot: 'stay' }); // brute force: eight XL shards
    expect((await measure(page)).cost).toBe(4277); // DNS $5 + LB $20 + 2 web groups × $326 + 8 XL shards × $450
    await expect(page.locator('#goals li', { hasText: 'Spend at most $3,500' })).toHaveClass(/fail/);
  });

  test('the NoSQL store takes 40% of the queries off the shards', async ({ page }) => {
    await freshPage(page, '#level-9/build');
    await openMission(page, 2, { estimate: true });
    await addShards(page, { hot: 'own' });
    await calm(page);
    expect((await measure(page)).max).toBeCloseTo(1200 / 1600, 6);
    await addNoSql(page);
    await calm(page);
    const r = await measure(page);
    expect(r.loads).toEqual([720, 720, 720, 180, 180, 180]);
    expect(r.cost).toBe(3863); // 4,500 req/s: 2,250 per web group, 125 h → $469; DNS $5 + LB $20 + 2 × $469 + 6 XL shards × $450 + NoSQL $200
  });

  test('levels without shards ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    const r = await measure(page);
    expect(r.max).toBeNull();
    expect(r.cost).toBe(1375); // Level 8 start: DNS $5 + LB $20 + 2 XL web × $450 + XL database $450
  });
});

test.describe('Level 9 · teaching feedback', () => {
  test('the log names the busiest shard', async ({ page }) => {
    await freshPage(page, '#level-9/build');
    await openMission(page, 0, { estimate: true });
    await addShards(page, { key: 'country' });
    // The first log check, by hand at t = 0: in play it can come late, when the traffic's wobble has added 2%.
    await page.evaluate(async () => { const { observe } = await import('/js/ui/log.js'); window.__sdl.run.t = 0; observe(window.__sdl.model()); });
    await expect(page.locator('#log')).toContainText('its busiest shard is 79% busy');
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'No database shard above 70% busy' })).toHaveClass(/fail/);
  });

  test('resharding from 4 to 5 moves 80% of accounts', async ({ page }) => {
    await freshPage(page, '#level-9/build');
    await openMission(page, 2, { estimate: true });
    await addShards(page, { count: '4', hot: 'own' });
    await addNoSql(page);
    await page.click('#playBtn');
    await page.click('#exp-reshard');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('going from 4 to 5 shards, account_id % 5 puts 80% of accounts');
  });

  test('the sharded database connects from the web servers only', async ({ page }) => {
    await freshPage(page, '#level-9/build');
    const z = await addShards(page);
    await page.evaluate((id) => window.__sdl.tryConnect('l', id), z);
    await expect(page.locator('#log')).toContainText('The load balancer sends requests to web servers');
    await expect(page.locator('.edge-label', { hasText: 'queries' })).not.toHaveCount(0);
  });

  test('the inspector shows each shard\'s load', async ({ page }) => {
    await freshPage(page, '#level-9/build');
    await openMission(page, 1, { estimate: true });
    const z = await addShards(page);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await selectNode(page, z);
    await expect(page.locator('#insp')).toContainText('Shard size (each shard)');
    await expect(page.locator('#inspLive')).toContainText('queries/s on each shard');
    await expect(page.locator('#inspLive')).toContainText('88%');
  });

  test('shard settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-9/build');
    const z = await addShards(page, { count: '8', key: 'date', hot: 'own' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = window.__sdl.S.nodes.find((x) => x.type === 'shards'); return [n.count, n.key, n.hot]; });
    expect(await get()).toEqual(['8', 'date', 'own']);
    await page.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem('sdl-level9-v1'));
      Object.assign(saved.nodes.find((n) => n.id === id), { count: '7', key: 'name', hot: 'maybe' });
      localStorage.setItem('sdl-level9-v1', JSON.stringify(saved));
    }, z);
    await reloadGame(page);
    expect(await get()).toEqual(['2', 'account', 'stay']);
  });

  test('the shard estimate accepts "3" and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-9/build');
    for (const [v, hint] of [['1.9', '100% busy'], ['4', 'fewer do too']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '3 shards');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });
});

test.describe('Level 9 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-9/build');
    await page.fill('#estIn', '3');
    await pressEnterOn(page, '#estBtn');
    for (const id of ['b', 'r']) { await pressEnterOn(page, `[data-node="${id}"]`); await pressEnterOn(page, '#insp [data-focus-key="remove"]'); }
    await pressEnterOn(page, '.pal-item[data-type="shards"]');
    const z = await state(page, () => window.__sdl.S.nodes.at(-1).id);
    await pressEnterOn(page, `[data-node="${z}"]`);
    await pressEnterOn(page, '#insp [data-focus-key="count-3"]');
    await pressEnterOn(page, '#insp [data-focus-key="size-XL"]');
    while (await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).count()) {
      await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
      await page.keyboard.press('Enter');
    }
    expect((await measure(page)).cost).toBe(2027); // DNS $5 + LB $20 + 2 web groups × $326 + 3 XL shards × $450
    await pressEnterOn(page, '#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  registerCommonTests({
    level: 9,
    phone: {
      setup: async (page) => {
        await addShards(page);
        await addNoSql(page);
      },
    },
    onTab: {
      build: async (page) => {
        await openMission(page, 2, { estimate: true });
        const z = await addShards(page, { hot: 'own' });
        await addNoSql(page);
        await page.click('#playBtn'); await playFor(page, 0.5);
        await selectNode(page, z);
      },
    },
  });
});
