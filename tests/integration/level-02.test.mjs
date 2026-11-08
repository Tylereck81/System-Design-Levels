// Level 2 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';

const L = await loadLevel(2);

missionTests(L, [
  {
    start: ['lb', 'pool', 'shared', 'served', 'lat', 'crash-web'],
    solution: { id: 'a116a546', is: 'a load balancer in front of four S web servers' },
    broken: { id: '4c5c6d96', is: 'two M web servers instead', misses: ['crash-web'] },
  },
  {
    start: ['shared', 'served', 'lat', 'crash-web'],
    solution: { id: '8f76cbd4', is: 'five M web servers and an XL database' },
    broken: { id: '02364084', is: 'one L and three M web servers', misses: ['crash-web'] },
  },
  {
    start: ['standby', 'shared', 'served', 'lat', 'crash-lb'],
    solution: { id: 'e5604349', is: 'a standby load balancer' },
    broken: { id: 'aaa1f4ad', is: 'one load balancer', misses: ['standby', 'crash-lb'] },
  },
]);

test('Mission 1 solution: cost', () => {
  L.place(L.design('a116a546'), 0);
  // DNS $5 + load balancer $20 + four S web servers 4 × $40 + L database $200 = $385.
  assert.equal(L.model().cost, 385);
});
