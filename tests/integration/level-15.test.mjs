// Level 15 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';

const L = await loadLevel(15);

missionTests(L, [
  {
    start: ['crawl', 'dns'],
    solution: { id: 'f8eae014', is: 'five downloaders with cached DNS' },
    broken: { id: 'dbd0a2d2', is: 'four downloaders with cached DNS', misses: ['dns'] },
  },
  {
    start: ['polite', 'crawl', 'flood'],
    solution: { id: '7149064a', is: 'five downloaders with cached DNS' },
  },
  {
    start: ['storage', 'polite', 'crawl', 'trap'],
    solution: { id: 'cd48cfc3', is: 'a parser that drops duplicates and filters URLs' },
  },
]);

test('Mission 1 solution: cost', () => {
  L.place(L.design('f8eae014'), 0);
  // Five downloaders 5 × $200 + parser $150 + content store $300 = $1,450.
  assert.equal(L.model().cost, 1450);
});
