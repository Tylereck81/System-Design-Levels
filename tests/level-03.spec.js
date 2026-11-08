import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors } from './helpers.js';

// Level 3: database replication.
// The level starts with Users, DNS, two load balancers, two XL web servers and one XL primary database ('b').

/** Add databases (each becomes a read replica) and connect every web server to them. */
async function addReplicas(page, sizes, { connect = true } = {}) {
  return page.evaluate(({ sizes, connect }) => {
    const s = window.__sdl, S = s.S, ids = [];
    for (const size of sizes) {
      s.addNode('db');
      const n = S.nodes.at(-1); n.size = size; ids.push(n.id);
      if (connect) for (const w of S.nodes.filter((x) => x.type === 'web')) s.tryConnect(w.id, n.id);
    }
    s.afterDesignChange();
    return ids;
  }, { sizes, connect });
}
const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; if (k > 0) S.est = true; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => {
  const s = window.__sdl, m = s.model();
  const dbs = s.S.nodes.filter((n) => n.type === 'db').map((n) => ({ id: n.id, role: n.role, ...(m.node[n.id] || {}) }));
  return { served: m.servedPct, latency: m.latency, cost: m.cost, spof: m.spof, issue: m.issue, dbs };
});
// Pause and go back to t = 0, where traffic has no wobble, so numbers can be pinned exactly.
const calm = (page) => page.evaluate(() => { const s = window.__sdl; s.run.playing = false; s.run.t = 0; });
const select = async (page, id) => { await page.focus(`[data-node="${id}"]`); await page.keyboard.press('Enter'); };

test.describe('Level 3 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-3/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 3 / 21');

    // Mission 1: two XL replicas, then crash one.
    await addReplicas(page, ['XL', 'XL']);
    expect((await measure(page)).cost).toBe(2295);
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.verified[0])).toBe(true);
    await page.click('#exp-crash-replica');
    await fastForward(page, 2);
    await page.click('#exp-crash-replica');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    expect(await logText(page)).toContain('Its reads moved to the other replica.');

    // Mission 2: estimate the peak writes, add a third XL replica.
    await page.click('#mission .complete button');
    await page.fill('#estIn', '400 writes/s');
    await page.click('#estBtn');
    await addReplicas(page, ['XL']);
    expect((await measure(page)).cost).toBe(2745);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash-replica');
    await fastForward(page, 2);
    await page.click('#exp-crash-replica');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);

    // Mission 3: crash the primary and promote a replica through the inspector.
    await page.click('#mission .complete button');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash-primary');
    await fastForward(page, 1);
    expect((await measure(page)).served).toBeLessThan(81);
    await expect(page.locator('#log')).toContainText('press Promote to primary');
    const replica = await state(page, () => window.__sdl.S.nodes.find((n) => n.role === 'replica').id);
    await select(page, replica);
    await page.locator('#insp').getByRole('button', { name: 'Promote to primary' }).click();
    await expect(page.locator('#log')).toContainText('roughly 400 writes are missing');
    await fastForward(page, 2);
    await page.click('#exp-crash-primary');
    // Promoting changed the design, so the targets must hold again before the mission completes.
    expect(await state(page, () => window.__sdl.S.done[2])).toBe(false);
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 3 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });

  test('progress is saved under its own key and does not touch Level 2', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await addReplicas(page, ['XL']);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['sdl-level3-v1']);
    await page.goto('about:blank');
    await page.goto('/#level-2/build');
    await page.waitForFunction(() => !!window.__sdl);
    await expect(page.locator('#lvlChip')).toHaveText('Level 2 / 21');
    expect(await state(page, () => window.__sdl.S.nodes.filter((n) => n.type === 'db').length)).toBe(1);
  });
});

test.describe('Level 3 · numbers', () => {
  test('pinned designs match the simulation model', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await calm(page);
    // 1,500 req/s on one XL database: 94% busy. 40 + LB 1/(1 − 0.3) + 0.5 + web 20/(1 − 0.469) + 0.5 + db 10/(1 − 0.9375)
    let r = await measure(page);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.latency).toBeCloseTo(240.1, 1);
    expect(r.spof).toBe(1);
    // Two XL replicas: the primary gets the 150 writes; each replica 675 reads + 150 copied writes.
    await addReplicas(page, ['XL', 'XL']);
    r = await measure(page);
    expect(r.dbs.map((d) => [d.role, Math.round(d.load), Math.round(d.copied || 0)])).toEqual([['primary', 150, 0], ['replica', 825, 150], ['replica', 825, 150]]);
    expect(r.latency).toBeCloseTo(99.76, 1);
    expect(r.spof).toBe(0);
    // Mission 2: 2,000 req/s, 1 in 5 writes, three XL replicas: 533 reads + 400 copied writes each.
    await goTo(page, 1);
    await addReplicas(page, ['XL']);
    await calm(page);
    r = await measure(page);
    expect(r.dbs.filter((d) => d.role === 'replica').map((d) => Math.round(d.load))).toEqual([933, 933, 933]);
    expect(r.latency).toBeCloseTo(117.9, 1);
    expect(r.cost).toBe(2745);
  });

  test('levels 1 and 2 keep their numbers: databases there have no roles', async ({ page }) => {
    await freshPage(page, '#level-2/build');
    await page.evaluate(() => window.__sdl.addNode('lb'));
    expect(await state(page, () => window.__sdl.S.nodes.filter((n) => n.type === 'db').every((n) => n.role === undefined))).toBe(true);
  });
});

