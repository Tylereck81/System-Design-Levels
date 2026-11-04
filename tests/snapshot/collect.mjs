// Turns the designs recorded by a capture run into tests/snapshot/designs/level-NN.json (see README.md).
// Usage: node tests/snapshot/collect.mjs [max designs per mission, default 16]
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseRoute } from '../../js/route.js';
import { CAPTURE_DIR } from './capture.js';

const MAX_PER_MISSION = Number(process.argv[2]) || 16;
const OUT_DIR = join('tests', 'snapshot', 'designs');

/** Up to `max` items spread evenly over a sorted list, so the pick does not depend on the order tests ran in. */
const spread = (items, max) => (items.length <= max ? items : Array.from({ length: max }, (_, i) => items[Math.floor(i * items.length / max)]));

if (!existsSync(CAPTURE_DIR)) {
  console.error(`Nothing to collect: ${CAPTURE_DIR} does not exist. Run the tests with SDL_CAPTURE=1 first (see README.md).`);
  process.exit(1);
}

const byLevel = new Map(); // level id → mission → Set of design JSON
for (const file of readdirSync(CAPTURE_DIR).filter((f) => f.endsWith('.ndjson'))) {
  for (const line of readFileSync(join(CAPTURE_DIR, file), 'utf8').split('\n').filter(Boolean)) {
    const { route, mission, nodes, edges } = JSON.parse(line);
    const level = parseRoute(route).level;
    if (level === 'mock') continue; // a mock interview reuses a real level's simulation
    if (!byLevel.has(level)) byLevel.set(level, new Map());
    const missions = byLevel.get(level);
    if (!missions.has(mission)) missions.set(mission, new Set());
    missions.get(mission).add(JSON.stringify({ nodes, edges }));
  }
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [level, missions] of [...byLevel].sort((a, b) => a[0] - b[0])) {
  const designs = [];
  for (const [mission, set] of [...missions].sort((a, b) => a[0] - b[0])) {
    for (const json of spread([...set].sort(), MAX_PER_MISSION)) designs.push({ mission, ...JSON.parse(json) });
  }
  const name = `level-${String(level).padStart(2, '0')}.json`;
  writeFileSync(join(OUT_DIR, name), JSON.stringify({ level, designs }, null, 1) + '\n');
  console.log(name, [...missions].map(([m, s]) => `m${m}: ${s.size} found`).join(', '), `→ ${designs.length} kept`);
}
