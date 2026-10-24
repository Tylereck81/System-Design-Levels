// Shared helpers for level tests. They drive the game through the real UI where it matters,
// and through window.__sdl test hooks for setup and for fast-forwarding simulated time.

export const QUIZ_KEY_L1 = [2, 0, 3, 1, 2, 0, 1, 3, 2, 0];

/** Open the game with empty saved progress. */
export async function freshPage(page, hash = '') {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/' + hash);
  await page.reload();
  await page.waitForFunction(() => !!window.__sdl);
}

/** Advance the simulation by `secs` simulated seconds without waiting in real time. */
export async function fastForward(page, secs) {
  await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__sdl.step(0.02); }, Math.round(secs * 50));
}

export const state = (page, fn) => page.evaluate(fn);
export const nodeIds = (page) => page.evaluate(() => Object.fromEntries(window.__sdl.S.nodes.map((n) => [n.type, n.id])));
export const model = (page) => page.evaluate(() => {
  const m = window.__sdl.model();
  return { served: +m.servedPct.toFixed(2), latency: m.latency && +m.latency.toFixed(1), cost: m.cost };
});
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

/** Mark the first `count` missions done and open the next one. */
export async function unlockMissions(page, count) {
  await page.evaluate((c) => {
    const S = window.__sdl.S;
    for (let i = 0; i < c; i++) { S.done[i] = true; S.verified[i] = true; }
    S.mission = c;
    window.__sdl.afterChange(true);
  }, count);
}

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
