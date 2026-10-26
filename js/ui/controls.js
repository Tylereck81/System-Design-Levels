// Play, experiments and reset buttons.
import { $ } from '../dom.js';
import { MISSIONS, TXT, fresh, S, run, setS, setSel, setConnectFrom } from '../state.js';
import { graph, model } from '../engine/model.js';
import { paintLive } from '../engine/canvas.js';
import { stopRun } from '../engine/sim.js';
import { renderHUD, setBanner } from './hud.js';
import { renderInspector } from './inspector.js';
import { paintGoals } from './mission.js';
import { log } from './log.js';
import { afterChange, afterDesignChange } from '../main.js';

export function paintControls() {
  const M = MISSIONS[S.mission];
  const pb = $('playBtn');
  const blocked = !!(M.gate && !S.est);
  pb.disabled = blocked;
  pb.title = blocked ? 'Estimate peak traffic first' : (run.playing ? 'Pause the simulation' : 'Start the simulation');
  $('playIcon').textContent = run.playing ? '❚❚' : '▶';
  $('playTxt').textContent = blocked ? 'Estimate first' : (run.playing ? 'Pause' : 'Play');
  const cb = $('crashBtn'), sb = $('spikeBtn');
  cb.disabled = blocked; sb.disabled = blocked;
  cb.setAttribute('aria-pressed', run.crash ? 'true' : 'false');
  sb.setAttribute('aria-pressed', run.spike ? 'true' : 'false');
  cb.textContent = (S.exp.crash ? '✓ ' : '') + (run.crash ? TXT.crashBtnOn : TXT.crashBtn);
  sb.textContent = (S.exp.spike ? '✓ ' : '') + (run.spike ? TXT.spikeBtnOn : TXT.spikeBtn);
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
$('crashBtn').onclick = () => {
  if (!run.crash && !designReady()) { log(TXT.crashNeedsDesign, 'warn'); return; }
  run.crash = !run.crash; run.hold = 0;
  if (run.crash) { log(TXT.crashOn, 'bad'); if (!run.playing) togglePlay(); }
  else log(TXT.crashOff, 'ok');
  run.mdl = model(); paintControls(); paintGoals(); renderInspector(); paintLive();
};
$('spikeBtn').onclick = () => {
  if (!run.spike && !designReady()) { log(TXT.spikeNeedsDesign, 'warn'); return; }
  run.spike = !run.spike; run.hold = 0;
  if (run.spike) { log(TXT.spikeOn(MISSIONS[S.mission].qps * 10), 'warn'); if (!run.playing) togglePlay(); }
  else log(TXT.spikeOff, 'ok');
  run.mdl = model(); paintControls(); paintGoals(); renderInspector(); renderHUD();
};
export function armButton(btn, label, armedLabel, action) {
  let armed = false, timer = null;
  btn.onclick = () => {
    if (!armed) { armed = true; btn.textContent = armedLabel; timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000); return; }
    clearTimeout(timer); armed = false; btn.textContent = label; action();
  };
}
armButton($('resetBtn'), 'Clear canvas', 'Click again to clear', () => {
  S.nodes = S.nodes.filter(n => n.type === 'users'); S.edges = []; setSel(null); setConnectFrom(null);
  stopRun(true); afterDesignChange(); log('Canvas cleared.');
});
armButton($('resetLevel'), 'Reset level progress', 'Click again: this clears your missions and canvas', () => {
  const keepQuiz = S.quiz, keepTab = S.tab;
  setS(fresh()); S.quiz = keepQuiz; S.tab = keepTab; setSel(null); setConnectFrom(null);
  stopRun(true); afterChange(true); log('Level progress reset. Mission 1 is waiting.');
});
