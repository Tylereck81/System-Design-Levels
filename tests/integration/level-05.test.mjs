// Level 5 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(5);

propertyTests(L);

missionTests(L, [
  {
    start: ['far'],
    solution: { id: 'baba8bd0', is: 'a CDN that Users fetch files from' },
    broken: { id: '9d2572d9', is: 'a CDN that Users are not connected to', misses: ['far'] },
  },
  {
    start: ['far', 'crash-cdn'],
    solution: { id: '228ec71f', is: 'a CDN that falls back to the origin' },
    broken: { id: 'baba8bd0', is: 'a CDN with no fallback', misses: ['spof', 'crash-cdn'] },
  },
  {
    start: ['far'],
    solution: { id: 'e3bf1950', is: 'a CDN with versioned file names and an origin fallback' },
    broken: { id: '93d23af0', is: 'the same CDN with no fallback', misses: ['spof'] },
  },
]);

test('Mission 1 solution: the CDN bills by data sent', () => {
  L.place(L.design('baba8bd0'), 0);
  // 4,000 req/s × 0.5 files per request ÷ 2 (traffic averages half its peak) × 20 KB × 30 days × 86,400 s ÷ 10⁶
  // = 51,840 GB a month × $0.02 = $1,036.80 → $1,037.
  assert.equal(L.costOfType('cdn'), 1037);
  // Level 4's $2,005 design plus the CDN: $3,042.
  assert.equal(L.model().cost, 3042);
});
