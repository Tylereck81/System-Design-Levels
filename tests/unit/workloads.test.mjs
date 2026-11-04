// The workload registry's rules (js/engine/workloads.js): every level turns on at most one workload, and each
// workload has its own result field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../../levels/index.js';
import { setLevel } from '../../js/level.js';

// workloads.js reaches js/state.js, which reads the level when it loads: give it one first.
setLevel((await LEVELS[0].load()).default, LEVELS[0]);
const { WORKLOADS } = await import('../../js/engine/workloads.js');

test('every level turns on at most one workload', async () => {
  for (const entry of LEVELS) {
    const workload = (await entry.load()).default.workload || {};
    const on = WORKLOADS.filter((w) => w.active(workload)).map((w) => w.field);
    assert.ok(on.length <= 1, `Level ${entry.id} turns on ${on.join(' and ')}: one workload would shape the other's traffic`);
  }
});

test('each workload has its own result field', () => {
  const fields = WORKLOADS.map((w) => w.field);
  assert.equal(new Set(fields).size, fields.length);
});
