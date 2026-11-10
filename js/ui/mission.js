// Mission panel: brief, estimate box and goals.
import { fmt } from '../format.js';
import { $, el, keepFocus } from '../dom.js';
import { TARGET_MS, MISSIONS, HOLD, S, run, expPassed, trafficHidden } from '../state.js';
import { model } from '../engine/model.js';
import { stopRun } from '../view/loop.js';
import { paintControls } from './controls.js';
import { log } from './log.js';
import { hooks } from '../hooks.js';
import { anyOn } from '../engine/experiments.js';
import { level } from '../level.js';
import { renderMock, stressOpen } from './mock.js';

export const unlocked = (i) => i === 0 || S.done[i - 1];
export function renderMissionTabs() {
  const box = $('mtabs'); box.textContent = '';
  MISSIONS.forEach((M, i) => {
    const b = el('button', S.done[i] ? 'done' : '', (S.done[i] ? '✓ ' : '') + 'Mission ' + (i + 1)); b.type = 'button'; b.dataset.focusKey = 'mtab-' + i;
    b.disabled = !unlocked(i);
    b.setAttribute('aria-current', S.mission === i ? 'true' : 'false');
    b.title = unlocked(i) ? M.title : 'Finish the previous mission first';
    b.onclick = () => switchMission(i);
    box.appendChild(b);
  });
}

export function switchMission(i) {
  if (!unlocked(i) || i === S.mission) return;
  S.mission = i;
  stopRun(true);
  hooks.afterChange(true);
  log(`Mission ${i + 1}: ${MISSIONS[i].title}. Traffic is now ${trafficHidden(MISSIONS[i]) ? 'unknown until you estimate it' : fmt(MISSIONS[i].qps) + ' req/s'}.`);
}

export function renderMission() { keepFocus($('missionCard'), buildMission, () => $('missionCard')); }
function buildMission() {
  renderMissionTabs();
  const M = MISSIONS[S.mission], i = S.mission;
  const box = $('mission'); box.textContent = '';
  if (level.interview) {
    // A mock interview: no missions or goals, a timer instead; Break-it opens in the last step.
    $('mtabs').textContent = '';
    renderMock(box, renderMission);
    $('expGroup').hidden = !stressOpen();
    paintControls();
    return;
  }
  box.appendChild(el('p', 'label', `Mission ${i + 1} of ${MISSIONS.length} · ${M.ref}`));
  box.appendChild(el('h2', null, M.title));
  box.appendChild(el('p', 'story', M.story));
  const facts = el('div', 'facts');
  const trafficTxt = trafficHidden(M) ? '?' : fmt(M.qps);
  facts.innerHTML = `<div><b>${trafficTxt}</b><span>req/s at peak</span></div><div><b>${M.budget ? '$' + fmt(M.budget) : '—'}</b><span>monthly budget</span></div><div><b>&lt;${TARGET_MS} ms</b><span>response</span></div>`;
  box.appendChild(facts);
  if (M.gate) box.appendChild(renderGate(M));
  const ul = el('ul', 'goals'); ul.id = 'goals'; box.appendChild(ul);
  const vf = el('div'); vf.id = 'verify'; box.appendChild(vf);
  paintGoals();
  if (S.done[i]) {
    const c = el('div', 'complete');
    const last = i === MISSIONS.length - 1;
    c.innerHTML = `<b>Mission complete.</b><p>${M.takeaway}</p>`;
    const nb = el('button', 'btn primary', last ? 'Take the quiz →' : `Mission ${i + 2} →`); nb.type = 'button';
    nb.onclick = () => last ? hooks.setTab('quiz') : switchMission(i + 1);
    c.appendChild(nb); box.appendChild(c);
  } else {
    const d = el('details', 'hint');
    d.appendChild(el('summary', null, 'Stuck? Show a hint'));
    d.appendChild(el('p', null, M.hint));
    box.appendChild(d);
  }
  $('expGroup').hidden = !M.goals.some(x => x.type === 'exp');
  paintControls();
}

