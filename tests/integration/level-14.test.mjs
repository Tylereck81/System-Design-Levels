// Level 14 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';

const L = await loadLevel(14);

missionTests(L, [
  {
    start: ['viral'],
    solution: { id: '359ee2bf', is: 'a cache in front of the database' },
    broken: { id: 'e41abf19', is: 'no cache', misses: ['viral'] },
  },
  {
    start: ['counted', 'bulk'],
    solution: { id: '56ddb489', is: '302 redirects and a limit per account' },
  },
  {
    start: ['private', 'counted', 'served', 'lat', 'viral'],
    solution: { id: '68761926', is: 'codes checked with a Bloom filter' },
    broken: { id: 'adbdb14c', is: 'hashed codes checked in the database', misses: ['served', 'lat', 'viral'] },
  },
]);

test('Mission 1 solution: database and cache costs', () => {
  L.place(L.design('359ee2bf'), 0);
  // XL database $450; L cache $80.
  assert.equal(L.costOfType('db'), 450);
  assert.equal(L.costOfType('cache'), 80);
});
