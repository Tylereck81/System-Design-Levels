// Where the simulation snapshot keeps its files (see README.md). Paths are found from this file, not from the folder
// a command runs in.
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/** Where a capture run records designs: inside Playwright's output folder, which it empties when a run starts. */
export const CAPTURE_DIR = here('../../test-results/snapshot-capture/');
export const DESIGNS_DIR = here('./designs/');
export const EXPECTED_DIR = here('./expected/');

/** The snapshot file name for level `id`, e.g. level-07.json. */
export const fileOf = (id) => `level-${String(id).padStart(2, '0')}.json`;
