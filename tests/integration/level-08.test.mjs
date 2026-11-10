// Level 8 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(8);

propertyTests(L);

missionTests(L, [
  {
    start: ['upload', 'keep-up', 'lat'],
    solution: { id: '6e58fe7c', is: 'a queue with eight M workers' },
    broken: { id: 'bbd3f660', is: 'two XL workers', misses: ['cost'] },
  },
  {
    start: ['upload', 'keep-up', 'lat', 'watch', 'crash-workers'],
    solution: { id: 'd23c24c6', is: 'a queue, workers and a monitor on the queue' },
    broken: { id: '023f43b0', is: 'no monitor', misses: ['watch', 'crash-workers'] },
  },
  {
    start: ['upload', 'keep-up', 'lat', 'watch', 'upload-rush'],
    solution: { id: 'f66a8993', is: 'autoscaled L workers and a monitor' },
    broken: { id: '4ebc6dac', is: 'no monitor', misses: ['watch'] },
  },
]);

test('Mission 1 solution: cost', () => {
  L.place(L.design('6e58fe7c'), 0);
  // Eight M workers: 8 × $90 = $720.
  assert.equal(L.costOfType('worker'), 720);
  // DNS $5 + load balancer $20 + two XL web servers 2 × $450 + XL database $450 + queue $50 + workers $720 = $2,145.
  assert.equal(L.model().cost, 2145);
});
