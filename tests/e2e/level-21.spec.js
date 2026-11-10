import { test, expect } from '../fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors, openMission, selectNode, setProps, pressEnterOn } from '../helpers.js';

// Level 21: Cloud file sync.
// Users ('u') → one load balancer ('l') → block servers ('b': 2, whole files, no compression) → cloud storage ('s':
// every version, no cold tier, no dedupe); the load balancer → notification servers ('n': 4). 556 uploads a second.

const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model({ peak: true });
  return { qps: m.qps, served: m.servedPct, cost: m.cost, o: m.sync, spof: m.spof };
});
const during = (page, id) => page.evaluate((x) => { window.__sdl.run.on = x ? { [x]: {} } : {}; }, id);
/** Add a standby load balancer connected from Users to the block and notification servers; returns its id. */
const addStandby = (page) => page.evaluate(() => {
  const s = window.__sdl, S = s.S;
  s.addNode('lb');
  const n = S.nodes.at(-1);
  s.tryConnect('u', n.id); s.tryConnect(n.id, 'b'); s.tryConnect(n.id, 'n'); s.afterDesignChange();
  return n.id;
});
const click = (page, key) => page.locator(`#insp [data-focus-key="${key}"]`).click();
const pause = (page) => page.evaluate(() => { if (window.__sdl.run.playing) window.__sdl.togglePlay(); });
const breakIt = async (page, id) => { await page.click(`#exp-${id}`); await fastForward(page, 2); await page.click(`#exp-${id}`); };

test.describe('Level 21 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-21/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 21 / 21');

    // Mission 1: estimate 600 PB, delta sync and compression, a standby load balancer; the active one fails.
    await page.fill('#estIn', '600');
    await page.click('#estBtn');
    await selectNode(page, 'b');
    await click(page, 'delta-delta');
    await click(page, 'compress-on');
    await expect(page.locator('[data-node="b"] .node-sub')).toHaveText('2 servers · delta · compressed');
    await addStandby(page);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'lbdown');
    await expect(page.locator('#log')).toContainText('still synced through the standby');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await pause(page);

    // Mission 2: 7 notification servers; one dies.
    await page.click('#mission .complete button');
    await selectNode(page, 'n');
    await click(page, 'count-7');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'polldown');
    await expect(page.locator('#log')).toContainText('every device was back in 48 s');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    await pause(page);

    // Mission 3: keep 10 versions and move idle data to cold storage; data grows.
    await page.click('#mission .complete button');
    await selectNode(page, 's');
    await click(page, 'versions-ten');
    await click(page, 'cold-on');
    await expect(page.locator('[data-node="s"] .node-sub')).toHaveText('10 versions · cold tier');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'growth');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 21 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 21 · numbers', () => {
  test('bytes per upload: whole files, changed blocks, compression', async ({ page }) => {
    await freshPage(page, '#level-21/build');
    // 70% new files of 0.4 MB; 30% edits of 20 MB files changing about 1 MB. 556 × 1.03 uploads against 2 × 125 MB/s.
    let r = await measure(page);
    expect(r.o.mbPerUpload).toBeCloseTo(0.7 * 0.4 + 0.3 * 20, 9);
    expect(r.served).toBeCloseTo(100 * 250 / (572.68 * 6.28), 4);
    await setProps(page, 'b', { delta: 'delta' });
    r = await measure(page);
    expect(r.o.mbPerUpload).toBeCloseTo(0.58, 9);
    expect(r.served).toBeCloseTo(100 * 250 / (572.68 * 0.58), 4);
    await setProps(page, 'b', { compress: 'on' });
    r = await measure(page);
    expect([r.o.mbPerUpload, r.served]).toEqual([expect.closeTo(0.29, 9), 100]);
    expect(r.spof).toBe(1); // the one load balancer
  });

  test('a notification server dies: reconnect time by server count', async ({ page }) => {
    await freshPage(page, '#level-21/build');
    await during(page, 'polldown');
    for (const [count, secs] of [['4', Infinity], ['5', 800000 / 8000], ['6', 4e6 / 6 / 10000], ['7', 4e6 / 7 / 12000], ['8', 500000 / 14000]]) {
      await setProps(page, 'n', { count });
      const s = (await measure(page)).o.reconnectS;
      expect([count, s]).toEqual([count, secs === Infinity ? Infinity : expect.closeTo(secs, 6)]);
    }
  });

  test('the storage bill: versions, cold storage, dedupe, growth', async ({ page }) => {
    await freshPage(page, '#level-21/build');
    // 60 million GB × 2.5 versions × 2 regions × $0.02.
    let r = await measure(page);
    expect(r.o.bill).toBeCloseTo(60e6 * 2.5 * 2 * 0.02, 3);
    await setProps(page, 's', { versions: 'ten', cold: 'on' });
    r = await measure(page);
    expect(r.o.bill).toBeCloseTo(60e6 * 1.3 * 2 * (0.3 * 0.02 + 0.7 * 0.004), 3);
    await setProps(page, 's', { dedupe: 'on' });
    expect((await measure(page)).o.bill).toBeCloseTo(60e6 * 1.3 * 0.85 * 2 * (0.3 * 0.02 + 0.7 * 0.004), 3);
    await during(page, 'growth');
    expect((await measure(page)).o.bill).toBeCloseTo(1.3 * 60e6 * 1.3 * 0.85 * 2 * (0.3 * 0.02 + 0.7 * 0.004), 3);
  });

  test('levels without file sync ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-20/build');
    expect(await page.evaluate(() => window.__sdl.model().sync)).toBeNull();
  });
});

