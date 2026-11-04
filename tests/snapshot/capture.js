// Records the designs the tests build, as input for the simulation snapshot (see README.md).
// Off unless SDL_CAPTURE=1, so normal runs are unaffected.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { test } from '@playwright/test';
import { CAPTURE_DIR } from './files.js';

const PREFIX = 'SDL_CAPTURE ';
const SNAPSHOT_SPEC = 'model-snapshot.spec.js'; // it measures recorded designs; recording them again would loop

/**
 * In the page: wrap the test hooks as soon as the game publishes them, and log each distinct design once, with the
 * level the page started with and the mission it was measured on. A design counts when a test asks the model about it,
 * or when its mission becomes verified (through a test's fast-forward or through real-time play).
 */
function watchDesigns(prefix) {
  const logged = new Set(), verified = new Set();
  let level = null; // the level this page booted with; a later hash change reloads the page
  const record = (S) => {
    if (level == null) return;
    const json = JSON.stringify({ level, mission: S.mission, nodes: S.nodes, edges: S.edges });
    if (logged.has(json)) return;
    logged.add(json);
    console.log(prefix + json);
  };
  const checkVerified = (S) => {
    const now = !!S.verified[S.mission];
    if (now && !verified.has(S.mission)) record(S);
    if (now) verified.add(S.mission); else verified.delete(S.mission);
  };
  let current;
  Object.defineProperty(window, '__sdl', {
    configurable: true,
    get: () => current,
    set: (sdl) => {
      current = sdl;
      import('/js/level.js').then((m) => { level = m.entry.id; }); // already loaded: the game has started
      const { model, step } = sdl;
      sdl.model = (...args) => { record(sdl.S); return model(...args); };
      sdl.step = (...args) => { step(...args); checkVerified(sdl.S); };
      setInterval(() => checkVerified(sdl.S), 100); // play in real time runs the game's own step, not the hook
    },
  });
}

/** Start recording designs for this page when SDL_CAPTURE=1. Call before the first navigation. */
export async function installCapture(page) {
  if (process.env.SDL_CAPTURE !== '1' || basename(test.info().file) === SNAPSHOT_SPEC) return;
  mkdirSync(CAPTURE_DIR, { recursive: true });
  const file = join(CAPTURE_DIR, `${process.pid}.ndjson`);
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith(PREFIX)) appendFileSync(file, text.slice(PREFIX.length) + '\n');
  });
  await page.addInitScript(watchDesigns, PREFIX);
}
