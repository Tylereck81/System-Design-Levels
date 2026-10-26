// Simulation loop: stepping, target checks and the animation frame.
import { MISSIONS, TXT, HOLD, S, run, save } from '../state.js';
import { model, sampleRoute } from './model.js';
import { tagsG, paintLive } from './canvas.js';
import { dots, spawn, showIpTag, moveDots, setDots } from './dots.js';
import { renderHUD, setBanner } from '../ui/hud.js';
import { paintInspectorLive } from '../ui/inspector.js';
import { renderMission, paintGoals } from '../ui/mission.js';
import { paintControls } from '../ui/controls.js';
import { log, observe } from '../ui/log.js';
import { renderTabs } from '../main.js';

export function stopRun(full) {
  run.playing = false; run.crash = false; run.spike = false; run.hold = 0; run.spawnAcc = 0;
  run.expT = { crash: 0, spike: 0 }; run.active = new Set();
  if (full) { run.t = 0; run.dnsDone = false; run.dnsFlying = false; run.everPlayed = false; run.mdl = null; }
  dots.forEach(d => d.c.remove()); setDots([]); tagsG.textContent = '';
}

export function step(dt) {
  run.t += dt;
  const m = model(); run.mdl = m; const g = m.g;

  if (g.hasDNS && g.entry.length && !run.dnsDone && !run.dnsFlying && !run.crash) {
    run.dnsFlying = true;
    const d = spawn([g.users.id, g.dns.id, g.users.id], 'dns', -1);
    d.onDone = () => { run.dnsDone = true; run.dnsFlying = false; showIpTag(g.users); log(TXT.dnsAnswered, ''); };
  }
  if (!g.hasDNS) run.dnsDone = false;

  if (g.users && g.ready && (!m.issue || run.crash) && (run.dnsDone || run.crash || !g.needsDns)) {
    const rate = Math.max(2.5, Math.min(12, m.qps / 14));
    run.spawnAcc += dt * rate;
    while (run.spawnAcc >= 1) {
      run.spawnAcc -= 1;
      if (dots.length > 90) break;
      const { route, failAt } = sampleRoute(m);
      spawn(route, 'req', failAt);
    }
  }

  const M = MISSIONS[S.mission], i = S.mission;
  if (!S.verified[i]) {
    const allOk = !run.crash && !run.spike && M.goals.every(goal => {
      if (goal.type === 'exp') return true;
      if (goal.type === 'gate') return S.est;
      if (goal.type === 'struct') return goal.test(g);
      return goal.test(m);
    });
    run.hold = allOk ? run.hold + dt : 0;
    if (run.hold >= HOLD) { S.verified[i] = true; log(`Targets held for ${HOLD} seconds.`, 'ok'); checkDone(); save(); renderMission(); }
  }
  const built = g.ready;
  for (const k of ['crash', 'spike']) {
    if (run[k] && built && M.goals.some(x => x.id === k) && !S.exp[k]) {
      run.expT[k] += dt;
      if (run.expT[k] >= 1.5) {
        S.exp[k] = true;
        log(k === 'crash' ? TXT.crashObserved : TXT.spikeObserved, 'ok');
        checkDone(); save(); renderMission();
      }
    }
  }
}

export function checkDone() {
  const i = S.mission, M = MISSIONS[i];
  if (S.done[i]) return;
  const expsOk = M.goals.filter(x => x.type === 'exp').every(x => S.exp[x.id]);
  if (S.verified[i] && expsOk && (!M.gate || S.est)) {
    S.done[i] = true;
    log(i === MISSIONS.length - 1 ? TXT.levelComplete : `Mission ${i + 1} complete.`, 'ok');
    renderTabs();
  }
}

export let last = 0;
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
