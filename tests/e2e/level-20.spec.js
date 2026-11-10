import { test, expect } from '../fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { freshPage, fastForward, playFor, state, logText, reloadGame, trackErrors, openMission, selectNode, setProps, pressEnterOn } from '../helpers.js';

// Level 20: Video platform.
// Creators ('u') upload through the upload service ('p': through the API servers, whole files) to transcoding ('t':
// 10 servers, no retry) and delivery ('v': every video from the CDN). 9.3 uploads a second at the peak.

const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model({ peak: true });
  return { qps: m.qps, served: m.servedPct, cost: m.cost, o: m.video, spof: m.spof };
});
const during = (page, id) => page.evaluate((x) => { window.__sdl.run.on = x ? { [x]: {} } : {}; }, id);
const click = (page, key) => page.locator(`#insp [data-focus-key="${key}"]`).click();
const pause = (page) => page.evaluate(() => { if (window.__sdl.run.playing) window.__sdl.togglePlay(); });
const breakIt = async (page, id) => { await page.click(`#exp-${id}`); await fastForward(page, 2); await page.click(`#exp-${id}`); };

test.describe('Level 20 · playthrough', () => {
  test('all three missions can be completed', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#level-20/build');
    await expect(page.locator('#lvlChip')).toHaveText('Level 20 / 21');

    // Mission 1: estimate 100 TB, pre-signed URLs and resumable chunks; patchy networks.
    await page.fill('#estIn', '100');
    await page.click('#estBtn');
    await selectNode(page, 'p');
    await click(page, 'url-presigned');
    await click(page, 'chunks-chunked');
    await expect(page.locator('[data-node="p"] .node-sub')).toHaveText('pre-signed URL · chunks');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'patchy');
    await expect(page.locator('#log')).toContainText('networks got patchy, and 100.0% of uploads were still published');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await pause(page);

    // Mission 2: 11 transcoding servers with retries; one dies.
    await page.click('#mission .complete button');
    await selectNode(page, 't');
    await click(page, 'workers-11');
    await click(page, 'retry-on');
    await expect(page.locator('[data-node="t"] .node-sub')).toHaveText('11 servers · retry');
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'dies');
    await expect(page.locator('#log')).toContainText('a transcoding server died, and 100.0% of videos were still published');
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    await pause(page);

    // Mission 3: only popular videos on the CDN; views grow.
    await page.click('#mission .complete button');
    await selectNode(page, 'v');
    await click(page, 'deliver-popular');
    expect((await measure(page)).cost).toBe(800 + 11 * 500 + 2952000);
    await page.click('#playBtn');
    await fastForward(page, 5);
    await breakIt(page, 'growth');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(await logText(page)).toContain('Level 20 complete');

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 20 · numbers', () => {
  test('uploads: the API servers\' links, pre-signed URLs and chunks', async ({ page }) => {
    await freshPage(page, '#level-20/build');
    // 9.3 × 1.03 uploads a second; 4 API servers × 125 MB/s ÷ 250 MB = 2 videos a second; 5% of whole files fail.
    const r = await measure(page);
    expect(r.qps).toBeCloseTo(9.579, 6);
    expect(r.o.uploaded).toBeCloseTo(2 / 9.579 * 0.95, 9);
    expect(r.cost).toBe(800 + 10 * 500 + 3600000);
    expect(r.spof).toBe(0);
    await setProps(page, 'p', { url: 'presigned' });
    expect((await measure(page)).o.uploaded).toBeCloseTo(0.95, 9);
    await during(page, 'patchy');
    expect((await measure(page)).o.uploaded).toBeCloseTo(0.6, 9);
    await setProps(page, 'p', { chunks: 'chunked' });
    expect((await measure(page)).o.uploaded).toBe(1);
  });

  test('transcoding: 1 video a second per server; a dead server\'s videos are lost without retry', async ({ page }) => {
    await freshPage(page, '#level-20/build');
    await setProps(page, 'p', { url: 'presigned', chunks: 'chunked' });
    let r = await measure(page);
    expect(r.served).toBe(100);
    await during(page, 'dies');
    r = await measure(page);
    expect(r.o.transcoded).toBeCloseTo(9 / 9.579 * 0.9, 9);
    await setProps(page, 't', { retry: 'on' });
    expect((await measure(page)).o.transcoded).toBeCloseTo(9 / 9.579, 9);
    await setProps(page, 't', { workers: '11' });
    expect((await measure(page)).served).toBe(100);
  });

  test('the streaming bill: everything on the CDN, or only popular videos', async ({ page }) => {
    await freshPage(page, '#level-20/build');
    // 24 million views × 0.25 GB × 30 days = 180 million GB.
    let r = await measure(page);
    expect(r.o.bill).toBeCloseTo(180e6 * 0.02, 3);
    await setProps(page, 'v', { deliver: 'popular' });
    r = await measure(page);
    expect(r.o.bill).toBeCloseTo(180e6 * (0.8 * 0.02 + 0.2 * 0.002), 3);
    await during(page, 'growth');
    expect((await measure(page)).o.bill).toBeCloseTo(180e6 * 1.2 * (0.8 * 0.02 + 0.2 * 0.002), 3);
  });

  test('levels without a video platform ignore the new rules', async ({ page }) => {
    await freshPage(page, '#level-19/build');
    expect(await page.evaluate(() => window.__sdl.model().video)).toBeNull();
  });
});

