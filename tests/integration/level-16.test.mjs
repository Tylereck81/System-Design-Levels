// Level 16 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';

const L = await loadLevel(16);

missionTests(L, [
  {
    start: ['served', 'sms'],
    solution: { id: '1347d819', is: 'a queue per channel and five workers' },
    broken: { id: '0cd2a42c', is: 'one queue for every channel', misses: ['sms'] },
  },
  {
    start: ['optout', 'served', 'blast'],
    solution: { id: 'a6d89b38', is: 'opt-out checks and a send limit' },
  },
  {
    start: ['optout', 'served', 'crash'],
    solution: { id: '8a8af6a0', is: 'workers that log sends and drop duplicates' },
  },
]);

test('Mission 1 solution: cost', () => {
  L.place(L.design('1347d819'), 0);
  // Notification service $150 + queue $50 + five workers 5 × $90 + provider $0 = $650.
  assert.equal(L.model().cost, 650);
});
