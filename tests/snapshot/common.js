// Shared by the simulation snapshot spec (tests/snapshot/snapshot.spec.js) and its capture and collect scripts.
// Paths are found from this file, not from the folder a command runs in.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/** Where a capture run records designs: inside Playwright's output folder, which it empties when a run starts. */
export const CAPTURE_DIR = here('../../test-results/snapshot-capture/');
export const DESIGNS_DIR = here('./designs/');
export const EXPECTED_DIR = here('./expected/');

/** The snapshot file name for level `id`, e.g. level-07.json. */
export const fileOf = (id) => `level-${String(id).padStart(2, '0')}.json`;

/** JSON with every object's keys sorted, so the same design built in another order gives the same text. */
export const canonical = (value) => JSON.stringify(value, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** A short name for a design that depends only on its content, so adding a design never renames the others. */
export const designId = ({ nodes, edges }) => createHash('sha1').update(canonical({ nodes, edges })).digest('hex').slice(0, 8);
