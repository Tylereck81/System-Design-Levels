import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, state, logText, reloadGame, trackErrors } from './helpers.js';

// Level 2: load balancer and horizontal scaling.

/**
 * Build Users → load balancer(s) → web servers → database through the game's own add/connect functions.
 * The level starts with one L web server (w1) and an L database (b) already connected.
 */
async function build(page, { webs = ['M', 'M', 'M'], db = 'L', lbs = 1, connectDb = true } = {}) {
  return page.evaluate(({ webs, db, lbs, connectDb }) => {
    const s = window.__sdl, S = s.S;
    S.nodes.find((n) => n.id === 'w1').size = webs[0];
    for (let i = 1; i < webs.length; i++) s.addNode('web');
    S.nodes.filter((n) => n.type === 'web').forEach((n, i) => { n.size = webs[i]; });
    for (let i = 0; i < lbs; i++) s.addNode('lb');
    const all = (t) => S.nodes.filter((n) => n.type === t);
    for (const lb of all('lb')) { s.tryConnect('u', lb.id); for (const w of all('web')) s.tryConnect(lb.id, w.id); }
    if (connectDb) for (const w of all('web')) s.tryConnect(w.id, 'b');
    all('db')[0].size = db;
    s.afterDesignChange();
    return { webs: all('web').map((n) => n.id), lbs: all('lb').map((n) => n.id) };
  }, { webs, db, lbs, connectDb });
}
const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => { const m = window.__sdl.model(); return { served: m.servedPct, latency: m.latency, cost: m.cost, spof: m.spof, issue: m.issue }; });

test.describe('Level 2 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-2/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 2 / 21');

    // Mission 1: load balancer + four S servers (N + 1), then crash one.
    await build(page, { webs: ['S', 'S', 'S', 'S'] });
    expect((await measure(page)).cost).toBe(385);
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.verified[0])).toBe(true);
    await page.click('#exp-crash-web');
    await fastForward(page, 2);
    await page.click('#exp-crash-web');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    expect(await logText(page)).toContain('Observed: one web server down');

    // Mission 2: estimate, five M servers and an XL database.
    await page.click('#mission .complete button');
    await page.fill('#estIn', '1,204');
    await page.click('#estBtn');
    await page.evaluate(() => {
      const s = window.__sdl, S = s.S;
      s.addNode('web');
      const lb = S.nodes.find((n) => n.type === 'lb'), w = S.nodes.filter((n) => n.type === 'web').at(-1);
      s.tryConnect(lb.id, w.id); s.tryConnect(w.id, 'b');
      S.nodes.forEach((n) => { if (n.type === 'web') n.size = 'M'; if (n.type === 'db') n.size = 'XL'; });
      s.afterDesignChange();
    });
    expect((await measure(page)).cost).toBe(925);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash-web');
    await fastForward(page, 2);
    await page.click('#exp-crash-web');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);

    // Mission 3: a standby load balancer, then crash the active one.
    await page.click('#mission .complete button');
    await page.evaluate(() => {
      const s = window.__sdl, S = s.S;
      s.addNode('lb');
      const lb = S.nodes.filter((n) => n.type === 'lb').at(-1);
      s.tryConnect('u', lb.id);
      for (const w of S.nodes.filter((n) => n.type === 'web')) s.tryConnect(lb.id, w.id);
    });
    await expect(page.locator('[data-node] .node-sub', { hasText: 'Standby · same IP' })).toHaveCount(1);
    const m3 = await measure(page);
    expect(m3.cost).toBe(945);
    expect(m3.spof).toBe(1); // only the database is left
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash-lb');
    await fastForward(page, 2);
    await page.click('#exp-crash-lb');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 2 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });

  test('progress is saved under its own key and does not touch Level 1', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await build(page);
    await page.evaluate(() => window.__sdl.afterChange());
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['sdl-level2-v1']);
    await page.goto('about:blank');
    await page.goto('/#build');
    await page.waitForFunction(() => !!window.__sdl);
    await expect(page.locator('#lvlChip')).toHaveText('Level 1 / 21');
    expect(await state(page, () => window.__sdl.S.nodes.some((n) => n.type === 'lb'))).toBe(false);
  });
});

