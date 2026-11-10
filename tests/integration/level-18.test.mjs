// Level 18 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(18);

propertyTests(L);

missionTests(L, [
  {
    start: ['served', 'delay', 'dies'],
    solution: { id: '9e140f8a', is: 'four WebSocket chat servers, reconnecting through discovery' },
    broken: { id: 'c0c3d285', is: 'three chat servers', misses: ['dies'] },
  },
  {
    start: ['push', 'served', 'delay', 'night'],
    solution: { id: 'dac39db0', is: 'push notifications for offline users' },
  },
  {
    start: ['push', 'served', 'delay', 'tunnel'],
    solution: { id: '0513555a', is: 'presence from heartbeats' },
  },
]);

test('Mission 1 solution: cost', () => {
  L.place(L.design('9e140f8a'), 0);
  // Four chat servers 4 × $300 + message store $500 = $1,700.
  assert.equal(L.model().cost, 1700);
});
