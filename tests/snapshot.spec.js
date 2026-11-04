import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { freshPage } from './helpers.js';
import { LEVELS } from '../levels/index.js';
import { DESIGNS_DIR, EXPECTED_DIR, fileOf, designId } from './snapshot/common.js';

/*
 * Simulation snapshot: a refactor guard.
 *
 * The full simulation result for every level, on the designs the other tests build, must stay the same. The expected
 * values are recorded from the engine, not worked out by hand: they prove a refactor changed no number, not that the
 * numbers are right (the hand-computed tests do that).
 *
 *   tests/snapshot/designs/level-NN.json   recorded designs, one per line, with the mission each was measured on
 *   tests/snapshot/expected/level-NN.json  one line per case, m<mission>/<design id>/<experiment or calm>/<moment>: the
 *                                          model's result (without the graph view) and the mission's goals
 *
 * Numbers match within a small tolerance (sums done in another order differ in their last bits); goal results and
 * the values shown are compared exactly. Not covered: the frame loop (goal holding, experiment timers, completion),
 * which crash candidate the game picks (every candidate is measured), mock interviews, the animation and the page.
 *
 * When it fails, in a refactor: the change altered the simulation. Find out why and fix the code; never update the
 * snapshot to make it pass. Two cases need the owner instead: only a goal's shown value or result differs while its
 * number matches (it sits on a rounding or target boundary), or only a value near zero moved by a tiny amount (rounding
 * noise from subtracting large flows).
 *
 * The expected files change only with the owner's approval, in two cases. A formula or constant change: update in
 * the same PR and say which values changed and why. New designs (a new level, or many new tests): record again on a
 * commit whose numbers are known to be right (normally main), never in a PR that changes the engine.
 *
 *   Update the expected files     bash:        SDL_SNAPSHOT_UPDATE=1 npx playwright test snapshot.spec --project=chromium
 *                                 PowerShell:  $env:SDL_SNAPSHOT_UPDATE='1'; npx playwright test snapshot.spec
 *                                              --project=chromium; Remove-Item Env:SDL_SNAPSHOT_UPDATE
 *   Record the designs again      1. SDL_CAPTURE=1 (as above) with the whole suite: npx playwright test --project=chromium
 *                                    (tests/snapshot/capture.js records each distinct design a test measures or
 *                                    verifies; this spec never records)
 *                                 2. node tests/snapshot/collect.mjs (writes designs/, at most 16 per mission; refuses
 *                                    a capture that gives any mission fewer designs, unless --accept-fewer)
 *                                 3. update the expected files as above
 */

const UPDATE = process.env.SDL_SNAPSHOT_UPDATE === '1';
const PROJECT = 'chromium'; // recorded and checked in one engine: other engines may round Math.sin differently
// Sums done in another order differ in their last bits. A number may differ by RELATIVE of its size, plus NOISE times
// the case's traffic for values that come out near zero after subtracting flows. Real changes are far larger.
const RELATIVE = 1e-9;
const NOISE = 1e-12;
const BACKLOG_JOBS = 600; // a fixed backlog in every queue, so the backlog path is covered too
const DAY_HOURS = [3, 12, 18];

/**
 * In the page: every case for one level. For each mission, the start design and the designs recorded for it are
 * measured with no experiment (at two moments of the traffic's wobble, at its peak, and with a backlog when the design
 * has queues). When the design is ready to run, as the game requires, it is also measured with each experiment
 * running (now, and at the peak when it has a required outcome): a crash on each component it could take down, a day
 * at three hours. Each result also records the mission's goals: met or not, and the value shown.
 * Each design carries an id made from its content. Returns { case name: result as JSON }.
 */
