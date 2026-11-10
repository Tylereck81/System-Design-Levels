// The simulation step (js/engine/sim.js) in Node, with no page: it holds targets, times experiments and completes
// missions, and reports what happened only through the callbacks it is given.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel } from './harness.mjs';

const L = await loadLevel(1);
const { advance, resetRun } = await import('../../js/engine/sim.js');
const { startExp } = await import('../../js/engine/experiments.js');
const { S, run, HOLD } = L.state;

const DT = 0.05;
let logs, progress;
const report = { log: (msg) => logs.push(msg), progress: () => { progress += 1; } };
/** Runs advance() for `secs` simulated seconds, in steps of DT. */
const runFor = (secs) => { for (let i = 0; i < Math.round(secs / DT); i++) advance(DT, report); };

beforeEach(() => {
  resetRun(true);
  S.verified = S.verified.map(() => false); S.done = S.done.map(() => false);
  S.exp = S.exp.map((e) => Object.fromEntries(Object.keys(e).map((k) => [k, false])));
  S.est = false;
  logs = []; progress = 0;
});

test('targets met for 4 s in a row verify the mission and complete it, reported through the callbacks', () => {
  L.place(L.design('9db8f413'), 0); // Mission 1 solution: DNS and one S web server
  runFor(HOLD - 0.5);
  assert.equal(S.verified[0], false, 'not yet: the targets have held for 3.5 s');
  assert.equal(progress, 0);
  runFor(0.6);
  assert.equal(S.verified[0], true);
  assert.equal(S.done[0], true, 'Mission 1 has no break-it goal or estimate, so holding the targets completes it');
  assert.deepEqual(logs, [`Targets held for ${HOLD} seconds.`, 'Mission 1 complete.']);
  assert.equal(progress, 1);
});

test('a design that misses a target never starts the hold', () => {
  L.place(L.design('db859200'), 0); // DNS with no web server
  runFor(HOLD + 1);
  assert.equal(run.hold, 0);
  assert.equal(S.verified[0], false);
  assert.deepEqual(logs, []);
  assert.equal(progress, 0);
});

test('a break-it goal counts once its experiment has run for 1.5 s on a built design', () => {
  L.place(L.design('4e6eb488'), 2); // Mission 3 solution: an L web server with an L SQL database
  const spike = L.level.experiments.find((e) => e.id === 'spike');
  startExp(spike, L.model().g);
  runFor(1.4);
  assert.equal(S.exp[2].spike, false, 'not yet: 1.4 s');
  runFor(0.15);
  assert.equal(S.exp[2].spike, true);
  assert.equal(S.done[2], false, 'the targets and the crash goal are still to do');
  assert.equal(logs.length, 1, 'the experiment says what it observed');
  assert.equal(progress, 1);
});
