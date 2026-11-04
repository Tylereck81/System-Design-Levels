import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, state, logText, reloadGame, trackErrors } from './helpers.js';

// Level 10: Rate limiter.
// The level starts inside one data center: Users ('u'), DNS ('d'), one load balancer ('l'), two autoscaled groups of
// M API servers ('w1', 'w2') and a search index of 3 XL shards ('z'). Real apps send 2,000 req/s; bot keys flood.

/** Put a rate limiter between Users and the load balancer; return its id. */
const addLimiter = (page, props = {}) => page.evaluate((p) => {
  const s = window.__sdl;
  s.S.edges = s.S.edges.filter((e) => !(e.from === 'u' && e.to === 'l'));
  s.addNode('limiter');
  const n = s.S.nodes.at(-1); Object.assign(n, p);
  s.tryConnect('u', n.id); s.tryConnect(n.id, 'l');
  s.afterDesignChange();
  return n.id;
}, props);
const addCounters = (page, ids) => page.evaluate((list) => { const s = window.__sdl; s.addNode('counter'); const c = s.S.nodes.at(-1).id; for (const i of list) s.tryConnect(i, c); s.afterDesignChange(); return c; }, ids);
const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; S.est = true; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model();
  return { served: m.servedPct, latency: m.latency, cost: m.cost, quota: m.keyQuota, botThrough: m.botThrough, index: (m.node.z || {}).util };
});
const calm = (page) => page.evaluate(() => { const s = window.__sdl; s.run.playing = false; s.run.t = 0; });
const select = async (page, id) => { await page.focus(`[data-node="${id}"]`); await page.keyboard.press('Enter'); };
const set = (page, id, props) => page.evaluate(([i, p]) => { Object.assign(window.__sdl.S.nodes.find((n) => n.id === i), p); window.__sdl.afterDesignChange(); }, [id, props]);

test.describe('Level 10 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-10/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 10 / 21');

    // Mission 1: a rate limiter with a bucket of 12 (set through the inspector).
    const r1 = await addLimiter(page);
    await select(page, r1);
    await page.locator('#insp [data-focus-key="bucket-12"]').click();
    await expect(page.locator(`[data-node="${r1}"] .node-sub`)).toHaveText('token bucket · 12, 1/s');
    expect((await measure(page)).cost).toBe(1955);
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);

    // Mission 2: a sliding window counter, then the edge burst.
    await page.click('#mission .complete button');
    await select(page, r1);
    await page.locator('#insp').getByRole('button', { name: /^Sliding window counter/ }).click();
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-edge-burst');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('no key got more than 60 requests');
    await page.click('#exp-edge-burst');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);

    // Mission 3: estimate, a second limiter and shared counters.
    await page.click('#mission .complete button');
    await page.fill('#estIn', '2');
    await page.click('#estBtn');
    const r2 = await page.evaluate(() => { const s = window.__sdl; s.addNode('limiter'); const n = s.S.nodes.at(-1); n.algo = 'scount'; s.tryConnect('u', n.id); s.tryConnect(n.id, 'l'); s.afterDesignChange(); return n.id; });
    await addCounters(page, [r1, r2]);
    await expect(page.locator('.edge-label', { hasText: 'counters' })).not.toHaveCount(0);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-edge-burst');
    await fastForward(page, 2);
    await page.click('#exp-edge-burst');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 10 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 10 · numbers', () => {
  test('pinned designs match the simulation model', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    await calm(page);
    // Start: 2,000 real + 2,400 bot requests a second reach the index: 4,400 over 3 XL shards.
    let r = await measure(page);
    expect(r.index).toBeCloseTo(4400 / 3 / 1600, 6);
    expect(r.latency).toBeGreaterThan(150);
    expect(r.cost).toBe(2283);
    // A token bucket of 4, refilled 1 a second: a typed search (12 in 2 s) loses 12 − 4 − 2 = 6 of 12.
    const id = await addLimiter(page);
    await calm(page);
    r = await measure(page);
    expect(r.served).toBeCloseTo(50, 6);
    expect(r.botThrough).toBeCloseTo(160, 6); // 160 keys × 1 a second
    // A bucket of 12 fits the burst. Bots no longer cost API servers.
    await set(page, id, { bucket: '12' });
    await calm(page);
    r = await measure(page);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.quota).toBe(1);
    expect(r.cost).toBe(1955);
    // Refilling 5 a second lets each key through 5 times the limit.
    await set(page, id, { refill: '5' });
    await calm(page);
    r = await measure(page);
    expect(r.quota).toBe(5);
    expect(r.botThrough).toBeCloseTo(800, 6);
  });

  test('the leaking bucket makes typed searches wait', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    await goTo(page, 0);
    await addLimiter(page, { algo: 'leaky', bucket: '12' });
    await calm(page);
    expect((await measure(page)).latency).toBeGreaterThan(5000); // 12 requests at 1 a second: 5 s on average
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('in the leaking bucket\'s queue');
  });

  test('levels without bots ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-9/build');
    const r = await measure(page);
    expect(r.quota).toBeNull();
    expect(r.botThrough).toBe(0);
    expect(r.cost).toBe(1577);
  });
});

