// Shared helpers for level tests. They drive the game through the real UI where it matters,
// and through window.__sdl test hooks for setup and for fast-forwarding simulated time.

import { installCapture } from './snapshot/capture.js';

import { expect } from '@playwright/test';

export const QUIZ_KEY_L1 = [2, 0, 2, 3, 3, 1, 1, 2, 1, 0];

/** Open the game with empty saved progress, on Level 1's lesson unless `hash` names another page ('' is the home page). */
export async function freshPage(page, hash = '#lesson') {
  await installCapture(page);
  // Each test gets a new browser context, so a page that has not opened anything yet has no saved data and the game
  // loads once. Otherwise clear it on the game's own page first.
  const { origins } = await page.context().storageState();
  if (page.url() !== 'about:blank' || origins.some((o) => o.localStorage.length > 0)) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    // Leave the page first: changing only the hash to another level would make the game reload itself.
    await page.goto('about:blank');
  }
  await page.goto('/' + hash);
  await page.waitForFunction(() => !!window.__sdl || document.getElementById('view-home')?.hidden === false); // a level, or the home page
}

/** Reload the page and wait until the game has started (it loads its level file first). */
export async function reloadGame(page) {
  await page.reload();
  await page.waitForFunction(() => !!window.__sdl);
}

/** Advance the simulation by `secs` simulated seconds without waiting in real time. */
export async function fastForward(page, secs) {
  await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__sdl.step(0.02); }, Math.round(secs * 50));
}

/**
 * Wait while the game plays in real time until its own frame loop has moved the clock on by `secs` simulated seconds
 * (unlike fastForward, the page draws every frame). It waits on the clock, not on a fixed time, so a slow machine
 * only makes it take longer; a clock that stops fails within 10 s, with a message.
 */
export async function playFor(page, secs) {
  const clock = () => page.evaluate(() => ({ playing: window.__sdl.run.playing, t: window.__sdl.run.t }));
  const start = await clock();
  expect(start.playing, 'the game is playing (press Play first)').toBe(true);
  await expect.poll(async () => (await clock()).t - start.t, {
    message: `the frame loop moves the clock on by ${secs} s`,
    timeout: 10_000,
  }).toBeGreaterThanOrEqual(secs);
}

export const state = (page, fn) => page.evaluate(fn);
export const nodeIds = (page) => page.evaluate(() => Object.fromEntries(window.__sdl.S.nodes.map((n) => [n.type, n.id])));
export const model = (page) => page.evaluate(() => {
  const m = window.__sdl.model();
  return { served: +m.servedPct.toFixed(2), latency: m.latency && +m.latency.toFixed(1), cost: m.cost };
});
/**
 * `count` request dots ({ route, failAt }) for the current model. A seeded generator (mulberry32) replaces
 * Math.random, so the same design gives the same routes every run and proportion checks are not left to chance.
 */
export const sampleRoutes = (page, count, seed = 1) => page.evaluate(([n, s0]) => {
  let s = s0 >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const m = window.__sdl.model();
  return Array.from({ length: n }, () => window.__sdl.sampleRoute(m, rand));
}, [count, seed]);
export const logText = (page) => page.locator('#log').innerText();

export async function center(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Click at the centre of an element by coordinates (SVG children can't be clicked by selector). */
export async function tap(page, selector) {
  const p = await center(page, selector);
  await page.mouse.click(p.x, p.y);
}

export async function dragBetween(page, fromSelector, toSelectorOrPoint) {
  const a = await center(page, fromSelector);
  const b = typeof toSelectorOrPoint === 'string' ? await center(page, toSelectorOrPoint) : toSelectorOrPoint;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/**
 * Mark missions 0..i-1 done and verified, then open mission i.
 * `estimate: true` also marks the level's estimate step as answered, so a gated mission shows its traffic.
 */
export async function openMission(page, i, { estimate = false } = {}) {
  await page.evaluate(([k, est]) => {
    const S = window.__sdl.S;
    for (let j = 0; j < k; j++) { S.done[j] = true; S.verified[j] = true; }
    S.mission = k;
    if (S.opened) for (let j = 0; j <= k; j++) S.opened[j] = true; // a one-page lesson opens missions from their cards
    if (est) S.est = true;
    window.__sdl.afterChange(true);
  }, [i, estimate]);
}

/** Press Enter on the element matching `selector`, as a keyboard player would. */
export async function pressEnterOn(page, selector) {
  await page.focus(selector);
  await page.keyboard.press('Enter');
}

/** Select a node on the canvas with the keyboard. */
export const selectNode = (page, id) => pressEnterOn(page, `[data-node="${id}"]`);

/** Change a node's properties directly, then let the game react as it does to a design change. */
export const setProps = (page, id, props) => page.evaluate(([nodeId, p]) => {
  Object.assign(window.__sdl.S.nodes.find((n) => n.id === nodeId), p);
  window.__sdl.afterDesignChange();
}, [id, props]);

/** Pause traffic and rewind the clock, so a reading is taken at the start of the run. */
export const calm = (page) => page.evaluate(() => { const s = window.__sdl; s.run.playing = false; s.run.t = 0; });

/** Build Users → DNS, Users → Web server (→ Database) through the API. */
export async function buildBasic(page, { db = true } = {}) {
  await page.evaluate((withDb) => {
    const sdl = window.__sdl;
    ['dns', 'web', ...(withDb ? ['db'] : [])].forEach((t) => sdl.addNode(t));
    const id = (t) => sdl.S.nodes.find((n) => n.type === t).id;
    sdl.tryConnect('u', id('dns'));
    sdl.tryConnect('u', id('web'));
    if (withDb) sdl.tryConnect(id('web'), id('db'));
  }, db);
  return nodeIds(page);
}

/** Collect page errors so a test can assert there were none. */
export function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}
