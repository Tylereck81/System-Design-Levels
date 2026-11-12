// Lesson tab: a lesson written as steps or as chapters (`level.lesson`, see Lesson in types.js) or authored HTML
// (`level.lessonHtml`), and the helpers a level's diagrams are drawn with.
import { level } from '../level.js';
import { $, svgEl, html, raw, prependHtml, setHtml } from '../dom.js';
import { hooks } from '../hooks.js';
import { drawIcon } from '../view/icons.js';
import { MISSIONS, QUIZ, S } from '../state.js';
import { unlocked, switchMission } from './mission.js';
import { log } from './log.js';

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

/** A step's or a screen's question (`s` keys its ids): "Guess first" comes before the explanation, "Your turn" after it. */
function checkHtml(check, s) {
  const guess = check.kind === 'guess';
  return html`<div class="check">
    <p class="label">${guess ? 'Guess first' : 'Your turn'}</p>
    <p class="check-q" id="q-${s}">${raw(check.q)}</p>
    <div class="check-opts" role="group" aria-labelledby="q-${s}">${check.options.map((o, i) => html`
      <button type="button" class="btn opt" data-act="answer" data-opt="${i}" aria-pressed="false">${raw(o.t)}</button>`)}</div>
    <div class="check-fb" aria-live="polite"></div>
    ${guess ? html`<button type="button" class="btn sm" data-act="reveal">Skip the question and show me</button>` : ''}
  </div>`;
}