export function renderGate(M) {
  const g = el('div', 'gate' + (S.est ? ' passed' : ''));
  if (S.est) {
    g.innerHTML = M.gate.acceptedHtml;
    return g;
  }
  g.innerHTML = `<p>${M.gate.prompt}</p>
    <div class="row"><label for="estIn" class="label">${M.gate.label}</label><input id="estIn" inputmode="numeric" autocomplete="off" placeholder="${M.gate.placeholder}"><button class="btn primary" id="estBtn" type="button">Check</button></div>
    <div class="fb" id="estFb" aria-live="polite"></div>`;
  const inp = g.querySelector('#estIn'), btn = g.querySelector('#estBtn'), fb = g.querySelector('#estFb');
  inp.value = S.estVal || '';
  const check = () => {
    S.estVal = inp.value;
    const m = (inp.value || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (!m || parseFloat(m[0]) < 0) { fb.className = 'fb bad'; fb.textContent = M.gate.notNumber; return; } // a count can't be negative
    const v = parseFloat(m[0]);
    if (v >= M.gate.lo && v <= M.gate.hi) { S.est = true; log(M.gate.acceptedLog, 'ok'); hooks.afterChange(); return; }
    fb.className = 'fb bad';
    const hint = M.gate.hints.find(h => h.test(v));
    fb.textContent = hint ? hint.text : M.gate.fallback;
  };
  btn.onclick = check;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  inp.addEventListener('input', () => { S.estVal = inp.value; fb.textContent = ''; });
  return g;
}

export const ICONS = {
  pass: '<svg class="gi" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.5" fill="var(--ok)"/><path d="M4.6 8.2l2.2 2.2 4.6-4.8" fill="none" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fail: '<svg class="gi" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.5" fill="var(--bad)"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round"/></svg>',
  todo: '<svg class="gi" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="var(--ink-3)" stroke-width="1.4"/></svg>',
};
export const STATUS_TXT = { pass: 'met', fail: 'not met', todo: 'not tested yet' };
export const liveMetrics = () => run.everPlayed && !anyOn();

export function goalStatus(goal, m, g) {
  if (goal.type === 'struct') return goal.test(g) ? 'pass' : (run.everPlayed || goal.id === 'cost' ? 'fail' : 'todo');
  if (goal.type === 'gate') return S.est ? 'pass' : 'todo';
  if (goal.type === 'exp') return expPassed(goal.id) ? 'pass' : 'todo';
  if (liveMetrics()) return goal.test(m) ? 'pass' : 'fail';
  return S.verified[S.mission] ? 'pass' : 'todo';
}

export function paintGoals() {
  const ul = $('goals'); if (!ul) return;
  const M = MISSIONS[S.mission];
  const m = run.mdl || model(); const g = m.g;
  let met = 0;
  ul.innerHTML = M.goals.map(goal => {
    const s = goalStatus(goal, m, g); if (s === 'pass') met++;
    let v = '';
    if (goal.val && (goal.type === 'struct' || liveMetrics())) v = goal.val(m, g);
    return `<li class="${s}">${ICONS[s]}<span>${goal.text}<span class="sr-only"> (${STATUS_TXT[s]})</span></span><span class="gv">${v}</span></li>`;
  }).join('');
  const strip = $('mstrip');
  strip.innerHTML = `<span><b>Mission ${S.mission + 1}:</b> ${M.title}</span><span>${S.done[S.mission] ? 'complete' : met + '/' + M.goals.length + ' goals'} · brief ↓</span>`;
  const vf = $('verify'); if (!vf) return;
  const failingNow = liveMetrics() && M.goals.some(x => x.type === 'metric' && !x.test(m));
  if (S.done[S.mission] && failingNow) { vf.innerHTML = '<p class="verify bad">Your current design no longer meets the targets.</p>'; return; }
  if (S.verified[S.mission]) { vf.innerHTML = `<p class="verify ok">Targets held for ${HOLD} s.${M.goals.some(x => x.type === 'exp') && !S.done[S.mission] ? ' Now break it.' : ''}</p>`; return; }
  if (run.playing && anyOn()) { vf.innerHTML = '<p class="verify">Experiment running: targets are paused.</p>'; return; }
  if (run.playing && run.hold > 0) { vf.innerHTML = `<p class="verify">Holding targets… ${run.hold.toFixed(1)} / ${HOLD} s</p><div class="vbar"><i style="width:${Math.min(100, run.hold / HOLD * 100)}%"></i></div>`; return; }
  vf.innerHTML = run.everPlayed ? '' : `<p class="verify">Press Play to test your design. Targets must hold for ${HOLD} seconds.</p>`;
}
$('mstrip').addEventListener('click', () => { const c = $('missionCard'); c.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); c.focus({ preventScroll: true }); });
