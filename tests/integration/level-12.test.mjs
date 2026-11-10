// Level 12 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(12);

propertyTests(L);

missionTests(L, [
  {
    start: ['fresh', 'partition'],
    solution: { id: '032e72b8', is: 'a strict quorum with N = 3, W = 3, R = 1' },
    broken: { id: '9d8968c4', is: 'a sloppy quorum with W = 2, R = 2', misses: ['partition'] },
  },
  {
    start: ['durable'],
    solution: { id: '9d8968c4', is: 'a sloppy quorum with W = 2, R = 2' },
  },
  {
    start: ['fresh', 'partition'],
    solution: { id: 'dbf03b6c', is: 'a strict quorum with N = 3, W = 3, R = 1' },
  },
]);

test('Mission 1 solution: the store pays for every copy', () => {
  L.place(L.design('032e72b8'), 0);
  // N = 3 copies × $150 = $450.
  assert.equal(L.costOfType('kv'), 450);
});

test('Web servers that keep their data in the key-value store run at full capacity', () => {
  L.place(L.design('032e72b8'), 0);
  // 2,000 req/s → 1,000 per L web group. A full L server takes 800, the autoscaler fills it to 60% (480): each hour runs
  // ceil(1,000 × day share ÷ 480) servers, 40 server-hours a day → $200 × 40 ÷ 24 = $333 a group.
  // DNS $5 + LB $20 + N = 3 copies × $150 + 2 × $333 = $1,141. (Halved, as if each ran its own database: $1,509.)
  assert.equal(L.model().cost, 1141);
});

test('Five copies miss only the budget, in every mission', () => {
  // DNS $5 + LB $20 + 5 × $150 + 2 web groups × $333 = $1,441, over the $1,300 budget.
  for (const [mission, props] of [[0, { n: '5', w: '3', r: '3' }], [1, { n: '5', w: '3', r: '3', mode: 'sloppy' }], [2, { n: '5', w: '5', r: '1' }]]) {
    const d = structuredClone(L.design('start'));
    Object.assign(d.nodes.find((n) => n.id === 'k'), props);
    assert.deepEqual(L.missed(d, mission), ['cost'], `mission ${mission + 1}`);
  }
});
