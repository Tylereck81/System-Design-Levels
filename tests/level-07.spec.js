import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors } from './helpers.js';

// Level 7: Multiple data centers.
// The level starts with one data center in Frankfurt ('f', size L, standing for Level 6's whole design), DNS ('d',
// plain), the CDN ('k') and Users ('u'). 30% of shoppers are in America.

/** Add a data center in Virginia, connected from Users, and return its id. */
const addVirginia = (page, size = 'S') => page.evaluate((sz) => {
  const s = window.__sdl;
  s.addNode('dc');
  const n = s.S.nodes.at(-1); Object.assign(n, { region: 'far', size: sz });
  s.tryConnect('u', n.id);
  s.afterDesignChange();
  return n.id;
}, size);
const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; S.est = true; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => {
  const s = window.__sdl, m = s.model(), at = (id) => m.node[id] || {};
  const v = s.S.nodes.find((n) => n.type === 'dc' && n.region === 'far');
  return { served: m.servedPct, latency: m.latency, cost: m.cost, spof: m.spof, farPageMs: m.farPageMs, noData: m.noDataPct, lagWrites: m.lagWrites, f: at('f').util, v: v ? at(v.id).util : null };
});
const calm = (page) => page.evaluate(() => { const s = window.__sdl; s.run.playing = false; s.run.t = 0; });
const select = async (page, id) => { await page.focus(`[data-node="${id}"]`); await page.keyboard.press('Enter'); };
const set = (page, id, props) => page.evaluate(([i, p]) => { Object.assign(window.__sdl.S.nodes.find((n) => n.id === i), p); window.__sdl.afterDesignChange(); }, [id, props]);
const connect = (page, a, b) => page.evaluate(([x, y]) => window.__sdl.tryConnect(x, y), [a, b]);

test.describe('Level 7 · playthrough', () => {
  test('both missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-7/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 7 / 21');

    // Mission 1: Virginia, GeoDNS and a smaller Frankfurt, through the inspector.
    await page.locator('.pal-item[data-type="dc"]').click();
    const v = await state(page, () => window.__sdl.S.nodes.at(-1).id);
    await page.locator('#insp').getByRole('button', { name: /^Virginia/ }).click();
    await page.locator('#insp .conn').getByRole('button', { name: 'Connect' }).first().click(); // Users → Virginia DC
    await expect(page.locator(`[data-node="${v}"] .node-name`)).toHaveText('Virginia DC ');
    await select(page, 'd');
    await page.locator('#insp').getByRole('button', { name: /^GeoDNS/ }).click();
    await select(page, 'f');
    await page.locator('#insp [data-focus-key="size-M"]').click();
    expect((await measure(page)).cost).toBe(2942);
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);

    // Mission 2: estimate, make Frankfurt big enough, replicate Virginia to it, take Virginia offline.
    await page.click('#mission .complete button');
    await page.fill('#estIn', '2,000');
    await page.click('#estBtn');
    await select(page, 'f');
    await page.locator('#insp [data-focus-key="size-L"]').click();
    await connect(page, v, 'f');
    await expect(page.locator('.edge-label', { hasText: 'replicates' })).not.toHaveCount(0);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-dc-offline');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('about 120 writes had not arrived yet');
    await page.click('#exp-dc-offline');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true]);
    expect(await logText(page)).toContain('Level 7 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 7 · numbers', () => {
  test('pinned designs match the simulation model', async ({ page }) => {
    await freshPage(page, '#level-7/build');
    await calm(page);
    // Start: one data center in Frankfurt. A page for America: 120 ms there and back + 50 ms inside.
    let r = await measure(page);
    expect(r.cost).toBe(2742);
    expect(r.farPageMs).toBeCloseTo(170, 6);
    expect(r.f).toBeCloseTo(2000 / 2400, 3);
    expect(r.spof).toBe(1);
    // Virginia with GeoDNS: 40 + 50 = 90 ms; each data center gets its own region.
    await addVirginia(page);
    await set(page, 'd', { routing: 'geo' });
    await calm(page);
    r = await measure(page);
    expect(r.farPageMs).toBeCloseTo(90, 6);
    expect(r.v).toBeCloseTo(600 / 800, 3);
    expect(r.f).toBeCloseTo(1400 / 2400, 3);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.cost).toBe(3442);
    expect(r.spof).toBe(0);
  });

  test('levels without data centers ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-6/build');
    const r = await measure(page);
    expect(r.farPageMs).toBeNull();
    expect(r.noData).toBe(0);
    expect(r.cost).toBe(3042);
  });
});

