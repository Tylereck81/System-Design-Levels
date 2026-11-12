import { test, expect } from '../fixtures.js';
import { registerCommonTests, registerPageLessonTests } from '../shared-checks.js';
import {
  QUIZ_KEY_L1, freshPage, fastForward, playFor, state, nodeIds, model, logText,
  tap, dragBetween, openMission, buildBasic, trackErrors, reloadGame,
} from '../helpers.js';

test.describe('Level 1 · full playthrough', () => {
  test('all three missions can be completed through the UI', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page);
    await expect(page.locator('#figFlow .node-box')).toHaveCount(3);
    await page.click('#startBuild');

    // Mission 1: add DNS + web server, connect by dragging from the + handle
    await page.click('.pal-item[data-type="dns"]');
    await page.click('.pal-item[data-type="web"]');
    let ids = await nodeIds(page);
    for (const target of ['dns', 'web']) {
      await dragBetween(page, '[data-handle="u"] .hv', `[data-node="${ids[target]}"] .node-box`);
    }
    expect(await state(page, () => window.__sdl.S.edges.length)).toBe(2);
    await page.click('#playBtn');
    await expect(page.locator('#dotsG circle').first()).toBeAttached({ timeout: 5000 });
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);
    await expect(page.locator('#doneText')).toHaveText('Mission 1 complete');

    // Mission 2: separate the data tier, pick SQL, upgrade the web server
    await page.click('#mission .complete button');
    await page.click('.pal-item[data-type="db"]');
    ids = await nodeIds(page);
    await dragBetween(page, `[data-handle="${ids.web}"] .hv`, `[data-node="${ids.db}"] .node-box`);
    await page.click('#insp .seg.two button:first-child');
    expect((await model(page)).latency).toBeGreaterThan(150); // S + S: both 75% busy
    await tap(page, `[data-node="${ids.web}"] .node-box`);
    await page.click('#insp .seg:not(.two) button:nth-child(2)'); // web → M
    const m2 = await model(page);
    expect(m2.latency).toBeLessThan(150);
    expect(m2.cost).toBeLessThanOrEqual(150); // budget: DNS $5 + M web $90 + S database $40 = $135
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);

    // Mission 3: estimate, scale both tiers to L, then break it
    await page.click('#mission .complete button');
    await expect(page.locator('#playBtn')).toBeDisabled();
    await page.fill('#estIn', '231');
    await page.click('#estBtn');
    await expect(page.locator('#estFb')).toContainText('twice the average');
    await page.fill('#estIn', '463 req/s');
    await page.click('#estBtn');
    for (const n of ['web', 'db']) {
      await tap(page, `[data-node="${ids[n]}"] .node-box`);
      await page.click('#insp .seg:not(.two) button:nth-child(3)'); // L
    }
    const m3 = await model(page);
    expect(m3.latency).toBeCloseTo(111.7, 0);
    expect(m3.cost).toBe(405); // DNS $5 + L web $200 + L database $200
    await page.click('#playBtn');
    await fastForward(page, 5);
    await page.click('#exp-crash');
    await fastForward(page, 2);
    await expect(page.locator('.node.down')).toHaveCount(1);
    await page.click('#exp-crash');
    await page.click('#exp-spike');
    await fastForward(page, 2);
    // The log is written by the frame loop's 0.2 s paint, which fastForward skips: let real frames run so it paints.
    // Match the experiment's note only ("Scaling up has a hard limit" from its observed line would also match 'hard limit').
    await playFor(page, 0.5);
    expect(await logText(page)).toContain('even the largest size (XL, 1,600 req/s) is not enough');
    await page.click('#exp-spike');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);

    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, true, true]);
    expect(errors).toEqual([]);
  });
});

test.describe('Level 1 · quiz', () => {
  test('correct answers pass, choices can change before checking, header tracks progress', async ({ page }) => {
    await freshPage(page, '#quiz');
    const first = page.locator('.q').nth(0);
    await first.locator('.opts button').nth(0).click();
    await expect(first.locator('.opts button').nth(2)).toBeEnabled();
    await first.locator('.opts button').nth(2).click();
    await first.locator('.qcheck button').click();
    await expect(page.locator('#quizMeta')).toHaveText('1/10');
    for (let i = 1; i < 10; i++) {
      const q = page.locator('.q').nth(i);
      await q.locator('.opts button').nth(QUIZ_KEY_L1[i]).click();
      await q.locator('.qcheck button').click();
    }
    await expect(page.locator('#qResult')).toContainText('10 / 10: passed');
    await expect(page.locator('#quizMeta')).toHaveText('✓ 10/10');
  });
});

