// Records the designs the tests build, as input for the simulation snapshot (see README.md).
// Off unless SDL_CAPTURE=1, so normal runs are unaffected.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const CAPTURE_DIR = join('test-results', 'snapshot-capture');
const PREFIX = 'SDL_CAPTURE ';

/**
 * In the page: wrap the test hooks as soon as the game publishes them, and log each distinct design once, with the
 * mission it was measured on. A design counts when a test asks the model about it, or when its mission is verified.
 */
function watchDesigns(prefix) {
  const logged = new Set();
  const record = (sdl) => {
    const { S } = sdl, design = { route: location.hash, mission: S.mission, nodes: S.nodes, edges: S.edges };
    const json = JSON.stringify(design);
    if (logged.has(json)) return;
    logged.add(json);
    console.log(prefix + json);
  };
  let current;
  Object.defineProperty(window, '__sdl', {
    configurable: true,
    get: () => current,
    set: (sdl) => {
      current = sdl;
      const { model, step } = sdl;
      sdl.model = (...args) => { record(sdl); return model(...args); };
      sdl.step = (...args) => { step(...args); if (sdl.S.verified[sdl.S.mission]) record(sdl); };
    },
  });
}

/** Start recording designs for this page when SDL_CAPTURE=1. Call before the first navigation. */
export async function installCapture(page) {
  if (process.env.SDL_CAPTURE !== '1') return;
  mkdirSync(CAPTURE_DIR, { recursive: true });
  const file = join(CAPTURE_DIR, `${process.pid}.ndjson`);
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith(PREFIX)) appendFileSync(file, text.slice(PREFIX.length) + '\n');
  });
  await page.addInitScript(watchDesigns, PREFIX);
}
