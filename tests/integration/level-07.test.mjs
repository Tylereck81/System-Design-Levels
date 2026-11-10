// Level 7 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(7);

propertyTests(L);

missionTests(L, [
  {
    start: ['far-page'],
    solution: { id: 'b1f3f302', is: 'an M data center near and an S one far away' },
    broken: { id: 'ee7358fa', is: 'an L data center near', misses: ['cost'] },
  },
  {
    start: ['spof', 'dc-offline'],
    solution: { id: '9330ab7c', is: 'an L data center near and a second one far away' },
    broken: { id: 'a290c6f4', is: 'an M data center near', misses: ['dc-offline'] },
  },
]);

test('Mission 1 solution: cost', () => {
  L.place(L.design('b1f3f302'), 0);
  // DNS $5 + CDN $1,037 (as in Level 5: 4,000 req/s, 0.5 files of 20 KB) + M data center $1,200 + S data center $700
  // = $2,942.
  assert.equal(L.costOfType('cdn'), 1037);
  assert.equal(L.model().cost, 2942);
});
