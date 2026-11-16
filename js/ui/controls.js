// Play, experiments and reset buttons.
import { $ } from '../dom.js';
import { MISSIONS, EXPERIMENTS, TYPES, fresh, S, ui, run, replaceState, expPassed, missionOpen } from '../state.js';
import { graph, model } from '../engine/model.js';
import { paintLive } from '../view/canvas.js';
import { stopRun } from '../view/loop.js';
import { renderHUD, setBanner } from './hud.js';
import { renderInspector } from './inspector.js';
import { paintGoals } from './mission.js';
import { log } from './log.js';
import { hooks } from '../hooks.js';
import { inParts } from '../level.js';
import { resetGuide } from './guide.js';
import { isOn, activeExps, startExp, stopExp, crashCandidates } from '../engine/experiments.js';

/** Why the open mission cannot be played yet ({ title, label } for the Play button), or null when it can. */
function playBlock() {
  if (!missionOpen(S.mission)) return { title: 'Open this mission from the lesson first', label: 'Play' };
  const M = MISSIONS[S.mission];
  return M.gate && !S.est ? { title: 'Estimate peak traffic first', label: 'Estimate first' } : null;
}
export function paintControls() {
  const pb = $('playBtn');
  const block = playBlock(), blocked = !!block;
  pb.disabled = blocked;
  pb.title = block ? block.title : (run.playing ? 'Pause the simulation' : 'Start the simulation');
  $('playIcon').textContent = run.playing ? '❚❚' : '▶';
  $('playTxt').textContent = block ? block.label : (run.playing ? 'Pause' : 'Play');
  for (const exp of EXPERIMENTS) {
    const btn = $('exp-' + exp.id);
    btn.disabled = blocked;
    btn.setAttribute('aria-pressed', isOn(exp.id) ? 'true' : 'false');
    btn.textContent = (expPassed(exp.id) ? '✓ ' : '') + (isOn(exp.id) ? exp.labelOn : exp.label);
  }
}
export function togglePlay() {
  if (playBlock()) return;
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
/**
 * The log line naming what a crash chose from several components (`startExp`'s result), e.g. "Down: the L web
 * server, the biggest loss of the 2." Null when the crash had only one to take down.
 */
function crashChoiceText({ node, of, tie }) {
  if (of < 2) return null;
  const what = `${node.size ? node.size + ' ' : ''}${TYPES[node.type].name.toLowerCase()}`;
  return tie ? `Down: one ${what}. Losing any one of the ${of} hurts the same.` : `Down: the ${what}, the biggest loss of the ${of}.`;
}
// One toggle button per experiment, in the Break it group.
for (const exp of EXPERIMENTS) {
  const btn = document.createElement('button');
  btn.className = 'btn toggle'; btn.id = 'exp-' + exp.id; btn.setAttribute('aria-pressed', 'false'); btn.textContent = exp.label;
  $('expGroup').appendChild(btn);
  btn.onclick = () => {
    if (!isOn(exp.id) && (!designReady() || (exp.kind === 'crash' && !crashCandidates(exp, graph()).length))) { log(exp.needsDesign, 'warn'); return; }
    let chose = null;
    if (isOn(exp.id)) stopExp(exp);
    else {
      // One experiment at a time, so each one's effect is clear and only that one counts.
      for (const other of activeExps()) { stopExp(other); log(other.off, 'ok'); }
      const started = startExp(exp, graph(), servedWithout);
      chose = started && started.node ? crashChoiceText(started) : null;
    }
    run.hold = 0;
    if (isOn(exp.id)) {
      log(typeof exp.on === 'function' ? exp.on(MISSIONS[S.mission].qps * exp.factor) : exp.on, exp.onTone);
      if (chose) log(chose, exp.onTone);
      if (!run.playing) togglePlay();
    }
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
  S.nodes = S.nodes.filter(n => n.type === 'users'); S.edges = []; ui.sel = null; ui.connectFrom = null;
  stopRun(true); hooks.afterDesignChange(); log('Canvas cleared.');
});
armButton($('resetLevel'), 'Reset level progress', 'Click again: this clears your missions and canvas', () => {
  const keepQuiz = S.quiz, keepTab = S.tab;
  resetGuide(); // the guide shows again, as on a first visit
  replaceState(fresh()); S.quiz = keepQuiz; S.tab = keepTab; ui.sel = null; ui.connectFrom = null;
  stopRun(true); hooks.afterChange(true); log(`Level progress reset. ${inParts() ? 'Start Mission 1 from the lesson.' : 'Mission 1 is waiting.'}`);
});
