import { test, expect } from '../fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors } from '../helpers.js';

// Level 5: CDN for static content.
// The level starts with Level 4's design: two load balancers ('l1', 'l2'), two XL web servers ('w1', 'w2'),
// two 8 GB caches, an XL primary ('b') and an XL replica ('r1'). Half of all requests are files; 30% of users are far away.

/** Add a CDN with the given settings, connected from Users and (unless origin is false) to both load balancers. */
async function addCdn(page, { ttl = '3600', onChange = 'ttl', fallback = 'none', origin = true, users = true } = {}) {
  return page.evaluate(({ ttl, onChange, fallback, origin, users }) => {
    const s = window.__sdl;
    s.addNode('cdn');
    const n = s.S.nodes.at(-1); Object.assign(n, { ttl, onChange, fallback });
    if (users) s.tryConnect('u', n.id);
    if (origin) for (const l of ['l1', 'l2']) s.tryConnect(n.id, l);
    s.afterDesignChange();
    return n.id;
  }, { ttl, onChange, fallback, origin, users });
}
const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; S.est = true; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => {
  const s = window.__sdl, m = s.model(), at = (id) => m.node[id] || {};
  const cdn = s.S.nodes.find((n) => n.type === 'cdn');
  return {
    served: m.servedPct, latency: m.latency, cost: m.cost, spof: m.spof, farFileMs: m.farFileMs, fileStaleSecs: m.fileStaleSecs,
    lb: at('l1').util, web: at('w1').util, cdnHit: cdn ? at(cdn.id).hit : null, hitRate: m.hitRate,
  };
});
// Pause and go back to t = 0, where traffic has no wobble, so numbers can be pinned exactly.
const calm = (page) => page.evaluate(() => { const s = window.__sdl; s.run.playing = false; s.run.t = 0; });
const select = async (page, id) => { await page.focus(`[data-node="${id}"]`); await page.keyboard.press('Enter'); };
const set = (page, id, props) => page.evaluate(([i, p]) => { Object.assign(window.__sdl.S.nodes.find((n) => n.id === i), p); window.__sdl.afterDesignChange(); }, [id, props]);

test.describe('Level 5 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-5/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 5 / 21');

    // Mission 1: estimate the data, add a CDN with a 1-hour TTL.
    await page.fill('#estIn', '52 TB');
    await page.click('#estBtn');
    const id = await addCdn(page);
    expect((await measure(page)).cost).toBe(3042);
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);

    // Mission 2: fall back to the origin (through the inspector), then take the CDN down.
    await page.click('#mission .complete button');
    await select(page, id);
    await page.locator('#insp').getByRole('button', { name: /^Load from the origin/ }).click();
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash-cdn');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('Files came from Frankfurt again');
    await page.click('#exp-crash-cdn');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);

    // Mission 3: give changed files a new name, then ship the logo.
    await page.click('#mission .complete button');
    await select(page, id);
    await page.locator('#insp').getByRole('button', { name: /^Give it a new name/ }).click();
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-new-logo');
    await fastForward(page, 2);
    await page.click('#exp-new-logo');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 5 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 5 · numbers', () => {
  test('pinned designs match the simulation model', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    await goTo(page, 0);
    await calm(page);
    // Start: every file comes from Frankfurt. America: 120 + 5 (load balancer, 80% busy) + 0.5 + 2 × 3.2 = 131.9 ms.
    let r = await measure(page);
    expect(r.cost).toBe(2005);
    expect(r.farFileMs).toBeCloseTo(131.9, 1);
    expect(r.lb).toBeCloseTo(0.8, 6); // 2,000 pages + 2,000 files on the active load balancer
    expect(r.web).toBeCloseTo(0.6875, 6); // (1,000 pages + 1,000 files × 0.1) of 1,600
    expect(r.served).toBeCloseTo(100, 6);
    // A CDN with a 1-hour TTL: hit = 3600 / 3630; a miss takes the same trip as before.
    await addCdn(page);
    await calm(page);
    r = await measure(page);
    expect(r.cdnHit).toBeCloseTo(3600 / 3630, 9);
    expect(r.farFileMs).toBeCloseTo(41.7, 1);
    expect(r.lb).toBeCloseTo(0.403, 3);
    expect(r.latency).toBeCloseTo(82.3, 1);
    expect(r.hitRate).toBeCloseTo(0.954, 3); // Level 4's caches still answer the page reads
    expect(r.cost).toBe(3042); // $2,005 + 51,840 GB × $0.02
  });

  test('the TTL sets the edge hit rate and the far shoppers\' wait', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    const id = await addCdn(page);
    const at = async (ttl) => { await set(page, id, { ttl }); await calm(page); return measure(page); };
    expect((await at('60')).cdnHit).toBeCloseTo(2 / 3, 9); // 1 request in 3 misses
    expect((await at('60')).farFileMs).toBeCloseTo(70.5, 1);
    expect((await at('600')).farFileMs).toBeCloseTo(45.2, 1);
    expect((await at('86400')).cdnHit).toBeGreaterThan(0.999);
  });

  test('levels without files ignore the new rule', async ({ page }) => {
    await freshPage(page, '#level-4/build');
    const r = await measure(page);
    expect(r.farFileMs).toBeNull();
    expect(r.fileStaleSecs).toBe(0);
    expect(r.cost).toBe(2295);
  });
});

