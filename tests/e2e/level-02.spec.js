import { test, expect } from '../fixtures.js';
import { registerCommonTests, registerLessonTests } from '../shared-checks.js';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors, openMission, pressEnterOn } from '../helpers.js';

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
const measure = (page) => page.evaluate(() => { const m = window.__sdl.model(); return { served: m.servedPct, latency: m.latency, cost: m.cost, spof: m.spof, issue: m.issue }; });

test.describe('Level 2 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-2/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 2 / 21');

    // Mission 1: load balancer + four S servers (N + 1), then crash one.
    await build(page, { webs: ['S', 'S', 'S', 'S'] });
    expect((await measure(page)).cost).toBe(385); // DNS $5 + LB $20 + 4 × S web $40 + L database $200
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
    expect((await measure(page)).cost).toBe(925); // DNS $5 + LB $20 + 5 × M web $90 + XL database $450
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
    await expect(page.locator('[data-node] .node-sub', { hasText: 'Standby · round robin' })).toHaveCount(1);
    const m3 = await measure(page);
    expect(m3.cost).toBe(945); // $925 + a second LB $20
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
    await openMission(page, 1);
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
    expect(r.cost).toBe(925); // DNS $5 + LB $20 + 5 × M web $90 + XL database $450
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
    expect(await state(page, () => window.__sdl.S.exp[1]['crash-web'])).toBe(false);
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

  test('routing method: round robin overloads a small server; weighted and least connections share by capacity', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await build(page, { webs: ['M', 'S'] });
    await page.evaluate(() => { window.__sdl.run.t = 0; });
    expect((await measure(page)).served).toBeCloseTo(93.2, 1); // round robin: 231.5 each, the S serves only 200
    const lb = await page.evaluate(() => window.__sdl.S.nodes.find((n) => n.type === 'lb').id);
    await expect(page.locator(`[data-node="${lb}"] .node-sub`)).toHaveText('round robin');
    for (const [name, label] of [['Weighted', 'weighted'], ['Least connections', 'least conn']]) {
      await page.focus(`[data-node="${lb}"]`);
      await page.keyboard.press('Enter');
      await page.locator('#insp').getByRole('button', { name: new RegExp('^' + name) }).click();
      // 463 split 2:1 → both 77% busy: 40 + LB 1.1 + 0.5 + web 87.6 + 0.5 + db 23.7
      const r = await measure(page);
      expect(r.served).toBeCloseTo(100, 6);
      expect(r.latency).toBeCloseTo(153.4, 1);
      await expect(page.locator(`[data-node="${lb}"] .node-sub`)).toHaveText(label);
    }
    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.nodes.find((n) => n.type === 'lb').algo)).toBe('lc');
  });

  test('saves from before routing methods load as round robin', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await build(page);
    await page.evaluate(() => {
      const S = window.__sdl.S;
      const saved = JSON.parse(JSON.stringify(S));
      saved.nodes.forEach((n) => { delete n.algo; });
      localStorage.setItem('sdl-level2-v1', JSON.stringify(saved));
    });
    await page.goto('about:blank');
    await page.goto('/#level-2/build');
    await page.waitForFunction(() => !!window.__sdl);
    expect(await state(page, () => window.__sdl.S.nodes.find((n) => n.type === 'lb').algo)).toBe('rr');
  });

  test('crashing a web server takes down the one whose loss hurts most', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await build(page, { webs: ['S', 'L', 'S'] });
    await page.click('#playBtn');
    await page.click('#exp-crash-web');
    const down = await page.evaluate(() => { const m = window.__sdl.model(); return window.__sdl.S.nodes.filter((n) => m.node[n.id] && m.node[n.id].down).map((n) => n.size); });
    expect(down).toEqual(['L']);
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
    await openMission(page, 1);
    await page.evaluate(() => { window.__sdl.S.est = true; window.__sdl.afterChange(); });
    expect((await measure(page)).served).toBeCloseTo(66.4, 1);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('Database is over capacity');
  });

  test('Mission 3: a standby connected to only some web servers is not ready, and the message names the fix', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await openMission(page, 2);
    await build(page, { webs: ['M', 'M', 'M', 'M', 'M'], db: 'XL' });
    await page.evaluate(() => {
      const s = window.__sdl, S = s.S;
      s.addNode('lb');
      const lb = S.nodes.filter((n) => n.type === 'lb').at(-1);
      s.tryConnect('u', lb.id);
      for (const w of S.nodes.filter((n) => n.type === 'web').slice(0, 2)) s.tryConnect(lb.id, w.id);
      s.afterDesignChange();
    });
    const goal = page.locator('#goals li', { hasText: 'A standby load balancer is ready' });
    await expect(goal).toContainText('reaches 2 of 5');
    await page.click('#playBtn');
    await expect(goal).toHaveClass(/fail/);
    await page.click('#exp-crash-lb');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[2]['crash-lb'])).toBe(false);
    await expect(page.locator('#log')).toContainText('Connect the standby to every web server: it reaches 2 of 5.');
    await page.click('#exp-crash-lb');
    await page.evaluate(() => {
      const s = window.__sdl, S = s.S, lb = S.nodes.filter((n) => n.type === 'lb').at(-1);
      for (const w of S.nodes.filter((n) => n.type === 'web')) s.tryConnect(lb.id, w.id);
    });
    await expect(goal).toHaveClass(/pass/);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash-lb');
    expect(await page.evaluate(() => window.__sdl.model({ peak: true }).servedPct)).toBeGreaterThanOrEqual(99);
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[2]['crash-lb'])).toBe(true);
  });

  test('Mission 3: one load balancer crashed means nothing is served; a standby keeps the site up', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await openMission(page, 2);
    await build(page, { webs: ['M', 'M', 'M', 'M', 'M'], db: 'XL' });
    await page.click('#playBtn');
    await page.click('#exp-crash-lb');
    expect((await measure(page)).issue).toContain('The load balancer is down');
    await fastForward(page, 3);
    expect(await state(page, () => window.__sdl.S.exp[2]['crash-lb'])).toBe(false);
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
    await openMission(page, 1);
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

test.describe('Level 2 · break-it results', () => {
  const crashPassed = (page, i) => page.evaluate((k) => window.__sdl.S.exp[k]['crash-web'], i);
  const servedAtPeak = (page) => page.evaluate(() => window.__sdl.model({ peak: true }).servedPct);

  test('results belong to a mission: Mission 2 starts with its crash test not done', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await build(page);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash-web');
    await fastForward(page, 2);
    await page.click('#exp-crash-web');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await page.click('#mission .complete button');
    expect(await crashPassed(page, 1)).toBe(false);
    await expect(page.locator('#goals li', { hasText: 'crash a web server' })).toHaveClass(/todo/);
    await expect(page.locator('#goals li', { hasText: 'crash a web server' })).toContainText('not tested yet');
    await expect(page.locator('#exp-crash-web')).toHaveText('Crash web server'); // no ✓ carried over
  });

  test('changing the design clears a passed crash test of an unfinished mission', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    const { webs } = await build(page);
    await page.click('#playBtn');
    await page.click('#exp-crash-web');
    await fastForward(page, 2);
    await page.click('#exp-crash-web');
    expect(await crashPassed(page, 0)).toBe(true);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(false); // the targets have not held yet
    await page.evaluate((id) => { const s = window.__sdl; s.S.nodes = s.S.nodes.filter((n) => n.id !== id); s.S.edges = s.S.edges.filter((e) => e.from !== id && e.to !== id); s.afterDesignChange(); }, webs[2]);
    expect(await crashPassed(page, 0)).toBe(false);
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(false);
  });

  test('the outcome is judged at peak traffic: L + M + M + M never passes', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await openMission(page, 1);
    await page.evaluate(() => { window.__sdl.S.est = true; });
    await build(page, { webs: ['L', 'M', 'M', 'M'], db: 'XL' });
    await page.evaluate(() => { window.__sdl.S.nodes.find((n) => n.type === 'lb').algo = 'wrr'; window.__sdl.afterDesignChange(); });
    await page.click('#playBtn');
    await page.click('#exp-crash-web');
    const served = await servedAtPeak(page);
    expect(served).toBeGreaterThanOrEqual(96.5);
    expect(served).toBeLessThanOrEqual(98.6);
    const down = await page.evaluate(() => { const m = window.__sdl.model(); return window.__sdl.S.nodes.filter((n) => m.node[n.id] && m.node[n.id].down).map((n) => n.size); });
    expect(down).toEqual(['L']); // the server the others can least cover for
    for (let i = 0; i < 6; i++) { await fastForward(page, 1.3); expect(await crashPassed(page, 1)).toBe(false); }
  });

  test('when the database is the bottleneck, the crash message names it', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await openMission(page, 1);
    await page.evaluate(() => { window.__sdl.S.est = true; });
    await build(page, { webs: ['M', 'M', 'M', 'M', 'M', 'M'], db: 'L' });
    await page.click('#playBtn');
    await page.click('#exp-crash-web');
    await fastForward(page, 2);
    expect(await crashPassed(page, 1)).toBe(false);
    await expect(page.locator('#log')).toContainText('the database is the bottleneck');
  });

  test('a save from before per-mission results keeps finished missions finished', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await page.evaluate(() => {
      const S = window.__sdl.S;
      const old = { ...JSON.parse(JSON.stringify(S)), v: 1, mission: 2, done: [true, true, false], verified: [true, true, false], est: true, quiz: { 0: 1 }, exp: { 'crash-web': true, 'crash-lb': false } };
      delete old.qv;
      localStorage.setItem('sdl-level2-v1', JSON.stringify(old));
    });
    await reloadGame(page);
    const s = await state(page, () => { const S = window.__sdl.S; return { done: S.done, exp: S.exp, mission: S.mission, quiz: S.quiz, v: S.v }; });
    expect(s.done).toEqual([true, true, false]);
    expect(s.exp).toEqual([{ 'crash-web': true }, { 'crash-web': true }, { 'crash-lb': false }]);
    expect(s.mission).toBe(2);
    expect(s.quiz).toEqual({ 0: 1 }); // the quiz didn't change, so its answers stay
    expect(s.v).toBe(2);
  });

  test('an unfinished mission keeps the result it had in an old save', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await page.evaluate(() => {
      const S = window.__sdl.S;
      localStorage.setItem('sdl-level2-v1', JSON.stringify({ ...JSON.parse(JSON.stringify(S)), v: 1, mission: 0, exp: { 'crash-web': true, 'crash-lb': true } }));
    });
    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.exp)).toEqual([{ 'crash-web': true }, { 'crash-web': false }, { 'crash-lb': false }]);
  });
});

