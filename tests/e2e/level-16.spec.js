import { test, expect } from '../fixtures.js';
import { registerCommonTests } from '../shared-checks.js';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors, openMission, selectNode, setProps, pressEnterOn } from '../helpers.js';

// Level 16: Notification system.
// Services ('u') call the notification server ('n'), which queues ('q', one shared queue) for the workers ('w',
// 4 machines, no log, no dedupe), which send to the providers ('p'). 460 requests a second at the peak.

const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model({ peak: true });
  return { qps: m.qps, served: m.servedPct, cost: m.cost, o: m.notify, spof: m.spof };
});
const during = (page, id) => page.evaluate((x) => { window.__sdl.run.on = x ? { [x]: {} } : {}; }, id);
const click = (page, key) => page.locator(`#insp [data-focus-key="${key}"]`).click();
const pause = (page) => page.evaluate(() => { if (window.__sdl.run.playing) window.__sdl.togglePlay(); });
const breakIt = async (page, id) => { await page.click(`#exp-${id}`); await fastForward(page, 2); await page.click(`#exp-${id}`); };

test.describe('Level 16 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-16/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 16 / 21');

    // Mission 1: estimate 231, 5 workers, a queue per channel, then the SMS provider goes down.
    await page.fill('#estIn', '231');
    await page.click('#estBtn');
    await selectNode(page, 'w');
    await click(page, 'count-5');
    await selectNode(page, 'q');
    await click(page, 'layout-channel');
    await expect(page.locator('[data-node="q"] .node-sub')).toHaveText('a queue per channel');
    expect((await measure(page)).cost).toBe(650); // notification service $150 + queue $50 + 5 workers × $90 + provider $0
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'sms');
    await expect(page.locator('#log')).toContainText('SMS stopped, and 100.0% of push and email still went out on time');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await pause(page);

    // Mission 2: check opt-outs and limit each user; marketing sends a blast.
    await page.click('#mission .complete button');
    await selectNode(page, 'n');
    await click(page, 'check-on');
    await click(page, 'limit-on');
    await expect(page.locator('[data-node="n"] .node-sub')).toHaveText('checks opt-outs · per-user limit');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'blast');
    await expect(page.locator('#log')).toContainText('the per-user limit dropped the blast');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    await pause(page);

    // Mission 3: a notification log and a duplicate check; workers crash.
    await page.click('#mission .complete button');
    await selectNode(page, 'w');
    await click(page, 'log-on');
    await click(page, 'dedupe-on');
    await expect(page.locator('[data-node="w"] .node-sub')).toHaveText('5 machines · log · dedupe');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'crash');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 16 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 16 · numbers', () => {
  test('workers: 100 sends a second each; a dead SMS provider holds one shared queue', async ({ page }) => {
    await freshPage(page, '#level-16/build');
    // 460 × 1.03 at the peak against 4 × 100 sends a second.
    let r = await measure(page);
    expect(r.qps).toBeCloseTo(473.8, 6);
    expect(r.served).toBeCloseTo(100 * 400 / 473.8, 6);
    expect(r.cost).toBe(4 * 90 + 150 + 50);
    await setProps(page, 'w', { count: '5' });
    expect((await measure(page)).served).toBe(100);
    // SMS sends wait 1 s: one shared queue averages 0.9 × 10 + 0.1 × 1,000 = 109 ms a send.
    await during(page, 'sms');
    r = await measure(page);
    expect(r.o.others).toBeCloseTo((5 * 1000 / 109) / 473.8, 9);
    expect(r.o.lost).toBeCloseTo(0.1, 9); // the SMS sends fail, and with no log they are gone
    await setProps(page, 'q', { layout: 'channel' });
    r = await measure(page);
    expect([r.o.others, r.served]).toEqual([1, expect.closeTo(90, 6)]);
    await setProps(page, 'w', { log: 'on' });
    r = await measure(page);
    expect([r.o.lost, r.o.waiting]).toEqual([0, 0.1]);
    expect((await measure(page)).spof).toBe(1); // the notification server
  });

  test('opt-outs, the blast, and a crash with and without the log and dedupe', async ({ page }) => {
    await freshPage(page, '#level-16/build');
    await setProps(page, 'w', { count: '5' });
    let r = await measure(page);
    expect(r.o.optSent).toBe(0.05);
    await setProps(page, 'n', { check: 'on' });
    expect((await measure(page)).o.optSent).toBe(0);
    await during(page, 'blast');
    r = await measure(page);
    expect(r.o.spam).toBe(true);
    expect(r.served).toBeCloseTo(100 * (0.05 + 0.95 * 500 / (473.8 * 0.95 + 473.8 * 2)), 6);
    await setProps(page, 'n', { limit: 'on' });
    r = await measure(page);
    expect([r.o.spam, r.served]).toEqual([false, 100]);
    await during(page, 'crash');
    expect((await measure(page)).o).toMatchObject({ lost: 0.02, dup: 0 });
    await setProps(page, 'w', { log: 'on' });
    expect((await measure(page)).o).toMatchObject({ lost: 0, dup: 0.01 });
    await setProps(page, 'w', { dedupe: 'on' });
    expect((await measure(page)).o).toMatchObject({ lost: 0, dup: 0 });
  });

  test('levels without a notification system ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-15/build');
    const r = await page.evaluate(() => window.__sdl.model().notify);
    expect(r).toBeNull();
  });
});