test.describe('Level 3 · teaching feedback', () => {
  test('a new database becomes a replica of the primary; connections say writes and reads', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    const [id] = await addReplicas(page, ['XL']);
    await expect(page.locator(`[data-node="${id}"] .node-name`)).toHaveText('Read replica');
    await expect(page.locator('[data-node="b"] .node-name')).toHaveText('Primary DB');
    await expect(page.locator(`[data-node="${id}"] .node-sub`)).toHaveText('XL · 1,600/s');
    await expect(page.locator('.edge-label', { hasText: 'writes' })).not.toHaveCount(0);
    await expect(page.locator('.edge-label', { hasText: 'reads' })).not.toHaveCount(0);
  });

  test('three L replicas look cheap but each also applies every write: 75% busy', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await addReplicas(page, ['L', 'L', 'L']);
    await calm(page);
    const r = await measure(page);
    expect(r.dbs.filter((d) => d.role === 'replica').map((d) => d.util)).toEqual([0.75, 0.75, 0.75]);
    expect(r.served).toBeCloseTo(100, 6);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText(/1[45]\d of its [56]\d\d queries\/s are writes copied from the primary/); // logged while traffic wobbles
    expect((await logText(page)).match(/Read replica is 7\d% busy/g)).toHaveLength(1); // three equal replicas, one line
    await expect(page.locator('#goals')).toContainText('75% max');
  });

  test('the inspector splits a replica\'s load into reads and copied writes', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    const [id] = await addReplicas(page, ['XL', 'XL']);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await select(page, id);
    await expect(page.locator('#inspLive')).toContainText('reads + writes copied from the primary');
  });

  test('two L replicas overload', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await addReplicas(page, ['L', 'L']);
    await calm(page);
    expect((await measure(page)).served).toBeCloseTo(97.3, 1);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('Read replica is over capacity');
  });

  test('a web server connected only to replicas cannot write, and the banner says so', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await addReplicas(page, ['XL', 'XL']);
    await page.evaluate(() => { const s = window.__sdl; s.S.edges = s.S.edges.filter((e) => !(e.from === 'w1' && e.to === 'b')); s.afterDesignChange(); });
    await calm(page);
    const r = await measure(page);
    expect(r.issue).toContain('Writes have nowhere to go');
    expect(r.served).toBeCloseTo(95, 6); // w1's half of the 10% writes fail
    expect(await state(page, () => window.__sdl.model().g.ready)).toBe(true);
  });

  test('with its only replica down, reads go to the primary', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await addReplicas(page, ['XL']);
    await page.click('#playBtn');
    await page.click('#exp-crash-replica');
    await calm(page);
    const r = await measure(page);
    expect(Math.round(r.dbs.find((d) => d.role === 'primary').load)).toBe(1500);
    expect(r.served).toBeCloseTo(100, 6);
  });

  test('Mission 2: the Mission 1 design is 75% busy, and L replicas cannot keep up with the writes', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    const ids = await addReplicas(page, ['XL', 'XL']);
    await goTo(page, 1);
    await calm(page);
    let r = await measure(page);
    expect(r.dbs.filter((d) => d.role === 'replica').map((d) => d.util)).toEqual([0.75, 0.75]);
    await page.evaluate((list) => { const S = window.__sdl.S; for (const id of list) S.nodes.find((n) => n.id === id).size = 'L'; window.__sdl.addNode('db'); }, ids);
    await page.evaluate(() => { const s = window.__sdl, n = s.S.nodes.at(-1); n.size = 'L'; for (const w of ['w1', 'w2']) s.tryConnect(w, n.id); });
    await calm(page);
    r = await measure(page);
    expect(r.served).toBeCloseTo(88.6, 1);
  });

  test('Mission 2: with only two XL replicas, a replica crash leaves too little', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await addReplicas(page, ['XL', 'XL']);
    await goTo(page, 1);
    await page.click('#playBtn');
    await page.click('#exp-crash-replica');
    await calm(page);
    // The last replica gets 1,600 reads + 400 copied writes = 2,000 queries/s against 1,600, so it drops 20%:
    // 1,280 reads + 400 writes served out of 2,000.
    expect((await measure(page)).served).toBeCloseTo(84, 6);
    await page.click('#playBtn');
    await fastForward(page, 3);
    expect(await state(page, () => window.__sdl.S.exp[1]['crash-replica'])).toBe(false);
    await expect(page.locator('#log')).toContainText('Add another replica');
  });

  test('Mission 3: a crashed primary fails every write until a replica is promoted', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await addReplicas(page, ['XL', 'XL', 'XL']);
    await goTo(page, 2);
    await page.click('#playBtn');
    await page.click('#exp-crash-primary');
    await calm(page);
    let r = await measure(page);
    expect(r.served).toBeCloseTo(80, 6);
    expect(r.issue).toContain('The primary database is down');
    const replica = r.dbs.find((d) => d.role === 'replica').id;
    await select(page, replica);
    await page.locator('#insp').getByRole('button', { name: 'Promote to primary' }).click();
    await calm(page);
    r = await measure(page);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.dbs.filter((d) => d.role === 'primary').map((d) => d.id)).toEqual([replica]);
    expect(r.dbs.find((d) => d.id === 'b')).toMatchObject({ role: 'replica', down: true });
    await expect(page.locator('#log')).toContainText('roughly 400 writes are missing');
    // The old primary comes back as a replica.
    await page.click('#exp-crash-primary');
    await expect(page.locator('[data-node="b"] .node-name')).toHaveText('Read replica');
  });

  test('a crashed replica cannot be promoted; a planned promotion loses nothing', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    const [a, b] = await addReplicas(page, ['XL', 'XL']);
    await page.click('#playBtn');
    await page.click('#exp-crash-replica');
    const down = await state(page, () => window.__sdl.S.nodes.find((n) => window.__sdl.model().down.has(n.id)).id);
    await select(page, down);
    await expect(page.locator('#insp').getByRole('button', { name: 'Promote to primary' })).toBeDisabled();
    await page.click('#exp-crash-replica');
    await select(page, down === a ? b : a);
    await page.locator('#insp').getByRole('button', { name: 'Promote to primary' }).click();
    await expect(page.locator('#log')).toContainText('nothing is lost');
    expect(await state(page, () => window.__sdl.S.nodes.filter((n) => n.role === 'primary').length)).toBe(1);
  });

  test('roles survive a reload; bad saved roles load as replicas with one primary', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await addReplicas(page, ['XL', 'XL']);
    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.nodes.filter((n) => n.type === 'db').map((n) => n.role))).toEqual(['primary', 'replica', 'replica']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level3-v1'));
      const dbs = saved.nodes.filter((n) => n.type === 'db');
      dbs[0].role = 'primary'; dbs[1].role = 'primary'; dbs[2].role = 'boss';
      localStorage.setItem('sdl-level3-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.nodes.filter((n) => n.type === 'db').map((n) => n.role))).toEqual(['primary', 'replica', 'replica']);
  });

  test('the estimate box asks for peak writes and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await page.evaluate(() => { const S = window.__sdl.S; S.done[0] = true; S.verified[0] = true; S.mission = 1; window.__sdl.afterChange(true); });
    await page.fill('#estIn', '200');
    await page.click('#estBtn');
    await expect(page.locator('#estFb')).toContainText('average write rate');
    await page.fill('#estIn', '2,000');
    await page.click('#estBtn');
    await expect(page.locator('#estFb')).toContainText('Only 1 in 5 is a write');
    await page.fill('#estIn', '1000');
    await page.click('#estBtn');
    await expect(page.locator('#estFb')).toContainText('Double it for peak');
    await page.fill('#estIn', '400');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });
});

