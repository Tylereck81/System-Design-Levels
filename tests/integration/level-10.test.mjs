// Level 10 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(10);

propertyTests(L);

missionTests(L, [
  {
    start: ['lat', 'quota', 'cost'],
    solution: { id: '13e80454', is: 'a token-bucket rate limiter' },
    broken: { id: 'ad23699f', is: 'a leaky-bucket rate limiter', misses: ['lat'] },
  },
  {
    start: ['lat', 'quota', 'cost', 'edge-burst'],
    solution: { id: 'b6352b3b', is: 'a sliding-window-counter rate limiter' },
    broken: { id: '186c4aec', is: 'a fixed-window rate limiter', misses: ['edge-burst'] },
  },
  {
    start: ['served', 'lat', 'quota', 'cost', 'edge-burst'],
    solution: { id: '2ccaf26e', is: 'two rate limiters sharing one counter store' },
    broken: { id: 'e46f19bf', is: 'two rate limiters with no shared counter', misses: ['quota', 'edge-burst'] },
  },
]);

test('Mission 1 solution: limiter and shard costs', () => {
  L.place(L.design('13e80454'), 0);
  // One rate limiter $100; three XL shards 3 × $450 = $1,350.
  assert.equal(L.costOfType('limiter'), 100);
  assert.equal(L.costOfType('shards'), 1350);
});
