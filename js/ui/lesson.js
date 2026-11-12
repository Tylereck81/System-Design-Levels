// Lesson tab: a lesson written as steps (`level.lesson`, see Lesson in types.js) or authored HTML (`level.lessonHtml`),
// and the helpers a level's diagrams are drawn with.
import { level } from '../level.js';
import { $, svgEl, html, raw, prependHtml, setHtml } from '../dom.js';
import { hooks } from '../hooks.js';
import { drawIcon } from '../view/icons.js';

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

/** A step's question: "Guess first" comes before the explanation, "Your turn" after it. */
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
  const reveal = (sec) => {
    sec.querySelector('.lstep-body').hidden = false;
    const skip = sec.querySelector('[data-act="reveal"]');
    if (skip) skip.hidden = true;
  };
  const answer = (btn) => {
    const sec = btn.closest('.lstep'), s = Number(sec.dataset.step), { options } = lesson.steps[s].check;
    const chosen = options[Number(btn.dataset.opt)], right = options.find((o) => o.right);
    btn.parentElement.querySelectorAll('.opt').forEach((o) => o.setAttribute('aria-pressed', String(o === btn)));
    setHtml(sec.querySelector('.check-fb'), chosen === right
      ? html`<p><b>Right.</b> ${raw(chosen.why)}</p>`
      : html`<p><b>Not quite.</b> ${raw(chosen.why)}</p><p>The right answer: <b>${raw(right.t)}</b>. ${raw(right.why)}</p>`);
    reveal(sec);
  };

  root.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button');
    if (!btn) return;
    if (btn.dataset.go) return go(Number(btn.dataset.go));
    const act = btn.dataset.act;
    if (act === 'answer') answer(btn);
    else if (act === 'reveal') { const sec = btn.closest('.lstep'); reveal(sec); sec.querySelector('.lstep-body').focus(); }
    else if (act === 'all') { all = !all; paint(); }
    else if (act === 'rules') {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      $('lessonRules').hidden = !open;
    } else if (act === 'build') hooks.setTab('build');
  });
  paint();
}

/** Fills the lesson tab. A step lesson also takes over the tab's start button as its "Skip to the missions". */
export function renderLesson() {
  const view = $('view-lesson');
  if (!level.lesson) { prependHtml(view, raw(level.lessonHtml)); return; } // a lesson is authored markup
  prependHtml(view, lessonHtml(level.lesson));
  const cta = view.querySelector('.lesson-cta');
  $('startBuild').firstChild.textContent = 'Skip to the missions ';
  $('lessonBar').appendChild(cta);
  wireSteps($('stepLesson'), level.lesson);
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
