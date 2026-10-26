// Boot, tab routing and the glue that re-renders after a change.
import { $ } from './dom.js';
import { MISSIONS, QUIZ, PASS, fresh, S, connectFrom, run, load, save, byId, setS, setConnectFrom } from './state.js';
import { model } from './engine/model.js';
import { renderCanvas } from './engine/canvas.js';
import { renderPalette, addNode, tryConnect } from './engine/interaction.js';
import { step, frame } from './engine/sim.js';
import { renderHUD, setBanner } from './ui/hud.js';
import { renderInspector } from './ui/inspector.js';
import { switchMission, renderMission } from './ui/mission.js';
import { paintControls, togglePlay } from './ui/controls.js';
import { log } from './ui/log.js';
import { drawFigures } from './ui/lesson.js';
import { quizScore, renderQuiz } from './ui/quiz.js';

document.documentElement.lang = 'en';

export const TABS = ['lesson', 'build', 'quiz'];
export function renderTabs() {
  for (const t of TABS) {
    const b = $('tab-' + t);
    b.setAttribute('aria-selected', S.tab === t ? 'true' : 'false');
    b.tabIndex = S.tab === t ? 0 : -1;
    $('view-' + t).hidden = S.tab !== t;
  }
  const nd = S.done.filter(Boolean).length;
  const bm = $('buildMeta'); bm.textContent = nd + '/' + MISSIONS.length; bm.classList.toggle('done', nd === MISSIONS.length);
  const qa = quizScore(), qm = $('quizMeta');
  if (qa.answered < QUIZ.length) { qm.textContent = qa.answered + '/' + QUIZ.length; qm.title = 'Questions answered'; qm.classList.remove('done'); }
  else { const pass = qa.correct >= PASS; qm.textContent = (pass ? '✓ ' : '') + qa.correct + '/' + QUIZ.length; qm.title = `Score: ${qa.correct} correct${pass ? ', passed' : ''}`; qm.classList.toggle('done', pass); }
}
export function setTab(t, focusTab) {
  if (!TABS.includes(t)) return;
  S.tab = t;
  if (t !== 'build' && run.playing) { run.playing = false; paintControls(); }
  renderTabs(); save();
  try { history.replaceState(null, '', '#' + t); } catch (e) { /* ignore */ }
  if (t === 'build') { renderCanvas(true); renderHUD(); }
  if (focusTab) $('tab-' + t).focus();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('startBuild').onclick = () => setTab('build');
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  const idx = TABS.indexOf(S.tab);
  if (e.key === 'ArrowRight') { e.preventDefault(); setTab(TABS[(idx + 1) % 3], true); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); setTab(TABS[(idx + 2) % 3], true); }
  if (e.key === 'Home') { e.preventDefault(); setTab('lesson', true); }
  if (e.key === 'End') { e.preventDefault(); setTab('quiz', true); }
});
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== S.tab) setTab(h); });

export function afterChange(forceFit) {
  if (connectFrom && !byId(connectFrom)) setConnectFrom(null);
  run.mdl = model();
  renderPalette(); renderCanvas(forceFit); renderInspector(); renderHUD(); renderMission(); renderTabs(); setBanner();
  save();
}
export function afterDesignChange() {
  const i = S.mission;
  if (!S.done[i] && S.verified[i]) { S.verified[i] = false; log('Design changed. Run it again to check the targets.', ''); }
  run.hold = 0;
  afterChange(true);
}

function start(data) {
  try { load(data); } catch (e) { setS(fresh()); }
  const h = (location.hash || '').slice(1);
  if (TABS.includes(h)) S.tab = h;
  drawFigures();
  run.mdl = model();
  renderPalette(); renderCanvas(true); renderInspector(); renderHUD(); renderMission(); renderQuiz(); renderTabs();
  log(S.done.every(Boolean) ? 'Welcome back. All missions done: replay any mission, or take the quiz.' : `Mission ${S.mission + 1}: ${MISSIONS[S.mission].title}.`);
  requestAnimationFrame(frame);
}
window.claude?.hot?.snapshot?.(() => ({ S }));
window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
window.__sdl = { get S() { return S; }, run, model, addNode, tryConnect, setTab, switchMission, togglePlay, step, afterChange, afterDesignChange };
