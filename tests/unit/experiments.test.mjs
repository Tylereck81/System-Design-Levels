// js/engine/experiments.js: the helpers that read the running experiments, fed a fixed list through run.on (no page).
// state.js reads the level when it loads, so a small made-up level is set first and the modules are imported after it.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setLevel } from '../../js/level.js';
import { near } from './near.mjs';

// Hour h carries (h + 1) / 24 of the peak: hour 0 is 1/24, hour 23 is 24/24 = 1.
const DAY = Array.from({ length: 24 }, (_, h) => (h + 1) / 24);
const EXPS = [
  { id: 'spike', kind: 'spike', factor: 10, extra: 500, hud: '10× spike' },
  { id: 'crash', kind: 'crash', factor: 0.5, target: () => null },
  { id: 'news', kind: 'event', extra: 200, slowDns: true },
  { id: 'day', kind: 'day', secs: 48, hud: (h) => `hour ${h}` }, // 24 hours in 48 s: one hour every 2 s
];
setLevel({
  targets: { latencyMs: 200, servedPct: 99 }, components: {}, palette: [], connections: { ok: {}, bad: {} },
  missions: [], quiz: { questions: [], passScore: 0 }, text: {}, experiments: EXPS, workload: { day: DAY },
  saveKey: 'sdl-unit-test', saveVersion: 1, startNodes: [], limits: {},
}, { id: 0, title: 'unit test' });
const { run } = await import('../../js/state.js');
const { trafficFactor, dayHour, dayShift, expTotal, expFlag, spikeHud, textOf } = await import('../../js/engine/experiments.js');

/** Run exactly these experiments; `day` is the day experiment's clock in seconds, when it runs. */
function running(ids, day) {
  for (const k of Object.keys(run.on)) delete run.on[k];
  for (const id of ids) run.on[id] = {};
  if (day != null) run.on.day = { t: day };
}
beforeEach(() => running([]));

test('trafficFactor: 1 with nothing running, else the product of the running factors', () => {
  assert.equal(trafficFactor(), 1);
  assert.equal((running(['spike']), trafficFactor()), 10);
  assert.equal((running(['spike', 'crash']), trafficFactor()), 5); // 10 × 0.5
  assert.equal((running(['news']), trafficFactor()), 1); // an event without a factor changes nothing
});

test('trafficFactor: a running day multiplies by the hour\'s share of the peak', () => {
  running([], 5); // hour floor(5 / 48 × 24) = 2, share (2 + 1) / 24 = 0.125
  near(trafficFactor(), 0.125);
  running(['spike'], 5);
  near(trafficFactor(), 1.25); // 10 × 0.125
});

test('dayHour: null without a day; the clock maps 48 s onto hours 0–23', () => {
  assert.equal(dayHour(), null);
  assert.equal((running(['spike']), dayHour()), null);
  assert.equal((running([], 0), dayHour()), 0);
  assert.equal((running([], 1.99), dayHour()), 0); // floor(1.99 / 2) = 0
  assert.equal((running([], 2), dayHour()), 1);
  assert.equal((running([], 47.9), dayHour()), 23); // floor(23.95)
  assert.equal((running([], 48), dayHour()), 23); // floor(24) = 24, held at the last hour
  assert.equal((running([], 100), dayHour()), 23);
});

test('dayShift: this hour\'s and the last hour\'s share; hour 0 follows hour 23', () => {
  assert.equal(dayShift(), null);
  running([], 5); // hour 2: now 3/24, before 2/24
  assert.deepEqual(dayShift(), { now: 3 / 24, prev: 2 / 24 });
  running([], 0); // hour 0: now 1/24, before hour 23 = 24/24
  assert.deepEqual(dayShift(), { now: 1 / 24, prev: 1 });
});

test('expTotal: the sum of a number over the running experiments, 0 when none sets it', () => {
  assert.equal(expTotal('extra'), 0);
  assert.equal((running(['spike']), expTotal('extra')), 500);
  assert.equal((running(['spike', 'news']), expTotal('extra')), 700); // 500 + 200
  assert.equal(expTotal('nobodySetsThis'), 0);
});

test('expFlag: true only while a running experiment has the flag', () => {
  assert.equal((running(['spike']), expFlag('slowDns')), false);
  assert.equal((running(['spike', 'news']), expFlag('slowDns')), true);
});

test('spikeHud: fixed text, the hour for a day, nothing without a label', () => {
  assert.equal(spikeHud(), undefined);
  assert.equal((running(['news']), spikeHud()), undefined);
  assert.equal((running(['spike']), spikeHud()), '10× spike');
  assert.equal((running([], 5), spikeHud()), 'hour 2');
});

test('textOf: fixed text as is, a function given the model result', () => {
  assert.equal(textOf('Add a cache.', { served: 50 }), 'Add a cache.');
  assert.equal(textOf((m) => `${m.served}% served`, { served: 98 }), '98% served');
});
