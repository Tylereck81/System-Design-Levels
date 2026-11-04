// Turns the designs recorded by a capture run into tests/snapshot/designs/level-NN.json.
// How and when to use it: see the header of tests/model-snapshot.spec.js.
// Usage: node tests/snapshot/collect.mjs [max designs per mission, default 16]
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LEVELS } from '../../levels/index.js';
import { parseRoute } from '../../js/route.js';
import { CAPTURE_DIR, DESIGNS_DIR, fileOf } from './files.js';

const MAX_PER_MISSION = Number(process.argv[2]) || 16;

/** Up to `max` items spread evenly over a sorted list, so the pick does not depend on the order tests ran in. */
const spread = (items, max) => (items.length <= max ? items : Array.from({ length: max }, (_, i) => items[Math.floor(i * items.length / max)]));
/** JSON with every object's keys sorted, so the same design built in another order gives the same text. */
const canonical = (value) => JSON.stringify(value, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
/** The level the game opens for an address: an unknown level means Level 1, as in js/boot.js. */
const levelOf = (route) => { const id = parseRoute(route).level; return id === 'mock' ? id : (LEVELS.find((l) => l.id === id) || LEVELS[0]).id; };

if (!existsSync(CAPTURE_DIR)) {
  console.error(`Nothing to collect: ${CAPTURE_DIR} does not exist. Run the tests with SDL_CAPTURE=1 first.`);
  process.exit(1);
}

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

mkdirSync(DESIGNS_DIR, { recursive: true });
for (const entry of LEVELS) {
  const missions = byLevel.get(entry.id) || new Map();
  const data = (await entry.load()).default;
  const start = canonical({ nodes: data.startNodes, edges: data.startEdges || [] }); // the spec measures it itself
  const lines = [];
  for (const [mission, designs] of [...missions].sort((a, b) => a[0] - b[0])) {
    const kept = spread([...designs].filter((d) => d !== start).sort(), MAX_PER_MISSION);
    for (const design of kept) lines.push(JSON.stringify({ mission, ...JSON.parse(design) }));
  }
  writeFileSync(join(DESIGNS_DIR, fileOf(entry.id)), `{"level": ${entry.id}, "designs": [\n${lines.join(',\n')}\n]}\n`);
  console.log(fileOf(entry.id), [...missions].map(([m, d]) => `m${m}: ${d.size} found`).join(', ') || 'none found', `→ ${lines.length} kept`);
}