test.describe('Level 2 · numbers', () => {
  test('pinned designs match the simulation model', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await page.evaluate(() => { window.__sdl.run.t = 0; });
    // 463 req/s over 4 S: LB 1 × 1/(1 − 0.0926) + web 20 × 1/(1 − 0.579) + db 10 × 1/(1 − 0.579) + 40 + 0.5 + 0.5
    await build(page, { webs: ['S', 'S', 'S', 'S'] });
    let r = await measure(page);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.latency).toBeCloseTo(113.32, 1);
    // 1,204 req/s over 5 M with an XL database.
    await goTo(page, 1);
    await page.evaluate(() => { window.__sdl.S.est = true; window.__sdl.run.t = 0; });
    await page.evaluate(() => {
      const s = window.__sdl, S = s.S;
      s.addNode('web');
      const lb = S.nodes.find((n) => n.type === 'lb'), w = S.nodes.filter((n) => n.type === 'web').at(-1);
      s.tryConnect(lb.id, w.id); s.tryConnect(w.id, 'b');
      S.nodes.forEach((n) => { if (n.type === 'web') n.size = 'M'; if (n.type === 'db') n.size = 'XL'; });
    });
    r = await measure(page);
    expect(r.latency).toBeCloseTo(132.97, 1);
    expect(r.cost).toBe(925);
  });
});

test.describe('Level 2 · teaching feedback', () => {
  test('users cannot connect straight to a web server', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    expect(await page.evaluate(() => window.__sdl.tryConnect('u', 'w1'))).toBe(false);
    expect(await logText(page)).toContain('Web servers have private IPs now');
    expect((await measure(page)).issue).toContain('Users have no way in');
  });

  test('a load balancer with no web servers behind it fails every request and says why', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await page.evaluate(() => { const s = window.__sdl; s.addNode('lb'); s.tryConnect('u', s.S.nodes.find((n) => n.type === 'lb').id); });
    const r = await measure(page);
    expect(r.served).toBe(0);
    expect(r.issue).toContain('no web servers to send requests to');
  });

  test('without a spare, crashing a web server does not count and the log says to add one', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await build(page, { webs: ['M', 'M'] });
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash-web');
    await fastForward(page, 3);
    expect(await state(page, () => window.__sdl.S.exp['crash-web'])).toBe(false);
    await expect(page.locator('#log')).toContainText('Add a spare web server (N + 1)');
  });

  test('mixed server sizes: the small one gets the same share and overloads', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await build(page, { webs: ['M', 'S'] });
    expect((await measure(page)).served).toBeCloseTo(93.2, 1);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('Web server is over capacity');
  });

  test('a web server not connected to the database runs at half capacity', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await build(page, { webs: ['M', 'M', 'M'], connectDb: false });
    const g = await page.evaluate(() => window.__sdl.model().g.everyReaches('web', 'db'));
    expect(g).toBe(false); // w1 still has its start connection; the new ones don't
    await expect(page.locator('[data-node] .node-sub', { hasText: '(½)' })).toHaveCount(2);
  });

  test('Mission 2: leaving the database at L overloads it', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await build(page, { webs: ['M', 'M', 'M', 'M', 'M'] });
    await goTo(page, 1);
    await page.evaluate(() => { window.__sdl.S.est = true; window.__sdl.afterChange(); });
    expect((await measure(page)).served).toBeCloseTo(66.4, 1);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('Database is over capacity');
  });

  test('Mission 3: one load balancer crashed means nothing is served; a standby keeps the site up', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await goTo(page, 2);
    await build(page, { webs: ['M', 'M', 'M', 'M', 'M'], db: 'XL' });
    await page.click('#playBtn');
    await page.click('#exp-crash-lb');
    expect((await measure(page)).issue).toContain('The load balancer is down');
    await fastForward(page, 3);
    expect(await state(page, () => window.__sdl.S.exp['crash-lb'])).toBe(false);
    await page.click('#exp-crash-lb');
    await page.evaluate(() => {
      const s = window.__sdl, S = s.S;
      s.addNode('lb');
      const lb = S.nodes.filter((n) => n.type === 'lb').at(-1);
      s.tryConnect('u', lb.id);
      for (const w of S.nodes.filter((n) => n.type === 'web')) s.tryConnect(lb.id, w.id);
    });
    // The standby takes no traffic while the active one is healthy.
    await page.click('#playBtn');
    await fastForward(page, 1);
    expect(await state(page, () => window.__sdl.run.mdl.node[Object.keys(window.__sdl.run.mdl.node).find((k) => window.__sdl.run.mdl.node[k].standby)].load)).toBe(0);
    await page.click('#exp-crash-lb');
    expect((await measure(page)).served).toBeCloseTo(100, 6);
  });

  test('the estimate box accepts formatted answers and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await goTo(page, 1);
    await page.fill('#estIn', '602');
    await page.click('#estBtn');
    await expect(page.locator('#estFb')).toContainText('twice the average');
    await page.fill('#estIn', '104000000');
    await page.click('#estBtn');
    await expect(page.locator('#estFb')).toContainText('86,400');
    await page.fill('#estIn', '1204 req/s');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });
});

