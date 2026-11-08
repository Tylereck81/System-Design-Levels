// Level 6 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';

const L = await loadLevel(6);

missionTests(L, [
  {
    start: ['served'],
    solution: { id: '2502c1e5', is: 'a shared session store' },
    broken: { id: '90c60ea4', is: 'weighted routing and no session store', misses: ['served'] },
  },
  {
    start: ['served', 'update-web'],
    solution: { id: 'b70451d8', is: 'a shared session store' },
    broken: { id: '25fa28a9', is: 'no session store', misses: ['update-web'] },
  },
  {
    start: ['served', 'cost', 'run-day'],
    solution: { id: '6ffd94fa', is: 'two autoscaled M web servers with a session store' },
    broken: { id: 'c17f5756', is: 'two autoscaled L web servers', misses: ['cost'] },
  },
]);

test('Mission 1 solution: cost', () => {
  L.place(L.design('2502c1e5'), 0);
  // Level 5's $3,042 design plus a session store $150 = $3,192.
  assert.equal(L.model().cost, 3192);
});
