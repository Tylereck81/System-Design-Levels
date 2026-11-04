// Turns the designs recorded by a capture run into tests/snapshot/designs/level-NN.json.
// How and when to use it: see the header of tests/snapshot.spec.js.
// Usage: node tests/snapshot/collect.mjs [--max=16] [--accept-fewer]
//   --max           most designs kept per mission (default 16)
//   --accept-fewer  write even when a mission ends up with fewer designs than it has now (after removing tests)
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { LEVELS } from '../../levels/index.js';
import { parseRoute } from '../../js/route.js';
import { CAPTURE_DIR, DESIGNS_DIR, fileOf, canonical } from './common.js';

const { values: args } = parseArgs({ options: { max: { type: 'string', default: '16' }, 'accept-fewer': { type: 'boolean', default: false } } });
const MAX_PER_MISSION = Number(args.max) || 16;

/** Up to `max` items spread evenly over a sorted list, so the pick does not depend on the order tests ran in. */
const spread = (items, max) => (items.length <= max ? items : Array.from({ length: max }, (_, i) => items[Math.floor(i * items.length / max)]));
/** The level the game opens for an address: an unknown level means Level 1, as in js/boot.js. */
const levelOf = (route) => { const id = parseRoute(route).level; return id === 'mock' ? id : (LEVELS.find((l) => l.id === id) || LEVELS[0]).id; };
const fail = (message) => { console.error(message); process.exit(1); };

if (!existsSync(CAPTURE_DIR)) fail(`Nothing to collect: ${CAPTURE_DIR} does not exist. Run the tests with SDL_CAPTURE=1 first.`);

const byLevel = new Map(); // level id → mission → Set of designs as canonical JSON
for (const file of readdirSync(CAPTURE_DIR).filter((f) => f.endsWith('.ndjson'))) {
  for (const line of readFileSync(join(CAPTURE_DIR, file), 'utf8').split('\n').filter(Boolean)) {
    const { route, mission, nodes, edges } = JSON.parse(line);
    const level = levelOf(route);
    if (level === 'mock') continue; // a mock interview reuses a real level's simulation
    if (!byLevel.has(level)) byLevel.set(level, new Map());
    const missions = byLevel.get(level);
    if (!missions.has(mission)) missions.set(mission, new Set());
    missions.get(mission).add(canonical({ nodes, edges }));
  }
}

// Work out every file first. Write nothing if a mission the level still has would end up with fewer designs than now:
// the capture may have run only some tests, or some failed. --accept-fewer writes anyway (after removing tests).
const output = [], fewer = [];
const countBy = (designs) => designs.reduce((m, d) => m.set(d.mission, (m.get(d.mission) || 0) + 1), new Map());
for (const entry of LEVELS) {
  const data = (await entry.load()).default;
  const start = canonical({ nodes: data.startNodes, edges: data.startEdges || [] }); // the spec measures it itself
  const lines = [], found = [];
  for (const [mission, designs] of [...(byLevel.get(entry.id) || new Map())].sort((a, b) => a[0] - b[0])) {
    if (!data.missions[mission]) continue; // a test set a mission the level does not have
    found.push(`m${mission}: ${designs.size} found`);
    for (const design of spread([...designs].filter((d) => d !== start).sort(), MAX_PER_MISSION)) {
      lines.push(JSON.stringify({ mission, ...JSON.parse(design) }));
    }
  }
  const file = join(DESIGNS_DIR, fileOf(entry.id));
  const before = countBy(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).designs : []);
  const now = countBy(lines.map((l) => JSON.parse(l)));
  for (const [mission, had] of before) {
    const has = now.get(mission) || 0;
    if (data.missions[mission] && has < had) fewer.push(`level ${entry.id} mission ${mission + 1} (${had} → ${has})`);
  }
  output.push({ file, text: `{"level": ${entry.id}, "designs": [\n${lines.join(',\n')}\n]}\n`, report: `${fileOf(entry.id)} ${found.join(', ') || 'none found'} → ${lines.length} kept` });
}
if (fewer.length && !args['accept-fewer']) {
  fail(`This capture has fewer designs for ${fewer.join(', ')}. Capture the whole suite and collect again, or pass --accept-fewer if tests were removed on purpose.`);
}

mkdirSync(DESIGNS_DIR, { recursive: true });
for (const { file, text, report } of output) { writeFileSync(file, text); console.log(report); }
