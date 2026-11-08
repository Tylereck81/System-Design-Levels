// Level 11 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';

const L = await loadLevel(11);

missionTests(L, [
  {
    start: ['lose-c'],
    solution: { id: 'cba2a949', is: 'five L cache servers on a hash ring' },
  },
  {
    start: ['add-server'],
    solution: { id: '0c1b8fad', is: 'a hash ring with virtual nodes' },
  },
  {
    start: ['lose-c'],
    solution: { id: 'aa34ffac', is: 'ten M cache servers on a ring with virtual nodes' },
    broken: { id: '0c1b8fad', is: 'five L cache servers', misses: ['lose-c'] },
  },
]);

test('Mission 1 solution: cache cluster and database costs', () => {
  L.place(L.design('cba2a949'), 0);
  // Five L cache servers 5 × $80 = $400; one L database $200.
  assert.equal(L.costOfType('ring'), 400);
  assert.equal(L.costOfType('db'), 200);
});
