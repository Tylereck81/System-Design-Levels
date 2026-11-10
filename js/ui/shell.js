// Page shell: fills in the level's lesson, header and headings, and runs the level picker.
import { $, el, raw, prependHtml } from '../dom.js';
import { level, entry } from '../level.js';
import { LEVELS, TOTAL_LEVELS, MOCK } from '../../levels/index.js';
import { routeHash } from '../route.js';
import { QUIZ, PASS } from '../state.js';

export function renderShell() {
  prependHtml($('view-lesson'), raw(level.lessonHtml)); // a lesson is authored markup
  if (level.interview) {
    $('lvlChip').textContent = 'Mock interview';
    $('lvlName').textContent = level.interview.title;
    $('buildTitle').textContent = `Mock interview: ${level.interview.title}`;
    $('tab-quiz').hidden = true;
    $('startBuild').firstChild.textContent = 'Start the interview ';
  } else {
    $('lvlChip').textContent = `Level ${entry.id} / ${TOTAL_LEVELS}`;
    $('lvlName').textContent = entry.title;
    $('buildTitle').textContent = `Build: Level ${entry.id} missions`;
    $('quizLabel').textContent = `Level ${entry.id} quiz · ${QUIZ.length} questions · ${PASS} to pass`;
  }
  renderPicker();
}

/* ---------------- Level picker ---------------- */
const btn = $('lvlBtn'), menu = $('lvlMenu');

function renderPicker() {
  const list = $('lvlList'); list.textContent = '';
  for (const l of LEVELS) {
    const a = el('a'); a.href = routeHash(l.id, 'lesson');
    if (l.id === entry.id) a.setAttribute('aria-current', 'page');
    a.append(el('span', 'chip', `Level ${l.id}`), el('span', null, l.title));
    a.addEventListener('click', () => setOpen(false));
    list.appendChild(el('li')).appendChild(a);
  }
  const a = el('a'); a.href = routeHash(MOCK.id, 'lesson');
  if (entry.id === MOCK.id) a.setAttribute('aria-current', 'page');
  a.append(el('span', 'chip', 'Mock'), el('span', null, 'Mock interview: a timed problem'));
  a.addEventListener('click', () => setOpen(false));
  list.appendChild(el('li')).appendChild(a);
}

function setOpen(open, focusButton) {
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) (menu.querySelector('[aria-current]') || menu.querySelector('a')).focus();
  else if (focusButton) btn.focus();
}
btn.addEventListener('click', () => setOpen(menu.hidden));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); setOpen(false, true); } }, true);
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('.lvl-wrap')) setOpen(false); });
