// Level 1 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(1);

propertyTests(L);

missionTests(L, [
  {
    start: ['dns', 'web', 'served', 'lat'],
    solution: { id: '9db8f413', is: 'DNS and one S web server' },
    broken: { id: 'db859200', is: 'DNS with no web server', misses: ['web', 'served', 'lat'] },
  },
  {
    start: ['tier', 'kind', 'served', 'lat'],
    solution: { id: '9791bba9', is: 'an S web server with an M SQL database' },
    broken: { id: '662519a9', is: 'an S SQL database', misses: ['lat'] },
  },
  {
    start: ['served', 'lat', 'crash', 'spike'],
    solution: { id: '4e6eb488', is: 'an L web server with an L SQL database' },
    broken: { id: '534c9c0a', is: 'an M SQL database', misses: ['served', 'lat'] },
  },
]);

test('Mission 1 solution: response time and cost', () => {
  L.place(L.design('9db8f413'), 0);
  const r = L.model();
  // A web server with no database runs it too: half of S's 200 req/s = 100, base 20 + 10 = 30 ms.
  // 50 req/s → ρ = 0.5 → 30 × 1/(1 − 0.5) = 60 ms, plus the 40 ms internet round trip = 100 ms.
  assert.equal(r.servedPct, 100);
  assert.ok(Math.abs(r.latency - 100) < 1e-9, `latency ${r.latency}`);
  // DNS $5 + S web server $40 = $45.
  assert.equal(r.cost, 45);
});

test('Mission 2: the same lone web server serves two thirds of the traffic', () => {
  L.place(L.design('9db8f413'), 1);
  // 150 req/s on a capacity of 100 req/s: 100 / 150 = 66.7% served.
  assert.ok(Math.abs(L.model().servedPct - 200 / 3) < 1e-9);
});

test('the first debrief\'s numbers are what the simulation gives for Mission 1\'s design', () => {
  const { debrief } = L.level.lesson.chapters[0];
  // "about 100 ms": Mission 1's solution at 50 req/s (worked out in the response time test above).
  L.place(L.design('9db8f413'), 0);
  assert.equal(debrief.number[0], `about ${Math.round(L.model().latency)} ms`);
  // "can carry 100", "one request in three would fail": the same design at Mission 2's 150 req/s serves
  // 150 × 2/3 = 100 req/s and fails 1 − 2/3 = 1/3 of them.
  L.place(L.design('9db8f413'), 1);
  const served = L.model().servedPct / 100;
  assert.equal(Math.round(L.level.missions[1].qps * served), 100);
  assert.ok(Math.abs(1 - served - 1 / 3) < 1e-9);
  assert.match(debrief.next, /can carry 100\. One request in three would fail\./);
});
