import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors } from './helpers.js';

// Level 14: URL shortener.
// The level starts inside one data center: Users ('u'), DNS ('d'), one load balancer ('l'), an autoscaled group of
// L web servers ('w', the link service: 301 redirects, base 62 codes, no limit) and an XL database ('b').
// Missions 1 and 2: 2,200 requests a second, 1 in 11 a new link. Mission 3: 800 new links and 2,000 clicks.

const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; S.est = true; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model({ peak: true }), at = (id) => m.node[id] || {}, c = m.g && window.__sdl.S.nodes.find((n) => n.type === 'cache');
  return { qps: m.qps, served: m.servedPct, latency: m.latency, cost: m.cost, link: m.link, db: at('b').load, hit: c ? at(c.id).hit : null };
});
const select = async (page, id) => { await page.focus(`[data-node="${id}"]`); await page.keyboard.press('Enter'); };
const set = (page, id, props) => page.evaluate(([x, p]) => { Object.assign(window.__sdl.S.nodes.find((n) => n.id === x), p); window.__sdl.afterDesignChange(); }, [id, props]);
/** Add a cache of `size` (TTL 1 hour) connected to the link service; returns its id. */
const addCache = (page, size = 'L') => page.evaluate((sz) => {
  const s = window.__sdl, S = s.S;
  s.addNode('cache');
  const n = S.nodes.at(-1); n.size = sz; n.ttl = '3600';
  s.tryConnect('w', n.id); s.afterDesignChange();
  return n.id;
}, size);
/** An experiment without the clock: the model while it runs. */
const during = (page, id) => page.evaluate((x) => { window.__sdl.run.on = x ? { [x]: {} } : {}; }, id);
const click = (page, key) => page.locator(`#insp [data-focus-key="${key}"]`).click();
const pause = (page) => page.evaluate(() => { if (window.__sdl.run.playing) window.__sdl.togglePlay(); });
const breakIt = async (page, id) => { await page.click(`#exp-${id}`); await fastForward(page, 2); await page.click(`#exp-${id}`); };

test.describe('Level 14 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-14/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 14 / 21');

    // Mission 1: estimate 7 characters, add a cache, then a viral link.
    await page.fill('#estIn', '7');
    await page.click('#estBtn');
    const c = await addCache(page, 'L');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'viral');
    await expect(page.locator('#log')).toContainText('a link went viral, and 100.0% of requests were still served');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await pause(page);

    // Mission 2: 302 redirects count every click; a per-account limit stops the bulk script.
    await page.click('#mission .complete button');
    await select(page, 'w');
    await click(page, 'redirect-302');
    await click(page, 'limit-account');
    await expect(page.locator('[data-node="w"] .node-sub')).toContainText('302 · base 62');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'bulk');
    await expect(page.locator('#log')).toContainText('the script was turned away with 429s');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    await pause(page);

    // Mission 3: hashed codes checked against a bloom filter, and an XL database.
    await page.click('#mission .complete button');
    await select(page, 'w');
    await click(page, 'code-bloom');
    await expect(page.locator('[data-node="w"] .node-sub')).toContainText('hash + bloom');
    expect((await measure(page)).cost).toBe(1255);
    expect(c).toBeTruthy();
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'viral');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 14 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 14 · numbers', () => {
  test('301 keeps repeat clicks in the browser; 302 brings every click back', async ({ page }) => {
    await freshPage(page, '#level-14/build');
    // 2,200 × 1.03 at the top of the wobble: 200 × 1.03 new links, 2,000 × 1.03 clicks, half of them repeats.
    let r = await measure(page);
    expect(r.qps).toBeCloseTo(1030 + 206, 6);
    expect(r.link.counted).toBeCloseTo(0.5, 9);
    expect(r.db).toBeCloseTo(1236, 6); // no cache: every click and new link reaches the database
    await set(page, 'w', { redirect: '302' });
    r = await measure(page);
    expect(r.qps).toBeCloseTo(2266, 6);
    expect(r.link.counted).toBe(1);
    expect(r.link.writes).toBeCloseTo(1 / 11, 9);
  });

  test('a new link costs 1, 2 or 1.01 database queries; a viral link is one cached key', async ({ page }) => {
    await freshPage(page, '#level-14/build');
    await set(page, 'w', { redirect: '302' });
    await addCache(page, 'L');
    let r = await measure(page);
    const misses = 2060 * (1 - r.hit);
    expect(r.db).toBeCloseTo(misses + 206, 6);
    for (const [code, k] of [['hash', 2], ['bloom', 1.01], ['base62', 1]]) {
      await set(page, 'w', { code });
      expect([code, (await measure(page)).db]).toEqual([code, expect.closeTo(misses + 206 * k, 6)]);
    }
    // 1,500 viral clicks all hit the cache, so the database load doesn't change.
    const hit = r.hit;
    await during(page, 'viral');
    r = await measure(page);
    expect(r.qps).toBeCloseTo(2266 + 1500, 6);
    expect(r.hit).toBeCloseTo(hit + (1 - hit) * 1500 / 3560, 9);
    expect(r.db).toBeCloseTo(misses + 206, 6);
  });

  test('the bulk script: 3,000 new links a second, unless limited per account', async ({ page }) => {
    await freshPage(page, '#level-14/build');
    await during(page, 'bulk');
    let r = await measure(page);
    expect(r.link.bots).toBe(3000);
    expect(r.db).toBeCloseTo(1236 + 3000, 6);
    expect(r.served).toBeLessThan(50);
    await set(page, 'w', { limit: 'account' });
    r = await measure(page);
    expect(r.link.bots).toBe(0);
    expect(r.served).toBe(100);
  });

  test('levels without a link service ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-13/build');
    const r = await page.evaluate(() => { const m = window.__sdl.model(); return { link: m.link, cost: m.cost }; });
    expect(r.link).toBeNull();
    expect(r.cost).toBe(1475);
  });
});

