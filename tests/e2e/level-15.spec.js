import { test, expect } from '../fixtures.js';
import { registerCommonTests } from '../shared-checks.js';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors, openMission, selectNode, setProps, pressEnterOn } from '../helpers.js';

// Level 15: Web crawler.
// The level is a pipeline: the URL frontier ('u', one FIFO queue) hands 800 URLs a second to the downloaders ('h',
// 4 machines, no DNS cache), which pass pages to the parser ('p') and on to content storage ('s').

const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model({ peak: true }), at = (id) => m.node[id] || {};
  return { qps: m.qps, served: m.servedPct, cost: m.cost, crawl: m.crawl, cap: at('h').cap, store: at('s').load, spof: m.spof };
});
const during = (page, id) => page.evaluate((x) => { window.__sdl.run.on = x ? { [x]: {} } : {}; }, id);
const click = (page, key) => page.locator(`#insp [data-focus-key="${key}"]`).click();
const pause = (page) => page.evaluate(() => { if (window.__sdl.run.playing) window.__sdl.togglePlay(); });
const breakIt = async (page, id) => { await page.click(`#exp-${id}`); await fastForward(page, 2); await page.click(`#exp-${id}`); };

test.describe('Level 15 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-15/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 15 / 21');

    // Mission 1: estimate 600 TB, then 5 machines with a DNS cache, then DNS slows down.
    await page.fill('#estIn', '600');
    await page.click('#estBtn');
    await selectNode(page, 'h');
    await click(page, 'count-5');
    await click(page, 'dns-cache');
    await expect(page.locator('[data-node="h"] .node-sub')).toHaveText('5 machines · DNS cache');
    expect((await measure(page)).cost).toBe(1450); // 5 downloaders × $200 + parser $150 + content store $300
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'dns');
    await expect(page.locator('#log')).toContainText('DNS slowed down, and 100.0% of pages were still downloaded');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await pause(page);

    // Mission 2: a queue per host; a site floods the frontier.
    await page.click('#mission .complete button');
    await selectNode(page, 'u');
    await click(page, 'queues-host');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'flood');
    await expect(page.locator('#log')).toContainText('the site got 1 request a second, and the crawl went on');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    await pause(page);

    // Mission 3: the duplicate check and the URL filter; the crawler finds a trap.
    await page.click('#mission .complete button');
    await selectNode(page, 'p');
    await click(page, 'dedup-on');
    await click(page, 'filter-on');
    await expect(page.locator('[data-node="p"] .node-sub')).toHaveText('content seen? · URL filter');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'trap');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 15 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 15 · numbers', () => {
  test('downloaders: threads or one DNS lookup at a time, whichever is lower', async ({ page }) => {
    await freshPage(page, '#level-15/build');
    // 4 machines, 10 ms lookups one at a time: 100 pages a second each, against 800 × 1.03 at peak.
    const r = await measure(page);
    expect(r.qps).toBeCloseTo(824, 6);
    expect(r.cap).toBe(400);
    expect(r.served).toBeCloseTo(100 * 400 / 824, 6);
    expect(r.cost).toBe(4 * 200 + 150 + 300);
    for (const [count, dns, cap, slow] of [['4', 'cache', 800, 800], ['5', 'cache', 1000, 1000], ['8', 'lookup', 800, 40]]) {
      await setProps(page, 'h', { count, dns });
      await during(page, null);
      expect([count, dns, (await measure(page)).cap]).toEqual([count, dns, cap]);
      await during(page, 'dns'); // 200 ms lookups: 5 a second without a cache; a cache needs only 2% of them
      expect([count, dns, (await measure(page)).cap]).toEqual([count, dns, slow]);
    }
    await during(page, null);
    await setProps(page, 'h', { count: '1' });
    expect((await measure(page)).spof).toBe(2); // one machine, and the parser
  });

  test('politeness: FIFO hits the busiest host with its share; per-host queues send 1 a second', async ({ page }) => {
    await freshPage(page, '#level-15/build');
    await setProps(page, 'h', { count: '5', dns: 'cache' });
    let r = await measure(page);
    expect(r.crawl.hostRate).toBeCloseTo(824 * 0.02, 6);
    await during(page, 'flood');
    r = await measure(page);
    expect(r.crawl.hostRate).toBeCloseTo(824 * 0.3, 6);
    expect(r.served).toBeCloseTo(70, 6); // the flooded site refuses its 30%
    await setProps(page, 'u', { queues: 'host' });
    r = await measure(page);
    expect([r.crawl.hostRate, r.served]).toEqual([1, 100]);
  });

  test('duplicates and traps: storage, wasted downloads and trap URLs', async ({ page }) => {
    await freshPage(page, '#level-15/build');
    await setProps(page, 'h', { count: '5', dns: 'cache' });
    let r = await measure(page);
    expect(r.crawl.storageTB).toBeCloseTo(600, 9);
    expect(r.store).toBeCloseTo(824, 6);
    await setProps(page, 'p', { dedup: 'on' });
    r = await measure(page);
    expect(r.crawl.storageTB).toBeCloseTo(426, 9);
    expect(r.store).toBeCloseTo(824 * 0.71, 6);
    await during(page, 'trap');
    r = await measure(page);
    expect([r.crawl.wasted, r.crawl.trapAdds]).toEqual([0.4, expect.closeTo(824 * 0.4 * 10, 6)]);
    await setProps(page, 'u', { queues: 'host' });
    r = await measure(page);
    expect([r.crawl.wasted, r.crawl.trapAdds]).toEqual([expect.closeTo(1 / 824, 9), 10]);
    await setProps(page, 'p', { filter: 'on' });
    r = await measure(page);
    expect([r.crawl.wasted, r.crawl.trapAdds]).toEqual([0, 0]);
  });

  test('levels without a crawler ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-14/build');
    const r = await page.evaluate(() => { const m = window.__sdl.model(); return { crawl: m.crawl, cost: m.cost }; });
    expect(r.crawl).toBeNull();
  });
});

