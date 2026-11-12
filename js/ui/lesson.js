// Lesson tab: a lesson written as steps or on one page (`level.lesson`, see Lesson in types.js) or authored HTML
// (`level.lessonHtml`), and the helpers a level's diagrams are drawn with.
import { level, inParts, lessonMinutes } from '../level.js';
import { $, svgEl, html, raw, prependHtml, setHtml } from '../dom.js';
import { hooks } from '../hooks.js';
import { drawIcon } from '../view/icons.js';
import { MISSIONS, S, mayOpen } from '../state.js';
import { openFromLesson } from './mission.js';

/* ---------------- Step lesson ---------------- */
// All steps are in the page from the start; the ones not shown are `hidden`, so their figures can still be drawn.
// Nothing here is scored or saved.

/** One body block (`LessonBlock`). Lesson text is authored markup; code is shown as written. */
function blockHtml(b) {
  if ('p' in b) return html`<p>${raw(b.p)}</p>`;
  if ('ul' in b) return html`<ul>${b.ul.map((t) => html`<li>${raw(t)}</li>`)}</ul>`;
  if ('ol' in b) return html`<ol>${b.ol.map((t) => html`<li>${raw(t)}</li>`)}</ol>`;
  if ('assume' in b) return html`<p class="assume">${raw(b.assume)}</p>`;
  if ('code' in b) return html`<pre class="code" tabindex="0">${b.code}</pre>${caption(b.caption)}`;
  if ('figure' in b) {
    return html`<figure class="fig"><svg id="${b.figure}" role="img" aria-label="${b.alt}"></svg><figcaption>${raw(b.caption)}</figcaption></figure>`;
  }
  if ('calc' in b) return calcHtml(b.calc);
  const { head, rows, num } = b.table; // the only type left (validate-lesson.js checks the shapes)
  const cell = (c, i) => html`<td${num && i > 0 ? raw(' class="n"') : ''}>${raw(c)}</td>`;
  return html`<div class="tbl-wrap"><table class="t">
    <thead><tr>${head.map((h) => (h ? html`<th>${raw(h)}</th>` : raw('<td></td>')))}</tr></thead>
    <tbody>${rows.map((r) => html`<tr>${r.map(cell)}</tr>`)}</tbody></table></div>${caption(b.caption)}`;
}
/** A worked calculation (`Calc`): the formula, one operation per row (label, working, result), then the answer. */
function calcHtml({ formula, rows, result }) {
  const row = (r) => html`<li><span class="calc-label">${raw(r.label)}</span> <span class="calc-work">${raw(r.work)}</span> <span class="calc-result">${r.approx ? '≈' : '='} ${raw(r.result)}</span></li>`;
  return html`<div class="calc-box">
    <p class="label">Worked example</p>
    <p class="calc-formula">${raw(formula)}</p>
    <ul class="calc-rows">${rows.map(row)}</ul>
    <p class="calc-answer">${raw(result)}</p>
  </div>`;
}
const caption = (text) => (text ? html`<p class="assume">${raw(text)}</p>` : '');

/** A question, its options and the place its feedback goes; `key` keys its ids. */
const questionHtml = (check, key) => html`<p class="check-q" id="q-${key}">${raw(check.q)}</p>
    <div class="check-opts" role="group" aria-labelledby="q-${key}">${check.options.map((o, i) => html`
      <button type="button" class="btn opt" data-act="answer" data-opt="${i}" aria-pressed="false">${raw(o.t)}</button>`)}</div>
    <div class="check-fb" aria-live="polite"></div>`;

/** A step's question (`s` keys its ids): "Guess first" comes before the explanation, "Your turn" after it. */
function checkHtml(check, s) {
  const guess = check.kind === 'guess';
  return html`<div class="check">
    <p class="label">${guess ? 'Guess first' : 'Your turn'}</p>
    ${questionHtml(check, s)}
    ${guess ? html`<button type="button" class="btn sm" data-act="reveal">Skip the question and show me</button>` : ''}
  </div>`;
}