test.describe('Level 14 · teaching feedback', () => {
  test('Mission 2 with 301: half the clicks are not counted', async ({ page }) => {
    await freshPage(page, '#level-14/build');
    await goTo(page, 1);
    await addCache(page, 'L');
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'Every click is counted' })).toHaveClass(/fail/);
    await expect(page.locator('#goals li', { hasText: 'Every click is counted' })).toContainText('50.0%');
  });

  test('the bulk script without a limit: the log says to limit new links', async ({ page }) => {
    await freshPage(page, '#level-14/build');
    await goTo(page, 1);
    await addCache(page, 'L');
    await set(page, 'w', { redirect: '302' });
    await page.click('#playBtn');
    await page.click('#exp-bulk');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[1].bulk)).toBe(false);
    await expect(page.locator('#log')).toContainText('3,000 new links a second from one account reach the database. Limit new links per account.');
  });

  test('Mission 3: base 62 codes are guessable; hashing with a database check overloads it', async ({ page }) => {
    await freshPage(page, '#level-14/build');
    await goTo(page, 2);
    await addCache(page, 'L');
    await set(page, 'w', { redirect: '302', limit: 'account' });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'can\'t be guessed' })).toHaveClass(/fail/);
    await expect(page.locator('#goals li', { hasText: 'can\'t be guessed' })).toContainText('in sequence');
    await set(page, 'w', { code: 'hash' });
    await fastForward(page, 1);
    expect((await measure(page)).served).toBeLessThan(99);
    await expect(page.locator('#log')).toContainText('Database is over capacity');
  });

  test('no cache: a viral link takes the database down', async ({ page }) => {
    await freshPage(page, '#level-14/build');
    await goTo(page, 0);
    await page.click('#playBtn');
    await page.click('#exp-viral');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[0].viral)).toBe(false);
    await expect(page.locator('#log')).toContainText('One link is one key: a cache answers it from memory.');
  });

  test('link service settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-14/build');
    await set(page, 'w', { redirect: '302', code: 'bloom', limit: 'account' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = window.__sdl.S.nodes.find((x) => x.id === 'w'); return [n.redirect, n.code, n.limit]; });
    expect(await get()).toEqual(['302', 'bloom', 'account']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level14-v1'));
      Object.assign(saved.nodes.find((n) => n.id === 'w'), { redirect: '307', code: 'md5', limit: 'ip' });
      localStorage.setItem('sdl-level14-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['302', 'base62', 'none']);
  });

  test('the estimate accepts 7 and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-14/build');
    for (const [v, hint] of [['6', 'fewer than 219 billion'], ['5', 'under a billion'], ['8', 'shorter is the point']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '7 characters');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });

  test('the lesson diagram is drawn', async ({ page }) => {
    await freshPage(page, '#level-14/lesson');
    await expect(page.locator('#figRedirect')).toContainText('302, Location');
  });
});

test.describe('Level 14 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-14/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    await page.focus('#estIn');
    await page.keyboard.type('7');
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
    await addCache(page, 'L');
    await enter('#playBtn');
    await fastForward(page, 5);
    await enter('#exp-viral');
    await fastForward(page, 2);
    await enter('#exp-viral');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-14/build');
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    await select(page, 'w');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-14/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-14/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            await page.evaluate(() => { window.__sdl.S.est = true; window.__sdl.afterChange(true); });
            await page.click('#playBtn'); await playFor(page, 0.5);
            await select(page, 'w');
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