test.describe('Level 2 · quiz', () => {
  test('answer key is balanced and not guessable by length', async ({ page }) => {
    await freshPage(page, '#level-2/quiz');
    const source = await (await page.request.get('/levels/level-02.js')).text();
    const questions = [...source.matchAll(/o: \[(.*?)\], a: (\d)/g)];
    expect(questions).toHaveLength(10);
    const counts = [0, 0, 0, 0];
    let longestIsRight = 0;
    for (const [, opts, a] of questions) {
      counts[+a]++;
      const options = [...opts.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
      const longest = options.reduce((best, o, i) => (o.length > options[best].length ? i : best), 0);
      if (longest === +a) longestIsRight++;
    }
    expect(Math.max(...counts)).toBeLessThanOrEqual(3);
    expect(longestIsRight).toBeLessThanOrEqual(3);
    await expect(page.locator('#quizLabel')).toHaveText('Level 2 quiz · 10 questions · 8 to pass');
  });
});

test.describe('Level 2 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    await enter('.pal-item[data-type="lb"]');
    for (let i = 0; i < 3; i++) await enter('.pal-item[data-type="web"]');
    const ids = await page.evaluate(() => Object.fromEntries(['lb', 'web'].map((t) => [t, window.__sdl.S.nodes.filter((n) => n.type === t).map((n) => n.id)])));
    const connectAll = async (nodeId) => {
      await enter(`[data-node="${nodeId}"]`);
      while (await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).count()) {
        await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
        await page.keyboard.press('Enter');
      }
    };
    await connectAll('u');
    await connectAll(ids.lb[0]);
    for (const w of ids.web) {
      await connectAll(w);
      await enter(`[data-node="${w}"]`);
      await enter('#insp .seg:not(.two) button:nth-child(1)'); // S
    }
    await enter('[data-node="w1"]');
    await enter('#insp .seg:not(.two) button:nth-child(1)'); // S
    await enter('#playBtn');
    await fastForward(page, 5);
    await enter('#exp-crash-web');
    await fastForward(page, 2);
    await enter('#exp-crash-web');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll on Mission 3', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-2/build');
    await goTo(page, 2);
    await build(page, { webs: ['M', 'M', 'M', 'M', 'M'], db: 'XL', lbs: 2 });
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-2/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-2/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') { await build(page, { webs: ['S', 'S', 'S', 'S'], lbs: 2 }); await page.click('#playBtn'); await page.waitForTimeout(500); }
          const results = await new AxeBuilder({ page }).analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