/**
 * Marks the pressed option and explains it in its question's feedback; a wrong answer also shows the right one.
 * `options` are the question's options (`CheckOption`).
 */
function showAnswer(btn, options) {
  const chosen = options[Number(btn.dataset.opt)], right = options.find((o) => o.right);
  btn.parentElement.querySelectorAll('.opt').forEach((o) => o.setAttribute('aria-pressed', String(o === btn)));
  setHtml(btn.closest('.check').querySelector('.check-fb'), chosen === right
    ? html`<p><b>Right.</b> ${raw(chosen.why)}</p>`
    : html`<p><b>Not quite.</b> ${raw(chosen.why)}</p><p>The right answer: <b>${raw(right.t)}</b>. ${raw(right.why)}</p>`);
}

/**
 * A step: the label, the title (heading `st-<s>`), the hook, the question and the body a "Guess first" question hides
 * until it is answered, ending with the takeaway.
 */
function stepParts(step, s, label) {
  const guess = step.check?.kind === 'guess';
  return html`<p class="label">${label}</p>
    <h2 id="st-${s}" tabindex="-1">${raw(step.title)}</h2>
    <p class="hook">${raw(step.hook)}</p>
    ${guess ? checkHtml(step.check, s) : ''}
    <div class="lstep-body" tabindex="-1"${guess ? raw(' hidden') : ''}>
      ${step.body.map(blockHtml)}
      ${step.check && !guess ? checkHtml(step.check, s) : ''}
      <p class="takeaway"><b>Remember</b> ${raw(step.takeaway)}</p>
    </div>`;
}
/** Numbers worth remembering, as [value, what it is] pairs. */
const numbersHtml = (numbers) => html`<dl class="recap-nums">${numbers.map(([value, meaning]) => html`<div><dt>${raw(value)}</dt><dd>${raw(meaning)}</dd></div>`)}</dl>`;
/** The step lesson's "Game rules" button and the rules it shows. */
const rulesHtml = (rules) => html`<button type="button" class="btn sm" data-act="rules" aria-expanded="false" aria-controls="lessonRules">Game rules</button>
    <p class="assume" id="lessonRules" hidden>${raw(rules)}</p>`;

function stepHtml(step, s, count) {
  return html`<section class="lstep" data-step="${s}" aria-labelledby="st-${s}"${s ? raw(' hidden') : ''}>
    ${stepParts(step, s, `Step ${s + 1} of ${count}`)}
    <div class="lstep-nav">
      ${s ? html`<button type="button" class="btn" data-go="${s - 1}">Back</button>` : ''}
      <button type="button" class="btn primary" data-go="${s + 1}">Next</button>
    </div>
  </section>`;
}

function recapHtml(lesson, s) {
  const { numbers, bridge } = lesson.recap;
  return html`<section class="lstep recap" data-step="${s}" aria-labelledby="st-${s}" hidden>
    <p class="label">Recap</p>
    <h2 id="st-${s}" tabindex="-1">What you now know</h2>
    <ul>${lesson.steps.map((step) => html`<li>${raw(step.takeaway)}</li>`)}</ul>
    <h3>Numbers to carry</h3>
    ${numbersHtml(numbers)}
    <h3>Your missions</h3>
    <ol class="bridge">${bridge.map((line, i) => html`<li><b>Mission ${i + 1} · ${level.missions[i].title}</b> ${raw(line)}</li>`)}</ol>
    ${rulesHtml(lesson.rules)}
    <div class="lstep-nav">
      <button type="button" class="btn" data-go="${s - 1}">Back</button>
      <button type="button" class="btn primary" data-act="build">Start mission 1 <span aria-hidden="true">→</span></button>
    </div>
  </section>`;
}

