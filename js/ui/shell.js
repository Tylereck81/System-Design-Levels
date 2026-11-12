// Page shell: fills in the level's lesson, header and headings.
import { $ } from '../dom.js';
import { level, entry } from '../level.js';
import { TOTAL_LEVELS } from '../../levels/index.js';
import { QUIZ, PASS } from '../state.js';
import { renderLesson } from './lesson.js';

export function renderShell() {
  renderLesson();
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
}
