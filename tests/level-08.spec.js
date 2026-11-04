import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, state, logText, reloadGame, trackErrors } from './helpers.js';

// Level 8: Message queue, workers and monitoring.
// The level starts inside one data center: Users ('u'), DNS ('d'), one load balancer ('l'), two XL web servers
// ('w1', 'w2') and an XL database ('b'). 1 request in 1,000 is an upload, which takes 20 s of one vCPU to process.

/** Add a queue (from both web servers) and workers (from the queue); return their ids. */
const addQueue = (page, { scaling = '8', size = 'M' } = {}) => page.evaluate(([sc, sz]) => {
  const s = window.__sdl;
  s.addNode('queue'); const q = s.S.nodes.at(-1).id;
  s.addNode('worker'); const k = s.S.nodes.at(-1); Object.assign(k, { scaling: sc, size: sz });
  s.tryConnect('w1', q); s.tryConnect('w2', q); s.tryConnect(q, k.id);
  s.afterDesignChange();
  return { q, k: k.id };
}, [scaling, size]);
const addMonitor = (page, q) => page.evaluate((qid) => { const s = window.__sdl; s.addNode('monitor'); s.tryConnect(s.S.nodes.at(-1).id, qid); s.afterDesignChange(); }, q);
const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; S.est = true; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => {
  const s = window.__sdl, m = s.model(), at = (id) => m.node[id] || {};
  return { served: m.servedPct, latency: m.latency, cost: m.cost, uploadMs: m.uploadMs, jobsIn: m.jobsIn, jobsOut: m.jobsOut, backlog: m.backlog, alert: !!m.alert, web: at('w1').util };
});
const calm = (page) => page.evaluate(() => { const s = window.__sdl; s.run.playing = false; s.run.t = 0; });
const select = async (page, id) => { await page.focus(`[data-node="${id}"]`); await page.keyboard.press('Enter'); };
const set = (page, id, props) => page.evaluate(([i, p]) => { Object.assign(window.__sdl.S.nodes.find((n) => n.id === i), p); window.__sdl.afterDesignChange(); }, [id, props]);

test.describe('Level 8 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-8/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 8 / 21');

    // Mission 1: estimate, then a queue and 8 M workers (set through the inspector).
    await page.fill('#estIn', '20');
    await page.click('#estBtn');
    const { q, k } = await addQueue(page, { scaling: '1', size: 'S' });
    await select(page, k);
    await page.locator('#insp').getByRole('button', { name: /^8 workers/ }).click();
    await page.locator('#insp [data-focus-key="size-M"]').click();
    await expect(page.locator(`[data-node="${k}"] .node-sub`)).toHaveText('8 × M · 1.6/s');
    expect((await measure(page)).cost).toBe(2145);
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);

    // Mission 2: monitoring on the queue, then crash the workers.
    await page.click('#mission .complete button');
    await addMonitor(page, q);
    await expect(page.locator('.edge-label', { hasText: 'watches' })).not.toHaveCount(0);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash-workers');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('monitoring raised an alert');
    await page.click('#exp-crash-workers');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);

    // Mission 3: autoscaled L workers, then the Monday rush.
    await page.click('#mission .complete button');
    await select(page, k);
    await page.locator('#insp').getByRole('button', { name: /^Autoscale/ }).click();
    await page.locator('#insp [data-focus-key="size-L"]').click();
    expect((await measure(page)).cost).toBe(1972);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-upload-rush');
    await fastForward(page, 2);
    await page.click('#exp-upload-rush');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 8 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 8 · numbers', () => {
  test('pinned designs match the simulation model', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    await calm(page);
    // Start: each XL web server processes half an upload a second (2,000 page-units each) next to 499.5 pages.
    let r = await measure(page);
    expect(r.web).toBeCloseTo((499.5 + 0.5 * 2000) / 1600, 6);
    expect(r.uploadMs).toBeGreaterThan(300000); // 20 s, times 16 for a server 94% busy
    expect(r.latency).toBeGreaterThan(150);
    expect(r.cost).toBe(1375);
    // With a queue: an upload is an ordinary request plus a 2 ms publish; 8 M workers take 1.6 jobs a second.
    await addQueue(page);
    await calm(page);
    r = await measure(page);
    expect(r.web).toBeCloseTo(500 / 1600, 6);
    expect(r.uploadMs).toBeCloseTo(73, 0);
    expect(r.latency).toBeCloseTo(97.9, 1);
    expect(r.jobsIn).toBeCloseTo(1, 6);
    expect(r.jobsOut).toBeCloseTo(1, 6);
    expect(r.cost).toBe(2145); // + $50 queue + 8 × $90
  });

  test('worker choices: capacity and cost', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    const { k } = await addQueue(page);
    for (const [scaling, size, cost, keepsUp] of [['4', 'L', 2225, true], ['2', 'XL', 2325, true], ['4', 'M', 1785, false], ['8', 'S', 1745, false], ['auto', 'M', 1849, true], ['auto', 'L', 1942, true], ['auto', 'XL', 2175, true]]) {
      await set(page, k, { scaling, size });
      await calm(page);
      const r = await measure(page);
      expect([scaling, size, r.cost]).toEqual([scaling, size, cost]);
      expect(r.jobsOut >= r.jobsIn - 1e-9).toBe(keepsUp);
    }
  });

  test('levels without uploads ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-7/build');
    const r = await measure(page);
    expect(r.uploadMs).toBeNull();
    expect(r.jobsIn).toBe(0);
    expect(r.cost).toBe(2742);
  });
});