test.describe('Level 21 · teaching feedback', () => {
  test('one load balancer fails: the log says to add a standby', async ({ page }) => {
    await freshPage(page, '#level-21/build');
    await openMission(page, 0, { estimate: true });
    await setProps(page, 'b', { delta: 'delta', compress: 'on' });
    await page.click('#playBtn');
    await page.click('#exp-lbdown');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[0].lbdown)).toBe(false);
    await expect(page.locator('#log')).toContainText('every request enters through one load balancer. Add a standby');
  });

  test('6 notification servers: the log gives the 67 s to reconnect', async ({ page }) => {
    await freshPage(page, '#level-21/build');
    await openMission(page, 1, { estimate: true });
    await setProps(page, 'b', { delta: 'delta', compress: 'on' });
    await setProps(page, 'n', { count: '6' });
    await page.click('#playBtn');
    await page.click('#exp-polldown');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('It takes 67 s to get every device back');
  });

  test('every version, all hot: Mission 3\'s budget fails at $6.00M', async ({ page }) => {
    await freshPage(page, '#level-21/build');
    await openMission(page, 2, { estimate: true });
    await setProps(page, 'b', { delta: 'delta', compress: 'on' });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'Spend at most $2.00M' })).toHaveClass(/fail/);
    await expect(page.locator('#goals li', { hasText: 'Spend at most $2.00M' })).toContainText('$6.00M');
  });

  test('the inspector shows bytes per upload and connections per server', async ({ page }) => {
    await freshPage(page, '#level-21/build');
    await openMission(page, 0, { estimate: true });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await pause(page);
    await selectNode(page, 'b');
    await expect(page.locator('#inspLive')).toContainText('6.28 MB');
    await expect(page.locator('#inspLive')).toContainText('sent per upload, whole files');
    await selectNode(page, 'n');
    await expect(page.locator('#inspLive')).toContainText('1,000,000');
  });

  test('settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-21/build');
    await setProps(page, 'b', { count: '4', delta: 'delta', compress: 'on' });
    await setProps(page, 'n', { count: '8' });
    await setProps(page, 's', { versions: 'ten', cold: 'on', dedupe: 'on' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = (id) => window.__sdl.S.nodes.find((x) => x.id === id); return [n('b').count, n('b').delta, n('b').compress, n('n').count, n('s').versions, n('s').cold, n('s').dedupe]; });
    expect(await get()).toEqual(['4', 'delta', 'on', '8', 'ten', 'on', 'on']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level21-v1'));
      const n = (id) => saved.nodes.find((x) => x.id === id);
      Object.assign(n('b'), { count: '5', delta: 'some', compress: 'zip' }); n('n').count = '3'; Object.assign(n('s'), { versions: '100', cold: 'ice', dedupe: 'yes' });
      localStorage.setItem('sdl-level21-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['2', 'whole', 'off', '4', 'all', 'off', 'off']);
  });

  test('the estimate accepts 600 and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-21/build');
    for (const [v, hint] of [['120', 'only daily users'], ['60', 'Check the units']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '600 PB');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });

  test('the lesson diagram is drawn', async ({ page }) => {
    await freshPage(page, '#level-21/lesson');
    await expect(page.locator('#figBlocks')).toContainText('only 2 and 5');
  });
});

test.describe('Level 21 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-21/build');
    await page.focus('#estIn');
    await page.keyboard.type('600');
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
    await pressEnterOn(page, '[data-node="b"]');
    await pressEnterOn(page, '#insp [data-focus-key="delta-delta"]');
    await pressEnterOn(page, '#insp [data-focus-key="compress-on"]');
    await addStandby(page);
    await pressEnterOn(page, '#playBtn');
    await fastForward(page, 5);
    await pressEnterOn(page, '#exp-lbdown');
    await fastForward(page, 2);
    await pressEnterOn(page, '#exp-lbdown');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-21/build');
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    await selectNode(page, 'b');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-21/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-21/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            await page.evaluate(() => { window.__sdl.S.est = true; window.__sdl.afterChange(true); });
            await page.click('#playBtn'); await playFor(page, 0.5);
            await selectNode(page, 'b');
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
