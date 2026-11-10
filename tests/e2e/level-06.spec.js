import { test, expect } from '../fixtures.js';
import { registerCommonTests } from '../shared-checks.js';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors, sampleRoutes, openMission, selectNode, setProps, calm, pressEnterOn } from '../helpers.js';

// Level 6: Stateless web tier and autoscaling.
// The level starts with Level 5's design: a CDN ('k'), two load balancers ('l1', 'l2') using round robin, two XL web
// servers ('w1', 'w2') that keep sessions in memory, two caches, an XL primary ('b') and an XL replica ('r1').

/** Add a session store and connect both web servers to it. */
const addStore = (page) => page.evaluate(() => {
  const s = window.__sdl;
  s.addNode('session');
  const n = s.S.nodes.at(-1);
  for (const w of ['w1', 'w2']) s.tryConnect(w, n.id);
  s.afterDesignChange();
  return n.id;
});
const measure = (page) => page.evaluate(() => {
  const s = window.__sdl, m = s.model(), at = (id) => m.node[id] || {};
  const store = s.S.nodes.find((n) => n.type === 'session');
  return {
    served: m.servedPct, latency: m.latency, cost: m.cost, spof: m.spof, lost: m.lostPct,
    w1: at('w1').util, miss: at('w1').sessionMiss || 0, copies: [at('w1').copies, at('w2').copies], store: store ? at(store.id).util : null,
  };
});
// Pause and go back to t = 0, where traffic has no wobble, so numbers can be pinned exactly.
const sticky = async (page) => { await setProps(page, 'l1', { algo: 'sticky' }); await setProps(page, 'l2', { algo: 'sticky' }); };
const autoscale = async (page, size) => { await setProps(page, 'w1', { scaling: 'auto', size }); await setProps(page, 'w2', { scaling: 'auto', size }); };

test.describe('Level 6 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-6/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 6 / 21');

    // Mission 1: sticky sessions on the active load balancer, through the inspector.
    await selectNode(page, 'l1');
    await page.locator('#insp').getByRole('button', { name: /^Sticky sessions/ }).click();
    await expect(page.locator('[data-node="l1"] .node-sub')).toHaveText('Active · sticky');
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);

    // Mission 2: sticky sessions lose carts when a server leaves; a session store doesn't.
    await page.click('#mission .complete button');
    await page.click('#playBtn');
    await page.click('#exp-update-web');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('50% of shoppers had their session on the web server that left');
    await page.click('#exp-update-web');
    await addStore(page);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-update-web');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('no shopper noticed');
    await page.click('#exp-update-web');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);

    // Mission 3: estimate, autoscale both web servers as M groups (through the inspector), then run a day.
    await page.click('#mission .complete button');
    await page.fill('#estIn', '5');
    await page.click('#estBtn');
    for (const id of ['w1', 'w2']) {
      await selectNode(page, id);
      await page.locator('#insp').getByRole('button', { name: /^Autoscale/ }).click();
      await page.locator('#insp [data-focus-key="size-M"]').click();
    }
    expect((await measure(page)).cost).toBe(2758);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-run-day');
    await fastForward(page, 25);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 6 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 6 · numbers', () => {
  test('pinned designs match the simulation model', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    await calm(page);
    // Start: round robin over two servers that keep sessions in memory. Half the pages miss; files are fine.
    let r = await measure(page);
    expect(r.cost).toBe(3042);
    expect(r.miss).toBeCloseTo(0.5, 9);
    expect(r.served).toBeCloseTo(75, 6);
    // Sticky sessions: every page finds its session.
    await sticky(page);
    await calm(page);
    r = await measure(page);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.latency).toBeCloseTo(82.2, 1);
    // A session store instead: one 3 ms lookup per page (20% busy: 2,000 of 10,000/s), $150 a month.
    await setProps(page, 'l1', { algo: 'rr' }); await setProps(page, 'l2', { algo: 'rr' });
    await addStore(page);
    await calm(page);
    r = await measure(page);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.store).toBeCloseTo(0.2, 6);
    expect(r.latency).toBeCloseTo(84.3, 1);
    expect(r.cost).toBe(3192);
    expect(r.spof).toBe(0); // a managed service
  });

  test('an autoscaled group pays for the servers it runs each hour', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    await openMission(page, 2, { estimate: true });
    await addStore(page);
    // M: 1,000 pages a second per group at the peak, 240 per server: 5 servers, 50% busy.
    await autoscale(page, 'M');
    await calm(page);
    const r = await measure(page);
    expect(r.copies).toEqual([5, 5]);
    expect(r.w1).toBeCloseTo(0.5, 3);
    expect(r.cost).toBe(2758);
    for (const [size, cost] of [['S', 2668], ['L', 2958], ['XL', 3230]]) {
      await autoscale(page, size);
      expect((await measure(page)).cost).toBe(cost);
    }
    // Fixed servers: two XL are over budget; L + XL with weighted routing too.
    await setProps(page, 'w1', { scaling: 'fixed', size: 'XL' }); await setProps(page, 'w2', { scaling: 'fixed', size: 'XL' });
    expect((await measure(page)).cost).toBe(3192);
    await setProps(page, 'w1', { size: 'L' }); await setProps(page, 'l1', { algo: 'wrr' });
    expect((await measure(page)).cost).toBe(2942);
    await expect(page.locator('#goals')).toContainText('$2,942');
  });

  test('levels without sessions ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    const r = await measure(page);
    expect(r.miss).toBe(0);
    expect(r.lost).toBe(0);
    expect(r.cost).toBe(2005);
  });
});

