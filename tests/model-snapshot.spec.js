import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { freshPage } from './helpers.js';
import { LEVELS } from '../levels/index.js';
import { DESIGNS_DIR, EXPECTED_DIR, fileOf } from './snapshot/files.js';

// Refactor guard: the full simulation result for every level, on the designs the other tests build, must stay the
// same. These expected values are recorded from the engine, not worked out by hand: they prove a refactor changed no
// number, not that the numbers are right (the hand-computed tests do that). See tests/snapshot/README.md.

const UPDATE = process.env.SDL_SNAPSHOT_UPDATE === '1';
const UPDATE_PROJECT = 'chromium'; // one engine writes the expected files, so they never mix browsers
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
 * Returns { case name: result as JSON }.
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
  const out = {};
  const start = { nodes: level.startNodes, edges: level.startEdges || [] };
  level.missions.forEach((_, mission) => {
    [start, ...designs.filter((d) => d.mission === mission)].forEach((design, d) => {
      const at = (name, result) => { out[`m${mission}/d${d}/${name}`] = json(result); };
      S.nodes = structuredClone(design.nodes);
      S.edges = structuredClone(design.edges);
      S.mission = mission;
      run.on = {}; run.queues = {}; run.t = 0;
      const calm = model();
      at('calm/t0', calm);
      run.t = 1.3;
      at('calm/t1.3', model());
      run.t = 0;
      at('calm/peak', model({ peak: true }));
      const queues = Object.keys(calm.queues);
      if (queues.length) {
        run.queues = Object.fromEntries(queues.map((id) => [id, backlogJobs]));
        at('backlog/t0', model());
        run.queues = {};
      }
      if (!calm.g.ready) return; // the game runs no experiment on a design that isn't ready
      for (const exp of level.experiments || []) {
        for (const [name, adjust] of variants(exp, calm.g)) {
          startExp(exp, calm.g);
          adjust(run.on[exp.id]);
          at(`${name}/now`, model());
          if (exp.expect) at(`${name}/peak`, model({ peak: true })); // the game judges a required outcome at the peak
          run.on = {};
        }
      }
    });
  });
  return out;
}

/** Paths where `actual` differs from `expected`; numbers within `noise` + RELATIVE of their size count as equal. */
function differences(expected, actual, noise, path = '', found = []) {
  const at = (k) => (path ? `${path}.${k}` : k);
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(expected - actual) > RELATIVE * Math.max(Math.abs(expected), Math.abs(actual)) + noise) found.push(`${path}: expected ${expected}, got ${actual}`);
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
  test('there are snapshot files for exactly the playable levels', () => {
    const wanted = LEVELS.map((l) => fileOf(l.id)).sort();
    const jsonIn = (dir) => readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    expect(jsonIn(DESIGNS_DIR)).toEqual(wanted);
    if (!UPDATE) expect(jsonIn(EXPECTED_DIR)).toEqual(wanted);
  });

  for (const { id } of LEVELS) {
    test(`Level ${id} gives the recorded numbers`, async ({ page }) => {
      if (UPDATE) expect(test.info().project.name, `update the snapshot with --project=${UPDATE_PROJECT}`).toBe(UPDATE_PROJECT);
      const designsFile = join(DESIGNS_DIR, fileOf(id)), expectedFile = join(EXPECTED_DIR, fileOf(id));
      expect(existsSync(designsFile), `${designsFile} is missing: see tests/snapshot/README.md`).toBe(true);
      const { designs } = JSON.parse(readFileSync(designsFile, 'utf8'));
      await freshPage(page, `#level-${id}/build`);
      const results = await page.evaluate(measureLevel, { designs, backlogJobs: BACKLOG_JOBS, dayHours: DAY_HOURS });
      if (UPDATE) {
        mkdirSync(EXPECTED_DIR, { recursive: true });
        const lines = Object.keys(results).sort().map((k) => `${JSON.stringify(k)}: ${results[k]}`);
        writeFileSync(expectedFile, `{\n${lines.join(',\n')}\n}\n`);
        test.info().annotations.push({ type: 'updated', description: `${expectedFile}: ${lines.length} cases` });
        return;
      }
      expect(existsSync(expectedFile), `${expectedFile} is missing: see tests/snapshot/README.md`).toBe(true);
      const expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
      const found = [];
      for (const name of new Set([...Object.keys(expected), ...Object.keys(results)])) {
        const want = expected[name], got = results[name] && JSON.parse(results[name]);
        if (!want || !got) { found.push(`${name}: ${want ? 'no longer measured' : 'new case, not in the expected file'}`); continue; }
        differences(want, got, NOISE * Math.max(1, Math.abs(want.qps)), name, found);
      }
      expect(found.slice(0, 15), `${found.length} values differ from ${expectedFile}`).toEqual([]);
    });
  }
});
