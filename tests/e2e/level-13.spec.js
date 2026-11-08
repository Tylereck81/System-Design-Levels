import { test, expect } from '../fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors } from '../helpers.js';

// Level 13: Unique ID generator.
// The level starts inside one data center: Users ('u'), DNS ('d'), one load balancer ('l'), two autoscaled groups of
// L web servers ('w1', 'w2') and an ID generator ('i') set to UUIDs. 3,000 requests a second, 4 new IDs each.

const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; S.est = true; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model({ peak: true }), i = m.node.i || {};
  return { served: m.servedPct, cost: m.cost, dup: m.idDupPct, bits: m.idBits, numeric: m.idNumeric, ordered: m.idOrdered, idSpof: m.idSpof, made: m.idMade, spof: m.spof, want: i.load, cap: i.cap, ms: i.ms, latency: m.latency };
});
const select = async (page, id) => { await page.focus(`[data-node="${id}"]`); await page.keyboard.press('Enter'); };
const set = (page, props) => page.evaluate((p) => { Object.assign(window.__sdl.S.nodes.find((n) => n.id === 'i'), p); window.__sdl.afterDesignChange(); }, props);
/** An experiment without the clock: the model while it runs. */
const during = (page, id) => page.evaluate((x) => { window.__sdl.run.on = x ? { [x]: {} } : {}; }, id);
const click = (page, key) => page.locator(`#insp [data-focus-key="${key}"]`).click();
/** Pause the simulation, so the panels stay still while a slow browser clicks through them. */
const pause = (page) => page.evaluate(() => { if (window.__sdl.run.playing) window.__sdl.togglePlay(); });
/** Run an experiment for 2 simulated seconds and stop it. */
const breakIt = async (page, id) => { await page.click(`#exp-${id}`); await fastForward(page, 2); await page.click(`#exp-${id}`); };

test.describe('Level 13 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-13/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 13 / 21');

    // Mission 1: estimate 4 servers, then multi-primary on 4 (through the inspector), then lose one.
    await page.fill('#estIn', '4');
    await page.click('#estBtn');
    await select(page, 'i');
    await click(page, 'method-step');
    await click(page, 'servers-4');
    await expect(page.locator('[data-node="i"] .node-sub')).toHaveText('Multi-primary · 4 servers');
    expect((await measure(page)).cost).toBe(1875);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'lose');
    await expect(page.locator('#log')).toContainText('with one generator server down, 100.0% of requests were still served');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await pause(page);

    // Mission 2: timestamp-based generators take a new server without repeats.
    await page.click('#mission .complete button');
    await select(page, 'i');
    await click(page, 'method-snow');
    await click(page, 'servers-2');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'add');
    await expect(page.locator('#log')).toContainText('a server joined, and no ID repeated');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    await pause(page);

    // Mission 3: in time order, and a generator waits when its clock goes back.
    await page.click('#mission .complete button');
    await select(page, 'i');
    await click(page, 'clock-wait');
    await expect(page.locator('[data-node="i"] .node-sub')).toHaveText('Timestamp-based · 2 servers · waits');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'clock');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 13 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 13 · numbers', () => {
  test('each method: bits, numbers, order, rate and cost', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    // 3,000 requests a second at the top of the wobble (×1.03), 4 IDs each.
    let r = await measure(page);
    expect(r.want).toBeCloseTo(3000 * 1.03 * 4, 6);
    expect(r).toMatchObject({ cost: 1475, dup: 0, bits: 128, numeric: false, ordered: false, idSpof: false, served: 100, ms: 0 });
    expect(r.cap).toBe(Infinity); // no limit: the web servers make them
    for (const [method, servers, cost, cap, ordered, ms] of [['ticket', '1', 1575, 5000, true, 2], ['step', '1', 1575, 5000, true, 2], ['step', '3', 1775, 15000, false, 2], ['snow', '2', 1675, 8192000, true, 1]]) {
      await set(page, { method, servers });
      r = await measure(page);
      expect([method, servers, r.cost, r.cap, r.ordered, r.ms, r.bits, r.numeric, r.dup]).toEqual([method, servers, cost, cap, ordered, ms, 64, true, 0]);
      expect(r.idSpof).toBe(servers === '1');
      expect(r.spof).toBe(servers === '1' ? 2 : 1); // the load balancer, and a generator on one server
    }
    // One ticket server makes 5,000 of the 12,360 IDs a second asked for.
    await set(page, { method: 'ticket', servers: '1' });
    r = await measure(page);
    expect(r.served).toBeCloseTo(100 * 5000 / 12360, 6);
    expect(r.spof).toBe(2); // the load balancer and the ticket server
    // Two ticket servers each count 1, 2, 3…: every number is handed out twice.
    await set(page, { servers: '2' });
    r = await measure(page);
    expect(r.dup).toBeCloseTo(50, 9);
    expect(r.ordered).toBe(false);
  });

  test('break it: a server down, a server added, a clock set back', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    // Multi-primary on 3: one down leaves 10,000 IDs a second; on 4, 15,000.
    await set(page, { method: 'step', servers: '3' });
    await during(page, 'lose');
    let r = await measure(page);
    expect(r.cap).toBe(10000);
    expect(r.served).toBeCloseTo(100 * 10000 / 12360, 6);
    await set(page, { servers: '4' });
    expect((await measure(page)).served).toBe(100);
    // A ticket server down: nothing gets an ID.
    await set(page, { method: 'ticket', servers: '1' });
    expect((await measure(page)).served).toBe(0);
    // A fifth multi-primary server counts onto numbers already handed out: its share, 1 in 5, repeats.
    await set(page, { method: 'step', servers: '4' });
    await during(page, 'add');
    r = await measure(page);
    expect(r.dup).toBeCloseTo(20, 9);
    expect(r.cap).toBe(25000);
    // A new timestamp-based generator has its own machine ID.
    await set(page, { method: 'snow', servers: '2' });
    expect((await measure(page)).dup).toBe(0);
    // A clock set back: the generator's share of the IDs repeats, unless it waits 20 ms (10 ms on average over 2).
    await during(page, 'clock');
    r = await measure(page);
    expect([r.dup, r.ordered, r.ms]).toEqual([50, false, 1]);
    await set(page, { clock: 'wait' });
    r = await measure(page);
    expect([r.dup, r.ordered, r.ms]).toEqual([0, true, 11]);
    // Only timestamp-based IDs read the clock.
    await set(page, { method: 'step', clock: 'keep' });
    expect((await measure(page)).dup).toBe(0);
    await during(page, null);
    await set(page, { method: 'snow' });
    expect((await measure(page)).dup).toBe(0);
  });

  test('levels without an ID generator ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-12/build');
    const r = await page.evaluate(() => { const m = window.__sdl.model(); return { dup: m.idDupPct, bits: m.idBits, cost: m.cost }; });
    expect(r.dup).toBeNull();
    expect(r.bits).toBeNull();
    expect(r.cost).toBe(1509);
  });
});

