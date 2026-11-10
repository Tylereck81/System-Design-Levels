// Mock interview panel: the brief, a timer for the four steps, and a self-check list at the end.
import { $, el, html, setHtml } from '../dom.js';
import { level } from '../level.js';
import { S, save } from '../state.js';
import { STEPS, PROBLEM_KEY } from '../../levels/mock-steps.js';
import { LEVELS, MOCK_LEVELS } from '../../levels/index.js';
import { log } from './log.js';
import { writeStorage } from '../storage.js';
import { hooks } from '../hooks.js';

let since = null; // ms when the current step's clock started; null while paused (a reload pauses the clock)

/** The saved mock state, made valid: the step, seconds spent per step, finished, and the self-check ticks. */
export function mockState() {
  const m = S.mock && typeof S.mock === 'object' ? S.mock : {};
  const n = level.interview.checklist.length;
  S.mock = {
    step: Number.isInteger(m.step) && m.step >= 0 && m.step < STEPS.length ? m.step : 0,
    times: Array.isArray(m.times) && m.times.length === STEPS.length && m.times.every((t) => Number.isFinite(t) && t >= 0) ? m.times : STEPS.map(() => 0),
    finished: m.finished === true,
    checks: Array.from({ length: n }, (_, i) => !!(Array.isArray(m.checks) && m.checks[i] === true)),
  };
  return S.mock;
}

const seconds = (i) => S.mock.times[i] + (i === S.mock.step && since != null ? (Date.now() - since) / 1000 : 0);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const over = (i) => seconds(i) > STEPS[i].max * 60;
const total = () => STEPS.reduce((a, _, i) => a + seconds(i), 0);

/** Stop the clock, adding the running time to the current step. */
function pause() {
  if (since == null) return;
  S.mock.times[S.mock.step] += (Date.now() - since) / 1000;
  since = null;
}

/** Put the panel into `box` (the mission panel). `redraw` redraws it after a button changes the state. */
export function renderMock(box, redraw) {
  const rerender = () => { redraw(); hooks.renderTabs(); };
  const m = mockState();
  box.appendChild(el('p', 'label', 'Mock interview · 45 minutes'));
  box.appendChild(el('h2', null, level.interview.title));
  box.appendChild(el('p', 'story', level.interview.brief));

  const ol = el('ol', 'mock-steps'); ol.id = 'mockSteps';
  STEPS.forEach((s, i) => {
    const li = el('li', i === m.step && !m.finished ? 'now' : i < m.step || m.finished ? 'past' : '');
    if (i === m.step && !m.finished) li.setAttribute('aria-current', 'step');
    li.append(el('b', null, s.name), el('span', 'mock-t', ''), el('span', 'mock-target', `${s.min === s.max ? s.min : `${s.min}–${s.max}`} min`));
    ol.appendChild(li);
  });
  box.appendChild(ol);

  if (!m.finished) {
    box.appendChild(el('p', 'mock-tip', STEPS[m.step].tip));
    const row = el('div', 'mock-row');
    const play = el('button', 'btn primary', since == null ? (seconds(m.step) > 0 ? 'Resume timer' : 'Start timer') : 'Pause timer'); play.type = 'button'; play.id = 'mockPlay';
    play.onclick = () => { if (since == null) since = Date.now(); else pause(); save(); rerender(); };
    const last = m.step === STEPS.length - 1;
    const next = el('button', 'btn', last ? 'Finish' : `Next: ${STEPS[m.step + 1].name}`); next.type = 'button'; next.id = 'mockNext';
    next.onclick = () => {
      const running = since != null;
      pause();
      log(`${STEPS[m.step].name}: ${clock(m.times[m.step])} (aim for ${STEPS[m.step].max} min or less).`, over(m.step) ? 'warn' : 'ok');
      if (last) { m.finished = true; log(`Mock interview finished in ${clock(total())}. Check your answer below.`, 'ok'); }
      else { m.step += 1; if (running) since = Date.now(); }
      save(); rerender();
    };
    row.append(play, next);
    box.appendChild(row);
  } else {
    box.appendChild(el('p', 'mock-tip', `Finished in ${clock(total())}. Tick each point you covered, out loud or on the canvas.`));
    const ul = el('ul', 'mock-checks'); ul.id = 'mockChecks';
    level.interview.checklist.forEach((text, i) => {
      const li = el('li'), id = 'mockCheck' + i;
      const cb = el('input'); cb.type = 'checkbox'; cb.id = id; cb.checked = m.checks[i];
      cb.onchange = () => { m.checks[i] = cb.checked; save(); paintCount(); };
      const lab = el('label', null, text); lab.htmlFor = id;
      li.append(cb, lab); ul.appendChild(li);
    });
    box.appendChild(ul);
    const count = el('p', 'mock-count'); count.id = 'mockCount'; box.appendChild(count);
  }

  const again = el('div', 'mock-row');
  const restart = el('button', 'btn', 'Restart the timer'); restart.type = 'button'; restart.id = 'mockRestart';
  restart.onclick = () => { since = null; Object.assign(m, { step: 0, times: STEPS.map(() => 0), finished: false, checks: m.checks.map(() => false) }); log('Timer restarted. The canvas is kept: clear it to start from scratch.', ''); save(); rerender(); };
  const pick = el('select'); pick.id = 'mockProblem'; pick.setAttribute('aria-label', 'Problem');
  pick.appendChild(Object.assign(el('option', null, 'A random problem'), { value: 'random' }));
  for (const id of MOCK_LEVELS) pick.appendChild(Object.assign(el('option', null, LEVELS.find((l) => l.id === id).title), { value: String(id), selected: id === level.interview.problem }));
  const go = el('button', 'btn', 'New problem'); go.type = 'button'; go.id = 'mockSwitch';
  go.onclick = () => {
    const others = MOCK_LEVELS.filter((id) => id !== level.interview.problem);
    const id = pick.value === 'random' ? others[Math.floor(Math.random() * others.length)] : Number(pick.value);
    writeStorage(PROBLEM_KEY, String(id));
    location.reload();
  };
  again.append(restart, pick, go);
  box.appendChild(again);
  paintMock();
  paintCount();
}

function paintCount() {
  const c = $('mockCount'); if (!c) return;
  c.textContent = `${S.mock.checks.filter(Boolean).length} of ${S.mock.checks.length} covered`;
}

/** Update the step clocks (called every second while the panel is shown). */
export function paintMock() {
  const ol = $('mockSteps'); if (!ol || !S.mock) return;
  [...ol.children].forEach((li, i) => {
    li.querySelector('.mock-t').textContent = clock(seconds(i));
    li.classList.toggle('over', over(i));
  });
  const strip = $('mstrip');
  if (strip) setHtml(strip, html`<span><b>Mock interview:</b> ${level.interview.title}</span><span>${S.mock.finished ? 'finished' : `${STEPS[S.mock.step].name} · ${clock(seconds(S.mock.step))}`} · brief ↓</span>`);
}

/** True while the step that offers the Break-it experiments is open (Stress it, or after the interview). */
export const stressOpen = () => !!S.mock && (S.mock.finished || S.mock.step === STEPS.length - 1);

if (level.interview) setInterval(() => { if (since != null) paintMock(); }, 1000);