function lessonHtml(lesson) {
  const count = lesson.steps.length, missions = level.missions.length;
  const dot = (i) => (i < count
    ? html`<li><button type="button" class="dot" data-go="${i}" aria-label="Step ${i + 1}: ${lesson.steps[i].title}">${i + 1}</button></li>`
    : html`<li><button type="button" class="dot" data-go="${i}">Recap</button></li>`);
  return html`<div class="step-lesson" id="stepLesson">
    <p class="label">${raw(lesson.kicker)}</p>
    <h1>${raw(lesson.title)}</h1>
    <p class="lede">${raw(lesson.promise)}</p>
    <p class="lesson-meta">${count} short steps · about ${lesson.minutes} minutes · then ${missions} missions</p>
    <div class="lesson-bar" id="lessonBar">
      <nav aria-label="Lesson steps"><ol class="dots">${Array.from({ length: count + 1 }, (_, i) => dot(i))}</ol></nav>
      <button type="button" class="btn sm" data-act="all">Show all steps on one page</button>
    </div>
    ${lesson.steps.map((step, s) => stepHtml(step, s, count))}
    ${recapHtml(lesson, count)}
  </div>`;
}

/**
 * Answers a step's question or skips it, and reveals the explanation it hides. Returns true when the click was one
 * of these.
 */
function checkClick(btn, lesson) {
  const sec = btn.closest('.lstep'), act = btn.dataset.act;
  if (act !== 'answer' && act !== 'reveal') return false;
  const body = sec.querySelector('.lstep-body'), skip = sec.querySelector('[data-act="reveal"]');
  body.hidden = false;
  if (skip) skip.hidden = true;
  if (act === 'reveal') body.focus();
  else showAnswer(btn, lesson.steps[Number(sec.dataset.step)].check.options);
  return true;
}

/** Shows or hides the game rules under the "Game rules" button. */
function toggleRules(btn) {
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  $('lessonRules').hidden = !open;
}

/** Wires a rendered step lesson: one listener for every button in it. */
function wireSteps(root, lesson) {
  const sections = [...root.querySelectorAll('.lstep')];
  const dots = [...root.querySelectorAll('.dot')];
  let current = 0, all = false;
  const allBtn = root.querySelector('[data-act="all"]');

  const paint = () => {
    sections.forEach((sec, i) => { sec.hidden = !all && i !== current; });
    dots.forEach((d, i) => (i === current && !all ? d.setAttribute('aria-current', 'step') : d.removeAttribute('aria-current')));
    root.classList.toggle('all', all);
    allBtn.textContent = all ? 'Show one step at a time' : 'Show all steps on one page';
  };
  const go = (i) => { current = i; all = false; paint(); $(`st-${i}`).focus(); };

  root.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button');
    if (!btn) return;
    if (btn.dataset.go) return go(Number(btn.dataset.go));
    if (checkClick(btn, lesson)) return;
    const act = btn.dataset.act;
    if (act === 'all') { all = !all; paint(); }
    else if (act === 'rules') toggleRules(btn);
    else if (act === 'build') hooks.setTab('build');
  });
  paint();
}

/* ---------------- One-page lesson ---------------- */
// The intro, a line of links to each part, one part per mission (its sections, its questions, its mission card),
// then the wrap-up, all on one page. Nothing here is saved: a part's state comes from mission progress, and a mission
// card's Start button is what opens its mission (`S.opened`, see missionOpen in state.js).
// Part 2 onwards and the wrap-up are locked until the mission before them is done (`partOpen`): a locked one shows its
// heading and a line saying which mission opens it, and the rest of it is `hidden`, so it cannot be read, reached by
// the keyboard or found.

/**
 * Whether part `p` of a one-page lesson is open; `p` equal to the number of parts is the wrap-up. The only rule for it:
 * a part opens with its mission (Part 1 always, any other once the mission before it is done), and the wrap-up once
 * the last mission is done. It reads `S.done` only, so resetting the level locks the parts again.
 */