test.describe('Level 2 · saved data and inputs', () => {
  test('a save with more web servers than the limit loads only the limit', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-2/build');
    await page.evaluate(() => {
      const S = JSON.parse(JSON.stringify(window.__sdl.S));
      for (let i = 0; i < 8; i++) { S.nodes.push({ id: 'x' + i, type: 'web', x: 100 + i, y: 300, size: 'S' }); S.edges.push({ id: 'y' + i, from: 'x' + i, to: 'b' }); }
      for (let i = 0; i < 3; i++) S.nodes.push({ id: 'l' + i, type: 'lb', x: 200 + i, y: 170 });
      localStorage.setItem('sdl-level2-v1', JSON.stringify(S));
    });
    await reloadGame(page);
    const s = await state(page, () => ({ web: window.__sdl.S.nodes.filter((n) => n.type === 'web').length, lb: window.__sdl.S.nodes.filter((n) => n.type === 'lb').length, edges: window.__sdl.S.edges.filter((e) => !window.__sdl.S.nodes.some((n) => n.id === e.from) || !window.__sdl.S.nodes.some((n) => n.id === e.to)).length }));
    expect(s).toEqual({ web: 6, lb: 2, edges: 0 });
    expect(errors).toEqual([]);
  });

  test('the estimate box rejects a negative number', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await openMission(page, 1);
    await page.fill('#estIn', '-1204');
    await page.click('#estBtn');
    await expect(page.locator('#estFb')).toContainText('Type the estimate as a number');
    expect(await state(page, () => window.__sdl.S.est)).toBe(false);
  });
});