test.describe('Level 15 · teaching feedback', () => {
  test('slow DNS without a cache: the log says to keep one', async ({ page }) => {
    await freshPage(page, '#level-15/build');
    await openMission(page, 0, { estimate: true });
    await setProps(page, 'h', { count: '8' });
    await page.click('#playBtn');
    await page.click('#exp-dns');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[0].dns)).toBe(false);
    await expect(page.locator('#log')).toContainText('one lookup at a time at 200 ms is 5 pages a second per machine. Keep a DNS cache.');
  });

  test('FIFO: the polite goal fails, and a flood gets the crawler refused', async ({ page }) => {
    await freshPage(page, '#level-15/build');
    await openMission(page, 1, { estimate: true });
    await setProps(page, 'h', { count: '5', dns: 'cache' });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'At most 1 request a second' })).toHaveClass(/fail/);
    await page.click('#exp-flood');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('requests a second and refuses them: 30.0% of downloads fail. Give each host its own queue.');
  });

  test('a trap without a URL filter: the log counts the URLs it adds', async ({ page }) => {
    await freshPage(page, '#level-15/build');
    await openMission(page, 2, { estimate: true });
    await setProps(page, 'h', { count: '5', dns: 'cache' });
    await setProps(page, 'u', { queues: 'host' });
    await setProps(page, 'p', { dedup: 'on' });
    await page.click('#playBtn');
    await page.click('#exp-trap');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[2].trap)).toBe(false);
    await expect(page.locator('#log')).toContainText('The trap adds 10 new URLs a second to the frontier, forever. Filter URLs by depth and length.');
  });

  test('the inspector shows machines, pages a second and DNS', async ({ page }) => {
    await freshPage(page, '#level-15/build');
    await openMission(page, 0, { estimate: true });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await pause(page);
    await selectNode(page, 'h');
    await expect(page.locator('#inspLive')).toContainText('machines × pages/s each: DNS lookups one at a time');
    await expect(page.locator('#inspLive')).toContainText('4 × 100');
  });

  test('crawler settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-15/build');
    await setProps(page, 'h', { count: '6', dns: 'cache' });
    await setProps(page, 'u', { queues: 'host' });
    await setProps(page, 'p', { dedup: 'on', filter: 'on' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = (id) => window.__sdl.S.nodes.find((x) => x.id === id); return [n('h').count, n('h').dns, n('u').queues, n('p').dedup, n('p').filter]; });
    expect(await get()).toEqual(['6', 'cache', 'host', 'on', 'on']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level15-v1'));
      const n = (id) => saved.nodes.find((x) => x.id === id);
      Object.assign(n('h'), { count: '99', dns: 'fast' }); n('u').queues = 'lifo'; Object.assign(n('p'), { dedup: 'yes', filter: 2 });
      localStorage.setItem('sdl-level15-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['4', 'lookup', 'fifo', 'off', 'off']);
  });

  test('the estimate accepts 600 and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-15/build');
    for (const [v, hint] of [['60', 'powers of ten'], ['36000', 'That is 5 years of it']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '600 TB');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });

  test('the lesson diagram is drawn', async ({ page }) => {
    await freshPage(page, '#level-15/lesson');
    await expect(page.locator('#figCrawl')).toContainText('URL frontier');
    await expect(page.locator('#figCrawl')).toContainText('new URLs');
  });
});

test.describe('Level 15 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-15/build');
    await page.focus('#estIn');
    await page.keyboard.type('600');
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
    await pressEnterOn(page, '[data-node="h"]');
    await pressEnterOn(page, '#insp [data-focus-key="count-5"]');
    await pressEnterOn(page, '#insp [data-focus-key="dns-cache"]');
    await pressEnterOn(page, '#playBtn');
    await fastForward(page, 5);
    await pressEnterOn(page, '#exp-dns');
    await fastForward(page, 2);
    await pressEnterOn(page, '#exp-dns');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  registerCommonTests({
    level: 15,
    phone: { select: 'h' },
    onTab: {
      build: async (page) => {
        await openMission(page, 0, { estimate: true });
        await page.click('#playBtn'); await playFor(page, 0.5);
        await selectNode(page, 'h');
      },
    },
  });
});