test.describe('Level 10 · teaching feedback', () => {
  test('a small bucket blocks real users, and the log says why', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    await addLimiter(page);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('rejects 50% of real users\' requests');
  });

  test('at the window edge: fixed window 2×, token bucket of 12 1.2×, sliding windows 1×', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    await goTo(page, 1);
    const id = await addLimiter(page, { bucket: '12' });
    await page.click('#playBtn');
    await page.click('#exp-edge-burst');
    for (const [props, quota] of [[{ algo: 'token' }, 1.2], [{ algo: 'fixed' }, 2], [{ algo: 'slog' }, 1], [{ algo: 'scount' }, 1], [{ algo: 'token', bucket: '60' }, 2]]) {
      await set(page, id, props);
      await calm(page);
      const r = await measure(page);
      expect([props.algo, r.quota]).toEqual([props.algo, quota]);
      expect(r.cost).toBe(1955); // the bill follows normal days, not the experiment
    }
    await set(page, id, { algo: 'fixed', bucket: '12' });
    await page.click('#playBtn');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['edge-burst'])).toBe(false);
    await expect(page.locator('#log')).toContainText('Each key gets 120 requests a minute through, not 60.');
    await expect(page.locator('#log')).not.toContainText('counter store');
  });

  test('one limiter overloads; two without shared counters let each key through twice', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    await goTo(page, 2);
    const r1 = await addLimiter(page, { algo: 'scount' });
    await calm(page);
    let r = await measure(page);
    expect(r.served).toBeLessThan(60); // 10,800 requests a second on a limiter that checks 6,000
    const r2 = await page.evaluate(() => { const s = window.__sdl; s.addNode('limiter'); const n = s.S.nodes.at(-1); n.algo = 'scount'; s.tryConnect('u', n.id); s.tryConnect(n.id, 'l'); s.afterDesignChange(); return n.id; });
    await calm(page);
    r = await measure(page);
    expect(r.quota).toBe(2);
    expect(r.botThrough).toBeCloseTo(800, 6);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('connect them all to a counter store');
    await addCounters(page, [r1, r2]);
    await calm(page);
    r = await measure(page);
    expect(r.quota).toBe(1);
    expect(r.botThrough).toBeCloseTo(400, 6);
    expect(r.cost).toBe(2167);
  });

  test('the limiter connects from Users to the load balancer only', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    const id = await addLimiter(page);
    await page.evaluate((i) => window.__sdl.tryConnect(i, 'w1'), id);
    await expect(page.locator('#log')).toContainText('Connect it to the load balancer');
    await expect(page.locator('.edge-label', { hasText: 'allowed' })).not.toHaveCount(0);
  });

  test('request dots: bots are stopped at the limiter, real requests go on', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    const id = await addLimiter(page, { bucket: '12' });
    const routes = await page.evaluate(() => { const s = window.__sdl, m = s.model(); return Array.from({ length: 800 }, () => s.sampleRoute(m)); });
    const stopped = routes.filter((r) => r.route[r.failAt] === id);
    expect(stopped.length).toBeGreaterThan(200);
    expect(routes.filter((r) => r.failAt < 0 && r.route.includes('z')).length).toBeGreaterThan(200);
  });

  test('the inspector shows bots let through and real users blocked', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    const id = await addLimiter(page);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await select(page, id);
    await expect(page.locator('#inspLive')).toContainText('bot requests/s arriving → let through');
    await expect(page.locator('#inspLive')).toContainText('of real users\' requests rejected');
  });

  test('limiter settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    const id = await addLimiter(page, { algo: 'slog', bucket: '60', refill: '5' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = window.__sdl.S.nodes.find((x) => x.type === 'limiter'); return [n.algo, n.bucket, n.refill]; });
    expect(await get()).toEqual(['slog', '60', '5']);
    await page.evaluate((i) => {
      const saved = JSON.parse(localStorage.getItem('sdl-level10-v1'));
      Object.assign(saved.nodes.find((n) => n.id === i), { algo: 'magic', bucket: '7', refill: '0' });
      localStorage.setItem('sdl-level10-v1', JSON.stringify(saved));
    }, id);
    await reloadGame(page);
    expect(await get()).toEqual(['token', '4', '1']);
  });

  test('the limiter estimate accepts "2" and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    await goTo(page, 2);
    await page.evaluate(() => { window.__sdl.S.est = false; window.__sdl.afterChange(true); });
    for (const [v, hint] of [['0.33', 'real apps alone'], ['1.5', 'bots alone']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '2 limiters');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });
});

test.describe('Level 10 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-10/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    await enter('.pal-item[data-type="limiter"]');
    const id = await state(page, () => window.__sdl.S.nodes.at(-1).id);
    await enter(`[data-node="${id}"]`);
    await enter('#insp [data-focus-key="bucket-12"]');
    while (await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).count()) {
      await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
      await page.keyboard.press('Enter');
    }
    await enter('[data-node="u"]');
    await page.locator('#insp .conn', { hasText: 'Users → Load balancer' }).getByRole('button', { name: 'Disconnect' }).focus();
    await page.keyboard.press('Enter');
    expect((await measure(page)).cost).toBe(1955);
    await enter('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-10/build');
    const id = await addLimiter(page);
    await addCounters(page, [id]);
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-10/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-10/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            const id = await addLimiter(page);
            await addCounters(page, [id]);
            await page.click('#playBtn'); await page.waitForTimeout(500);
            await select(page, id);
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