test.describe('Level 2 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await pressEnterOn(page, '.pal-item[data-type="lb"]');
    for (let i = 0; i < 3; i++) await pressEnterOn(page, '.pal-item[data-type="web"]');
    const ids = await page.evaluate(() => Object.fromEntries(['lb', 'web'].map((t) => [t, window.__sdl.S.nodes.filter((n) => n.type === t).map((n) => n.id)])));
    const connectAll = async (nodeId) => {
      await pressEnterOn(page, `[data-node="${nodeId}"]`);
      while (await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).count()) {
        await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
        await page.keyboard.press('Enter');
      }
    };
    await connectAll('u');
    await connectAll(ids.lb[0]);
    for (const w of ids.web) {
      await connectAll(w);
      await pressEnterOn(page, `[data-node="${w}"]`);
      await pressEnterOn(page, '#insp .seg:not(.two) button:nth-child(1)'); // S
    }
    await pressEnterOn(page, '[data-node="w1"]');
    await pressEnterOn(page, '#insp .seg:not(.two) button:nth-child(1)'); // S
    await pressEnterOn(page, '#playBtn');
    await fastForward(page, 5);
    await pressEnterOn(page, '#exp-crash-web');
    await fastForward(page, 2);
    await pressEnterOn(page, '#exp-crash-web');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  registerCommonTests({
    level: 2,
    phone: {
      title: 'on Mission 3',
      setup: async (page) => {
        await openMission(page, 2);
        await build(page, { webs: ['M', 'M', 'M', 'M', 'M'], db: 'XL', lbs: 2 });
      },
    },
    onTab: {
      build: async (page) => { await build(page, { webs: ['S', 'S', 'S', 'S'], lbs: 2 }); await page.click('#playBtn'); await playFor(page, 0.5); },
    },
  });
});

test.describe('Level 2 · step lesson', () => {
  registerLessonTests({ level: 2 });
});
