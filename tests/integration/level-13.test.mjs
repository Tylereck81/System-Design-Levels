// Level 13 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(13);

propertyTests(L);

missionTests(L, [
  {
    start: ['numeric', 'bits'],
    solution: { id: '826c873e', is: 'two Snowflake-style ID servers' },
    broken: { id: '9068e6a3', is: 'three servers counting in steps', misses: ['lose'] },
  },
  {
    start: ['numeric', 'bits'],
    solution: { id: '826c873e', is: 'two Snowflake-style ID servers' },
  },
  {
    start: ['numeric', 'bits', 'ordered', 'clock'],
    solution: { id: '04e58847', is: 'Snowflake-style IDs that wait when the clock goes back' },
  },
]);

test('Mission 1 solution: cost of the ID servers', () => {
  L.place(L.design('826c873e'), 0);
  // Two ID servers × $100 = $200.
  assert.equal(L.costOfType('idgen'), 200);
});
