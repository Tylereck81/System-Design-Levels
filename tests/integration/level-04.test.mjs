// Level 4 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(4);

propertyTests(L);

missionTests(L, [
  {
    start: ['hit', 'dbbusy', 'cost'],
    solution: { id: '29676a76', is: 'two L caches (10-minute TTL) and one replica' },
    broken: { id: '3d29be60', is: 'one XL cache and two replicas', misses: ['cost'] },
  },
  {
    start: ['hit', 'dbbusy', 'cost', 'crash-cache'],
    solution: { id: '29676a76', is: 'two L caches (10-minute TTL) and one replica' },
    broken: { id: '80b70971', is: 'one L cache', misses: ['spof', 'crash-cache'] },
  },
  {
    start: ['hit', 'dbbusy', 'cost'],
    solution: { id: 'c98aca5b', is: 'two L caches that delete an entry on write' },
    broken: { id: '28cc8907', is: 'three caches with a one-minute TTL', misses: ['hit'] },
  },
]);

test('Mission 1 solution: cost', () => {
  L.place(L.design('29676a76'), 0);
  // DNS $5 + two load balancers 2 × $20 + two XL web servers 2 × $450 + XL primary and XL replica 2 × $450
  // + two L caches 2 × $80 = $2,005.
  assert.equal(L.model().cost, 2005);
});