test.describe('Level 5 · teaching feedback', () => {
  test('without a CDN, America waits for every file; a 1-minute TTL is still too slow', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    await goTo(page, 0);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals')).toContainText('132 ms');
    const id = await addCdn(page, { ttl: '60' });
    await fastForward(page, 1);
    await expect(page.locator('#goals')).toContainText('70 ms');
    await set(page, id, { ttl: '600' });
    await fastForward(page, 1);
    await expect(page.locator('#goals')).toContainText('45 ms');
  });

  test('a CDN with no origin holds nothing, so every file fails', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    await goTo(page, 0);
    await addCdn(page, { origin: false });
    await calm(page);
    expect((await measure(page)).served).toBeCloseTo(50, 6);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('The CDN has no origin');
  });

  test('a CDN Users do not connect to only adds cost', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    await addCdn(page, { users: false });
    await calm(page);
    const r = await measure(page);
    expect(r.farFileMs).toBeCloseTo(131.9, 1);
    expect(r.cost).toBe(3042);
  });

  test('the CDN connects to the load balancers, not to the web servers', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    const id = await addCdn(page, { origin: false });
    await page.evaluate((i) => window.__sdl.tryConnect(i, 'w1'), id);
    await expect(page.locator('#log')).toContainText('the CDN cannot reach them');
    expect(await state(page, () => window.__sdl.S.edges.some((e) => e.to === 'w1' && e.from.startsWith('n')))).toBe(false);
  });

  test('a CDN outage without fallback breaks every file; with fallback the origin takes them', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    await goTo(page, 1);
    const id = await addCdn(page);
    await page.click('#playBtn');
    await page.click('#exp-crash-cdn');
    await calm(page);
    expect((await measure(page)).served).toBeCloseTo(50, 6);
    await page.click('#playBtn');
    await fastForward(page, 3);
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['crash-cdn'])).toBe(false);
    await expect(page.locator('#log')).toContainText('load files from the origin');
    await set(page, id, { fallback: 'origin' });
    await calm(page);
    const r = await measure(page);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.farFileMs).toBeCloseTo(131.9, 1);
    expect(r.lb).toBeCloseTo(0.8, 6);
  });

  test('a long TTL keeps the old logo; invalidating misses browsers; a new name reaches everyone', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    await goTo(page, 2);
    const id = await addCdn(page);
    expect((await measure(page)).fileStaleSecs).toBe(3600);
    await page.click('#playBtn');
    await page.click('#exp-new-logo');
    await fastForward(page, 3);
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['new-logo'])).toBe(false);
    await expect(page.locator('#log')).toContainText('old logo for up to 1 hour');
    await page.click('#exp-new-logo'); // stop it, invalidate instead, and ship again
    await set(page, id, { onChange: 'purge' });
    expect((await measure(page)).fileStaleSecs).toBe(3600);
    await page.click('#exp-new-logo');
    await fastForward(page, 3);
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['new-logo'])).toBe(false);
    await expect(page.locator('#log')).toContainText('browsers that already had it');
    // A 1-minute TTL is fresh enough, but too slow for America.
    await set(page, id, { onChange: 'ttl', ttl: '60' });
    let r = await measure(page);
    expect(r.fileStaleSecs).toBe(60);
    expect(r.farFileMs).toBeGreaterThan(60);
    await set(page, id, { onChange: 'version', ttl: '3600' });
    r = await measure(page);
    expect(r.fileStaleSecs).toBe(0);
    expect(r.farFileMs).toBeLessThan(60);
  });

  test('a restarted experiment or a changed design logs its advice again', async ({ page }) => {
    // The log checks every 0.2 s of real time. Paused, each check runs by hand: no check falls between fast clicks.
    await freshPage(page, '#level-5/build');
    await goTo(page, 2);
    const id = await addCdn(page);
    await page.evaluate(() => { window.__sdl.run.playing = false; });
    const check = () => page.evaluate(async () => { const { observe } = await import('/js/ui/log.js'); observe(window.__sdl.model()); });
    const latest = () => page.evaluate(async () => (await import('/js/ui/log.js')).logLines[0].msg);
    const restart = () => page.evaluate(async () => {
      const x = await import('/js/engine/experiments.js'), { level } = await import('/js/level.js');
      const exp = level.experiments.find((e) => e.id === 'new-logo');
      if (x.isOn(exp.id)) x.stopExp(exp);
      x.startExp(exp);
    });
    await restart();
    await check();
    expect(await latest()).toContain('old logo for up to 1 hour');
    await restart();
    await page.evaluate(async () => (await import('/js/ui/log.js')).log('Logo shipped again.', ''));
    await check();
    expect(await latest()).toContain('old logo for up to 1 hour');
    await set(page, id, { onChange: 'purge' }); // while it runs
    await check();
    expect(await latest()).toContain('browsers that already had it');
    await set(page, id, { onChange: 'version' }); // fixed: the log says so
    await check();
    expect(await latest()).toContain('All good');
  });

  test('request dots: hits end at the CDN, misses go on to a web server', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    const id = await addCdn(page, { ttl: '60' });
    const routes = await page.evaluate(() => { const s = window.__sdl, m = s.model(); return Array.from({ length: 600 }, () => s.sampleRoute(m).route); });
    const viaCdn = routes.filter((r) => r[1] === id);
    expect(viaCdn.length).toBeGreaterThan(220);
    const hits = viaCdn.filter((r) => r.length === 3), misses = viaCdn.filter((r) => r.length > 3);
    expect(hits.length).toBeGreaterThan(misses.length);
    expect(misses.every((r) => r.includes('w1') || r.includes('w2'))).toBe(true);
    expect(misses.every((r) => !r.some((x) => ['b', 'r1', 'c1', 'c2'].includes(x)))).toBe(true); // files never reach the cache or databases
    expect(routes.some((r) => r[1] === 'l1' && r.includes('c1'))).toBe(true);
  });

  test('the inspector shows the CDN, the web servers\' files and both round trips', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    await goTo(page, 0);
    const id = await addCdn(page);
    await expect(page.locator(`[data-node="${id}"] .node-sub`)).toHaveText('TTL 1 h');
    await expect(page.locator('.edge-label', { hasText: 'files' })).not.toHaveCount(0);
    await expect(page.locator('.edge-label', { hasText: 'misses' })).not.toHaveCount(0);
    await select(page, id);
    await expect(page.locator('#inspLive')).toContainText('$1,037');
    await expect(page.locator('#inspLive')).toContainText('52 TB');
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#inspLive')).toContainText('99%');
    await expect(page.locator('#inspLive')).toContainText('misses/s pulled from the origin');
    await page.locator('#insp').getByRole('button', { name: /^1 day/ }).click();
    await expect(page.locator(`[data-node="${id}"] .node-sub`)).toHaveText('TTL 1 day');
    await select(page, 'w1');
    await expect(page.locator('#inspLive')).toContainText('pages + files arriving');
    await select(page, 'u');
    await expect(page.locator('#insp .live')).toContainText('120 ms');
    await expect(page.locator('#insp .live')).toContainText('America (30%)');
  });

  test('CDN settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    await addCdn(page, { ttl: '86400', onChange: 'version', fallback: 'origin' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = window.__sdl.S.nodes.find((x) => x.type === 'cdn'); return [n.ttl, n.onChange, n.fallback]; });
    expect(await get()).toEqual(['86400', 'version', 'origin']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level5-v1'));
      Object.assign(saved.nodes.find((n) => n.type === 'cdn'), { ttl: '5', onChange: 'never', fallback: 'maybe' });
      localStorage.setItem('sdl-level5-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['60', 'ttl', 'none']);
  });

  test('the data estimate shows the traffic, accepts "52 TB" and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    await expect(page.locator('#hud')).toContainText('4,000');
    for (const [v, hint] of [['104', 'uses the peak'], ['51,840', 'looks like GB'], ['1.7', 'one day']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '52 TB');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });
});

