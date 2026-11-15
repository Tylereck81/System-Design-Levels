// Level 6 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(6);

propertyTests(L);

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

test('the lesson\'s worked example and day picture count servers as the autoscaler does', async () => {
  // The lesson rounds up load ÷ (capacity × 60%) itself; the engine's copiesFor is the autoscaler's own count.
  const { copiesFor } = await import('../../js/engine/components.js');
  const { SIZES, T } = await import('../../js/engine/catalog.js');
  assert.equal(copiesFor(1800, SIZES.L.cap), 4); // 1,800 ÷ (800 × 0.6) = 3.75, so 4
  assert.equal(copiesFor(360, SIZES.L.cap), 1); // 360 ÷ 480 = 0.75, so 1
  // Every hour of the day picture: 1,800 req/s × that hour's share of the peak, on L servers.
  const usable = SIZES.L.cap * T.scaleAt;
  L.level.workload.day.forEach((share, h) => assert.equal(Math.ceil((1800 * share) / usable), copiesFor(1800 * share, SIZES.L.cap), `hour ${h}`));
});
