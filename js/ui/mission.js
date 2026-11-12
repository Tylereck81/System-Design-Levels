// Mission panel: brief, estimate box and goals.
import { fmt } from '../format.js';
import { $, el, keepFocus, html, raw, setHtml, setHtmlIfChanged } from '../dom.js';
import { TARGET_MS, MISSIONS, HOLD, S, run, expPassed, trafficHidden, mayOpen, missionOpen } from '../state.js';
import { model } from '../engine/model.js';
import { stopRun } from '../view/loop.js';
import { paintControls } from './controls.js';
import { log } from './log.js';
import { hooks } from '../hooks.js';
import { anyOn } from '../engine/experiments.js';
import { level, inParts } from '../level.js';
import { renderMock, stressOpen } from './mock.js';

/** Why mission i is not open yet, in words. */
const lockedWhy = (i) => (inParts() ? `Read Part ${i + 1} of the lesson, then press Start Mission ${i + 1}.` : 'Finish the previous mission first');
export function renderMissionTabs() {
  const box = $('mtabs'); box.textContent = '';
  MISSIONS.forEach((M, i) => {
    const b = el('button', S.done[i] ? 'done' : '', (S.done[i] ? '✓ ' : '') + 'Mission ' + (i + 1)); b.type = 'button'; b.dataset.focusKey = 'mtab-' + i;
    b.disabled = !missionOpen(i);
    b.setAttribute('aria-current', S.mission === i ? 'true' : 'false');
    b.title = missionOpen(i) ? M.title : lockedWhy(i);
    b.onclick = () => switchMission(i);
    box.appendChild(b);
  });
}

export function switchMission(i) {
  if (!missionOpen(i) || i === S.mission) return;
  S.mission = i;
  stopRun(true);
  hooks.afterChange(true);
  log(`Mission ${i + 1}: ${MISSIONS[i].title}. Traffic is now ${trafficHidden(MISSIONS[i]) ? 'unknown until you estimate it' : fmt(MISSIONS[i].qps) + ' req/s'}.`);
}

/**
 * Opens mission i from its card in the lesson (with a one-page lesson, from then on it stays open) and makes it the
 * Build tab's mission. Does nothing while the mission before it is not done; returns whether it opened.
 */
export function openFromLesson(i) {
  if (!mayOpen(i)) return false;
  if (inParts() && !S.opened[i]) {
    S.opened[i] = true;
    if (i === S.mission) { hooks.afterChange(); return true; } // switchMission does nothing for the mission already shown
  }
  switchMission(i);
  return true;
}

/** The Build tab's notice for a mission not open yet, with a button to its card in the lesson. */
function renderLocked(box, M, i) {
  box.appendChild(el('p', 'label', `Mission ${i + 1} of ${MISSIONS.length}`));
  box.appendChild(el('h2', null, M.title));
  const p = el('p', 'locked', lockedWhy(i)); p.id = 'missionLocked'; box.appendChild(p);
  const b = el('button', 'btn primary', `Go to Part ${i + 1}`); b.type = 'button';
  b.dataset.act = 'lesson-mission'; b.dataset.mission = String(i);
  box.appendChild(b);
  setHtmlIfChanged($('mstrip'), html`<span><b>Mission ${i + 1}:</b> ${M.title}</span><span>not open yet · brief ↓</span>`);
  $('expGroup').hidden = true;
  paintControls();
}

