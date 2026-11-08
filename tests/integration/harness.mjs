// Runs the simulation in Node for one level, for the integration tests (one level per test file: js/state.js reads
// the level once, when it is first imported, and node --test runs each file in its own process).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEVELS } from '../../levels/index.js';
import { setLevel } from '../../js/level.js';
import { DESIGNS_DIR, fileOf, designId } from '../snapshot/common.js';

let loaded = null;

/**
 * Sets level `id` as the one being played and imports the game modules that read it. Returns the level data, the
 * state module, model(), and helpers that place a design and judge a mission's goals the way the game does.
 */
export async function loadLevel(id) {
  if (loaded && loaded.id !== id) throw new Error(`level ${loaded.id} is already loaded: use one test file per level`);
  if (loaded) return loaded.api;
  const entry = LEVELS.find((l) => l.id === id);
  const level = (await entry.load()).default;
  setLevel(level, entry);
  const state = await import('../../js/state.js');
  const { model } = await import('../../js/engine/model.js');
  const { startExp, crashCandidates, expectMet } = await import('../../js/engine/experiments.js');
  const { costOf } = await import('../../js/engine/components.js');
  const { S, run } = state;

  // The designs other tests built, recorded for the snapshot; a test names one by its id.
  const file = join(DESIGNS_DIR, fileOf(id));
  const recorded = JSON.parse(readFileSync(file, 'utf8')).designs.map((d) => ({ ...d, id: designId(d) }));
  const start = { id: 'start', nodes: level.startNodes, edges: level.startEdges || [] };

  /** The recorded design with this id, or the level's start design for 'start'. */
  const design = (designIdOrStart) => {
    if (designIdOrStart === 'start') return start;
    const d = recorded.find((x) => x.id === designIdOrStart);
    if (!d) throw new Error(`no recorded design ${designIdOrStart} in ${file}: were the snapshot designs recorded again?`);
    return d;
  };

  /** Puts design `d` on the canvas for mission `mission`, with no experiment running and empty queues. */
  const place = (d, mission) => {
    S.nodes = structuredClone(d.nodes);
    S.edges = structuredClone(d.edges);
    S.mission = mission;
    run.on = {}; run.queues = {}; run.t = 0;
  };

  /** { goal id: met } for the mission's structure and metric goals, as the game checks them with no experiment. */
  const goals = (mission) => {
    const r = model();
    return Object.fromEntries(level.missions[mission].goals.filter((x) => x.type === 'struct' || x.type === 'metric')
      .map((x) => [x.id, !!x.test(x.type === 'struct' ? r.g : r)]));
  };

  /**
   * True when break-it experiment `expId` gives its required outcome on the placed design. The game judges it at the
   * top of the traffic's wobble (model({ peak: true })), only on a design that is ready; a day must hold every hour.
   * A crash is checked on every component it could take down (the game picks the one whose loss hurts most).
   */
  const expOutcome = (expId) => {
    const exp = level.experiments.find((e) => e.id === expId);
    const g = model().g;
    if (!g.ready) return false;
    const cases = exp.kind === 'crash' ? crashCandidates(exp, g).map((n) => (on) => { on.node = n.id; })
      : exp.kind === 'day' ? Array.from({ length: 24 }, (_, h) => (on) => { on.t = exp.secs * (h + 0.5) / 24; })
        : [() => {}];
    if (!cases.length) return false;
    const met = cases.every((adjust) => {
      startExp(exp, g);
      adjust(run.on[exp.id]);
      const ok = expectMet(exp, model({ peak: true }));
      run.on = {};
      return ok;
    });
    return met;
  };

  /** Every structure, metric and break-it goal of the mission, met or not, on the placed design. */
  const allGoals = (mission) => {
    const out = goals(mission);
    for (const x of level.missions[mission].goals) if (x.type === 'exp') out[x.id] = expOutcome(x.id);
    return out;
  };

  /** The goals of the mission that design `d` misses, in the mission's order. */
  const missed = (d, mission) => {
    place(design(d), mission);
    const r = allGoals(mission);
    return Object.keys(r).filter((k) => !r[k]);
  };

  /** Monthly cost of every component of `type` in the placed design (for types that do not autoscale). */
  const costOfType = (type) => S.nodes.filter((n) => n.type === type).reduce((sum, n) => sum + costOf(n), 0);

  const api = { level, state, model, design, place, missed, costOfType };
  loaded = { id, api };
  return api;
}

/**
 * One test per mission and design: the start design misses `start`; the solution meets every goal (apart from
 * `needsPlayer`: break-it goals the player completes by acting during the experiment, tested in the level's file);
 * the broken design, when given, misses exactly `broken.misses`. Estimate gates are not judged here.
 *
 *   { start: [goal ids], solution: { id, is }, broken?: { id, is, misses: [goal ids] }, needsPlayer?: [goal ids] }
 */
export function missionTests({ level, missed }, cases) {
  test('there is a case for every mission', () => assert.equal(cases.length, level.missions.length));
  cases.forEach((c, i) => {
    const name = `Mission ${i + 1}`;
    test(`${name}: the start design misses ${c.start.join(', ')}`, () => assert.deepEqual(missed('start', i), c.start));
    const extra = c.needsPlayer ? ` (${c.needsPlayer.join(', ')} needs the player during the experiment)` : '';
    test(`${name}: ${c.solution.is} meets every goal${extra}`, () => assert.deepEqual(missed(c.solution.id, i), c.needsPlayer || []));
    if (c.broken) test(`${name}: ${c.broken.is} misses ${c.broken.misses.join(', ')}`, () => assert.deepEqual(missed(c.broken.id, i), c.broken.misses));
  });
}