test.describe('Level 5 · fixes from QA', () => {
  test('Mission 2: a CDN without fallback is a single point of failure; with fallback it is not', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    await goTo(page, 1);
    const id = await addCdn(page);
    await calm(page);
    expect((await measure(page)).spof).toBe(1);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'No single point of failure' })).toHaveClass(/fail/);
    await set(page, id, { fallback: 'origin' });
    await calm(page);
    expect((await measure(page)).spof).toBe(0);
    await page.click('#playBtn');
    await page.click('#exp-crash-cdn');
    expect(await page.evaluate(() => window.__sdl.model({ peak: true }).servedPct)).toBeGreaterThanOrEqual(99);
  });

  test('a CDN Users do not connect to is not counted', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    await addCdn(page, { users: false });
    await calm(page);
    expect((await measure(page)).spof).toBe(0);
  });
});

test.describe('Level 5 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-5/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    await page.fill('#estIn', '52');
    await enter('#estBtn');
    await enter('.pal-item[data-type="cdn"]');
    const id = await state(page, () => window.__sdl.S.nodes.find((n) => n.type === 'cdn').id);
    await enter(`[data-node="${id}"]`);
    await enter('#insp [data-focus-key="ttl-3600"]');
    while (await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).count()) {
      await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
      await page.keyboard.press('Enter');
    }
    expect((await measure(page)).cost).toBe(3042);
    await enter('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll with the CDN', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-5/build');
    await addCdn(page);
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-5/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-5/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            await goTo(page, 0);
            const id = await addCdn(page);
            await page.click('#playBtn'); await playFor(page, 0.5);
            await select(page, id);
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
