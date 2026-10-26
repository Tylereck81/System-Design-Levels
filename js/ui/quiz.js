// Quiz tab.
import { level } from '../level.js';
import { $, el } from '../dom.js';
import { QUIZ, PASS, S, qsel, save } from '../state.js';
import { renderTabs, setTab } from '../main.js';

export function quizScore() {
  let answered = 0, correct = 0;
  QUIZ.forEach((q, i) => { if (S.quiz[i] != null) { answered++; if (S.quiz[i] === q.a) correct++; } });
  return { answered, correct };
}
export function renderQuiz() {
  const list = $('qList'); list.textContent = '';
  QUIZ.forEach((q, i) => {
    const card = el('div', 'q'); card.id = 'q' + i;
    const h = el('h2'); h.appendChild(el('span', null, String(i + 1).padStart(2, '0'))); h.appendChild(document.createTextNode(q.q));
    const opts = el('div', 'opts'); opts.setAttribute('role', 'group'); opts.setAttribute('aria-label', 'Answers to question ' + (i + 1));
    const ans = S.quiz[i];
    q.o.forEach((o, j) => {
      const b = el('button'); b.type = 'button';
      b.appendChild(el('span', 'k', 'ABCD'[j])); b.appendChild(el('span', null, o));
      if (ans != null) {
        b.disabled = true;
        if (j === q.a) b.classList.add('right');
        else if (j === ans) b.classList.add('wrong');
      } else {
        b.setAttribute('aria-pressed', qsel[i] === j ? 'true' : 'false');
        b.onclick = () => { qsel[i] = j; renderQuiz(); const nb = $('q' + i).querySelectorAll('.opts button')[j]; if (nb) nb.focus(); };
      }
      opts.appendChild(b);
    });
    card.append(h, opts);
    if (ans == null) {
      const row = el('div', 'qcheck');
      const cb = el('button', 'btn primary sm', 'Check answer'); cb.type = 'button';
      cb.disabled = qsel[i] == null;
      cb.onclick = () => { S.quiz[i] = qsel[i]; delete qsel[i]; save(); renderQuiz(); renderTabs(); const nc = $('q' + i).querySelector('.expl'); if (nc) nc.focus(); };
      row.appendChild(cb);
      row.appendChild(el('span', null, qsel[i] == null ? 'Choose an answer first.' : 'You can change your choice until you check it.'));
      card.appendChild(row);
    } else {
      const ex = el('div', 'expl'); ex.tabIndex = -1;
      const b = el('b', ans === q.a ? 'r' : 'w', ans === q.a ? 'Correct. ' : 'Not quite. ');
      ex.appendChild(b); ex.appendChild(document.createTextNode(q.e));
      ex.appendChild(el('span', 'ref', q.r));
      card.appendChild(ex);
    }
    list.appendChild(card);
  });
  const sc = quizScore();
  $('qScoreTxt').textContent = `${sc.answered} answered · ${sc.correct} correct`;
  $('qBar').style.width = (sc.answered / QUIZ.length * 100) + '%';
  const res = $('qResult'); res.textContent = '';
  if (sc.answered === QUIZ.length) {
    const pass = sc.correct >= PASS;
    const box = el('div', 'result');
    box.appendChild(el('h2', null, `${sc.correct} / ${QUIZ.length}${pass ? ': passed' : ''}`));
    box.appendChild(el('p', null, pass ? level.quiz.passText : level.quiz.failText(PASS)));
    const row = el('div', 'row');
    const retry = el('button', 'btn', 'Retake the quiz'); retry.type = 'button';
    retry.onclick = () => { S.quiz = {}; for (const k in qsel) delete qsel[k]; save(); renderQuiz(); renderTabs(); window.scrollTo({ top: 0 }); };
    const back = el('button', 'btn', 'Back to the lesson'); back.type = 'button';
    back.onclick = () => setTab('lesson');
    row.append(retry, back); box.appendChild(row); res.appendChild(box);
  }
}