const partOpen = (p) => mayOpen(p);

/** A part's state in words (never colour alone). */
const partState = (i) => (!partOpen(i) ? 'Locked' : S.done[i] ? 'Done' : 'Not started');

/** The line a locked part (or, for `p` equal to the number of parts, the locked wrap-up) shows under its heading. */
const lockHtml = (p, wrap = false) => html`<p class="part-lock" hidden>Finish Mission ${p} to unlock ${wrap ? 'the wrap-up' : 'this part'}.</p>`;

function introHtml(lesson) {
  const { intro } = lesson, minutes = lessonMinutes(lesson);
  return html`<section class="lintro" aria-labelledby="lp-intro">
    <p class="label">${raw(intro.kicker)} · about ${minutes} minutes</p>
    <h1 id="lp-intro" tabindex="-1">${raw(intro.title)}</h1>
    <p class="lede">${raw(intro.story)}</p>
    <p class="label">By the end you can</p>
    <ul>${intro.outcomes.map((o) => html`<li>${raw(o)}</li>`)}</ul>
    <figure class="fig"><svg id="${intro.picture}" role="img" aria-label="${intro.alt}"></svg><figcaption>What you will build</figcaption></figure>
  </section>`;
}

/** "On this page": a link to each part with its mission's state, and to the wrap-up. */
function onPageHtml(parts) {
  return html`<nav class="onpage" aria-labelledby="onpageLabel">
    <p class="label" id="onpageLabel">On this page</p>
    <ul>${parts.map((p, i) => html`<li><button type="button" class="jump" data-jump="lp-part-${i}">${i + 1} · ${raw(p.title)} · <span class="part-state" data-part="${i}">${partState(i)}</span></button></li>`)}
      <li><button type="button" class="jump" data-jump="lp-wrap">Wrap-up</button></li>
    </ul>
  </nav>`;
}

/** A "New part" card: the component's icon (drawn by `drawCardIcons`) and name, with its long name if it has one, then three short lines. */
function cardHtml(card) {
  return html`<div class="newpart">
    <svg class="newpart-icon" viewBox="-3 -3 36 30" aria-hidden="true" data-icon="${card.type}"></svg>
    <div>
      <p class="label">New part</p>
      <p class="newpart-name">${level.components[card.type].name}${card.aka ? ` (${card.aka})` : ''}</p>
      <dl>
        <dt>What it is</dt><dd>${raw(card.what)}</dd>
        <dt>What it does</dt><dd>${raw(card.does)}</dd>
        <dt>In the game</dt><dd>${raw(card.game)}</dd>
      </dl>
    </div>
  </div>`;
}

/** Section `s` of part `p` (or of "Start here"): its title, its hook when it has one, its body and Remember line. */
const sectionHtml = (section, p, s) => html`<section class="lsec" aria-labelledby="lp-s${p}-${s}">
    <h3 id="lp-s${p}-${s}">${raw(section.title)}</h3>
    ${section.hook ? html`<p class="hook">${raw(section.hook)}</p>` : ''}
    <div class="lsec-body">
      ${section.body.map(blockHtml)}
      <p class="takeaway"><b>Remember</b> ${raw(section.takeaway)}</p>
    </div>
  </section>`;

/** Part `p`'s questions, together, after its sections. */
const checksHtml = (checks, p) => html`<div class="checks" aria-labelledby="lp-c${p}">
    <h3 id="lp-c${p}">Check yourself</h3>
    ${checks.map((check, q) => html`<div class="check" data-part="${p}" data-q="${q}">${questionHtml(check, `${p}-${q}`)}</div>`)}
  </div>`;

/**
 * Part `p`'s mission card, in both of its states: what the mission asks with a Start button, and once the mission is
 * done what it showed with a Replay button. `paintParts` shows the one that applies (the card is in its part, so it
 * is seen only once its mission may open). Only the last part may have no
 * debrief (validate-lesson.js), and the wrap-up follows it.
 */