test.describe('Level 16 · teaching feedback', () => {
  test('one shared queue: the log blames the SMS sends holding the workers', async ({ page }) => {
    await freshPage(page, '#level-16/build');
    await openMission(page, 0, { estimate: true });
    await setProps(page, 'w', { count: '5' });
    await page.click('#playBtn');
    await page.click('#exp-sms');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[0].sms)).toBe(false);
    await expect(page.locator('#log')).toContainText('every worker gets stuck on SMS sends. Give each channel its own queue.');
  });

  test('no opt-out check: the goal shows 5% sent to users who opted out', async ({ page }) => {
    await freshPage(page, '#level-16/build');
    await openMission(page, 1, { estimate: true });
    await setProps(page, 'w', { count: '5' });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'opted out' })).toHaveClass(/fail/);
    await expect(page.locator('#goals li', { hasText: 'opted out' })).toContainText('5.0%');
  });

  test('a crash with a log but no dedupe: the log says some arrive twice', async ({ page }) => {
    await freshPage(page, '#level-16/build');
    await openMission(page, 2, { estimate: true });
    await setProps(page, 'w', { count: '5', log: 'on' });
    await page.click('#playBtn');
    await page.click('#exp-crash');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('1.0% of notifications arrive twice: some resent ones had gone out before the crash. Drop event IDs already sent.');
  });

  test('the inspector shows the workers, the queues and what is lost', async ({ page }) => {
    await freshPage(page, '#level-16/build');
    await openMission(page, 0, { estimate: true });
    await page.click('#playBtn');
    await page.click('#exp-sms');
    await fastForward(page, 1);
    await pause(page);
    await selectNode(page, 'w');
    await expect(page.locator('#inspLive')).toContainText('all on one shared queue');
    await expect(page.locator('#inspLive')).toContainText('of notifications lost');
  });

  test('settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-16/build');
    await setProps(page, 'w', { count: '6', log: 'on', dedupe: 'on' });
    await setProps(page, 'q', { layout: 'channel' });
    await setProps(page, 'n', { check: 'on', limit: 'on' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = (id) => window.__sdl.S.nodes.find((x) => x.id === id); return [n('w').count, n('w').log, n('w').dedupe, n('q').layout, n('n').check, n('n').limit]; });
    expect(await get()).toEqual(['6', 'on', 'on', 'channel', 'on', 'on']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level16-v1'));
      const n = (id) => saved.nodes.find((x) => x.id === id);
      Object.assign(n('w'), { count: '7', log: 'yes', dedupe: 1 }); n('q').layout = 'two'; Object.assign(n('n'), { check: 'maybe', limit: null });
      localStorage.setItem('sdl-level16-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['4', 'off', 'off', 'one', 'off', 'off']);
  });

  test('the estimate accepts 231 and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-16/build');
    for (const [v, hint] of [['463', 'That is the peak'], ['139', 'That is push only']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '230');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });

  test('the lesson diagram is drawn', async ({ page }) => {
    await freshPage(page, '#level-16/lesson');
    await expect(page.locator('#figNotify')).toContainText('SMS queue');
  });
});

test.describe('Level 16 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-16/build');
    await page.focus('#estIn');
    await page.keyboard.type('231');
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
    await pressEnterOn(page, '[data-node="w"]');
    await pressEnterOn(page, '#insp [data-focus-key="count-5"]');
    await pressEnterOn(page, '[data-node="q"]');
    await pressEnterOn(page, '#insp [data-focus-key="layout-channel"]');
    await pressEnterOn(page, '#playBtn');
    await fastForward(page, 5);
    await pressEnterOn(page, '#exp-sms');
    await fastForward(page, 2);
    await pressEnterOn(page, '#exp-sms');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  registerCommonTests({
    level: 16,
    phone: { select: 'w' },
    onTab: {
      build: async (page) => {
        await openMission(page, 0, { estimate: true });
        await page.click('#playBtn'); await playFor(page, 0.5);
        await selectNode(page, 'w');
      },
    },
  });
});
