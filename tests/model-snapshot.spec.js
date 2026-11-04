import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { freshPage } from './helpers.js';

// Refactor guard: the full simulation result for every level, on the designs the other tests build, must stay the
// same. These expected values are recorded from the engine, not worked out by hand: they prove a refactor changed no
// number, not that the numbers are right (the hand-computed tests do that). See tests/snapshot/README.md.

const DIR = join('tests', 'snapshot');
const UPDATE = process.env.SDL_SNAPSHOT_UPDATE === '1';
const TOLERANCE = 1e-9; // relative; sums done in another order may differ in the last bits

/**
 * In the page: every case for one level. For each mission, the start design and the designs recorded for it are
 * measured with no experiment (at two moments of the traffic's wobble, and at its peak) and with each experiment
 * running (now, and at the peak when it has a required outcome). A crash is measured on each component it could take
 * down, and a day at three hours. Each result also records the mission's goals: met or not, and the value shown.
 * Returns { case name: result as JSON }.
 */
async function measureLevel({ levelFile, designs }) {
  const { S, run, model } = window.__sdl;
  const level = (await import(levelFile)).default;
  const { startExp, crashCandidates } = await import('/js/engine/experiments.js'); // the module the game runs
  const DAY_HOURS = [3, 12, 18];
  const json = (r) => {
    const { g, ...rest } = r; // the graph view holds functions and the whole design
    const goals = level.missions[r.mission].goals.filter((x) => x.type === 'struct' || x.type === 'metric')
      .map((x) => { const on = x.type === 'struct' ? g : r; return [x.id, !!x.test(on), x.val ? x.val(r, g) : null]; });
    return JSON.stringify({ ...rest, goals }, (_, x) => {
      if (x instanceof Set) return [...x].sort();
      if (x instanceof Map) return Object.fromEntries([...x].sort(([a], [b]) => String(a).localeCompare(String(b))));
      if (typeof x === 'number' && !Number.isFinite(x)) return String(x);
      if (typeof x === 'number') return Number(x.toPrecision(12)); // well inside TOLERANCE; keeps the files small
      return x;
    });
  };
  const out = {};
  const start = { nodes: level.startNodes, edges: level.startEdges || [] };
  level.missions.forEach((_, mission) => {
    const list = [start, ...designs.filter((d) => d.mission === mission)];
    list.forEach((design, d) => {
      S.nodes = structuredClone(design.nodes);
      S.edges = structuredClone(design.edges);
      S.mission = mission;
      run.on = {}; run.queues = {};
      const at = (name, result) => { out[`m${mission}/d${d}/${name}`] = json(result); };
      for (const t of [0, 1.3]) { run.t = t; at(`calm/t${t}`, model()); }
      run.t = 0;
      at('calm/peak', model({ peak: true }));
      const g = model().g;
      const measure = (name, exp) => {
        at(`${name}/now`, model());
        if (exp.expect) at(`${name}/peak`, model({ peak: true })); // the game judges a required outcome at the peak
      };
      for (const exp of level.experiments || []) {
        if (exp.kind === 'crash') {
          // The game crashes the candidate whose loss hurts most; measuring each covers whichever it picks.
          for (const target of crashCandidates(exp, g)) {
            startExp(exp, g);
            run.on[exp.id].node = target.id;
            measure(`${exp.id}:${target.id}`, exp);
            run.on = {};
          }
        } else if (exp.kind === 'day') {
          for (const hour of DAY_HOURS) {
            startExp(exp, g);
            run.on[exp.id].t = exp.secs * (hour + 0.5) / 24;
            measure(`${exp.id}@${hour}h`, exp);
            run.on = {};
          }
        } else {
          startExp(exp, g);
          measure(exp.id, exp);
          run.on = {};
        }
      }
    });
  });
  return out;
}

/** Paths where `actual` differs from `expected`, numbers compared with the relative tolerance. */
function differences(expected, actual, path = '', found = []) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(expected - actual) > TOLERANCE * Math.max(Math.abs(expected), Math.abs(actual)) + 1e-12) found.push(`${path}: expected ${expected}, got ${actual}`);
  } else if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) differences(expected[k], actual[k], path ? `${path}.${k}` : k, found);
  } else if (expected !== actual) {
    found.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  return found;
}

const designFiles = readdirSync(join(DIR, 'designs')).filter((f) => f.endsWith('.json')).sort();

test.describe('Simulation snapshot', () => {
  for (const file of designFiles) {
    const { level, designs } = JSON.parse(readFileSync(join(DIR, 'designs', file), 'utf8'));
    test(`Level ${level} gives the recorded numbers`, async ({ page }) => {
      await freshPage(page, `#level-${level}/build`);
      const levelFile = `/levels/level-${String(level).padStart(2, '0')}.js`;
      const results = await page.evaluate(measureLevel, { levelFile, designs });
      const expectedFile = join(DIR, 'expected', file);
      if (UPDATE) {
        mkdirSync(join(DIR, 'expected'), { recursive: true });
        const lines = Object.keys(results).sort().map((k) => `${JSON.stringify(k)}: ${results[k]}`);
        writeFileSync(expectedFile, `{\n${lines.join(',\n')}\n}\n`);
        test.info().annotations.push({ type: 'updated', description: `${expectedFile}: ${lines.length} cases` });
        return;
      }
      expect(existsSync(expectedFile), `${expectedFile} is missing: see tests/snapshot/README.md`).toBe(true);
      const expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
      const actual = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, JSON.parse(v)]));
      const found = differences(expected, actual);
      expect(found.slice(0, 15), `${found.length} values differ from ${expectedFile}`).toEqual([]);
    });
  }
});
