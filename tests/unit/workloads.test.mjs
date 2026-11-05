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

test('a component kind\'s outcome is a workload\'s field', async () => {
  // A kind with no outcome (a worker, a sharded database…) always takes its own step; one with an outcome takes it
  // while that workload is on.
  const { KINDS } = await import('../../js/engine/kinds/index.js');
  const fields = WORKLOADS.map((w) => w.field);
  for (const k of KINDS.filter((kind) => kind.outcome)) assert.ok(fields.includes(k.outcome), `${k.id} reads no workload's outcome`);
});

test('a level whose palette has a component kind with a step turns that kind\'s workload on', async () => {
  // loadPhase gives such a type the plain server step while its workload is off; no level (nor its mock interview,
  // which keeps the level's palette and workload) may rely on that.
  const [{ kindOf }, { COMPONENTS }] = await Promise.all([import('../../js/engine/kinds/index.js'), import('../../js/engine/catalog.js')]);
  for (const entry of LEVELS) {
    const level = (await entry.load()).default, workload = level.workload || {};
    for (const type of (level.palette || []).filter((t) => COMPONENTS[t])) {
      const kind = kindOf({ type });
      if (!kind?.step || !kind.outcome) continue;
      const w = WORKLOADS.find((x) => x.field === kind.outcome);
      assert.ok(w.active(workload), `Level ${entry.id} has ${type} but not the ${kind.outcome} workload`);
    }
  }
});
