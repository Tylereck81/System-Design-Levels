import { test, expect } from '../fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors } from '../helpers.js';

// Level 19: Search autocomplete.
// Users ('u') send a request per keystroke to the API servers ('a': 4 servers, no browser caching), which ask the
// trie cache ('t': table queries, 3 shards split by letter, rebuilt weekly). 55,600 requests a second at the peak.

const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; S.est = true; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model({ peak: true });
  return { qps: m.qps, served: m.servedPct, latency: m.latency, cost: m.cost, o: m.typeahead };
});
const select = async (page, id) => { await page.focus(`[data-node="${id}"]`); await page.keyboard.press('Enter'); };
const set = (page, id, props) => page.evaluate(([x, p]) => { Object.assign(window.__sdl.S.nodes.find((n) => n.id === x), p); window.__sdl.afterDesignChange(); }, [id, props]);
const during = (page, id) => page.evaluate((x) => { window.__sdl.run.on = x ? { [x]: {} } : {}; }, id);
const click = (page, key) => page.locator(`#insp [data-focus-key="${key}"]`).click();
const pause = (page) => page.evaluate(() => { if (window.__sdl.run.playing) window.__sdl.togglePlay(); });
const breakIt = async (page, id) => { await page.click(`#exp-${id}`); await fastForward(page, 2); await page.click(`#exp-${id}`); };

test.describe('Level 19 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-19/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 19 / 21');

    // Mission 1: estimate 27,800, top 5 per node and browser caching; a big match.
    await page.fill('#estIn', '27800');
    await page.click('#estBtn');
    await select(page, 't');
    await click(page, 'method-topk');
    await select(page, 'a');
    await click(page, 'browser-on');
    await expect(page.locator('[data-node="a"] .node-sub')).toHaveText('4 servers · browser cache');
    expect((await measure(page)).cost).toBe(1800);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'rush');
    await expect(page.locator('#log')).toContainText('the match came, and 100.0% of keystrokes were answered');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await pause(page);

    // Mission 2: 6 API servers and a shard map; election night.
    await page.click('#mission .complete button');
    await select(page, 'a');
    await click(page, 'count-6');
    await select(page, 't');
    await click(page, 'split-map');
    await expect(page.locator('[data-node="t"] .node-sub')).toHaveText('top 5 · 3 shards · shard map');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'peak');
    await expect(page.locator('#log')).toContainText('election night came, and 100.0% of keystrokes were answered');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    await pause(page);

    // Mission 3: rebuild hourly; a new search trends.
    await page.click('#mission .complete button');
    await select(page, 't');
    await click(page, 'rebuild-hourly');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'trend');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 19 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 19 · numbers', () => {
  test('lookup time, API capacity and browser caching', async ({ page }) => {
    await freshPage(page, '#level-19/build');
    // 55,600 × 1.03 keystrokes against 4 × 12,000; a table query takes 100 ms after the 40 ms trip and 5 ms.
    let r = await measure(page);
    expect(r.qps).toBeCloseTo(57268, 6);
    expect(r.served).toBeCloseTo(100 * 48000 / 57268, 6);
    expect(r.latency).toBeCloseTo(40 + 5 + 0.5 + 100, 6); // the trip, the API server, the hop inside the data center, the lookup
    await set(page, 't', { method: 'trie' });
    expect((await measure(page)).latency).toBeCloseTo(105.5, 6);
    await set(page, 't', { method: 'topk' });
    expect((await measure(page)).latency).toBeCloseTo(46.5, 6);
    await set(page, 'a', { browser: 'on' });
    r = await measure(page);
    expect(r.qps).toBeCloseTo(57268 * 0.7, 6); // 30% answered by the browser
    expect(r.served).toBe(100);
  });

  test('shards: equal letter ranges put 45% on the busiest of three; a shard map a third', async ({ page }) => {
    await freshPage(page, '#level-19/build');
    await set(page, 't', { method: 'topk' });
    await set(page, 'a', { browser: 'on', count: '6' });
    await during(page, 'peak');
    let r = await measure(page);
    const reach = 57268 * 1.6 * 0.7;
    expect(r.o.shardLoad).toBeCloseTo(reach * 0.45, 6);
    expect(r.served).toBeCloseTo(100 * (1 - 0.45 * (1 - 25000 / (reach * 0.45))), 6);
    await set(page, 't', { split: 'map' });
    r = await measure(page);
    expect(r.o.shardLoad).toBeCloseTo(reach / 3, 6);
    expect(r.served).toBe(100);
    await set(page, 't', { split: 'letter', shards: '4' });
    expect((await measure(page)).o.shardLoad).toBeCloseTo(reach * 0.36, 6);
  });

  test('rebuilds: weekly, daily, hourly', async ({ page }) => {
    await freshPage(page, '#level-19/build');
    for (const [rebuild, h, cost] of [['weekly', 168, 1800], ['daily', 24, 1900], ['hourly', 1, 2200]]) {
      await set(page, 't', { rebuild });
      const r = await measure(page);
      expect([rebuild, r.o.staleH, r.cost]).toEqual([rebuild, h, cost]);
    }
  });

  test('levels without autocomplete ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-18/build');
    expect(await page.evaluate(() => window.__sdl.model().typeahead)).toBeNull();
  });
});

