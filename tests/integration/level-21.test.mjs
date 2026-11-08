// Level 21 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';

const L = await loadLevel(21);

missionTests(L, [
  {
    start: ['served', 'lbdown'],
    solution: { id: '9afb172c', is: 'two load balancers and compressed delta sync' },
    broken: { id: 'a61057ec', is: 'one load balancer', misses: ['lbdown'] },
  },
  {
    start: ['served', 'polldown'],
    solution: { id: '6d576854', is: 'seven long-polling servers' },
  },
  {
    start: ['served', 'cost', 'growth'],
    solution: { id: 'cb77c2a2', is: 'cold storage and ten versions per file' },
  },
]);

test('Mission 1 solution: server costs', () => {
  L.place(L.design('9afb172c'), 0);
  // Two block servers 2 × $300 = $600; four polling servers 4 × $400 = $1,600; two load balancers 2 × $20 = $40.
  assert.equal(L.costOfType('blocksrv'), 600);
  assert.equal(L.costOfType('pollsrv'), 1600);
  assert.equal(L.costOfType('lb'), 40);
});