export function renderMission() { keepFocus($('missionCard'), buildMission, () => $('missionCard')); }
function buildMission() {
  renderMissionTabs();
  const M = MISSIONS[S.mission], i = S.mission;
  // The canvas says when the open mission is complete, with a button to its card in the lesson (one-page lessons only).
  $('doneBanner').hidden = !(inParts() && S.done[i]);
  $('doneText').textContent = `Mission ${i + 1} complete`;
  const box = $('mission'); box.textContent = '';
  if (level.interview) {
    // A mock interview: no missions or goals, a timer instead; Break-it opens in the last step.
    $('mtabs').textContent = '';
    renderMock(box, renderMission);
    $('expGroup').hidden = !stressOpen();
    paintControls();
    return;
  }
  if (!missionOpen(i)) { renderLocked(box, M, i); return; }
  box.appendChild(el('p', 'label', `Mission ${i + 1} of ${MISSIONS.length} · ${M.ref}`));
  box.appendChild(el('h2', null, M.title));
  box.appendChild(el('p', 'story', M.story));
  if (inParts()) {
    const again = el('button', 'linkbtn', `Read Part ${i + 1} again`); again.type = 'button';
    again.dataset.act = 'lesson-part'; again.dataset.mission = String(i);
    box.appendChild(again);
  }
  const facts = el('div', 'facts');
  const trafficTxt = trafficHidden(M) ? '?' : fmt(M.qps);
  setHtml(facts, html`<div><b>${trafficTxt}</b><span>req/s at peak</span></div><div><b>${M.budget ? '$' + fmt(M.budget) : '—'}</b><span>monthly budget</span></div><div><b>&lt;${TARGET_MS} ms</b><span>response</span></div>`);
  box.appendChild(facts);
  if (M.gate) box.appendChild(renderGate(M));
  const ul = el('ul', 'goals'); ul.id = 'goals'; box.appendChild(ul);
  const vf = el('div'); vf.id = 'verify'; box.appendChild(vf);
  paintGoals();
  if (S.done[i]) {
    const c = el('div', 'complete');
    const last = i === MISSIONS.length - 1;
    setHtml(c, html`<b>Mission complete.</b><p>${M.takeaway}</p>`);
    // With a one-page lesson the next mission opens from its part of the lesson, so until then this leads back there.
    const toLesson = !last && !missionOpen(i + 1);
    const nb = el('button', 'btn primary', last ? 'Take the quiz →' : toLesson ? 'Back to the lesson →' : `Mission ${i + 2} →`); nb.type = 'button';
    if (toLesson) nb.dataset.act = 'debrief';
    else nb.onclick = () => last ? hooks.setTab('quiz') : switchMission(i + 1);
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
  // A gate's prompt and accepted message are markup the level writes (bold, line breaks); its other fields are text.
  if (S.est) {
    setHtml(g, raw(M.gate.acceptedHtml));
    return g;
  }
  setHtml(g, html`<p>${raw(M.gate.prompt)}</p>
    <div class="row"><label for="estIn" class="label">${M.gate.label}</label><input id="estIn" inputmode="numeric" autocomplete="off" placeholder="${M.gate.placeholder}"><button class="btn primary" id="estBtn" type="button">Check</button></div>
    <div class="fb" id="estFb" aria-live="polite"></div>`);
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
  pass: raw('<svg class="gi" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.5" fill="var(--ok)"/><path d="M4.6 8.2l2.2 2.2 4.6-4.8" fill="none" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
  fail: raw('<svg class="gi" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.5" fill="var(--bad)"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round"/></svg>'),
  todo: raw('<svg class="gi" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="var(--ink-3)" stroke-width="1.4"/></svg>'),
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

/** Repaint the goals, the mission strip and the verify line; each is rewritten only when its content changed. */
export function paintGoals() {
  const ul = $('goals'); if (!ul) return;
  const M = MISSIONS[S.mission];
  const m = run.mdl || model(); const g = m.g;
  const status = M.goals.map(goal => goalStatus(goal, m, g)); // each goal is tested once per paint
  const met = status.filter(s => s === 'pass').length;
  setHtmlIfChanged(ul, M.goals.map((goal, k) => {
    const s = status[k];
    const v = goal.val && (goal.type === 'struct' || liveMetrics()) ? goal.val(m, g) : '';
    return html`<li class="${s}">${ICONS[s]}<span>${goal.text}<span class="sr-only"> (${STATUS_TXT[s]})</span></span><span class="gv">${v}</span></li>`;
  }));
  setHtmlIfChanged($('mstrip'), html`<span><b>Mission ${S.mission + 1}:</b> ${M.title}</span><span>${S.done[S.mission] ? 'complete' : met + '/' + M.goals.length + ' goals'} · brief ↓</span>`);
  const vf = $('verify'); if (!vf) return;
  // While metrics are live, a metric goal's status is its test against the model (goalStatus).
  const failingNow = liveMetrics() && M.goals.some((x, k) => x.type === 'metric' && status[k] === 'fail');
  setHtmlIfChanged(vf, verifyLine(M, failingNow));
}

function verifyLine(M, failingNow) {
  if (S.done[S.mission] && failingNow) return html`<p class="verify bad">Your current design no longer meets the targets.</p>`;
  if (S.verified[S.mission]) return html`<p class="verify ok">Targets held for ${HOLD} s.${M.goals.some(x => x.type === 'exp') && !S.done[S.mission] ? ' Now break it.' : ''}</p>`;
  if (run.playing && anyOn()) return html`<p class="verify">Experiment running: targets are paused.</p>`;
  if (run.playing && run.hold > 0) return html`<p class="verify">Holding targets… ${run.hold.toFixed(1)} / ${HOLD} s</p><div class="vbar"><i style="width:${Math.min(100, run.hold / HOLD * 100)}%"></i></div>`;
  return run.everPlayed ? '' : html`<p class="verify">Press Play to test your design. Targets must hold for ${HOLD} seconds.</p>`;
}
$('mstrip').addEventListener('click', () => { const c = $('missionCard'); c.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); c.focus({ preventScroll: true }); });
