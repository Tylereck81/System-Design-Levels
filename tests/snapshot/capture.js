// tests/snapshot/: the simulation snapshot, a refactor guard run with the browser tests (npm run test:e2e); its rules
// are in the header of snapshot.spec.js.
// Records the designs the tests build, as input for the simulation snapshot (see tests/snapshot/snapshot.spec.js).
// Off unless SDL_CAPTURE=1, so normal runs are unaffected.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { test } from '@playwright/test';
import { CAPTURE_DIR } from './common.js';

const PREFIX = 'SDL_CAPTURE ';
const SNAPSHOT_SPEC = 'snapshot.spec.js'; // it measures recorded designs; recording them again would loop

/**
 * In the page: wrap the test hooks as soon as the game publishes them, and log each distinct design once, with the
 * address the game started from (it names the level) and the mission it was measured on. A design counts when a test
 * asks the model about it, or when its mission becomes verified (through a test's fast-forward or real-time play).
 */
function watchDesigns(prefix) {
  const logged = new Set(), verified = new Set();
  let route = null; // the address when the game started; going to another level reloads the page
  const record = (S) => {
    const json = JSON.stringify({ route, mission: S.mission, nodes: S.nodes, edges: S.edges });
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
      route = location.hash;
      const { model, step } = sdl;
      sdl.model = (...args) => { const r = model(...args); record(sdl.S); return r; }; // a design the model rejects is not kept
      sdl.step = (...args) => { step(...args); checkVerified(sdl.S); };
      setInterval(() => checkVerified(sdl.S), 100); // play in real time runs the game's own step, not the hook
    },
  });
}

const installed = new WeakSet();

/** Start recording designs for this page when SDL_CAPTURE=1. Call before the first navigation; more calls do nothing. */
export async function installCapture(page) {
  if (process.env.SDL_CAPTURE !== '1' || basename(test.info().file) === SNAPSHOT_SPEC || installed.has(page)) return;
  installed.add(page);
  mkdirSync(CAPTURE_DIR, { recursive: true });
  const file = join(CAPTURE_DIR, `${process.pid}.ndjson`);
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith(PREFIX)) appendFileSync(file, text.slice(PREFIX.length) + '\n');
  });
  await page.addInitScript(watchDesigns, PREFIX);
}