test.describe('Level 20 · teaching feedback', () => {
  test('through the API servers: the log points to pre-signed URLs', async ({ page }) => {
    await freshPage(page, '#level-20/build');
    await openMission(page, 0, { estimate: true });
    await page.click('#playBtn');
    await page.click('#exp-patchy');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[0].patchy)).toBe(false);
    await expect(page.locator('#log')).toContainText('every byte crosses the API servers\' links');
  });

  test('a dead server without retry: the log says its videos are lost', async ({ page }) => {
    await freshPage(page, '#level-20/build');
    await openMission(page, 1, { estimate: true });
    await setProps(page, 'p', { url: 'presigned', chunks: 'chunked' });
    await setProps(page, 't', { workers: '11' });
    await page.click('#playBtn');
    await page.click('#exp-dies');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('10% of videos in transcoding were on the dead server and are lost. Retry its tasks');
  });

  test('everything on the CDN: Mission 3\'s budget fails at $3.61M', async ({ page }) => {
    await freshPage(page, '#level-20/build');
    await openMission(page, 2, { estimate: true });
    await setProps(page, 'p', { url: 'presigned', chunks: 'chunked' });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await expect(page.locator('#goals li', { hasText: 'Spend at most $3.60M' })).toHaveClass(/fail/);
    await expect(page.locator('#goals li', { hasText: 'Spend at most $3.60M' })).toContainText('$3.61M');
  });

  test('the inspector shows uploads arriving and the transcoding setup', async ({ page }) => {
    await freshPage(page, '#level-20/build');
    await openMission(page, 0, { estimate: true });
    await page.click('#playBtn');
    await fastForward(page, 1);
    await pause(page);
    await selectNode(page, 'p');
    await expect(page.locator('#inspLive')).toContainText('of uploads arrive: the API servers\' links are');
    await expect(page.locator('#inspLive')).toContainText('5% of whole files fail and are given up on');
    await selectNode(page, 't');
    await expect(page.locator('#inspLive')).toContainText('no retry: a dead worker\'s videos are lost');
  });

  test('settings survive a reload; bad saved settings load as the defaults', async ({ page }) => {
    await freshPage(page, '#level-20/build');
    await setProps(page, 'p', { url: 'presigned', chunks: 'chunked' });
    await setProps(page, 't', { workers: '12', retry: 'on' });
    await setProps(page, 'v', { deliver: 'popular' });
    await reloadGame(page);
    const get = () => state(page, () => { const n = (id) => window.__sdl.S.nodes.find((x) => x.id === id); return [n('p').url, n('p').chunks, n('t').workers, n('t').retry, n('v').deliver]; });
    expect(await get()).toEqual(['presigned', 'chunked', '12', 'on', 'popular']);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sdl-level20-v1'));
      const n = (id) => saved.nodes.find((x) => x.id === id);
      Object.assign(n('p'), { url: 'ftp', chunks: 'tiny' }); Object.assign(n('t'), { workers: '99', retry: 'maybe' }); n('v').deliver = 'p2p';
      localStorage.setItem('sdl-level20-v1', JSON.stringify(saved));
    });
    await reloadGame(page);
    expect(await get()).toEqual(['api', 'whole', '10', 'off', 'cdn']);
  });

  test('the estimate accepts 100 and gives specific hints', async ({ page }) => {
    await freshPage(page, '#level-20/build');
    for (const [v, hint] of [['1000', 'Only 10% upload'], ['10', 'Check the units']]) {
      await page.fill('#estIn', v);
      await page.click('#estBtn');
      await expect(page.locator('#estFb')).toContainText(hint);
    }
    await page.fill('#estIn', '100 TB');
    await page.click('#estBtn');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
  });

  test('the lesson diagram is drawn', async ({ page }) => {
    await freshPage(page, '#level-20/lesson');
    await expect(page.locator('#figUpload')).toContainText('Original storage');
  });
});

test.describe('Level 20 · layout and accessibility', () => {
  test('keyboard only: finish Mission 1', async ({ page }) => {
    await freshPage(page, '#level-20/build');
    await page.focus('#estIn');
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.est)).toBe(true);
    await pressEnterOn(page, '[data-node="p"]');
    await pressEnterOn(page, '#insp [data-focus-key="url-presigned"]');
    await pressEnterOn(page, '#insp [data-focus-key="chunks-chunked"]');
    await pressEnterOn(page, '#playBtn');
    await fastForward(page, 5);
    await pressEnterOn(page, '#exp-patchy');
    await fastForward(page, 2);
    await pressEnterOn(page, '#exp-patchy');
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
  });

  test('phone: canvas on the first screen and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await freshPage(page, '#level-20/build');
    const top = await page.locator('#cv').evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
    await selectNode(page, 'p');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  for (const [w, h] of [[1024, 768], [1280, 720]]) {
    test(`${w}×${h}: Play button above the fold`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await freshPage(page, '#level-20/build');
      const box = await page.locator('#playBtn').boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }

  for (const colorScheme of ['light', 'dark']) {
    test.describe(`axe (${colorScheme})`, () => {
      test.use({ colorScheme });
      test('no violations on lesson, build and quiz', async ({ page }) => {
        await freshPage(page, '#level-20/lesson');
        for (const tab of ['lesson', 'build', 'quiz']) {
          await page.click(`#tab-${tab}`);
          if (tab === 'build') {
            await page.evaluate(() => { window.__sdl.S.est = true; window.__sdl.afterChange(true); });
            await page.click('#playBtn'); await playFor(page, 0.5);
            await selectNode(page, 'p');
          }
          const results = await new AxeBuilder({ page }).setLegacyMode().analyze();
          expect(results.violations.map((v) => `${tab}: ${v.id} (${v.nodes.length})`)).toEqual([]);
        }
      });
    });
  }
});
