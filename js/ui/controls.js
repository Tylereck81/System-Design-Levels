// Play, experiments and reset buttons.
import { $ } from '../dom.js';
import { MISSIONS, EXPERIMENTS, fresh, S, run, setS, setSel, setConnectFrom, expPassed } from '../state.js';
import { graph, model } from '../engine/model.js';
import { paintLive } from '../view/canvas.js';
import { stopRun } from '../view/loop.js';
import { renderHUD, setBanner } from './hud.js';
import { renderInspector } from './inspector.js';
import { paintGoals } from './mission.js';
import { log } from './log.js';
import { hooks } from '../hooks.js';
import { isOn, activeExps, startExp, stopExp, crashCandidates } from '../engine/experiments.js';

export function paintControls() {
  const M = MISSIONS[S.mission];
  const pb = $('playBtn');
  const blocked = !!(M.gate && !S.est);
  pb.disabled = blocked;
  pb.title = blocked ? 'Estimate peak traffic first' : (run.playing ? 'Pause the simulation' : 'Start the simulation');
  $('playIcon').textContent = run.playing ? '❚❚' : '▶';
  $('playTxt').textContent = blocked ? 'Estimate first' : (run.playing ? 'Pause' : 'Play');
  for (const exp of EXPERIMENTS) {
    const btn = $('exp-' + exp.id);
    btn.disabled = blocked;
    btn.setAttribute('aria-pressed', isOn(exp.id) ? 'true' : 'false');
    btn.textContent = (expPassed(exp.id) ? '✓ ' : '') + (isOn(exp.id) ? exp.labelOn : exp.label);
  }
}
export function togglePlay() {
  const M = MISSIONS[S.mission];
  if (M.gate && !S.est) return;
  run.playing = !run.playing;
  if (run.playing) { run.everPlayed = true; run.errored = false; log(run.t === 0 ? 'Simulation started.' : 'Resumed.'); }
  else log('Paused.');
  paintControls(); setBanner(); renderInspector(); paintGoals(); renderHUD();
}
$('playBtn').onclick = togglePlay;
export const designReady = () => graph().ready;
/** % served at peak traffic with component `id` taken down by crash `exp`: how much its loss hurts. */
function servedWithout(exp, id) {
  const was = run.on[exp.id];
  run.on[exp.id] = { node: id };
  try { return model({ peak: true }).servedPct; }
  finally { if (was) run.on[exp.id] = was; else delete run.on[exp.id]; } // a throw must not leave the crash switched on
}
// One toggle button per experiment, in the Break it group.
for (const exp of EXPERIMENTS) {
  const btn = document.createElement('button');
  btn.className = 'btn toggle'; btn.id = 'exp-' + exp.id; btn.setAttribute('aria-pressed', 'false'); btn.textContent = exp.label;
  $('expGroup').appendChild(btn);
  btn.onclick = () => {
    if (!isOn(exp.id) && (!designReady() || (exp.kind === 'crash' && !crashCandidates(exp, graph()).length))) { log(exp.needsDesign, 'warn'); return; }
    if (isOn(exp.id)) stopExp(exp);
    else {
      // One experiment at a time, so each one's effect is clear and only that one counts.
      for (const other of activeExps()) { stopExp(other); log(other.off, 'ok'); }
      startExp(exp, graph(), servedWithout);
    }
    run.hold = 0;
    if (isOn(exp.id)) { log(typeof exp.on === 'function' ? exp.on(MISSIONS[S.mission].qps * exp.factor) : exp.on, exp.onTone); if (!run.playing) togglePlay(); }
    else log(exp.off, 'ok');
    run.mdl = model(); paintControls(); paintGoals(); renderInspector(); paintLive(); renderHUD();
  };
}
export function armButton(btn, label, armedLabel, action) {
  let armed = false, timer = null;
  btn.onclick = () => {
    if (!armed) { armed = true; btn.textContent = armedLabel; timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000); return; }
    clearTimeout(timer); armed = false; btn.textContent = label; action();
  };
}
armButton($('resetBtn'), 'Clear canvas', 'Click again to clear', () => {
  S.nodes = S.nodes.filter(n => n.type === 'users'); S.edges = []; setSel(null); setConnectFrom(null);
  stopRun(true); hooks.afterDesignChange(); log('Canvas cleared.');
});
armButton($('resetLevel'), 'Reset level progress', 'Click again: this clears your missions and canvas', () => {
  const keepQuiz = S.quiz, keepTab = S.tab;
  setS(fresh()); S.quiz = keepQuiz; S.tab = keepTab; setSel(null); setConnectFrom(null);
  stopRun(true); hooks.afterChange(true); log('Level progress reset. Mission 1 is waiting.');
});
