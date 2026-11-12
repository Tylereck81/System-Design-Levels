// The animation frame: advances the simulation, flies the request dots and the DNS lookup, and repaints the page.
// The simulation itself is js/engine/sim.js; this module is the only caller of its advance().
import { TXT, S, run } from '../state.js';
import { sampleRoute } from '../engine/model.js';
import { advance, resetRun } from '../engine/sim.js';
import { crashing } from '../engine/experiments.js';
import { tagsG, paintLive } from './canvas.js';
import { dots, spawn, showIpTag, moveDots } from './dots.js';
import { renderHUD, setBanner } from '../ui/hud.js';
import { paintInspectorLive } from '../ui/inspector.js';
import { renderMission, paintGoals } from '../ui/mission.js';
import { paintControls } from '../ui/controls.js';
import { paintParts } from '../ui/lesson.js';
import { log, observe } from '../ui/log.js';
import { hooks } from '../hooks.js';

/** @type {import('../engine/sim.js').Report} */
// Progress (a mission checked or done) shows on the Build tab, in the tab labels and on the lesson's mission cards.
const report = { log, progress() { renderMission(); hooks.renderTabs(); paintParts(); } };

/** Stops the run and clears the dots. `full` also rewinds the clock (see resetRun). */
export function stopRun(full) {
  resetRun(full);
  dots.forEach(d => d.c.remove()); dots.length = 0; tagsG.textContent = '';
}

/** One simulation step of `dt` seconds, and the dots it sends. window.__sdl.step is this, so tests see the dots too. */
export function step(dt) {
  const m = advance(dt, report);
  flyDns(m.g);
  sendRequests(m, dt);
}

/** Before the first request, the users look the address up: one dot to DNS and back. */
function flyDns(g) {
  if (g.hasDNS && g.entry.length && !run.dnsDone && !run.dnsFlying && !crashing()) {
    run.dnsFlying = true;
    const d = spawn([g.users.id, g.dns.id, g.users.id], 'dns', -1);
    d.onDone = () => { run.dnsDone = true; run.dnsFlying = false; showIpTag(g.users); log(TXT.dnsAnswered, ''); };
  }
  if (!g.hasDNS) run.dnsDone = false;
}

/** Request dots, at a rate that grows with the traffic, each on a route sampled from the model's result. */
function sendRequests(m, dt) {
  const g = m.g;
  if (!(g.users && g.ready && (!m.issue || crashing()) && (run.dnsDone || crashing() || !g.needsDns))) return;
  const rate = Math.max(2.5, Math.min(12, m.qps / 14));
  run.spawnAcc += dt * rate;
  while (run.spawnAcc >= 1) {
    run.spawnAcc -= 1;
    if (dots.length > 90) break;
    const { route, failAt } = sampleRoute(m);
    spawn(route, 'req', failAt);
  }
}

let last = 0;
/** requestAnimationFrame callback. An error pauses the game and is logged; the loop itself keeps running. */
export function frame(ts) {
  requestAnimationFrame(frame);
  const raw = last ? (ts - last) / 1000 : 0; last = ts;
  if (!(run.playing && S.tab === 'build')) return;
  try {
    let left = Math.min(0.25, raw);
    while (left > 1e-6) { const h = Math.min(0.05, left); step(h); moveDots(h); left -= h; }
    run.uiAcc += raw;
    if (run.uiAcc > 0.2) {
      run.uiAcc = 0;
      observe(run.mdl); renderHUD(); paintLive(); paintGoals(); paintInspectorLive(); setBanner();
    }
  } catch (err) {
    console.error(err);
    run.playing = false;
    if (!run.errored) { run.errored = true; log('The simulation hit an unexpected error and paused. Press Play to continue.', 'bad'); }
    paintControls();
  }
}
