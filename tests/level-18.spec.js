import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors } from './helpers.js';

// Level 18: Chat system.
// Users ('u') keep connections to the chat servers ('c': 3 servers, polling, fixed addresses, presence by
// disconnect), which store messages in the message store ('m', offline recipients wait). 36,000 messages a second.

const goTo = (page, i) => page.evaluate((k) => {
  const S = window.__sdl.S;
  for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
  S.mission = k; S.est = true; window.__sdl.afterChange(true);
}, i);
const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model({ peak: true });
  return { qps: m.qps, served: m.servedPct, cost: m.cost, o: m.chat, spof: m.spof };
});
const select = async (page, id) => { await page.focus(`[data-node="${id}"]`); await page.keyboard.press('Enter'); };
const set = (page, id, props) => page.evaluate(([x, p]) => { Object.assign(window.__sdl.S.nodes.find((n) => n.id === x), p); window.__sdl.afterDesignChange(); }, [id, props]);
const during = (page, id) => page.evaluate((x) => { window.__sdl.run.on = x ? { [x]: {} } : {}; }, id);
const click = (page, key) => page.locator(`#insp [data-focus-key="${key}"]`).click();
const pause = (page) => page.evaluate(() => { if (window.__sdl.run.playing) window.__sdl.togglePlay(); });
const breakIt = async (page, id) => { await page.click(`#exp-${id}`); await fastForward(page, 2); await page.click(`#exp-${id}`); };

test.describe('Level 18 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-18/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 18 / 21');

    // Mission 1: estimate 20 GB, then WebSocket, service discovery and 4 servers; a server dies.
    await page.fill('#estIn', '20');
    await page.click('#estBtn');
    await select(page, 'c');
    await click(page, 'protocol-ws');
    await click(page, 'reconnect-discovery');
    await click(page, 'count-4');
    await expect(page.locator('[data-node="c"] .node-sub')).toHaveText('4 servers · WebSocket');
    expect((await measure(page)).cost).toBe(1700);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'dies');
    await expect(page.locator('#log')).toContainText('a chat server died, and 100.0% of messages were still delivered');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await pause(page);

    // Mission 2: push to offline recipients; night falls.
    await page.click('#mission .complete button');
    await select(page, 'm');
    await click(page, 'offline-push');
    await expect(page.locator('[data-node="m"] .node-sub')).toHaveText('pushes to offline users');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'night');
    await expect(page.locator('#log')).toContainText('offline friends were told by push');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    await pause(page);

    // Mission 3: heartbeats; trains go through tunnels.
    await page.click('#mission .complete button');
    await select(page, 'c');
    await click(page, 'presence-heartbeat');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'tunnel');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 18 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 18 · numbers', () => {
  test('polling, long polling and WebSocket: load, delay and memory', async ({ page }) => {
    await freshPage(page, '#level-18/build');
    // Polling: 2 million users every 5 s plus 37,080 messages, against 3 × 50,000 requests a second.
    let r = await measure(page);
    expect(r.served).toBeCloseTo(100 * 150000 / (400000 + 37080), 6);
    expect([r.o.delay, r.o.memoryGB]).toEqual([2.5, 0]);
    expect(r.cost).toBe(3 * 300 + 500);
    await set(page, 'c', { protocol: 'long' });
    r = await measure(page);
    expect(r.served).toBe(100);
    expect(r.o.delay).toBeCloseTo((0.1 + 2 * 15) / 3, 9); // one chance in 3 the recipient's request is on that server
    await set(page, 'c', { protocol: 'ws' });
    r = await measure(page);
    expect([r.served, r.o.delay]).toEqual([100, 0.1]);
    expect(r.o.memoryGB).toBeCloseTo(2e6 / 3 * 10 / 1e6, 9);
  });

  test('a server dies: stranded without service discovery, short of memory on 3 servers', async ({ page }) => {
    await freshPage(page, '#level-18/build');
    await set(page, 'c', { protocol: 'ws' });
    await during(page, 'dies');
    expect((await measure(page)).served).toBeCloseTo(100 * 2 / 3, 6);
    await set(page, 'c', { reconnect: 'discovery' });
    expect((await measure(page)).served).toBeCloseTo(100 * 1.6e6 / 2e6, 6); // 2 servers hold 1.6 million
    await set(page, 'c', { count: '4' });
    const r = await measure(page);
    expect(r.served).toBe(100);
    expect(r.o.memoryGB).toBeCloseTo(2e6 / 3 * 10 / 1e6, 9);
  });

  test('push to offline recipients, and presence with and without heartbeats', async ({ page }) => {
    await freshPage(page, '#level-18/build');
    expect((await measure(page)).o.notified).toBe(0);
    await set(page, 'm', { offline: 'push' });
    expect((await measure(page)).o.notified).toBe(1);
    // Logins and logouts: 2 million / 1,800 s × 2 × 100 friends.
    expect((await measure(page)).o.presenceLoad).toBeCloseTo(2e6 / 1800 * 2 * 100, 6);
    await during(page, 'tunnel');
    let r = await measure(page);
    expect(r.o.flips).toBe(12);
    expect(r.o.presenceLoad).toBeCloseTo(2e6 / 1800 * 200 + 2e6 * 0.05 * 6 / 60 * 2 * 100, 6);
    await set(page, 'c', { presence: 'heartbeat' });
    r = await measure(page);
    expect(r.o.flips).toBe(0);
    expect(r.o.presenceLoad).toBeCloseTo(2e6 / 1800 * 200 + 2e6 / 5, 6); // heartbeats every 5 s
  });

  test('levels without a chat system ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-17/build');
    expect(await page.evaluate(() => window.__sdl.model().chat)).toBeNull();
  });
});