test.describe('Level 6 · teaching feedback', () => {
  test('round robin over servers that keep sessions: the log says why pages fail', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('50% of pages reaching the web server fail');
    await setProps(page, 'l1', { algo: 'wrr' }); // weighted routing doesn't help: the session is still on one server
    await calm(page);
    expect((await measure(page)).served).toBeCloseTo(75, 6);
    // One web server finds every session, but can't carry the traffic.
    await page.evaluate(() => { window.__sdl.S.nodes = window.__sdl.S.nodes.filter((n) => n.id !== 'w2'); window.__sdl.afterDesignChange(); });
    await calm(page);
    const r = await measure(page);
    expect(r.miss).toBe(0);
    expect(r.served).toBeLessThan(99);
  });

  test('the update loses half the carts with sticky sessions, none with a session store', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    await openMission(page, 1, { estimate: true });
    await sticky(page);
    await page.click('#playBtn');
    await page.click('#exp-update-web');
    await expect(page.locator('#hud')).toContainText('2,160'); // the day curve at 10:00
    await expect(page.locator('#hud')).toContainText('at 10:00');
    await expect(page.locator('#log')).toContainText('Traffic is 2,160 req/s.');
    await calm(page);
    let r = await measure(page);
    expect(r.lost).toBeCloseTo(50, 6);
    expect(r.served).toBeCloseTo(100, 6);
    await page.click('#playBtn');
    await fastForward(page, 3);
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['update-web'])).toBe(false);
    await addStore(page);
    await calm(page);
    r = await measure(page);
    expect(r.lost).toBe(0);
    expect(r.w1).toBe(0);
    expect(r.served).toBeCloseTo(100, 6);
  });

  test('a day with sticky sessions logs shoppers out when the groups shrink', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    await openMission(page, 2, { estimate: true });
    await sticky(page);
    await autoscale(page, 'M');
    expect((await measure(page)).cost).toBe(2608); // in budget, and fine at the peak
    await page.click('#playBtn');
    await page.click('#exp-run-day');
    await fastForward(page, 25);
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['run-day'])).toBe(false);
    await expect(page.locator('#log')).toContainText('The day is over, but it does not count. At 00:00: The autoscaler removed servers that held carts in memory: 33% of shoppers');
    await expect(page.locator('#exp-run-day')).toHaveText('Run a day');
  });

  test('during a day, traffic and each group follow the hour', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    await openMission(page, 2, { estimate: true });
    await addStore(page);
    await autoscale(page, 'M');
    // Pause and set the day's clock directly, so real time passing in the browser can't move it.
    const at = (h) => page.evaluate((x) => { const s = window.__sdl; s.run.playing = false; s.run.on['run-day'].t = x; s.afterChange(); }, h);
    await page.click('#exp-run-day'); // starts Play too
    await at(4.5); // 04:00: 15% of the peak
    await expect(page.locator('#hud')).toContainText('at 04:00');
    expect(await state(page, () => Math.round(window.__sdl.model().base))).toBe(600);
    expect((await measure(page)).copies).toEqual([1, 1]);
    await expect(page.locator('[data-node="w1"] .node-sub')).toHaveText('M · auto, ×1 now');
    await at(20.5); // 20:00, the peak
    expect((await measure(page)).copies).toEqual([5, 5]);
    await page.click('#exp-run-day'); // stopping early doesn't count
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['run-day'])).toBe(false);
  });

  test('a fixed server cannot follow the day: the bill stays at the peak', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    await openMission(page, 2, { estimate: true });
    await addStore(page);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'Spend at most $2,900' })).toHaveClass(/fail/);
  });

  test('the session store connects from the web servers only', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    const id = await addStore(page);
    await expect(page.locator('.edge-label', { hasText: 'sessions' })).not.toHaveCount(0);
    await page.evaluate((i) => window.__sdl.tryConnect('l1', i), id);
    await expect(page.locator('#log')).toContainText('The load balancer does not read sessions');
    expect(await state(page, () => window.__sdl.S.edges.filter((e) => e.from === 'l1').length)).toBe(2);
  });

  test('request dots: some pages read the store; without it, some fail at a web server', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    let routes = await sampleRoutes(page, 600);
    const pages = routes.filter((r) => r.route[1] === 'l1');
    const atWeb = pages.filter((r) => ['w1', 'w2'].includes(r.route[r.failAt]));
    expect(atWeb.length).toBeGreaterThan(pages.length * 0.35);
    const id = await addStore(page);
    routes = await sampleRoutes(page, 600);
    const viaStore = routes.filter((r) => r.route.includes(id));
    expect(viaStore.length).toBeGreaterThan(80);
    expect(viaStore.every((r) => r.failAt < 0 && !r.route.some((x) => ['b', 'r1', 'c1', 'c2'].includes(x)))).toBe(true);
    expect(routes.some((r) => r.route.includes('c1') || r.route.includes('b'))).toBe(true);
  });

  test('the inspector explains state, autoscaling and the store', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    await selectNode(page, 'w1');
    await expect(page.locator('#insp')).toContainText('it is stateful');
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#inspLive')).toContainText('land here without their session');
    await page.click('#playBtn');
    await addStore(page);
    await setProps(page, 'w1', { scaling: 'auto', size: 'M' });
    await selectNode(page, 'w1');
    await expect(page.locator('#insp')).not.toContainText('it is stateful');
    await page.evaluate(() => { window.__sdl.run.everPlayed = false; });
    await selectNode(page, 'w1');
    await expect(page.locator('#inspLive')).toContainText('1 to 5');
    await expect(page.locator('#inspLive')).toContainText('servers over a day');
    await expect(page.locator('[data-node="w1"] .node-sub')).toHaveText('M · autoscaled');
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#inspLive')).toContainText('5 servers now');
  });

  test('scaling and sticky settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    await sticky(page);
    await setProps(page, 'w1', { scaling: 'auto' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = (id) => window.__sdl.S.nodes.find((x) => x.id === id); return [n('l1').algo, n('w1').scaling, n('w2').scaling]; });
    expect(await get()).toEqual(['sticky', 'auto', 'fixed']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level6-v1'));
      Object.assign(saved.nodes.find((n) => n.id === 'l1'), { algo: 'magnet' });
      Object.assign(saved.nodes.find((n) => n.id === 'w1'), { scaling: 'sometimes' });
      localStorage.setItem('sdl-level6-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['rr', 'fixed', 'fixed']);
  });

  test('the server estimate accepts "5" and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    await openMission(page, 2, { estimate: true });
    await page.evaluate(() => { window.__sdl.S.est = false; window.__sdl.afterChange(true); });
    for (const [v, hint] of [['2.5', '100% busy'], ['9', 'both groups'], ['4', 'Round up']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '5 servers');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });
});

test.describe('Level 6 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    await pressEnterOn(page, '.pal-item[data-type="session"]');
    const id = await state(page, () => window.__sdl.S.nodes.find((n) => n.type === 'session').id);
    await pressEnterOn(page, `[data-node="${id}"]`);
    while (await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).count()) {
      await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
      await page.keyboard.press('Enter');
    }
    expect((await measure(page)).cost).toBe(3192);
    await pressEnterOn(page, '#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  registerCommonTests({
    level: 6,
    phone: { title: 'with the session store', setup: (page) => addStore(page) },
    onTab: {
      build: async (page) => {
        await openMission(page, 2, { estimate: true });
        await addStore(page);
        await setProps(page, 'w1', { scaling: 'auto', size: 'M' });
        await page.click('#playBtn'); await playFor(page, 0.5);
        await selectNode(page, 'w1');
      },
    },
  });
});