function missionCardHtml(part, p) {
  const n = p + 1, mission = level.missions[p];
  const done = part.debrief
    ? html`<p><b>What you saw.</b> ${raw(part.debrief.saw)}</p>
      <p class="debrief-num"><span class="label">Your number</span> <b>${raw(part.debrief.number[0])}</b> ${raw(part.debrief.number[1])}</p>
      <p><b>What breaks next.</b> ${raw(part.debrief.next)}</p>`
    : html`<p>The wrap-up below sums up the level.</p>`;
  return html`<div class="mcard" data-part="${p}" aria-labelledby="lp-m${p}">
    <p class="label">Mission ${n}</p>
    <h3 id="lp-m${p}" tabindex="-1">${mission.title}</h3>
    <div class="mcard-start">
      <p class="mcard-will">You will</p>
      <ul>${part.youWill.map((line) => html`<li>${raw(line)}</li>`)}</ul>
      <button type="button" class="btn primary" data-act="mission" data-mission="${p}">Start Mission ${n} <span aria-hidden="true">→</span></button>
    </div>
    <div class="mcard-done" hidden>
      <p class="mcard-complete"><span aria-hidden="true">✓</span> Mission ${n} complete</p>
      ${done}
      <button type="button" class="btn" data-act="mission" data-mission="${p}">Replay Mission ${n}</button>
    </div>
  </div>`;
}

/** "Start here": what every level takes as known, before the first part. */
const startHtml = (start) => html`<section class="lstart" aria-labelledby="lp-start">
    <p class="label">${start.minutes} min</p>
    <h2 id="lp-start">Start here</h2>
    ${sectionHtml(start, 'start', 0)}
  </section>`;

function partHtml(part, p) {
  // A New part card comes before the section its `before` names: the first, when it names none.
  const cardsBefore = (s) => {
    const cards = (part.newParts ?? []).filter((card) => (card.before ?? 0) === s);
    return cards.length ? html`<div class="newparts">${cards.map(cardHtml)}</div>` : '';
  };
  return html`<section class="lpart" aria-labelledby="lp-part-${p}">
    <p class="label">${part.minutes} min</p>
    <h2 id="lp-part-${p}" tabindex="-1">Part ${p + 1} · ${raw(part.title)}</h2>
    ${p ? lockHtml(p) : ''}
    ${part.lead ? html`<p class="part-lead">${raw(part.lead)}</p>` : ''}
    ${part.sections.map((section, s) => html`${cardsBefore(s)}${sectionHtml(section, p, s)}`)}
    ${part.checks?.length ? checksHtml(part.checks, p) : ''}
    ${missionCardHtml(part, p)}
  </section>`;
}

/** The wrap-up's heading: "Wrap-up" while it is locked, as its link names it. */
const WRAP_TITLE = { open: 'What you built', locked: 'Wrap-up' };

/** The level's wrap-up: the intro's picture, three things to say, numbers to keep, then the quiz. */
function wrapHtml(wrap) {
  return html`<section class="lwrap" aria-labelledby="lp-wrap">
    <p class="label">Level ${level.id} · wrap-up</p>
    <h2 id="lp-wrap" tabindex="-1">${WRAP_TITLE.open}</h2>
    ${lockHtml(level.missions.length, true)}
    <figure class="fig"><svg id="${wrap.picture}" role="img" aria-label="${wrap.alt}"></svg></figure>
    <h3>Three things to say in an interview</h3>
    <ol>${wrap.say.map((line) => html`<li>${raw(line)}</li>`)}</ol>
    <h3>Numbers to keep</h3>
    ${numbersHtml(wrap.numbers)}
    ${wrap.loop ? html`<p>${raw(wrap.loop)}</p>` : ''}
    <p><b>Still broken.</b> ${raw(wrap.broken)}</p>
    <div class="lstep-nav">
      <button type="button" class="btn primary" data-act="quiz">Take the quiz <span aria-hidden="true">→</span></button>
    </div>
  </section>`;
}