test.describe('Level 7 · teaching feedback', () => {
  test('plain DNS spreads both regions over both data centers', async ({ page }) => {
    await freshPage(page, '#level-7/build');
    await addVirginia(page);
    await calm(page);
    const r = await measure(page);
    expect(r.noData).toBeCloseTo(25, 6); // shoppers landing where their data isn't
    expect(r.v).toBeCloseTo(1000 / 800, 3); // half of all pages on Virginia
    expect(r.served).toBeLessThan(80);
  });

  test('Frankfurt sized for Europe alone fails over badly; without replication the data is missing', async ({ page }) => {
    await freshPage(page, '#level-7/build');
    await goTo(page, 1);
    const v = await addVirginia(page);
    await set(page, 'd', { routing: 'geo' });
    await set(page, 'f', { size: 'M' });
    await page.click('#playBtn');
    await page.click('#exp-dc-offline');
    await calm(page);
    let r = await measure(page);
    expect(r.noData).toBeCloseTo(15, 6);
    await page.click('#playBtn');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('only in Virginia');
    await connect(page, v, 'f');
    await calm(page);
    r = await measure(page);
    expect(r.noData).toBe(0);
    expect(r.served).toBeCloseTo(90, 1); // 2,000 pages a second on a data center built for 1,600
    await page.click('#playBtn');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('over capacity');
    expect(await state(page, () => window.__sdl.S.exp[window.__sdl.S.mission]['dc-offline'])).toBe(false);
    await set(page, 'f', { size: 'L' });
    await calm(page);
    r = await measure(page);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.farPageMs).toBeCloseTo(170, 6);
    expect(r.lagWrites).toBeCloseTo(120, 6);
  });

  test('plain DNS keeps sending shoppers to the dead data center', async ({ page }) => {
    await freshPage(page, '#level-7/build');
    await goTo(page, 1);
    const v = await addVirginia(page);
    await connect(page, v, 'f'); await connect(page, 'f', v);
    await page.click('#playBtn');
    await page.click('#exp-dc-offline');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('plain DNS still hands out Virginia');
    await calm(page);
    expect((await measure(page)).served).toBeCloseTo(75, 6);
  });

  test('replication connects data centers both ways and disconnects one way at a time', async ({ page }) => {
    await freshPage(page, '#level-7/build');
    const v = await addVirginia(page);
    await connect(page, v, 'f'); await connect(page, 'f', v);
    const between = () => state(page, () => window.__sdl.S.edges.filter((e) => ['f'].includes(e.from) !== ['f'].includes(e.to) && e.from !== 'u' && e.from !== 'k' && e.to !== 'u').length);
    expect(await between()).toBe(2);
    await select(page, 'f');
    await page.locator('#insp .conn', { hasText: 'Frankfurt DC → Virginia DC' }).getByRole('button', { name: 'Disconnect' }).click();
    expect(await between()).toBe(1);
    expect(await state(page, () => window.__sdl.S.edges.some((e) => e.to === 'f' && e.from !== 'u' && e.from !== 'k'))).toBe(true);
    await page.evaluate(() => window.__sdl.tryConnect('f', 'd'));
    await expect(page.locator('#log')).toContainText('DNS answers name lookups off the request path');
  });

  test('request dots: pages go to the nearest data center and back', async ({ page }) => {
    await freshPage(page, '#level-7/build');
    const v = await addVirginia(page);
    await set(page, 'd', { routing: 'geo' });
    const routes = await page.evaluate(() => { const s = window.__sdl, m = s.model(); return Array.from({ length: 1000 }, () => s.sampleRoute(m)); });
    const toV = routes.filter((r) => r.route[1] === v), toF = routes.filter((r) => r.route[1] === 'f');
    expect(toV.length).toBeGreaterThan(80);
    expect(toF.length).toBeGreaterThan(toV.length);
    expect(toV.concat(toF).every((r) => r.route.length === 3 && r.failAt < 0)).toBe(true);
  });

  test('the inspector shows each data center\'s location, size and load', async ({ page }) => {
    await freshPage(page, '#level-7/build');
    await expect(page.locator('[data-node="f"] .node-sub')).toHaveText('L · 2,400 pages/s');
    await expect(page.locator('[data-node="d"] .node-sub')).toHaveText('Same answer for all');
    await select(page, 'f');
    await expect(page.locator('#insp')).toContainText('Size (pages/s at peak)');
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#inspLive')).toContainText('83%');
    await select(page, 'd');
    await page.locator('#insp').getByRole('button', { name: /^GeoDNS/ }).click();
    await expect(page.locator('[data-node="d"] .node-sub')).toHaveText('GeoDNS');
  });

  test('settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-7/build');
    const v = await addVirginia(page, 'M');
    await set(page, 'd', { routing: 'geo' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = (id) => window.__sdl.S.nodes.find((x) => x.id === id); return [n('d').routing, n(window.__sdl.S.nodes.at(-1).id).region, n(window.__sdl.S.nodes.at(-1).id).size]; });
    expect(await get()).toEqual(['geo', 'far', 'M']);
    await page.evaluate((id) => {
      const saved = JSON.parse(localStorage.getItem('sdl-level7-v1'));
      Object.assign(saved.nodes.find((n) => n.id === 'd'), { routing: 'magic' });
      Object.assign(saved.nodes.find((n) => n.id === id), { region: 'moon', size: 'XL' });
      localStorage.setItem('sdl-level7-v1', JSON.stringify(saved));
    }, v);
    await reloadGame(page);
    expect(await get()).toEqual(['rr', 'near', 'S']);
  });

  test('the failover estimate accepts "2,000" and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-7/build');
    await goTo(page, 1);
    await page.evaluate(() => { window.__sdl.S.est = false; window.__sdl.afterChange(true); });
    for (const [v, hint] of [['1,400', 'Europe alone'], ['600', 'America alone'], ['4000', 'counts files too']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '2,000 pages/s');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });
});

test.describe('Level 7 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-7/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    await enter('.pal-item[data-type="dc"]');
    const v = await state(page, () => window.__sdl.S.nodes.at(-1).id);
    await enter(`[data-node="${v}"]`);
    await enter('#insp [data-focus-key="region-far"]');
    await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
    await page.keyboard.press('Enter');
    await enter('[data-node="d"]');
    await enter('#insp [data-focus-key="routing-geo"]');
    await enter('[data-node="f"]');
    await enter('#insp [data-focus-key="size-M"]');
    expect((await measure(page)).cost).toBe(2942);
    await enter('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll with two data centers', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-7/build');
    await addVirginia(page);
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-7/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-7/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            const v = await addVirginia(page);
            await connect(page, v, 'f');
            await page.click('#playBtn'); await playFor(page, 0.5);
            await select(page, 'd');
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
