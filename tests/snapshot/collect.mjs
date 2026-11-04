// Turns the designs recorded by a capture run into tests/snapshot/designs/level-NN.json (see README.md).
// Usage: node tests/snapshot/collect.mjs [max designs per mission, default 16]
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LEVELS } from '../../levels/index.js';
import { CAPTURE_DIR, DESIGNS_DIR, fileOf } from './files.js';

const MAX_PER_MISSION = Number(process.argv[2]) || 16;

/** Up to `max` items spread evenly over a sorted list, so the pick does not depend on the order tests ran in. */
const spread = (items, max) => (items.length <= max ? items : Array.from({ length: max }, (_, i) => items[Math.floor(i * items.length / max)]));
/** A design as the simulation sees it: positions on the canvas don't change any number, so they are left out. */
const designKey = (nodes, edges) => JSON.stringify({ nodes: nodes.map(({ x, y, ...rest }) => rest), edges });

if (!existsSync(CAPTURE_DIR)) {
  console.error(`Nothing to collect: ${CAPTURE_DIR} does not exist. Run the tests with SDL_CAPTURE=1 first (see README.md).`);
  process.exit(1);
}

const byLevel = new Map(); // level id → mission → Map of design key → the first design recorded with it
for (const file of readdirSync(CAPTURE_DIR).filter((f) => f.endsWith('.ndjson')).sort()) {
  for (const line of readFileSync(join(CAPTURE_DIR, file), 'utf8').split('\n').filter(Boolean)) {
    const { level, mission, nodes, edges } = JSON.parse(line);
    if (level === 'mock') continue; // a mock interview reuses a real level's simulation
    if (!byLevel.has(level)) byLevel.set(level, new Map());
    const missions = byLevel.get(level);
    if (!missions.has(mission)) missions.set(mission, new Map());
    const designs = missions.get(mission), key = designKey(nodes, edges);
    if (!designs.has(key)) designs.set(key, { nodes, edges });
  }
}

mkdirSync(DESIGNS_DIR, { recursive: true });
for (const entry of LEVELS) {
  const missions = byLevel.get(entry.id) || new Map();
  const data = (await entry.load()).default;
  const start = designKey(data.startNodes, data.startEdges || []); // the spec measures the start design itself
  const lines = [];
  for (const [mission, designs] of [...missions].sort((a, b) => a[0] - b[0])) {
    const keys = [...designs.keys()].filter((k) => k !== start).sort();
    for (const key of spread(keys, MAX_PER_MISSION)) lines.push(JSON.stringify({ mission, ...designs.get(key) }));
  }
  writeFileSync(join(DESIGNS_DIR, fileOf(entry.id)), `{"level": ${entry.id}, "designs": [\n${lines.join(',\n')}\n]}\n`);
  console.log(fileOf(entry.id), [...missions].map(([m, d]) => `m${m}: ${d.size} found`).join(', ') || 'none found', `→ ${lines.length} kept`);
}