test.describe('Level 18 · teaching feedback', () => {
  test('a server dies with fixed addresses: the log says to use service discovery', async ({ page }) => {
    await freshPage(page, '#level-18/build');
    await goTo(page, 0);
    await set(page, 'c', { protocol: 'ws', count: '4' });
    await page.click('#playBtn');
    await page.click('#exp-dies');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[0].dies)).toBe(false);
    await expect(page.locator('#log')).toContainText('the dead server\'s users keep retrying its address. Let them ask service discovery');
  });

  test('polling: the delay goal fails at 2.5 s', async ({ page }) => {
    await freshPage(page, '#level-18/build');
    await goTo(page, 0);
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'Messages arrive within 0.5 s' })).toHaveClass(/fail/);
    await expect(page.locator('#goals li', { hasText: 'Messages arrive within 0.5 s' })).toContainText('2.5 s');
  });

  test('tunnels without heartbeats: the log counts the flips and events', async ({ page }) => {
    await freshPage(page, '#level-18/build');
    await goTo(page, 2);
    await set(page, 'c', { protocol: 'ws', count: '4', reconnect: 'discovery' });
    await set(page, 'm', { offline: 'push' });
    await page.click('#playBtn');
    await page.click('#exp-tunnel');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('flips offline and online 12 times a minute, and every flip goes to 100 friends: 2.2 million events a second. Use heartbeats.');
  });

  test('the inspector shows the delay and connection memory', async ({ page }) => {
    await freshPage(page, '#level-18/build');
    await goTo(page, 0);
    await set(page, 'c', { protocol: 'ws', count: '4' });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await pause(page);
    await select(page, 'c');
    await expect(page.locator('#inspLive')).toContainText('for a message to arrive, by WebSocket');
    await expect(page.locator('#inspLive')).toContainText('5.0 GB');
  });

  test('settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-18/build');
    await set(page, 'c', { count: '5', protocol: 'ws', reconnect: 'discovery', presence: 'heartbeat' });
    await set(page, 'm', { offline: 'push' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = (id) => window.__sdl.S.nodes.find((x) => x.id === id); return [n('c').count, n('c').protocol, n('c').reconnect, n('c').presence, n('m').offline]; });
    expect(await get()).toEqual(['5', 'ws', 'discovery', 'heartbeat', 'push']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level18-v1'));
      const n = (id) => saved.nodes.find((x) => x.id === id);
      Object.assign(n('c'), { count: '9', protocol: 'udp', reconnect: 'dns', presence: 'ping' }); n('m').offline = 'sms';
      localStorage.setItem('sdl-level18-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['3', 'poll', 'fixed', 'disconnect', 'wait']);
  });

  test('the estimate accepts 20 and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-18/build');
    for (const [v, hint] of [['2', 'Check the units'], ['20000', 'That is MB']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '20 GB');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });

  test('the lesson diagram is drawn', async ({ page }) => {
    await freshPage(page, '#level-18/lesson');
    await expect(page.locator('#figChat')).toContainText('Message store');
  });
});

test.describe('Level 18 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-18/build');
    const enter = async (selector) => { await page.focus(selector); await page.keyboard.press('Enter'); };
    await page.focus('#estIn');
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
    await enter('[data-node="c"]');
    await enter('#insp [data-focus-key="protocol-ws"]');
    await enter('#insp [data-focus-key="reconnect-discovery"]');
    await enter('#insp [data-focus-key="count-4"]');
    await enter('#playBtn');
    await fastForward(page, 5);
    await enter('#exp-dies');
    await fastForward(page, 2);
    await enter('#exp-dies');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-18/build');
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    await select(page, 'c');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-18/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-18/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            await page.evaluate(() => { window.__sdl.S.est = true; window.__sdl.afterChange(true); });
            await page.click('#playBtn'); await playFor(page, 0.5);
            await select(page, 'c');
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
