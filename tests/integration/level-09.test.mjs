// Level 9 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(9);

propertyTests(L);

missionTests(L, [
  {
    start: ['shards', 'served', 'lat'],
    solution: { id: 'ae398b49', is: 'three XL shards keyed by account' },
    broken: { id: '12753872', is: 'shards keyed by country', misses: ['shards'] },
  },
  {
    start: ['shards', 'served', 'lat'],
    solution: { id: '6abeeee5', is: 'shards that give the hot account its own shard' },
    broken: { id: 'ae398b49', is: 'the hot account staying on a shared shard', misses: ['shards'] },
  },
  {
    start: ['nosql', 'shards', 'served', 'lat', 'reshard'],
    solution: { id: '6b38d678', is: 'shards plus a NoSQL store' },
    broken: { id: '6abeeee5', is: 'no NoSQL store', misses: ['nosql', 'shards'] },
  },
]);

test('Mission 1 solution: the shards cost one XL server each', () => {
  L.place(L.design('ae398b49'), 0);
  // Three XL shards: 3 × $450 = $1,350.
  assert.equal(L.costOfType('shards'), 1350);
});
