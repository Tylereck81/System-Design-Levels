import { test, expect } from '@playwright/test';
import { freshPage } from './helpers.js';

// The model works on any graph: peers of the same type share load, a crashed peer's share
// moves to the others, SPOFs come from the graph, and request dots follow real paths.
// Level 1's limits stop players building these designs, so they are set up directly in state.
// Expected values are worked out by hand from the simulation model's formulas.

/** Users → DNS, Users → each web server, each web server → the databases listed for it. */
async function design(page, { mission, webs, dbs, links, crash = false, extraEdges = [] }) {
  return page.evaluate((o) => {
    const { S, run } = window.__sdl;
    S.mission = o.mission;
    S.nodes = [{ id: 'u', type: 'users', x: 0, y: 0 }, { id: 'd', type: 'dns', x: 0, y: 0 }];
    S.edges = [{ id: 'e0', from: 'u', to: 'd' }];
    let e = 1;
    for (const [id, size] of Object.entries(o.webs)) { S.nodes.push({ id, type: 'web', x: 0, y: 0, size }); S.edges.push({ id: 'e' + e++, from: 'u', to: id }); }
    for (const [id, size] of Object.entries(o.dbs)) S.nodes.push({ id, type: 'db', x: 0, y: 0, size, kind: 'sql' });
    for (const [from, to] of [...o.links, ...o.extraEdges]) S.edges.push({ id: 'e' + e++, from, to });
    run.t = 0; run.on = o.crash ? { crash: { node: o.crash } } : {};
  }, { mission, webs, dbs, links, crash, extraEdges });
}
const measure = (page) => page.evaluate(() => {
  const m = window.__sdl.model();
  return { served: m.servedPct, latency: m.latency, spof: m.spof, cost: m.cost, node: m.node };
});

test.describe('Simulation model · any graph', () => {
  test.beforeEach(async ({ page }) => { await freshPage(page); });

  test('two web servers split the load evenly; the shared database gets the sum', async ({ page }) => {
    // 150 req/s → 75 each on S (37.5% busy → 1.6 × 20 = 32 ms); the M database gets 150 (37.5% → 16 ms).
    await design(page, { mission: 1, webs: { w1: 'S', w2: 'S' }, dbs: { b: 'M' }, links: [['w1', 'b'], ['w2', 'b']] });
    const r = await measure(page);
    expect(r.node.w1.load).toBeCloseTo(75, 6);
    expect(r.node.w2.load).toBeCloseTo(75, 6);
    expect(r.node.b.load).toBeCloseTo(150, 6);
    expect(r.node.w1.ms).toBeCloseTo(32, 6);
    expect(r.node.b.ms).toBeCloseTo(16, 6);
    expect(r.latency).toBeCloseTo(88.5, 6);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.cost).toBe(175);
  });

  test('a crashed web server\'s share moves to its healthy peer', async ({ page }) => {
    // w1 down: w2 takes all 150 req/s (75% busy → 80 ms) and nothing fails.
    await design(page, { mission: 1, webs: { w1: 'S', w2: 'S' }, dbs: { b: 'M' }, links: [['w1', 'b'], ['w2', 'b']], crash: 'w1' });
    const r = await measure(page);
    expect(r.node.w1.down).toBe(true);
    expect(r.node.w2.load).toBeCloseTo(150, 6);
    expect(r.node.w2.ms).toBeCloseTo(80, 6);
    expect(r.latency).toBeCloseTo(136.5, 6);
    expect(r.served).toBeCloseTo(100, 6);
  });

  test('any component can be crashed: a down database fails every request behind healthy web servers', async ({ page }) => {
    await design(page, { mission: 1, webs: { w1: 'S', w2: 'S' }, dbs: { b: 'M' }, links: [['w1', 'b'], ['w2', 'b']], crash: 'b' });
    const r = await measure(page);
    expect(r.node.b.down).toBe(true);
    expect(r.node.b.load).toBeCloseTo(150, 6); // the requests still arrive, and fail there
    expect(r.node.w1.load).toBeCloseTo(75, 6);
    expect(r.node.w1.down).toBeUndefined();
    expect(r.served).toBe(0);
    expect(r.latency).toBeNull();
  });

  test('overloaded peers each drop their excess; failover halves what gets through', async ({ page }) => {
    // 463 req/s → 231.5 each on S (200 max): 400 served. After a crash, one S serves 200 of 463.
    await design(page, { mission: 2, webs: { w1: 'S', w2: 'S' }, dbs: { b: 'XL' }, links: [['w1', 'b'], ['w2', 'b']] });
    let r = await measure(page);
    expect(r.served).toBeCloseTo(86.3931, 3);
    expect(r.node.b.load).toBeCloseTo(400, 6);
    expect(r.latency).toBeCloseTo(553.8333, 3);
    await design(page, { mission: 2, webs: { w1: 'S', w2: 'S' }, dbs: { b: 'XL' }, links: [['w1', 'b'], ['w2', 'b']], crash: 'w1' });
    r = await measure(page);
    expect(r.served).toBeCloseTo(43.1965, 3);
  });

  test('SPOFs are components on the request path with no peer of the same type', async ({ page }) => {
    // Two web servers sharing one database: only the database is a SPOF.
    await design(page, { mission: 1, webs: { w1: 'S', w2: 'S' }, dbs: { b: 'M' }, links: [['w1', 'b'], ['w2', 'b']] });
    expect((await measure(page)).spof).toBe(1);
    // Two web servers, each using both databases: no SPOF.
    await design(page, { mission: 1, webs: { w1: 'S', w2: 'S' }, dbs: { b1: 'M', b2: 'M' }, links: [['w1', 'b1'], ['w1', 'b2'], ['w2', 'b1'], ['w2', 'b2']] });
    expect((await measure(page)).spof).toBe(0);
  });

  test('request dots follow a real path and avoid a crashed peer', async ({ page }) => {
    await design(page, { mission: 1, webs: { w1: 'S', w2: 'S' }, dbs: { b: 'M' }, links: [['w1', 'b'], ['w2', 'b']] });
    let routes = await page.evaluate(() => { const m = window.__sdl.model(); return Array.from({ length: 200 }, () => window.__sdl.sampleRoute(m)); });
    expect(new Set(routes.map((r) => r.route.join('>')))).toEqual(new Set(['u>w1>b>w1>u', 'u>w2>b>w2>u']));
    expect(routes.every((r) => r.failAt === -1)).toBe(true); // nobody is over capacity
    await design(page, { mission: 1, webs: { w1: 'S', w2: 'S' }, dbs: { b: 'M' }, links: [['w1', 'b'], ['w2', 'b']], crash: 'w1' });
    routes = await page.evaluate(() => { const m = window.__sdl.model(); return Array.from({ length: 50 }, () => window.__sdl.sampleRoute(m)); });
    expect(routes.every((r) => r.route.join('>') === 'u>w2>b>w2>u')).toBe(true);
  });

  test('a loop in the design does not hang the simulation', async ({ page }) => {
    await design(page, { mission: 1, webs: { w: 'S' }, dbs: { b: 'M' }, links: [['w', 'b']], extraEdges: [['b', 'w']] });
    const r = await measure(page);
    expect(Number.isFinite(r.spof)).toBe(true);
    expect(r.served).toBeGreaterThanOrEqual(0);
  });
});