test.describe('Level 3 · fixes from QA', () => {
  test('Mission 2: the replica crash takes down the one the others can least cover for', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await goTo(page, 1);
    await page.evaluate(() => { window.__sdl.S.nodes.find((n) => n.id === 'b').size = 'L'; });
    const [a, b] = await addReplicas(page, ['XL', 'XL']);
    const [c] = await addReplicas(page, ['XL'], { connect: false });
    await page.evaluate((id) => { window.__sdl.tryConnect('w2', id); window.__sdl.afterDesignChange(); }, c);
    await page.click('#playBtn');
    await page.click('#exp-crash-replica');
    const down = await page.evaluate(() => [...window.__sdl.model().down]);
    expect([a, b]).toContain(down[0]);
    const served = await page.evaluate(() => window.__sdl.model({ peak: true }).servedPct);
    expect(served).toBeGreaterThan(98);
    expect(served).toBeLessThan(99);
    await fastForward(page, 3);
    expect(await state(page, () => window.__sdl.S.exp[1]['crash-replica'])).toBe(false);
  });

  test('Mission 3: an old primary that comes back smaller is explained, and promoting it back finishes the mission', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await goTo(page, 2);
    await page.evaluate(() => { window.__sdl.S.nodes.find((n) => n.id === 'b').size = 'L'; });
    const [r1] = await addReplicas(page, ['XL', 'XL', 'XL']);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash-primary');
    await select(page, r1);
    await page.locator('#insp').getByRole('button', { name: 'Promote to primary' }).click();
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[2]['crash-primary'])).toBe(true);
    await page.click('#exp-crash-primary'); // restart the old primary: it comes back as a replica, and it is an L
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('It was the primary and is smaller than the other replicas.');
    expect(await state(page, () => window.__sdl.S.done[2])).toBe(false);
    await select(page, 'b');
    await page.locator('#insp').getByRole('button', { name: 'Promote to primary' }).click();
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[2])).toBe(true);
  });

  test('Mission 3: resizing the old primary is a design change, so the crash test runs again', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    await goTo(page, 2);
    await page.evaluate(() => { window.__sdl.S.nodes.find((n) => n.id === 'b').size = 'L'; });
    const [r1] = await addReplicas(page, ['XL', 'XL', 'XL']);
    await page.click('#playBtn');
    await page.click('#exp-crash-primary');
    await select(page, r1);
    await page.locator('#insp').getByRole('button', { name: 'Promote to primary' }).click();
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[2]['crash-primary'])).toBe(true); // promoting kept nothing from counting
    await page.click('#exp-crash-primary');
    await page.evaluate(() => { const s = window.__sdl; s.S.nodes.find((n) => n.id === 'b').size = 'XL'; s.afterDesignChange(); });
    expect(await state(page, () => window.__sdl.S.exp[2]['crash-primary'])).toBe(false);
  });

  for (const [w, h] of [[1440, 900], [390, 844]]) {
    test(`${w} px: a primary and three replicas, with no label overflow and no line under a database`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-3/build');
      await addReplicas(page, ['XL', 'XL', 'XL']);
      const bad = await page.evaluate(() => {
        const problems = [], svg = document.getElementById('cv');
        const boxes = [...svg.querySelectorAll('[data-node]')].map((g) => {
          const r = g.querySelector('.node-box').getBBox(), m = g.transform.baseVal.consolidate().matrix;
          const sub = g.querySelector('.node-sub');
          if (sub && sub.getBBox().x + sub.getBBox().width > r.width - 4) problems.push('overflow ' + g.dataset.node);
          return { id: g.dataset.node, x0: m.e, y0: m.f, x1: m.e + r.width, y1: m.f + r.height };
        });
        const crosses = (l, b) => { // sample the segment
          for (let t = 0.02; t < 0.98; t += 0.01) { const x = l.x1 + (l.x2 - l.x1) * t, y = l.y1 + (l.y2 - l.y1) * t; if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true; }
          return false;
        };
        for (const e of window.__sdl.S.edges) {
          const line = svg.querySelector(`[data-edge="${e.id}"] .edge-line`);
          const l = { x1: +line.getAttribute('x1'), y1: +line.getAttribute('y1'), x2: +line.getAttribute('x2'), y2: +line.getAttribute('y2') };
          for (const b of boxes) if (b.id !== e.from && b.id !== e.to && crosses(l, b)) problems.push(`${e.from}→${e.to} under ${b.id}`);
        }
        return problems;
      });
      expect(bad).toEqual([]);
    });
  }

  test('sentences name the primary database in full, and Promote has room under it', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    const [r] = await addReplicas(page, ['XL']);
    await select(page, 'b');
    await expect(page.locator('#insp [data-focus-key="remove"]')).toHaveText('Remove primary database');
    await select(page, r);
    const gap = await page.evaluate(() => {
      const btn = document.querySelector('#insp [data-focus-key="promote"]'), note = btn.nextElementSibling;
      return note.getBoundingClientRect().top - btn.getBoundingClientRect().bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(6);
  });
});

test.describe('Level 3 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-3/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    for (let i = 0; i < 2; i++) await enter('.pal-item[data-type="db"]');
    const ids = await state(page, () => window.__sdl.S.nodes.filter((n) => n.role === 'replica').map((n) => n.id));
    for (const id of ids) {
      await enter(`[data-node="${id}"]`);
      await enter('#insp .seg button:nth-child(4)'); // XL
      while (await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).count()) {
        await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
        await page.keyboard.press('Enter');
      }
    }
    expect((await measure(page)).cost).toBe(2295);
    await enter('#playBtn');
    await fastForward(page, 5);
    await enter('#exp-crash-replica');
    await fastForward(page, 2);
    await enter('#exp-crash-replica');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll with every database', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-3/build');
    await addReplicas(page, ['XL', 'XL', 'XL']);
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-3/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-3/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            const [id] = await addReplicas(page, ['XL', 'XL']);
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
