// Level 20 in Node: each mission's start design, a solution and a near miss, judged the way the game judges them.
// Designs are the recorded ones in tests/snapshot/designs/, named by id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel, missionTests } from './harness.mjs';
import { propertyTests } from './properties.mjs';

const L = await loadLevel(20);

propertyTests(L);

missionTests(L, [
  {
    start: ['served', 'patchy'],
    solution: { id: '03998d2c', is: 'chunked uploads straight to storage' },
    broken: { id: '62625ca6', is: 'whole-file uploads through the API', misses: ['served', 'patchy'] },
  },
  {
    start: ['served', 'dies'],
    solution: { id: 'faf12147', is: 'eleven transcoding workers that retry' },
  },
  {
    start: ['served', 'cost', 'growth'],
    solution: { id: '48ebe3e8', is: 'only popular videos on the CDN' },
  },
]);

test('Mission 1 solution: upload and transcoding costs', () => {
  L.place(L.design('03998d2c'), 0);
  // Upload service $800; ten transcoding workers 10 × $500 = $5,000.
  assert.equal(L.costOfType('vupload'), 800);
  assert.equal(L.costOfType('transcoder'), 5000);
});