test.describe('Level 13 · teaching feedback', () => {
  test('UUIDs: the goals show 128 bits of hex text', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    await goTo(page, 0);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'IDs fit in 64 bits' })).toHaveClass(/fail/);
    await expect(page.locator('#goals li', { hasText: 'IDs fit in 64 bits' })).toContainText('128 bits');
    await expect(page.locator('#goals li', { hasText: 'IDs are numbers only' })).toContainText('hex text');
    await expect(page.locator('#goals li', { hasText: 'Every ID is unique' })).toHaveClass(/pass/);
  });

  test('two ticket servers: the log says they repeat each other', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    await goTo(page, 0);
    await set(page, { method: 'ticket', servers: '2' });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#log')).toContainText('Each ticket server counts 1, 2, 3… on its own, so 50% of IDs repeat');
  });

  test('multi-primary on 3: a server down fails the break-it, and the log says why', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    await goTo(page, 0);
    await set(page, { method: 'step', servers: '3' });
    await page.click('#playBtn');
    await page.click('#exp-lose');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[0].lose)).toBe(false);
    await expect(page.locator('#log')).toContainText('the generator makes 10,000 of the 12,000 IDs a second needed');
  });

  test('adding a multi-primary server: IDs repeat, and the log explains the step', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    await goTo(page, 1);
    await set(page, { method: 'step', servers: '4' });
    await page.click('#playBtn');
    await page.click('#exp-add');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[1].add)).toBe(false);
    await expect(page.locator('#log')).toContainText('20% of IDs repeat one already handed out');
    await expect(page.locator('#log')).toContainText('Multi-primary can\'t grow without renumbering every server');
  });

  test('a clock set back: keep going repeats IDs; multi-primary is not in time order', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    await goTo(page, 2);
    await set(page, { method: 'snow', servers: '2' });
    await page.click('#playBtn');
    await page.click('#exp-clock');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('50% of IDs repeat, and go backwards in time');
    await page.click('#exp-clock');
    await set(page, { method: 'step', servers: '4' });
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'An ID made later is always larger' })).toHaveClass(/fail/);
  });

  test('the inspector shows the rate, the format and repeats', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    await goTo(page, 0);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await pause(page);
    await select(page, 'i');
    await expect(page.locator('#inspLive')).toContainText('no limit');
    await expect(page.locator('#inspLive')).toContainText('128 bits');
    await expect(page.locator('#inspLive')).toContainText('written as hex digits and dashes, not in time order');
    await click(page, 'method-ticket');
    await click(page, 'servers-2');
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#inspLive')).toContainText('10,000');
    await expect(page.locator('#inspLive')).toContainText('IDs/s on 2 servers');
    await expect(page.locator('#inspLive')).toContainText('of IDs repeat one already made');
  });

  test('generator settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    await set(page, { method: 'snow', servers: '3', clock: 'wait' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = window.__sdl.S.nodes.find((x) => x.id === 'i'); return [n.method, n.servers, n.clock]; });
    expect(await get()).toEqual(['snow', '3', 'wait']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level13-v1'));
      Object.assign(saved.nodes.find((n) => n.id === 'i'), { method: 'guid', servers: '9', clock: 'later' });
      localStorage.setItem('sdl-level13-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['uuid', '1', 'keep']);
  });

  test('the estimate accepts 4 and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    for (const [v, hint] of [['3', 'with one down only 10,000'], ['2', 'even with all running you need 3'], ['6', 'fewer are enough']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '4 servers');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });

  test('the lesson diagrams are drawn', async ({ page }) => {
    await freshPage(page, '#level-13/lesson');
    await expect(page.locator('#figStep')).toContainText('2, 4, 6, 8…');
    await expect(page.locator('#figBits')).toContainText('timestamp');
    await expect(page.locator('#figBits')).toContainText('12 bits');
  });
});

test.describe('Level 13 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    await page.focus('#estIn');
    await page.keyboard.type('4');
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
    await enter('[data-node="i"]');
    await enter('#insp [data-focus-key="method-snow"]');
    await enter('#insp [data-focus-key="servers-2"]');
    await enter('#playBtn');
    await fastForward(page, 5);
    await enter('#exp-lose');
    await fastForward(page, 2);
    await enter('#exp-lose');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-13/build');
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    await select(page, 'i');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-13/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-13/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            await page.evaluate(() => { window.__sdl.S.est = true; window.__sdl.afterChange(true); });
            await page.click('#playBtn'); await playFor(page, 0.5);
            await select(page, 'i');
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