const pageLessonHtml = (lesson) => html`<div class="page-lesson" id="pageLesson">
    ${introHtml(lesson)}
    ${onPageHtml(lesson.parts)}
    ${lesson.start ? startHtml(lesson.start) : ''}
    ${lesson.parts.map(partHtml)}
    ${wrapHtml(lesson.wrap)}
  </div>`;

/** Draws each New part card's icon, as the Build screen's component list draws it. */
function drawCardIcons(root) {
  for (const svg of root.querySelectorAll('.newpart-icon')) drawIcon(/** @type {HTMLElement} */ (svg).dataset.icon, svg, 0, 0);
}

/** The rendered one-page lesson, and each part's state it last showed (so a repaint touches only what changed). */
const pageView = { root: null, painted: [] };

/**
 * Shows part section `sec` (a part, or the wrap-up) open or locked: locked, only its heading and its lock line. Part 1
 * has no lock line and is never locked.
 */
function paintLock(sec, open) {
  for (const kid of sec.children) if (kid.tagName !== 'H2') /** @type {HTMLElement} */ (kid).hidden = kid.classList.contains('part-lock') === open;
}

/** Shows mission `i`'s card as done (what it showed, Replay) or still to do (You will, Start). */
function paintCard(i, done) {
  const card = pageView.root.querySelector(`.mcard[data-part="${i}"]`);
  card.classList.toggle('done', done);
  card.querySelector('.mcard-start').hidden = done;
  card.querySelector('.mcard-done').hidden = !done;
}

/** Shows each part locked or open, its state in the links and its mission card's state. main.js calls it after every change. */
export function paintParts() {
  if (!pageView.root) return;
  // In page order: part p is index p, and the wrap-up, after the last part, is index MISSIONS.length.
  pageView.root.querySelectorAll('.lpart, .lwrap').forEach((sec, p) => {
    const wrap = sec.classList.contains('lwrap'), open = partOpen(p), done = !wrap && !!S.done[p];
    const state = !open ? 'locked' : done ? 'done' : 'open';
    if (pageView.painted[p] === state) return;
    pageView.painted[p] = state;
    paintLock(sec, open);
    if (wrap) { sec.querySelector('h2').textContent = open ? WRAP_TITLE.open : WRAP_TITLE.locked; return; }
    pageView.root.querySelector(`.part-state[data-part="${p}"]`).textContent = partState(p);
    paintCard(p, done);
  });
}

/** Scrolls the lesson to the heading with id `id` and moves focus to it. */
function jumpTo(id) {
  const heading = $(id);
  heading.scrollIntoView({ block: 'start' });
  heading.focus({ preventScroll: true });
}

/** A card's Start or Replay button: opens mission `i` on the Build tab (its card is in view only once it may open). */
function startMission(i) {
  if (openFromLesson(i)) hooks.setTab('build');
}

/** Opens the Lesson tab at the heading with id `id`. */
function openLessonAt(id) {
  hooks.setTab('lesson');
  jumpTo(id);
}

/** The Build tab's buttons into the lesson, keyed by their `data-act`; each gets the mission the button names. */
const TO_LESSON = {
  debrief: (i) => openLessonAt(S.done[i] && i === MISSIONS.length - 1 ? 'lp-wrap' : `lp-m${i}`), // "Back to the lesson"
  'lesson-mission': (i) => openLessonAt(`lp-m${i}`), // a locked mission's "Go to Part N"
  'lesson-part': (i) => openLessonAt(`lp-part-${i}`), // "Read Part N again"
};

