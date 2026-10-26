// Page shell: fills in the level's lesson, header and headings.
import { $ } from '../dom.js';
import { level, entry } from '../level.js';
import { TOTAL_LEVELS } from '../../levels/index.js';
import { QUIZ, PASS } from '../state.js';

export function renderShell() {
  $('view-lesson').insertAdjacentHTML('afterbegin', level.lessonHtml);
  $('lvlChip').textContent = `Level ${entry.id} / ${TOTAL_LEVELS}`;
  $('lvlName').textContent = entry.title;
  $('buildTitle').textContent = `Build: Level ${entry.id} missions`;
  $('quizLabel').textContent = `Level ${entry.id} quiz · ${QUIZ.length} questions · ${PASS} to pass`;
}
