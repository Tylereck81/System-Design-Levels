// Level 12 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';

const L = await loadLevel(12);

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