test.describe('Level 19 · teaching feedback', () => {
  test('table queries: the latency goal fails at 145.5 ms', async ({ page }) => {
    await freshPage(page, '#level-19/build');
    await goTo(page, 0);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'Suggestions in under 100 ms' })).toHaveClass(/fail/);
  });

  test('election night split by letter: the log blames the busiest shard', async ({ page }) => {
    await freshPage(page, '#level-19/build');
    await goTo(page, 1);
    await set(page, 't', { method: 'topk' });
    await set(page, 'a', { browser: 'on', count: '6' });
    await page.click('#playBtn');
    await page.click('#exp-peak');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[1].peak)).toBe(false);
    await expect(page.locator('#log')).toContainText('the busiest shard gets 45% of lookups');
    await expect(page.locator('#log')).toContainText('Split the trie by a shard map.');
  });

  test('a trend with weekly rebuilds: the log says to rebuild hourly', async ({ page }) => {
    await freshPage(page, '#level-19/build');
    await goTo(page, 2);
    await set(page, 't', { method: 'topk' });
    await set(page, 'a', { browser: 'on' });
    await page.click('#playBtn');
    await page.click('#exp-trend');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('won\'t be suggested for up to 168 hours');
  });

  test('the inspector shows the busiest shard and the rebuild delay', async ({ page }) => {
    await freshPage(page, '#level-19/build');
    await goTo(page, 0);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await pause(page);
    await select(page, 't');
    await expect(page.locator('#inspLive')).toContainText('of lookups on the busiest of 3 shards');
    await expect(page.locator('#inspLive')).toContainText('168 h');
  });

  test('settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-19/build');
    await set(page, 'a', { count: '6', browser: 'on' });
    await set(page, 't', { method: 'topk', shards: '4', split: 'map', rebuild: 'hourly' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = (id) => window.__sdl.S.nodes.find((x) => x.id === id); return [n('a').count, n('a').browser, n('t').method, n('t').shards, n('t').split, n('t').rebuild]; });
    expect(await get()).toEqual(['6', 'on', 'topk', '4', 'map', 'hourly']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level19-v1'));
      const n = (id) => saved.nodes.find((x) => x.id === id);
      Object.assign(n('a'), { count: '7', browser: 'yes' }); Object.assign(n('t'), { method: 'grep', shards: '26', split: 'hash', rebuild: 'live' });
      localStorage.setItem('sdl-level19-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['4', 'off', 'table', '3', 'letter', 'weekly']);
  });

  test('the estimate accepts about 27,800 and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-19/build');
    for (const [v, hint] of [['1111', 'That counts searches'], ['55600', 'That is the peak']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '27,778');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });

  test('the lesson diagram is drawn', async ({ page }) => {
    await freshPage(page, '#level-19/lesson');
    await expect(page.locator('#figTrie')).toContainText('car, cat, cart, care, cab');
  });
});

test.describe('Level 19 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-19/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    await page.focus('#estIn');
    await page.keyboard.type('27800');
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
    await enter('[data-node="t"]');
    await enter('#insp [data-focus-key="method-topk"]');
    await enter('[data-node="a"]');
    await enter('#insp [data-focus-key="browser-on"]');
    await enter('#playBtn');
    await fastForward(page, 5);
    await enter('#exp-rush');
    await fastForward(page, 2);
    await enter('#exp-rush');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-19/build');
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    await select(page, 't');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-19/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-19/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            await page.evaluate(() => { window.__sdl.S.est = true; window.__sdl.afterChange(true); });
            await page.click('#playBtn'); await playFor(page, 0.5);
            await select(page, 't');
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