function stepHtml(step, s, count) {
  const guess = step.check?.kind === 'guess';
  return html`<section class="lstep" data-step="${s}" aria-labelledby="st-${s}"${s ? raw(' hidden') : ''}>
    <p class="label">Step ${s + 1} of ${count}</p>
    <h2 id="st-${s}" tabindex="-1">${raw(step.title)}</h2>
    <p class="hook">${raw(step.hook)}</p>
    ${guess ? checkHtml(step.check, s) : ''}
    <div class="lstep-body" tabindex="-1"${guess ? raw(' hidden') : ''}>
      ${step.body.map(blockHtml)}
      ${step.check && !guess ? checkHtml(step.check, s) : ''}
      <p class="takeaway"><b>Remember</b> ${raw(step.takeaway)}</p>
    </div>
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
    <dl class="recap-nums">${numbers.map(([value, meaning]) => html`<div><dt>${raw(value)}</dt><dd>${raw(meaning)}</dd></div>`)}</dl>
    <h3>Your missions</h3>
    <ol class="bridge">${bridge.map((line, i) => html`<li><b>Mission ${i + 1} · ${level.missions[i].title}</b> ${raw(line)}</li>`)}</ol>
    <button type="button" class="btn sm" data-act="rules" aria-expanded="false" aria-controls="lessonRules">Game rules</button>
    <p class="assume" id="lessonRules" hidden>${raw(lesson.rules)}</p>
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
 * Answers a question or skips it, and reveals the explanation it hides. `checkOf(section)` gives the check of the
 * `.lstep` the button is in. Returns true when the click was one of these.
 */
function checkClick(btn, checkOf) {
  const sec = btn.closest('.lstep'), act = btn.dataset.act;
  if (act !== 'answer' && act !== 'reveal') return false;
  const body = sec.querySelector('.lstep-body'), skip = sec.querySelector('[data-act="reveal"]');
  body.hidden = false;
  if (skip) skip.hidden = true;
  if (act === 'reveal') { body.focus(); return true; }
  const { options } = checkOf(sec);
  const chosen = options[Number(btn.dataset.opt)], right = options.find((o) => o.right);
  btn.parentElement.querySelectorAll('.opt').forEach((o) => o.setAttribute('aria-pressed', String(o === btn)));
  setHtml(sec.querySelector('.check-fb'), chosen === right
    ? html`<p><b>Right.</b> ${raw(chosen.why)}</p>`
    : html`<p><b>Not quite.</b> ${raw(chosen.why)}</p><p>The right answer: <b>${raw(right.t)}</b>. ${raw(right.why)}</p>`);
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
    if (checkClick(btn, (sec) => lesson.steps[Number(sec.dataset.step)].check)) return;
    const act = btn.dataset.act;
    if (act === 'all') { all = !all; paint(); }
    else if (act === 'rules') toggleRules(btn);
    else if (act === 'build') hooks.setTab('build');
  });
  paint();
}

/* ---------------- Chapter lesson ---------------- */
// One page at a time: the intro (with the list of chapters), a briefing screen, a debrief, or the wrap-up. Every page
// is in the document from the start (`hidden` when not shown), so the level's figures are drawn once. Page keys:
// 'intro', 'b<chapter>-<screen>', 'd<chapter>', 'wrap'. Nothing here is saved: a chapter's state comes from mission
// progress, and "briefing read" is remembered only until the page is reloaded.

/** Chapters whose last briefing screen was shown since the page loaded. */
const briefingRead = new Set();

/** A chapter's state in words (never colour alone). */
const chapterState = (c) => (S.done[c] ? 'Mission done' : briefingRead.has(c) ? 'Briefing read' : 'Not started');

/** The heading id of a page. */
const headingId = (key) => `lp-${key}`;

/** A briefing screen's key, split into its chapter and screen numbers; null for any other page. */
function screenOf(key) {
  const m = /^b(\d+)-(\d+)$/.exec(key);
  return m ? { c: Number(m[1]), s: Number(m[2]) } : null;
}

function introHtml(lesson) {
  const { intro, chapters } = lesson;
  const minutes = chapters.reduce((n, c) => n + c.minutes, 0);
  return html`<section class="lpage lintro" data-page="intro" aria-labelledby="${headingId('intro')}">
    <p class="label">${raw(intro.kicker)} · about ${minutes} minutes</p>
    <h1 id="${headingId('intro')}" tabindex="-1">${raw(intro.title)}</h1>
    <div class="intro-grid">
      <div>
        <p class="lede">${raw(intro.story)}</p>
        <p class="label">By the end you can</p>
        <ul>${intro.outcomes.map((o) => html`<li>${raw(o)}</li>`)}</ul>
        <button type="button" class="btn primary" data-go="b0-0">Start the first chapter <span aria-hidden="true">→</span></button>
      </div>
      <figure class="fig"><svg id="${intro.picture}" role="img" aria-label="${intro.alt}"></svg><figcaption>What you will build</figcaption></figure>
    </div>
    <h2>Chapters</h2>
    <ol class="chapters">${chapters.map((c, i) => html`<li><button type="button" class="chapter" data-go="b${i}-0">
      <span class="chapter-name">${i + 1} · ${raw(c.title)}</span>
      <span class="chapter-meta">${c.minutes} min · <span class="chapter-state" data-chapter="${i}">${chapterState(i)}</span></span></button></li>`)}
      <li><button type="button" class="chapter" data-act="quiz"><span class="chapter-name">Quiz</span><span class="chapter-meta">${QUIZ.length} questions</span></button></li>
    </ol>
    <button type="button" class="btn sm" data-act="rules" aria-expanded="false" aria-controls="lessonRules">Game rules</button>
    <p class="assume" id="lessonRules" hidden>${raw(lesson.rules)}</p>
  </section>`;
}

/** Briefing screen `s` of chapter `c`: a step's parts, then the line on how the mission uses the idea. */
function screenHtml(chapter, c, screen, s) {
  const key = `b${c}-${s}`, last = s === chapter.screens.length - 1;
  const guess = screen.check?.kind === 'guess';
  return html`<section class="lpage lstep" data-page="${key}" aria-labelledby="${headingId(key)}" hidden>
    <p class="label">Chapter ${c + 1} · ${raw(chapter.title)} · briefing ${s + 1} of ${chapter.screens.length}</p>
    <h2 id="${headingId(key)}" tabindex="-1">${raw(screen.title)}</h2>
    <p class="hook">${raw(screen.hook)}</p>
    ${guess ? checkHtml(screen.check, key) : ''}
    <div class="lstep-body" tabindex="-1"${guess ? raw(' hidden') : ''}>
      ${screen.body.map(blockHtml)}
      ${screen.check && !guess ? checkHtml(screen.check, key) : ''}
      <p class="takeaway"><b>Remember</b> ${raw(screen.takeaway)}</p>
      <p class="uses"><b>In Mission ${c + 1}</b> ${raw(screen.uses)}</p>
    </div>
    <div class="lstep-nav">
      <button type="button" class="btn" data-go="${s ? `b${c}-${s - 1}` : 'intro'}">Back</button>
      ${last
        ? html`<button type="button" class="btn primary" data-act="mission" data-mission="${c}">Start mission ${c + 1} <span aria-hidden="true">→</span></button>`
        : html`<button type="button" class="btn primary" data-go="b${c}-${s + 1}">Next</button>`}
    </div>
  </section>`;
}

/** What chapter `c`'s mission showed, one number, and what breaks next; it leads to the next chapter. */
function debriefHtml(chapters, c) {
  const { saw, number: [value, meaning], next } = chapters[c].debrief, key = `d${c}`;
  return html`<section class="lpage lstep debrief" data-page="${key}" aria-labelledby="${headingId(key)}" hidden>
    <p class="label">Chapter ${c + 1} · ${raw(chapters[c].title)} · debrief</p>
    <h2 id="${headingId(key)}" tabindex="-1">Mission ${c + 1} debrief</h2>
    <p><b>What you just saw.</b> ${raw(saw)}</p>
    <p class="debrief-num"><span class="label">Your number</span> <b>${raw(value)}</b> ${raw(meaning)}</p>
    <p><b>What breaks next.</b> ${raw(next)}</p>
    <div class="lstep-nav">
      <button type="button" class="btn" data-go="intro">All chapters</button>
      <button type="button" class="btn primary" data-go="b${c + 1}-0">Next: Chapter ${c + 2} · ${raw(chapters[c + 1].title)} <span aria-hidden="true">→</span></button>
    </div>
  </section>`;
}

/** The level's wrap-up, shown after the last mission: the intro's picture, three things to say, numbers to keep. */
function wrapHtml(wrap) {
  return html`<section class="lpage lstep wrap" data-page="wrap" aria-labelledby="${headingId('wrap')}" hidden>
    <p class="label">Level ${level.id} · wrap-up</p>
    <h2 id="${headingId('wrap')}" tabindex="-1">What you built</h2>
    <figure class="fig"><svg id="${wrap.picture}" role="img" aria-label="${wrap.alt}"></svg></figure>
    <h3>Three things to say in an interview</h3>
    <ol>${wrap.say.map((line) => html`<li>${raw(line)}</li>`)}</ol>
    <h3>Numbers to keep</h3>
    <dl class="recap-nums">${wrap.numbers.map(([value, meaning]) => html`<div><dt>${raw(value)}</dt><dd>${raw(meaning)}</dd></div>`)}</dl>
    ${wrap.loop ? html`<p>${raw(wrap.loop)}</p>` : ''}
    <p><b>Still broken.</b> ${raw(wrap.broken)}</p>
    <div class="lstep-nav">
      <button type="button" class="btn" data-go="intro">All chapters</button>
      <button type="button" class="btn primary" data-act="quiz">Take the quiz <span aria-hidden="true">→</span></button>
    </div>
  </section>`;
}

function chapterLessonHtml(lesson) {
  const { chapters } = lesson;
  return html`<div class="chapter-lesson" id="chapterLesson">
    ${introHtml(lesson)}
    ${chapters.map((chapter, c) => html`${chapter.screens.map((screen, s) => screenHtml(chapter, c, screen, s))}${chapter.debrief ? debriefHtml(chapters, c) : ''}`)}
    ${wrapHtml(lesson.wrap)}
  </div>`;
}

/** The rendered chapter lesson, the page it shows, and whether it is in the Briefing dialog. */
const lessonView = { root: null, page: 'intro', inDialog: false };

/** Shows one page and, unless told not to, moves focus to its heading. */
function showPage(key, focus = true) {
  lessonView.page = key;
  for (const page of lessonView.root.querySelectorAll('.lpage')) page.hidden = page.dataset.page !== key;
  const screen = screenOf(key);
  if (screen && screen.s === level.lesson.chapters[screen.c].screens.length - 1) briefingRead.add(screen.c);
  paintChapters();
  if (focus) $(headingId(key)).focus();
}

/** Writes each chapter's state in the intro's list. main.js calls it after every change, so it follows mission progress. */
export function paintChapters() {
  if (!lessonView.root) return;
  for (const state of lessonView.root.querySelectorAll('.chapter-state')) state.textContent = chapterState(Number(state.dataset.chapter));
}

/** Opens mission `i` on the Build tab; while it is still locked, the first mission not done opens instead, and the log says why. */
function startMission(i) {
  if (lessonView.inDialog) /** @type {HTMLDialogElement} */ ($('briefingDialog')).close();
  const open = unlocked(i) ? i : S.done.findIndex((done) => !done);
  if (open !== i) log(`Finish Mission ${i} first. Mission ${open + 1} is open.`, 'warn');
  if (open !== S.mission) switchMission(open);
  hooks.setTab('build');
}

/** Opens the debrief of chapter `c` on the Lesson tab; after the last mission, that is the wrap-up. */
function openDebrief(c) {
  hooks.setTab('lesson');
  showPage(c === MISSIONS.length - 1 ? 'wrap' : `d${c}`);
}

/**
 * Opens chapter `c`'s briefing screens in a dialog over the Build tab. The lesson itself moves into the dialog while
 * it is open, so each figure stays one svg with one id, and moves back when it closes.
 */
function openBriefing(c) {
  let dialog = /** @type {HTMLDialogElement} */ ($('briefingDialog'));
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'briefingDialog';
    dialog.className = 'lesson briefing-dialog';
    dialog.setAttribute('aria-label', 'Briefing');
    setHtml(dialog, html`<div class="dialog-bar"><button type="button" class="btn sm" data-act="close">Close</button></div>`);
    dialog.addEventListener('click', (e) => { if (/** @type {HTMLElement} */ (e.target).closest('[data-act="close"]')) dialog.close(); });
    dialog.addEventListener('close', () => {
      lessonView.inDialog = false;
      $('view-lesson').prepend(lessonView.root);
      showPage('intro', false);
      $('mission').querySelector('[data-act="briefing"]')?.focus(); // back to the link that opened it
    });
    document.body.appendChild(dialog);
  }
  lessonView.inDialog = true;
  dialog.appendChild(lessonView.root);
  showPage(`b${c}-0`, false);
  dialog.showModal();
}

/** Wires a rendered chapter lesson, and the Debrief and Briefing buttons on the Build tab. */
function wireChapters(root, lesson) {
  const checkOf = (sec) => {
    const { c, s } = screenOf(sec.dataset.page);
    return lesson.chapters[c].screens[s].check;
  };
  root.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button');
    if (!btn) return;
    if (btn.dataset.go) return showPage(btn.dataset.go);
    if (checkClick(btn, checkOf)) return;
    const act = btn.dataset.act;
    if (act === 'mission') startMission(Number(btn.dataset.mission));
    else if (act === 'quiz') hooks.setTab('quiz');
    else if (act === 'rules') toggleRules(btn);
  });
  $('view-build').addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('[data-act="debrief"], [data-act="briefing"]');
    if (!btn) return;
    if (btn.dataset.act === 'debrief') openDebrief(S.mission);
    else openBriefing(S.mission);
  });
}

/**
 * Fills the lesson tab. A step lesson or a chapter lesson also takes over the tab's start button as its "Skip to the
 * missions".
 */
export function renderLesson() {
  const view = $('view-lesson');
  if (!level.lesson) { prependHtml(view, raw(level.lessonHtml)); return; } // a lesson is authored markup
  const chapters = 'chapters' in level.lesson;
  prependHtml(view, chapters ? chapterLessonHtml(level.lesson) : lessonHtml(level.lesson));
  const cta = view.querySelector('.lesson-cta');
  $('startBuild').firstChild.textContent = 'Skip to the missions ';
  if (!chapters) { $('lessonBar').appendChild(cta); wireSteps($('stepLesson'), level.lesson); return; }
  lessonView.root = $('chapterLesson');
  lessonView.root.querySelector('.lintro').appendChild(cta);
  wireChapters(lessonView.root, level.lesson);
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