test.describe('Level 8 · teaching feedback', () => {
  test('too few workers: the queue grows, and the log says so', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    await goTo(page, 0);
    await addQueue(page, { scaling: '4', size: 'M' });
    await page.click('#playBtn');
    await fastForward(page, 3);
    const r = await measure(page);
    expect(r.jobsOut).toBeCloseTo(0.8, 6);
    expect(r.backlog).toBeGreaterThan(0.4);
    await expect(page.locator('#log')).toContainText('nothing is watching it');
    await expect(page.locator('#goals li', { hasText: 'Workers keep up' })).toHaveClass(/fail/);
  });

  test('crashed workers: uploads still answered, jobs wait, and they drain afterwards', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    await goTo(page, 1);
    const { q } = await addQueue(page);
    await page.click('#playBtn');
    await page.click('#exp-crash-workers');
    await fastForward(page, 3);
    let r = await measure(page);
    expect(r.served).toBeCloseTo(100, 1);
    expect(r.uploadMs).toBeLessThan(1000);
    expect(r.backlog).toBeGreaterThan(2.5);
    expect(r.alert).toBe(false); // nothing watches the queue
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['crash-workers'])).toBe(false);
    await expect(page.locator('#log')).toContainText('nothing alerts anyone');
    await addMonitor(page, q);
    expect((await measure(page)).alert).toBe(true);
    await page.click('#exp-crash-workers');
    // 8 M workers take 1.6 a second, 1 arrives: the backlog drains at 0.6 a second. It is larger than 3 when
    // the clicks above were slow, as the game runs in real time between them.
    await fastForward(page, (await measure(page)).backlog / 0.6 + 2);
    r = await measure(page);
    expect(r.backlog).toBe(0);
    expect(r.alert).toBe(false);
  });

  test('the Monday rush: fixed workers fall behind; autoscaled M stop at 10 servers', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    await goTo(page, 2);
    const { k } = await addQueue(page);
    await page.click('#playBtn');
    await page.click('#exp-upload-rush');
    await expect(page.locator('#hud')).toContainText('uploads ×3');
    await calm(page);
    let r = await measure(page);
    expect(r.jobsIn).toBeCloseTo(3, 1);
    expect(r.jobsOut).toBeCloseTo(1.6, 6);
    await page.click('#playBtn');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['upload-rush'])).toBe(false);
    await expect(page.locator('#log')).toContainText('Set the workers to autoscale');
    await set(page, k, { scaling: 'auto', size: 'M' });
    await calm(page);
    r = await measure(page);
    expect(r.jobsOut).toBeCloseTo(2, 6); // 10 × 0.2
    await set(page, k, { scaling: 'auto', size: 'L' });
    await calm(page);
    r = await measure(page);
    expect(r.jobsOut).toBeGreaterThanOrEqual(r.jobsIn); // and faster while it clears the backlog
    expect(r.cost).toBe(1942); // the bill follows normal days, not the rush
  });

  test('the queue connects from web servers to workers only', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    const { q, k } = await addQueue(page);
    await page.evaluate((kid) => window.__sdl.tryConnect('w1', kid), k);
    await expect(page.locator('#log')).toContainText('Workers take jobs from the queue');
    await page.evaluate((qid) => window.__sdl.tryConnect('l', qid), q);
    await expect(page.locator('#log')).toContainText('The load balancer sends requests to web servers');
    await expect(page.locator('.edge-label', { hasText: 'publish' })).not.toHaveCount(0);
    await expect(page.locator('.edge-label', { hasText: 'jobs' })).not.toHaveCount(0);
  });

  test('request dots: uploads end at the queue; pages go to the database', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    const { q, k } = await addQueue(page);
    const routes = await page.evaluate(() => { const s = window.__sdl, m = s.model(); return Array.from({ length: 900 }, () => s.sampleRoute(m).route); });
    const toQueue = routes.filter((r) => r.includes(q));
    expect(toQueue.length).toBeGreaterThan(80);
    expect(toQueue.every((r) => !r.includes('b') && !r.includes(k))).toBe(true);
    expect(routes.filter((r) => r.includes('b')).length).toBeGreaterThan(toQueue.length);
  });

  test('the inspector shows uploads, the backlog and the workers', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    await goTo(page, 0);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await select(page, 'w1');
    await expect(page.locator('#inspLive')).toContainText('processed here before it answers');
    const { q, k } = await addQueue(page, { scaling: '4', size: 'M' });
    await fastForward(page, 2);
    await select(page, k);
    await expect(page.locator('#insp')).toContainText('Worker size');
    await expect(page.locator('#insp [data-focus-key="size-M"]')).toContainText('4 vCPU');
    await expect(page.locator('#inspLive')).toContainText('jobs/s it can take');
    await expect(page.locator('#inspLive')).toContainText('jobs waiting in the queue');
    await select(page, q);
    await expect(page.locator('#inspLive')).toContainText('waiting for a worker');
  });

  test('worker settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    const { k } = await addQueue(page, { scaling: 'auto', size: 'L' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = window.__sdl.S.nodes.find((x) => x.type === 'worker'); return [n.scaling, n.size]; });
    expect(await get()).toEqual(['auto', 'L']);
    await page.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem('sdl-level8-v1'));
      Object.assign(saved.nodes.find((n) => n.id === id), { scaling: 'lots' });
      localStorage.setItem('sdl-level8-v1', JSON.stringify(saved));
    }, k);
    await reloadGame(page);
    expect(await get()).toEqual(['1', 'L']);
  });

  test('the vCPU estimate accepts "20" and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    for (const [v, hint] of [['0.05', 'Turn it around'], ['1', 'every 20 seconds'], ['1200', 'a minute of uploads']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '20 vCPUs');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });
});

test.describe('Level 8 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-8/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    await page.fill('#estIn', '20');
    await enter('#estBtn');
    await enter('.pal-item[data-type="queue"]');
    const q = await state(page, () => window.__sdl.S.nodes.at(-1).id);
    await enter(`[data-node="${q}"]`);
    while (await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).count()) {
      await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
      await page.keyboard.press('Enter');
    }
    await enter('.pal-item[data-type="worker"]');
    const k = await state(page, () => window.__sdl.S.nodes.at(-1).id);
    await enter(`[data-node="${k}"]`);
    await enter('#insp [data-focus-key="scaling-8"]');
    await enter('#insp [data-focus-key="size-M"]');
    await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
    await page.keyboard.press('Enter');
    expect((await measure(page)).cost).toBe(2145);
    await enter('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-8/build');
    const { q } = await addQueue(page);
    await addMonitor(page, q);
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-8/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-8/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            await goTo(page, 1);
            const { q, k } = await addQueue(page);
            await addMonitor(page, q);
            await page.click('#playBtn'); await page.waitForTimeout(500);
            await select(page, k);
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