test.describe('Level 1 · robustness', () => {
  test('changing the design on another mission resets an unfinished mission\'s check', async ({ page }) => {
    await freshPage(page, '#build');
    await openMission(page, 2);
    const ids = await buildBasic(page);
    // Mission 3: estimate, scale both tiers to L, hold the targets.
    await page.fill('#estIn', '463');
    await page.click('#estBtn');
    await page.evaluate(() => { for (const n of window.__sdl.S.nodes) { if (n.size) n.size = 'L'; if (n.type === 'db') n.kind = 'sql'; } window.__sdl.afterDesignChange(); });
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.verified[2])).toBe(true);
    // Switch to Mission 1 and break the design there: NoSQL on a small database.
    await page.evaluate(() => window.__sdl.switchMission(0));
    await tap(page, `[data-node="${ids.db}"] .node-box`);
    await page.click('#insp .seg.two button:nth-child(2)'); // NoSQL
    await page.click('#insp .seg:not(.two) button:nth-child(1)'); // S
    expect(await state(page, () => window.__sdl.S.verified[2])).toBe(false);
    // Back on Mission 3, running both experiments must not complete it.
    await page.evaluate(() => window.__sdl.switchMission(2));
    await page.click('#playBtn');
    await page.click('#exp-crash'); await fastForward(page, 2); await page.click('#exp-crash');
    await page.click('#exp-spike'); await fastForward(page, 2); await page.click('#exp-spike');
    expect(await state(page, () => window.__sdl.S.done[2])).toBe(false);
  });

  test('crashing with no web server does not freeze the simulation', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#build');
    await openMission(page, 2);
    await page.fill('#estIn', '463');
    await page.click('#estBtn');
    await page.click('#exp-crash');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[2].crash)).toBe(false);
    expect(await logText(page)).toContain('Build the design first');
    await buildBasic(page);
    await page.click('#playBtn');
    await playFor(page, 0.2); // fails if the frame loop stops moving the clock
    // crash, then delete the crashed server
    await page.click('#exp-crash');
    const ids = await nodeIds(page);
    await tap(page, `[data-node="${ids.web}"] .node-box`);
    await page.keyboard.press('Delete');
    await fastForward(page, 1);
    expect(errors).toEqual([]);
  });

  test('only one Break-it experiment runs at a time, so both cannot count together', async ({ page }) => {
    await freshPage(page, '#build');
    await openMission(page, 2);
    await buildBasic(page);
    await page.fill('#estIn', '463');
    await page.click('#estBtn');
    await page.evaluate(() => { for (const n of window.__sdl.S.nodes) { if (n.size) n.size = 'L'; if (n.type === 'db') n.kind = 'sql'; } window.__sdl.afterDesignChange(); });
    await page.click('#playBtn');
    await fastForward(page, 5);
    // Both clicks in one step, so no simulated time passes between them, however slow the browser's clicks are.
    await page.evaluate(() => { document.getElementById('exp-crash').click(); document.getElementById('exp-spike').click(); }); // starting the spike ends the crash
    await expect(page.locator('#exp-crash')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#exp-spike')).toHaveAttribute('aria-pressed', 'true');
    expect(await logText(page)).toContain('Web server restarted.');
    await fastForward(page, 2);
    expect(await state(page, () => window.__sdl.S.exp[2])).toEqual({ crash: false, spike: true });
    expect(await state(page, () => window.__sdl.S.done[2])).toBe(false);
  });

  test('Delete and Backspace remove a component only when focus is on the canvas or the page', async ({ page, browserName }) => {
    await freshPage(page, '#build');
    const ids = await buildBasic(page);
    const has = (type) => page.evaluate((t) => window.__sdl.S.nodes.some((n) => n.type === t), type);
    // Keyboard: select the web server, move to a mission tab, press Backspace: nothing is deleted.
    await page.focus(`[data-node="${ids.web}"]`);
    await page.keyboard.press('Enter');
    await page.focus('#mtabs button:first-child');
    // Playwright's WebKit treats Backspace on a button as "go back" and leaves the game, so press it elsewhere only.
    if (browserName !== 'webkit') await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    expect(await has('web')).toBe(true);
    // Back on the canvas node, Delete removes it.
    await page.focus(`[data-node="${ids.web}"]`);
    await page.keyboard.press('Delete');
    expect(await has('web')).toBe(false);
    // Mouse: use an inspector button, then click a component on the canvas; Delete removes it.
    await tap(page, `[data-node="${ids.db}"] .node-box`);
    await page.click('#insp .seg:not(.two) button:nth-child(2)'); // size M: the button now has focus
    await tap(page, `[data-node="${ids.db}"] .node-box`);
    await page.keyboard.press('Delete');
    expect(await has('db')).toBe(false);
  });

  test('deleting a component while connecting it is saved and clears the banner', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page, '#build');
    await page.click('.pal-item[data-type="web"]');
    const { web } = await nodeIds(page);
    await tap(page, `[data-handle="${web}"] .hv`);
    await expect(page.locator('#banner')).toBeVisible();
    await page.keyboard.press('Delete');
    await reloadGame(page);
    expect((await nodeIds(page)).web).toBeUndefined();
    await expect(page.locator('#banner')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('bad or old saved data loads a working state', async ({ page }) => {
    const errors = trackErrors(page);
    await freshPage(page);
    for (const bad of [
      '{"nodes":[{"id":"u","type":"users","x":380,"y":76}],"edges":[],"mission":7}',
      '{"nodes":"oops"}',
      'not json',
      '{"nodes":[{"id":"u","type":"users","x":1,"y":1}],"edges":[{"from":"u","to":"zz"}],"mission":0}',
    ]) {
      await page.evaluate((v) => localStorage.setItem('sdl-level1-v1', v), bad);
      await reloadGame(page);
      await expect(page.locator('#tab-lesson')).toBeVisible();
    }
    // a v1 save keeps missions but drops quiz answers whose options were reordered
    await page.evaluate(() => localStorage.setItem('sdl-level1-v1', JSON.stringify({
      nodes: [{ id: 'u', type: 'users', x: 380, y: 76 }], edges: [], mission: 1,
      done: [true, false, false], verified: [true, false, false], quiz: { 0: 1 }, tab: 'build',
    })));
    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, false, false]);
    expect(await state(page, () => window.__sdl.S.quiz)).toEqual({});
    // a save from quiz version 2 keeps missions but drops its answers: version 3 replaced and reordered questions
    await page.evaluate(() => localStorage.setItem('sdl-level1-v1', JSON.stringify({
      nodes: [{ id: 'u', type: 'users', x: 380, y: 76 }], edges: [], mission: 1, v: 2, qv: 2,
      done: [true, false, false], verified: [true, false, false], quiz: { 0: 2, 1: 0 }, tab: 'build',
    })));
    await reloadGame(page);
    expect(await state(page, () => window.__sdl.S.done)).toEqual([true, false, false]);
    expect(await state(page, () => window.__sdl.S.quiz)).toEqual({});
    expect(errors).toEqual([]);
  });

  test('reset level progress clears missions and canvas but keeps the quiz', async ({ page }) => {
    await freshPage(page, '#build');
    await openMission(page, 2);
    await buildBasic(page);
    await page.evaluate(() => { window.__sdl.S.quiz = { 0: 2 }; window.__sdl.afterChange(); });
    await page.click('#resetLevel');
    await page.click('#resetLevel');
    expect(await state(page, () => window.__sdl.S.done)).toEqual([false, false, false]);
    expect(await state(page, () => window.__sdl.S.nodes.length)).toBe(1);
    expect(await state(page, () => window.__sdl.S.quiz)).toEqual({ 0: 2 });
  });
});

