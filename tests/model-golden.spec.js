import { test, expect } from './fixtures.js';
import { freshPage } from './helpers.js';

// Pins Level 1's simulation numbers so refactors cannot change the game's balance.
// Expected values are worked out by hand from the formulas in the simulation model
// (utilization = load ÷ capacity, time = base ÷ (1 − utilization), excess requests fail),
// not read back from the code.

/**
 * Build a design directly in state and return the model's output.
 * mission: 0 = 50 req/s, 1 = 150 req/s, 2 = 463 req/s.
 */
async function measure(page, { mission, web, db = null, kind = 'sql', dns = true, hasWeb = true, t = 0, crash = false, spike = false }) {
  return page.evaluate((o) => {
    const { S, run, model } = window.__sdl;
    S.mission = o.mission;
    S.nodes = [{ id: 'u', type: 'users', x: 380, y: 76 }];
    S.edges = [];
    if (o.dns) { S.nodes.push({ id: 'd', type: 'dns', x: 650, y: 76 }); S.edges.push({ id: 'e1', from: 'u', to: 'd' }); }
    if (o.hasWeb) { S.nodes.push({ id: 'w', type: 'web', x: 380, y: 262, size: o.web }); S.edges.push({ id: 'e2', from: 'u', to: 'w' }); }
    if (o.db) { S.nodes.push({ id: 'b', type: 'db', x: 380, y: 436, size: o.db, kind: o.kind }); S.edges.push({ id: 'e3', from: 'w', to: 'b' }); }
    run.t = o.t; run.on = {};
    if (o.crash) run.on.crash = { node: 'w' };
    if (o.spike) run.on.spike = {};
    const m = model();
    const node = (id) => m.node[id] ? { load: m.node[id].load, cap: m.node[id].cap, util: m.node[id].util, ms: m.node[id].ms, down: !!m.node[id].down } : null;
    return { qps: m.qps, base: m.base, served: m.servedPct, latency: m.latency, cost: m.cost, spof: m.spof, issue: m.issue, web: node('w'), db: node('b') };
  }, { mission, web, db, kind, dns, hasWeb, t, crash, spike });
}

test.describe('Level 1 · simulation numbers', () => {
  test.beforeEach(async ({ page }) => { await freshPage(page); });

  test('one server running code and data gets half capacity', async ({ page }) => {
    // 50 req/s on S (200 ÷ 2 = 100): 50% busy → (20 + 10) × 2 = 60 ms, + 40 ms network.
    const r = await measure(page, { mission: 0, web: 'S' });
    expect(r.qps).toBe(50);
    expect(r.web.cap).toBe(100);
    expect(r.web.util).toBeCloseTo(0.5, 6);
    expect(r.latency).toBeCloseTo(100, 6);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.cost).toBe(45); // S $40 + DNS $5
    expect(r.spof).toBe(1);
  });

  test('a single server over capacity drops the excess and hits the 25× cap', async ({ page }) => {
    // 150 req/s on 100 capacity: 1/3 fail; utilization ≥ 0.96 → 25 × 30 ms = 750 ms.
    const r = await measure(page, { mission: 1, web: 'S' });
    expect(r.web.util).toBeCloseTo(1.5, 6);
    expect(r.served).toBeCloseTo(66.6667, 3);
    expect(r.latency).toBeCloseTo(790, 6);
  });

  test('two tiers at 75% busy each take 4× their base time', async ({ page }) => {
    // Web 20 × 4 = 80 ms, DB 10 × 4 = 40 ms, + 40 network + 0.5 in-DC hop = 160.5 ms.
    const r = await measure(page, { mission: 1, web: 'S', db: 'S' });
    expect(r.web.util).toBeCloseTo(0.75, 6);
    expect(r.db.util).toBeCloseTo(0.75, 6);
    expect(r.web.ms).toBeCloseTo(80, 6);
    expect(r.db.ms).toBeCloseTo(40, 6);
    expect(r.latency).toBeCloseTo(160.5, 6);
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.cost).toBe(85);
    expect(r.spof).toBe(2);
  });

  test('a bigger web server brings Mission 2 under 150 ms', async ({ page }) => {
    // Web M at 37.5% → 1.6 × 20 = 32 ms; DB S still 40 ms → 112.5 ms.
    const r = await measure(page, { mission: 1, web: 'M', db: 'S' });
    expect(r.latency).toBeCloseTo(112.5, 6);
    expect(r.cost).toBe(135);
  });

  test('NoSQL for relational data costs 3 lookups per request', async ({ page }) => {
    // 150 × 3 = 450 lookups/s on 200 capacity: only 200 ÷ 3 ≈ 66.7 req/s get answers.
    const r = await measure(page, { mission: 1, web: 'M', db: 'S', kind: 'nosql' });
    expect(r.db.load).toBeCloseTo(450, 6);
    expect(r.db.util).toBeCloseTo(2.25, 6);
    expect(r.db.ms).toBeCloseTo(225, 6); // 3 lookups × 3 ms × 25
    expect(r.served).toBeCloseTo(44.4444, 3);
    expect(r.latency).toBeCloseTo(297.5, 6);
  });

  test('launch day: an undersized database fails the excess', async ({ page }) => {
    const r = await measure(page, { mission: 2, web: 'L', db: 'M' });
    expect(r.qps).toBe(463);
    expect(r.web.util).toBeCloseTo(0.57875, 6);
    expect(r.db.util).toBeCloseTo(1.1575, 6);
    expect(r.served).toBeCloseTo(86.3931, 3);
    expect(r.latency).toBeCloseTo(337.9777, 3);
  });

  test('launch day: L + L passes with margin', async ({ page }) => {
    const r = await measure(page, { mission: 2, web: 'L', db: 'L' });
    expect(r.served).toBeCloseTo(100, 6);
    expect(r.latency).toBeCloseTo(111.7166, 3);
    expect(r.cost).toBe(405);
  });

  test('10× spike overwhelms even XL servers', async ({ page }) => {
    // 4,630 req/s: web serves 1,600, the database receives 1,600 and is exactly full.
    const r = await measure(page, { mission: 2, web: 'XL', db: 'XL', spike: true });
    expect(r.base).toBe(4630);
    expect(r.served).toBeCloseTo(34.5572, 3);
    expect(r.latency).toBeCloseTo(790.5, 6);
  });

  test('a crashed web server serves nothing', async ({ page }) => {
    const r = await measure(page, { mission: 2, web: 'L', db: 'L', crash: true });
    expect(r.web.down).toBe(true);
    expect(r.served).toBe(0);
    expect(r.latency).toBeNull();
    expect(r.issue).toMatch(/down/);
  });

  test('missing DNS or web server serves nothing and explains why', async ({ page }) => {
    const noDns = await measure(page, { mission: 0, web: 'S', dns: false });
    expect(noDns.served).toBe(0);
    expect(noDns.issue).toMatch(/DNS/);
    const noWeb = await measure(page, { mission: 0, hasWeb: false });
    expect(noWeb.served).toBe(0);
    expect(noWeb.issue).toMatch(/web server/);
  });

  test('traffic wobbles by at most ±3% around the mission target', async ({ page }) => {
    // qps = base × (1 + 0.02 sin(1.7t) + 0.01 sin(4.1t)); at t = 1 s that is 151.7476.
    const r = await measure(page, { mission: 1, web: 'S', db: 'S', t: 1 });
    expect(r.base).toBe(150);
    expect(r.qps).toBeCloseTo(151.7476, 3);
  });
});
