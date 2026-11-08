// js/level.js validateLevel: each problem it reports, triggered on purpose on a small valid level.
// (Every real level passing it is checked in levels.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLevel } from '../../js/level.js';

const DAY = Array(24).fill(1);
/** A valid level: one experiment of each kind, each a goal of Mission 1; `change` edits a copy. */
function level(change = (d) => d) {
  const d = {
    workload: { day: [...DAY] },
    experiments: [
      { id: 'crash', kind: 'crash', target: () => null },
      { id: 'peers', kind: 'crash', targets: () => [] },
      { id: 'spike', kind: 'spike', factor: 10 },
      { id: 'news', kind: 'event' },
      { id: 'day', kind: 'day', secs: 30 },
    ],
    missions: [{ goals: [{ type: 'exp', id: 'crash' }, { type: 'exp', id: 'day' }, { type: 'served' }] }, { goals: [] }],
  };
  change(d);
  return d;
}
const exp = (d, id) => d.experiments.find(e => e.id === id);

test('a valid level, and one with no experiments, have no problems', () => {
  assert.deepEqual(validateLevel(level()), []);
  assert.deepEqual(validateLevel({ missions: [{ goals: [{ type: 'served' }] }] }), []);
});

test('two experiments with the same id', () => {
  const d = level(d => d.experiments.push({ id: 'spike', kind: 'spike' }));
  assert.deepEqual(validateLevel(d), ['two experiments use the id "spike"']);
});

test('an unknown kind', () => {
  const d = level(d => { exp(d, 'news').kind = 'flood'; });
  assert.deepEqual(validateLevel(d), ['experiment "news" has unknown kind "flood"']);
});

test('a crash with neither a target nor a targets function', () => {
  assert.deepEqual(validateLevel(level(d => { delete exp(d, 'crash').target; })), ['crash experiment "crash" needs a target or targets function']);
  assert.deepEqual(validateLevel(level(d => { exp(d, 'peers').targets = ['a']; })), ['crash experiment "peers" needs a target or targets function']);
});

test('a day without secs, or without a 24-hour workload.day', () => {
  const msg = ['day experiment "day" needs secs and a 24-hour workload.day'];
  assert.deepEqual(validateLevel(level(d => { delete exp(d, 'day').secs; })), msg);
  assert.deepEqual(validateLevel(level(d => { exp(d, 'day').secs = 0; })), msg);
  assert.deepEqual(validateLevel(level(d => { d.workload.day.pop(); })), msg); // 23 hours
  assert.deepEqual(validateLevel(level(d => { delete d.workload; })), msg);
});

test('a break-it goal with no matching experiment names its mission, counted from 1', () => {
  const d = level(d => d.missions[1].goals.push({ type: 'exp', id: 'outage' }));
  assert.deepEqual(validateLevel(d), ['Mission 2 goal "outage" has no matching experiment']);
});

test('several problems are all reported, in order', () => {
  const d = level(d => { exp(d, 'news').kind = 'flood'; d.missions[0].goals.push({ type: 'exp', id: 'outage' }); });
  assert.deepEqual(validateLevel(d), ['experiment "news" has unknown kind "flood"', 'Mission 1 goal "outage" has no matching experiment']);
});