test.describe('Level 1 · teaching feedback', () => {
  test('the busy-server chart shows the 25× cap, not a failure, below 100% busy', async ({ page }) => {
    await freshPage(page);
    const chart = page.locator('#figQueue');
    await expect(chart.locator('text', { hasText: /^fail$/ })).toHaveCount(0);
    await expect(chart.locator('.ch-cap-t')).toHaveText('capped at 25× from 96%');
    await expect(chart).toHaveAttribute('aria-label', /capped at 25 times from 96%/);
    await expect(page.locator('#lessonRules')).toContainText('From 96% busy, a request takes at most 25× its work time; only load above 100% fails.');
  });

  test('changing the design after verifying resets the check', async ({ page }) => {
    await freshPage(page, '#build');
    await openMission(page, 2);
    await page.fill('#estIn', '463');
    await page.click('#estBtn');
    const ids = await buildBasic(page);
    await page.evaluate(() => {
      window.__sdl.S.nodes.forEach((n) => { if (n.size) n.size = 'L'; if (n.type === 'db') n.kind = 'sql'; });
      window.__sdl.afterChange();
    });
    await page.click('#playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.verified[2])).toBe(true);
    await tap(page, `[data-node="${ids.web}"] .node-box`);
    await page.click('#insp .seg:not(.two) button:nth-child(1)'); // downgrade to S
    await fastForward(page, 1);
    expect(await state(page, () => window.__sdl.S.verified[2])).toBe(false);
    // The game is still playing, so its next frame repaints the goals; toHaveClass waits for it.
    await expect(page.locator('#goals li:nth-child(2)')).toHaveClass('fail');
  });

  test('the log explains slow responses, single-server capacity and the NoSQL cost', async ({ page }) => {
    await freshPage(page, '#build');
    await openMission(page, 1);
    let ids = await buildBasic(page, { db: false });
    await expect(page.locator(`[data-node="${ids.web}"] .node-sub`)).toHaveText('S · 100 req/s (½)');
    await page.evaluate(() => window.__sdl.addNode('db'));
    ids = await nodeIds(page);
    await page.evaluate(([w, d]) => window.__sdl.tryConnect(w, d), [ids.web, ids.db]);
    await tap(page, `[data-node="${ids.db}"] .node-box`);
    await page.click('#insp .seg.two button:first-child'); // SQL
    await page.click('#playBtn');
    await fastForward(page, 2);
    await expect(page.locator('#log')).toContainText('misses the 150 ms goal'); // written by the live display loop
    await tap(page, `[data-node="${ids.db}"] .node-box`);
    await page.click('#insp .seg.two button:nth-child(2)'); // NoSQL
    await fastForward(page, 1);
    expect((await model(page)).served).toBeLessThan(99);
    await expect(page.locator('#log')).toContainText('lookups');
  });

  test('legend, story numbers and limit messages are right', async ({ page }) => {
    await freshPage(page, '#build');
    const legend = await page.locator('.legend').innerText();
    for (const word of ['Request', 'Response', 'Failed', 'DNS lookup']) expect(legend).toContain(word);
    expect(await page.content()).toContain('about 100,000 people');
    await page.click('.pal-item[data-type="db"]');
    await page.click('.pal-item[data-type="db"]', { force: true });
    expect(await logText(page)).toContain('replicas');
  });

  test('dropping onto a component nudges it clear; dropping outside explains', async ({ page }) => {
    await freshPage(page, '#build');
    await dragBetween(page, '.pal-item[data-type="web"]', '[data-node="u"] .node-box');
    const web = await state(page, () => window.__sdl.S.nodes.find((n) => n.type === 'web'));
    expect(Math.abs(web.y - 76) >= 74 || Math.abs(web.x - 380) >= 202).toBe(true);
    await dragBetween(page, '.pal-item[data-type="db"]', '#hud'); // outside the canvas
    expect(await logText(page)).toContain('Drop the database on the canvas');
  });
});

test.describe('Level 1 · layout', () => {
  test('laptop 1440×900: inspector fully visible', async ({ page }) => {
    await freshPage(page, '#build');
    await openMission(page, 2);
    await page.evaluate(() => window.__sdl.addNode('web'));
    const box = await page.locator('.insp-card').boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(900);
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test('canvas on first screen, readable labels, touch targets, no sideways scroll', async ({ page }) => {
      await freshPage(page, '#build');
      await buildBasic(page);
      const m = await page.evaluate(() => {
        const cv = document.getElementById('cv');
        const scale = cv.getScreenCTM().a;
        const px = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize) * scale;
        return {
          top: cv.getBoundingClientRect().top + scrollY,
          name: px('.node-name'),
          edge: px('.edge-label'),
          hit: document.querySelector('[data-handle] .hhit').getBoundingClientRect().width,
          svgTouch: getComputedStyle(cv).touchAction,
          nodeTouch: getComputedStyle(document.querySelector('#cv .node')).touchAction,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      expect(m.top).toBeLessThan(844);
      expect(m.name).toBeGreaterThanOrEqual(11);
      expect(m.edge).toBeGreaterThanOrEqual(9.5);
      expect(m.hit).toBeGreaterThanOrEqual(24);
      expect(m.svgTouch).toBe('pan-y');
      expect(m.nodeTouch).toBe('none');
      expect(m.scrollWidth).toBeLessThanOrEqual(390);
    });
  });
});

test.describe('Level 1 · accessibility', () => {
  test('keyboard only: build and finish Mission 1, move nodes, switch tabs', async ({ page }) => {
    await freshPage(page, '#build');
    await page.focus('.pal-item[data-type="dns"]');
    await page.keyboard.press('Enter');
    await page.focus('.pal-item[data-type="web"]');
    await page.keyboard.press('Enter');
    await page.focus('[data-node="u"]');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement.getAttribute('data-node'))).toBe('u');
    for (let k = 0; k < 2; k++) {
      await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
      await page.keyboard.press('Enter');
    }
    expect(await state(page, () => window.__sdl.S.edges.length)).toBe(2);
    await page.focus('#playBtn');
    await page.keyboard.press('Enter');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[0])).toBe(true);

    await page.focus('[data-node="u"]');
    const x0 = await state(page, () => window.__sdl.S.nodes[0].x);
    await page.keyboard.press('ArrowRight');
    expect(await state(page, () => window.__sdl.S.nodes[0].x)).toBe(x0 + 10);

    await page.focus('#tab-build');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#view-quiz')).toBeVisible();
  });

  test('keyboard only: Missions 2 and 3 keep focus on a control after every action', async ({ page }) => {
    await freshPage(page, '#build');
    await openMission(page, 1);
    const ids = await buildBasic(page, { db: false });
    const focused = () => page.evaluate(() => {
      const a = document.activeElement;
      return !a || a === document.body ? 'body' : (a.dataset.focusKey || a.id || a.getAttribute('data-node') || a.textContent.trim().slice(0, 30));
    });
    const press = async (selector, expected) => {
      await page.focus(selector);
      await page.keyboard.press('Enter');
      const f = await focused();
      expect(f, `focus after Enter on ${selector}`).not.toBe('body');
      if (expected) expect(f).toBe(expected);
    };

    // Mission 2: add a database, connect it, make it SQL, scale the web server to M.
    await press('.pal-item[data-type="db"]', 'pal-db');
    const db = (await state(page, () => window.__sdl.S.nodes.find((n) => n.type === 'db'))).id;
    await press(`[data-node="${ids.web}"]`, ids.web);
    await page.locator('#insp .conn').getByRole('button', { name: 'Connect', exact: true }).first().focus();
    await page.keyboard.press('Enter');
    expect(await focused()).toBe(`conn-${db}`);
    await press('#insp .seg:not(.two) button:nth-child(2)', 'size-M');
    await press(`[data-node="${db}"]`, db);
    await press('#insp .seg.two button:first-child', 'kind-sql');
    await press('#playBtn', 'playBtn');
    await fastForward(page, 5);
    expect(await state(page, () => window.__sdl.S.done[1])).toBe(true);
    await press('#mission .complete button');

    // Mission 3: estimate, scale up, run both experiments, then remove a component and switch missions.
    await page.focus('#estIn');
    await page.keyboard.type('463');
    await page.keyboard.press('Enter');
    expect(await focused()).not.toBe('body');
    for (const id of [ids.web, db]) {
      await press(`[data-node="${id}"]`, id);
      await press('#insp .seg:not(.two) button:nth-child(3)', 'size-L');
    }
    await press('#playBtn', 'playBtn');
    await press('#exp-crash', 'exp-crash');
    await press('#exp-crash', 'exp-crash');
    await press(`[data-node="${ids.dns}"]`, ids.dns);
    await page.locator('#insp').getByRole('button', { name: 'Remove DNS' }).focus();
    await page.keyboard.press('Enter');
    expect(await state(page, () => window.__sdl.S.nodes.some((n) => n.type === 'dns'))).toBe(false);
    expect(await focused()).toBe('u'); // nothing is selected now, so the inspector closed: the first component takes focus
    await press('#mtabs button:first-child', 'mtab-0');
  });

  registerCommonTests({
    level: 1,
    onTab: {
      build: async (page) => {
        await buildBasic(page);
        await page.click('#playBtn');
        await playFor(page, 0.5);
      },
      quiz: async (page) => {
        const q = page.locator('.q').nth(0);
        await q.locator('.opts button').nth(1).click();
        await q.locator('.qcheck button').click();
      },
    },
  });
});

test.describe('Level 1 · one-page lesson', () => {
  registerPageLessonTests({ level: 1 });
});
