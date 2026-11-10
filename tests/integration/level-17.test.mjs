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

test('Web servers that pass work to the feed service run at full capacity', () => {
  L.place(L.design('bcb2860b'), 0);
  // 3,150 req/s → 1,575 per L web group; each hour runs ceil(1,575 × day share ÷ 480) servers, 50 server-hours a day
  // → $200 × 50 ÷ 24 = $416.67 → $417 a group.
  // DNS $5 + LB $20 + feed service $700 + feed cache 120 GB × $2 + 2 × $417 = $1,799.
  assert.equal(L.model().cost, 1799);
});

test('New Year\'s Eve: eight workers instead of skipping inactive friends miss only the budget', () => {
  const d = structuredClone(L.design('c6a29f29'));
  Object.assign(d.nodes.find((n) => n.id === 'f'), { inactive: 'all', workers: '8' });
  // $1,799 − 4 workers × $100 + 8 × $100 = $2,199, over the $2,000 budget.
  assert.deepEqual(L.missed(d, 2), ['cost']);
});