async function measureLevel({ designs, backlogJobs, dayHours }) {
  const { S, run, model } = window.__sdl;
  const { level } = await import('/js/level.js'); // the level the game is running
  const { startExp, crashCandidates } = await import('/js/engine/experiments.js');
  const json = (r) => {
    const { g, ...rest } = r; // the graph view holds functions and the whole design
    const goals = level.missions[r.mission].goals.filter((x) => x.type === 'struct' || x.type === 'metric')
      .map((x) => [x.id, !!x.test(x.type === 'struct' ? g : r), x.val ? x.val(r, g) : null]);
    return JSON.stringify({ ...rest, goals }, (_, x) => {
      if (x instanceof Set) return [...x].sort();
      if (typeof x === 'number' && !Number.isFinite(x)) return String(x);
      if (typeof x === 'number') return Number(x.toPrecision(12)); // well inside the tolerance; keeps the files small
      return x;
    });
  };
  /** The ways to run `exp` on graph `g`: [case name, change to the state startExp sets]. */
  const variants = (exp, g) => {
    if (exp.kind === 'crash') return crashCandidates(exp, g).map((n) => [`${exp.id}:${n.id}`, (on) => { on.node = n.id; }]);
    if (exp.kind === 'day') return dayHours.map((h) => [`${exp.id}@${h}h`, (on) => { on.t = exp.secs * (h + 0.5) / 24; }]);
    return [[exp.id, () => {}]];
  };
  const stray = designs.find((d) => !level.missions[d.mission]);
  if (stray) throw new Error(`design ${stray.id} is for mission ${stray.mission + 1}, which this level no longer has: record the designs again`);
  const out = {};
  const start = { id: 'start', nodes: level.startNodes, edges: level.startEdges || [] };
  level.missions.forEach((_, mission) => {
    for (const design of [start, ...designs.filter((d) => d.mission === mission)]) {
      /** Run one case and keep its result; an error says which case it came from. */
      const at = (name, measure) => {
        const key = `m${mission}/${design.id}/${name}`;
        if (key in out) throw new Error(`${key} is measured twice: a designs file lists the same design twice`);
        try { out[key] = json(measure()); } catch (err) { throw new Error(`${key}: ${err.message}`, { cause: err }); }
      };
      S.nodes = structuredClone(design.nodes);
      S.edges = structuredClone(design.edges);
      S.mission = mission;
      run.on = {}; run.queues = {}; run.t = 0;
      let calm;
      at('calm/t0', () => (calm = model()));
      at('calm/t1.3', () => { run.t = 1.3; const r = model(); run.t = 0; return r; });
      at('calm/peak', () => model({ peak: true }));
      const queues = Object.keys(calm.queues);
      if (queues.length) {
        at('backlog/t0', () => {
          run.queues = Object.fromEntries(queues.map((id) => [id, backlogJobs]));
          const r = model();
          run.queues = {};
          return r;
        });
      }
      if (!calm.g.ready) continue; // the game runs no experiment on a design that isn't ready
      for (const exp of level.experiments || []) {
        for (const [name, adjust] of variants(exp, calm.g)) {
          startExp(exp, calm.g);
          adjust(run.on[exp.id]);
          at(`${name}/now`, () => model());
          if (exp.expect) at(`${name}/peak`, () => model({ peak: true })); // the game judges a required outcome at the peak
          run.on = {};
        }
      }
    }
  });
  return out;
}

/** Paths where `actual` differs from `expected`; numbers within `noise` + RELATIVE of their size count as equal. */
function differences(expected, actual, noise, path = '', found = []) {
  const at = (k) => (path ? `${path}.${k}` : k);
  if (typeof expected === 'number' && typeof actual === 'number') {
    const allowed = RELATIVE * Math.max(Math.abs(expected), Math.abs(actual)) + noise;
    if (Math.abs(expected - actual) > allowed) found.push(`${path}: expected ${expected}, got ${actual}`);
  } else if (Array.isArray(expected) !== Array.isArray(actual)) {
    found.push(`${path}: expected ${Array.isArray(expected) ? 'a list' : 'not a list'}, got ${JSON.stringify(actual)}`);
  } else if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) differences(expected[k], actual[k], noise, at(k), found);
  } else if (expected !== actual) {
    found.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  return found;
}

test.describe('Simulation snapshot', () => {
  test.skip(({ browserName }) => browserName !== PROJECT, `recorded in ${PROJECT} only`);

  test('there are snapshot files for exactly the playable levels', () => {
    const wanted = LEVELS.map((l) => fileOf(l.id)).sort();
    const jsonIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : []);
    expect(jsonIn(DESIGNS_DIR)).toEqual(wanted);
    // An update also removes the expected files of levels that no longer exist.
    if (UPDATE) {
      for (const f of jsonIn(EXPECTED_DIR)) if (!wanted.includes(f)) rmSync(join(EXPECTED_DIR, f));
    } else {
      expect(jsonIn(EXPECTED_DIR)).toEqual(wanted);
    }
  });

  for (const { id } of LEVELS) {
    test(`Level ${id} gives the recorded numbers`, async ({ page }) => {
      const designsFile = join(DESIGNS_DIR, fileOf(id)), expectedFile = join(EXPECTED_DIR, fileOf(id));
      expect(existsSync(designsFile), `${designsFile} is missing: see the header of tests/snapshot.spec.js`).toBe(true);
      const designs = JSON.parse(readFileSync(designsFile, 'utf8')).designs.map((d) => ({ ...d, id: designId(d) }));
      await freshPage(page, `#level-${id}/build`);
      const results = await page.evaluate(measureLevel, { designs, backlogJobs: BACKLOG_JOBS, dayHours: DAY_HOURS });
      if (UPDATE) {
        mkdirSync(EXPECTED_DIR, { recursive: true });
        const lines = Object.keys(results).sort().map((k) => `${JSON.stringify(k)}: ${results[k]}`);
        writeFileSync(expectedFile, `{\n${lines.join(',\n')}\n}\n`);
        test.info().annotations.push({ type: 'updated', description: `${expectedFile}: ${lines.length} cases` });
        return;
      }
      expect(existsSync(expectedFile), `${expectedFile} is missing: see the header of tests/snapshot.spec.js`).toBe(true);
      const expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
      const found = [];
      for (const name of new Set([...Object.keys(expected), ...Object.keys(results)])) {
        const want = expected[name], got = results[name] && JSON.parse(results[name]);
        if (!want || !got) { found.push(`${name}: ${want ? 'no longer measured' : 'new case, not in the expected file'}`); continue; }
        // A traffic that is not a finite number gives no slack: NaN would let every number pass.
        const traffic = Number.isFinite(want.qps) ? Math.abs(want.qps) : 0;
        differences(want, got, NOISE * Math.max(1, traffic), name, found);
      }
      expect(found.slice(0, 15), `${found.length} values differ from ${expectedFile}`).toEqual([]);
    });
  }
});
