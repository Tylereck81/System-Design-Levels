// Level 3 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';

const L = await loadLevel(3);

missionTests(L, [
  {
    start: ['split', 'dbbusy', 'lat', 'crash-replica'],
    solution: { id: 'b6a4bf92', is: 'an XL primary with two XL replicas' },
    broken: { id: '13085879', is: 'one replica', misses: ['dbbusy', 'lat'] },
  },
  {
    start: ['split', 'dbbusy', 'served', 'lat', 'crash-replica'],
    solution: { id: 'ebb34dc4', is: 'an XL primary with three XL replicas' },
    broken: { id: 'a4ec1334', is: 'an L primary', misses: ['crash-replica'] },
  },
  {
    start: ['split', 'spof', 'dbbusy', 'served', 'lat', 'crash-primary'],
    solution: { id: 'ebb34dc4', is: 'an XL primary with three XL replicas' },
    needsPlayer: ['crash-primary'],
  },
]);

test('Mission 1 solution: cost', () => {
  L.place(L.design('b6a4bf92'), 0);
  // DNS $5 + two load balancers 2 × $20 + two XL web servers 2 × $450 + three XL databases 3 × $450 = $2,295.
  assert.equal(L.model().cost, 2295);
});

test('Mission 2: one XL database serves 80%', () => {
  L.place(L.design('start'), 1);
  // 2,000 queries/s on one XL database of 1,600/s: 1,600 / 2,000 = 80%.
  assert.equal(L.model().servedPct, 80);
});

test('Mission 3: crash the primary, then promote a replica', () => {
  const { S, run } = L.state;
  const exp = L.level.experiments.find((e) => e.id === 'crash-primary');
  L.place(L.design('ebb34dc4'), 2);
  const old = S.nodes.find((n) => n.type === 'db' && n.role === 'primary');
  run.on[exp.id] = { node: old.id };
  // Every write fails: 1 in 5 requests is a write, so 80% are served.
  assert.equal(L.model().servedPct, 80);
  assert.equal(exp.expect(L.model({ peak: true })), false);
  // Promote a replica, as the inspector's button does: the old primary becomes a replica.
  old.role = 'replica'; old.wasPrimary = true;
  S.nodes.find((n) => n.type === 'db' && n.role === 'replica' && n !== old).role = 'primary';
  // At the peak, 2,000 × 1.03 = 2,060/s: the new primary takes 412 writes; the two healthy replicas each take
  // 1,648 / 2 = 824 reads plus all 412 writes = 1,236 of 1,600/s. Everything is served.
  const peak = L.model({ peak: true });
  assert.equal(peak.servedPct, 100);
  assert.equal(exp.expect(peak), true);
  run.on = {};
});
