// Boot, tab routing and the glue that re-renders after a change.
import { $ } from './dom.js';
import { MISSIONS, QUIZ, PASS, fresh, S, ui, run, load, save, byId, replaceState, clearOpenResults } from './state.js';
import { model, sampleRoute } from './engine/model.js';
import { renderCanvas } from './view/canvas.js';
import { renderPalette, addNode, tryConnect } from './view/interaction.js';
import { step, frame } from './view/loop.js';
import { relogNotMet } from './engine/experiments.js';
import { renderHUD, setBanner } from './ui/hud.js';
import { renderInspector } from './ui/inspector.js';
import { switchMission, renderMission } from './ui/mission.js';
import { paintControls, togglePlay } from './ui/controls.js';
import { log } from './ui/log.js';
import { drawFigures, paintParts } from './ui/lesson.js';
import { quizScore, renderQuiz } from './ui/quiz.js';
import { renderShell } from './ui/shell.js';
import { entry, level } from './level.js';
import { parseRoute, routeHash, replaceHash } from './route.js';
import { registerHooks } from './hooks.js';
import { LEVELS, MOCK } from '../levels/index.js';

document.documentElement.lang = 'en';

// A mock interview has no quiz: a self-check list ends it instead.
const TABS = level.interview ? ['lesson', 'build'] : ['lesson', 'build', 'quiz'];
function renderTabs() {
  for (const t of TABS) {
    const b = $('tab-' + t);
    b.setAttribute('aria-selected', S.tab === t ? 'true' : 'false');
    b.tabIndex = S.tab === t ? 0 : -1;
    $('view-' + t).hidden = S.tab !== t;
  }
  const nd = S.done.filter(Boolean).length;
  const bm = $('buildMeta');
  if (level.interview) { bm.textContent = S.mock?.finished ? '✓' : `${(S.mock?.step || 0) + 1}/4`; bm.title = 'Interview step'; bm.classList.toggle('done', !!S.mock?.finished); }
  else { bm.textContent = nd + '/' + MISSIONS.length; bm.classList.toggle('done', nd === MISSIONS.length); }
  const qa = quizScore(), qm = $('quizMeta');
  if (qa.answered < QUIZ.length) { qm.textContent = qa.answered + '/' + QUIZ.length; qm.title = 'Questions answered'; qm.classList.remove('done'); }
  else { const pass = qa.correct >= PASS; qm.textContent = (pass ? '✓ ' : '') + qa.correct + '/' + QUIZ.length; qm.title = `Score: ${qa.correct} correct${pass ? ', passed' : ''}`; qm.classList.toggle('done', pass); }
}
function setTab(t, focusTab) {
  if (!TABS.includes(t)) return;
  S.tab = t;
  if (t !== 'build' && run.playing) { run.playing = false; paintControls(); }
  renderTabs(); save();
  replaceHash(routeHash(entry.id, t));
  if (t === 'build') { renderCanvas(true); renderHUD(); }
  if (focusTab) $('tab-' + t).focus();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('startBuild').onclick = () => setTab('build');
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  const idx = TABS.indexOf(S.tab);
  if (e.key === 'ArrowRight') { e.preventDefault(); setTab(TABS[(idx + 1) % TABS.length], true); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); setTab(TABS[(idx + TABS.length - 1) % TABS.length], true); }
  if (e.key === 'Home') { e.preventDefault(); setTab(TABS[0], true); }
  if (e.key === 'End') { e.preventDefault(); setTab(TABS[TABS.length - 1], true); }
});
window.addEventListener('hashchange', () => {
  const r = parseRoute(location.hash);
  if (r.level === 'home') { location.reload(); return; } // e.g. Back to the home page
  const target = r.level === 'mock' ? MOCK.id : (LEVELS.find(l => l.id === r.level) || LEVELS[0]).id; // an unknown level means Level 1
  if (target !== entry.id) { location.reload(); return; } // another level: start again with its file
  const tab = TABS.includes(r.tab) ? r.tab : S.tab;
  fixAddress(tab);
  if (tab !== S.tab) setTab(tab);
});
/** Show this level's own address for `tab` when the address bar holds another form of it (or a wrong one). */
function fixAddress(tab) {
  if (location.hash && location.hash !== routeHash(entry.id, tab)) replaceHash(routeHash(entry.id, tab));
}

function afterChange(forceFit) {
  if (ui.connectFrom && !byId(ui.connectFrom)) ui.connectFrom = null;
  run.mdl = model();
  renderPalette(); renderCanvas(forceFit); renderInspector(); renderHUD(); renderMission(); renderTabs(); setBanner(); paintParts();
  save();
}
function afterDesignChange({ keepResults = false } = {}) {
  // The design is shared by every mission, so a change invalidates every unfinished mission's check.
  const i = S.mission;
  if (!S.done[i] && S.verified[i]) log('Design changed. Run it again to check the targets.', '');
  S.verified = S.verified.map((v, k) => v && S.done[k]);
  // and its break-it results, unless the change is an operation an experiment asks for (promoting a replica)
  if (!keepResults) clearOpenResults();
  run.hold = 0;
  relogNotMet(); // a running experiment's advice may change with the design
  afterChange(true);
}

function start(data) {
  try { load(data); } catch (err) { console.warn('Saved progress could not be loaded; starting fresh.', err); replaceState(fresh()); }
  const route = parseRoute(location.hash);
  if (TABS.includes(route.tab)) S.tab = route.tab;
  if (!TABS.includes(S.tab)) S.tab = 'lesson';
  fixAddress(S.tab); // e.g. an unknown level shows Level 1's address, and #level-2/XYZ shows #level-2/lesson
  renderShell();
  drawFigures();
  run.mdl = model();
  renderPalette(); renderCanvas(true); renderInspector(); renderHUD(); renderMission(); renderQuiz(); renderTabs();
  if (level.interview) log(`Mock interview: ${level.interview.title}. Start the timer when you're ready.`);
  else log(S.done.every(Boolean) ? 'Welcome back. All missions done: replay any mission, or take the quiz.' : `Mission ${S.mission + 1}: ${MISSIONS[S.mission].title}.`);
  requestAnimationFrame(frame);
}
registerHooks({ afterChange, afterDesignChange, renderTabs, setTab });
start({});
window.__sdl = { S, run, model, sampleRoute, addNode, tryConnect, setTab, switchMission, togglePlay, step, afterChange, afterDesignChange };