/** Wires a rendered one-page lesson, and the Build tab's buttons that lead into it. */
function wireParts(root, lesson) {
  root.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    if (btn.dataset.jump) jumpTo(btn.dataset.jump);
    else if (act === 'answer') {
      const check = btn.closest('.check');
      showAnswer(btn, lesson.parts[Number(check.dataset.part)].checks[Number(check.dataset.q)].options);
    } else if (act === 'mission') startMission(Number(btn.dataset.mission));
    else if (act === 'quiz') hooks.setTab('quiz');
  });
  $('view-build').addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('[data-act]');
    const go = btn && TO_LESSON[/** @type {HTMLElement} */ (btn).dataset.act];
    if (go) go(S.mission);
  });
}

/**
 * Fills the lesson tab. A step lesson or a one-page lesson also takes over the tab's start button as its "Skip to the
 * missions".
 */
export function renderLesson() {
  const view = $('view-lesson');
  if (!level.lesson) { prependHtml(view, raw(level.lessonHtml)); return; } // a lesson is authored markup
  const onePage = inParts();
  prependHtml(view, onePage ? pageLessonHtml(level.lesson) : lessonHtml(level.lesson));
  const cta = view.querySelector('.lesson-cta');
  $('startBuild').firstChild.textContent = 'Skip to the missions ';
  if (!onePage) { $('lessonBar').appendChild(cta); wireSteps($('stepLesson'), level.lesson); return; }
  pageView.root = $('pageLesson');
  pageView.root.querySelector('.lintro').appendChild(cta);
  drawCardIcons(pageView.root);
  wireParts(pageView.root, level.lesson);
  paintParts();
}

/* ---------------- Diagram helpers ---------------- */

export function figNode(svg, type, x, y, name, sub) {
  const w = 188, h = 60;
  const g = svgEl('g', { transform: `translate(${x - w / 2} ${y - h / 2})` }, svg);
  svgEl('rect', { x: 0, y: 0, width: w, height: h, rx: 11, class: 'node-box' }, g);
  drawIcon(type, g, 12, 18);
  const t = svgEl('text', { x: 52, y: 26, class: 'node-name' }, g); t.textContent = name;
  const s = svgEl('text', { x: 52, y: 43, class: 'node-sub' }, g); s.textContent = sub;
}
/** The id of an svg's arrowhead: one per svg, because a marker inside a hidden svg draws nothing for the others. */
const arrowId = (svg) => `figArr-${svg.id}`;
export function figArrow(svg, x1, y1, x2, y2, label, step, lx, ly, anchor) {
  svgEl('line', { x1, y1, x2, y2, class: 'd-line', 'marker-end': `url(#${arrowId(svg)})` }, svg);
  if (step) {
    svgEl('circle', { cx: lx - 13, cy: ly - 4, r: 9, class: 'd-step' }, svg);
    const s = svgEl('text', { x: lx - 13, y: ly, class: 'd-step-t', 'text-anchor': 'middle' }, svg); s.textContent = step;
  }
  figLabel(svg, lx, ly, label, anchor || 'start');
}
/** A text label; centred on (x, y) unless `anchor` says otherwise. */
export function figLabel(svg, x, y, text, anchor = 'middle', cls = 'd-label') {
  const t = svgEl('text', { x, y, class: cls, 'text-anchor': anchor }, svg); t.textContent = text;
}
/** A dashed arrow along the path `d` (for example 'M10 20 H80'). */
export function figDash(svg, d) {
  svgEl('path', { d, class: 'd-line d-dash', fill: 'none', 'marker-end': `url(#${arrowId(svg)})` }, svg);
}
export function figDefs(svg) {
  const defs = svgEl('defs', {}, svg);
  const mk = svgEl('marker', { id: arrowId(svg), viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
  svgEl('path', { d: 'M0 0L10 5L0 10z', class: 'arrowhead' }, mk);
}
export const drawFigures = () => level.drawFigures({ $, svgEl, figNode, figArrow, figDefs, figLabel, figDash });
