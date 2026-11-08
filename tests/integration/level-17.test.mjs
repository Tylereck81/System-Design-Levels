// Level 17 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';

const L = await loadLevel(17);

missionTests(L, [
  {
    start: ['served', 'lat', 'rush'],
    solution: { id: 'bcb2860b', is: 'hybrid fanout with four workers, caching post ids' },
    broken: { id: 'd4a28df3', is: 'fanout on write with two workers, caching whole posts', misses: ['cachegb', 'cost'] },
  },
  {
    start: ['served', 'lat', 'star'],
    solution: { id: 'bcb2860b', is: 'hybrid fanout with four workers, caching post ids' },
  },
  {
    start: ['served', 'lat', 'nye'],
    solution: { id: 'c6a29f29', is: 'hybrid fanout that skips inactive users' },
  },
]);

test('Mission 1 solution: the feed service pays for its fanout workers', () => {
  L.place(L.design('bcb2860b'), 0);
  // $300 + four workers 4 × $100 = $700.
  assert.equal(L.costOfType('feedsvc'), 700);
});
