// Level 19 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';

const L = await loadLevel(19);

missionTests(L, [
  {
    start: ['served', 'lat', 'rush'],
    solution: { id: '47b7dc72', is: 'browser caching and top-k lists on four API servers' },
    broken: { id: 'd3967dd0', is: 'six API servers and four trie shards', misses: ['cost'] },
  },
  {
    start: ['served', 'lat', 'peak'],
    solution: { id: '0ba3f5a2', is: 'six API servers and shards split by a map' },
  },
  {
    start: ['fresh', 'served', 'lat', 'trend'],
    solution: { id: '207c329f', is: 'the trie rebuilt every hour' },
  },
]);

test('Mission 1 solution: the browser cache answers 30% of keystrokes', () => {
  L.place(L.design('47b7dc72'), 0);
  // 55,600 keystroke requests/s × (1 − 0.3) = 38,920/s reach the API servers.
  assert.ok(Math.abs(L.model().qps - 38920) < 1e-6);
  // Four API servers × $200 = $800.
  assert.equal(L.costOfType('tapi'), 800);
});
