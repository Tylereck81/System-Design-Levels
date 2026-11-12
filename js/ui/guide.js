// The first-mission guide: one note at a time, beside the thing it talks about, naming the one next thing to do.
// The steps are data on the mission (`Mission.guide`, `GuideStep` in types.js). The note always shows the first step
// the design has not done yet, so a player who works out of order is never asked to redo something.
// It guides and never locks: no overlay, the note never covers what it points at, and only its own buttons take
// clicks. Only "the guide is finished" is remembered, under its own key, apart from the level's save.
import { $, el } from '../dom.js';
import { MISSIONS, S, ui, run, byId, missionOpen } from '../state.js';
import { graph } from '../engine/model.js';
import { GUIDE_ORDER } from '../level.js';
import { readStorage, writeStorage, removeStorage } from '../storage.js';
import { hooks } from '../hooks.js';

const KEY = 'sdl-guide-v1', FINISHED = 'finished';
/** The mission with a guide, or -1. */
const GI = MISSIONS.findIndex((M) => M.guide);
const STEPS = GI < 0 ? [] : MISSIONS[GI].guide;
/** Gap between the note and what it points at, and between the note and the window's edge, in px. */
const GAP = 12;
/** Up to this window width the note is a strip across the screen. */
const STRIP_MAX = 860;

/** Steps without a `done` test that the player has pressed Next on (this page only). */
const acked = new Set();
/** The guide is running: not finished, or started again with "Show the guide". */
let on = GI >= 0 && readStorage(KEY) !== FINISHED;
let loop = 0;
/** What the note shows now, so the page is only touched when it changes. */
let shown = { k: -1, text: '' }, placed = '';

const box = el('section', 'guide'); box.id = 'guide'; box.setAttribute('aria-label', 'Guide'); box.tabIndex = -1; box.hidden = true;
const live = el('div'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
const stepTxt = el('p', 'guide-step'), noteTxt = el('p', 'guide-text');
live.append(stepTxt, noteTxt);
const order = el('p', 'guide-order');
const nextBtn = el('button', 'btn primary', 'Next'); nextBtn.type = 'button'; nextBtn.id = 'guideNext';
const skipBtn = el('button', 'btn', 'Skip the guide'); skipBtn.type = 'button'; skipBtn.id = 'guideSkip';
const btns = el('div', 'guide-btns'); btns.append(nextBtn, skipBtn);
box.append(live, order, btns);
/** The outline round what the note points at. */
const ring = el('div', 'guide-ring'); ring.setAttribute('aria-hidden', 'true'); ring.hidden = true;
if (GI >= 0) $('view-build').append(box, ring);

nextBtn.onclick = () => { acked.add(shown.k); paint(); };
skipBtn.onclick = () => finish(true);
// Escape skips the guide, unless it is cancelling a selection or a connection on the canvas (view/interaction.js)
// or is typed in a text field.
document.addEventListener('keydown', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  if (e.key !== 'Escape' || box.hidden || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if (box.contains(target) || (!ui.sel && !ui.connectFrom)) finish(true);
}, true);

/** What the steps read. */
const view = () => ({ g: graph(), nodes: S.nodes, sel: ui.sel?.kind === 'node' ? byId(ui.sel.id) || null : null, running: run.everPlayed });
const resolve = (v, s) => (typeof v === 'function' ? v(s) : v);
/** Index of the first step not done, or -1 when every step is. */
const firstOpen = (s) => STEPS.findIndex((st, k) => !(st.done ? st.done(s) : acked.has(k)));

/**
 * Ends the guide and remembers it. `byPlayer`: skipped or Done, so focus moves to "Show the guide" if it was in the
 * note (whose buttons are gone) or nowhere (some browsers do not focus a clicked button).
 */
function finish(byPlayer) {
  const a = document.activeElement, hadFocus = !a || a === document.body || box.contains(a);
  on = false; writeStorage(KEY, FINISHED); hide();
  if (!byPlayer) return;
  hooks.afterChange();
  if (hadFocus) $('guideShow')?.focus();
}
function hide() { box.hidden = true; ring.hidden = true; shown = { k: -1, text: '' }; placed = ''; }

/** Starts the guide again from the first step not done, with focus on the note. */
function start() {
  on = true; hooks.afterChange(); keepChecking();
  paint(); if (!box.hidden) box.focus();
}
function keepChecking() { if (!loop && on) loop = requestAnimationFrame(tick); }
// The note follows the design, the selection, the run and the layout, so it is checked every frame while the guide runs.
function tick() {
  loop = 0;
  try { paint(); } catch (err) { console.error(err); }
  keepChecking();
}

function paint() {
  if (!on) return;
  if (S.done[GI]) { finish(false); return; } // completing the mission ends the guide
  if (S.tab !== 'build' || S.mission !== GI || !missionOpen(GI)) { hide(); return; }
  const s = view(), k = firstOpen(s);
  if (k < 0) { finish(true); return; }
  const st = STEPS[k], text = resolve(st.text, s);
  if (k !== shown.k || text !== shown.text) render(k, st, text);
  box.hidden = false;
  place(document.querySelector(resolve(st.at, s)));
}

function render(k, st, text) {
  shown = { k, text };
  stepTxt.textContent = `Step ${k + 1} of ${STEPS.length}`;
  noteTxt.textContent = '';
  noteTxt.append(el('b', null, st.title + '.'), ' ' + text);
  order.textContent = '';
  order.append(el('span', 'sr-only', 'Order: '));
  GUIDE_ORDER.forEach((w, i) => {
    if (i) { const a = el('span', null, ' → '); a.setAttribute('aria-hidden', 'true'); order.append(a); }
    if (w !== st.word) { order.append(w); return; }
    const b = el('b', null, w); b.append(el('span', 'sr-only', ', this step')); order.append(b);
  });
  nextBtn.hidden = !!st.done;
  nextBtn.textContent = k === STEPS.length - 1 ? 'Done' : 'Next';
}

/** What the note must not cover: the Play button, the settings sheet (when the inspector is one) and the target `t`. */
function keepClear(t) {
  const avoid = [$('playBtn').getBoundingClientRect()];
  const insp = $('inspCard');
  const sheet = !insp.hidden && getComputedStyle(insp).position === 'fixed' ? insp.getBoundingClientRect() : null;
  if (sheet) avoid.push(sheet);
  if (t) avoid.push(rectAt(t.left - 4, t.top - 4, t.width + 8, t.height + 8));
  return { avoid, sheet };
}
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const rectAt = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });

/**
 * Where the note may go, best first, for a note `w` × `h` whose lowest spot has its top at `bottom`. Up to STRIP_MAX
 * it is a strip at the bottom, else at the top; wider, beside the target `t` (if any), else a corner.
 */
function spots(t, w, h, bottom, vw) {
  if (vw <= STRIP_MAX) return [[GAP, bottom], [GAP, GAP]];
  const beside = t ? [[t.right + GAP, t.top], [t.right + GAP, t.bottom - h], [t.left - GAP - w, t.top], [t.left - GAP - w, t.bottom - h],
    [t.left, t.bottom + GAP], [t.left, t.top - GAP - h]] : [];
  return [...beside, [vw - w - GAP, bottom], [GAP, bottom], [vw - w - GAP, GAP], [GAP, GAP]];
}

/**
 * Puts the note where it covers neither its target, the Play button nor the settings sheet (narrow screens), and,
 * when it is not a strip and there is room, no component on the canvas either; and the outline round the target.
 */
function place(target) {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const t = target?.getBoundingClientRect();
  const hasT = !!t && t.width > 0 && t.height > 0;
  const { avoid, sheet } = keepClear(hasT ? t : null);
  const strip = vw <= STRIP_MAX;
  const w = strip ? vw - 2 * GAP : Math.min(320, vw - 2 * GAP);
  if (box.style.width !== w + 'px') box.style.width = w + 'px';
  const h = box.offsetHeight;
  const clamp = ([x, y]) => [Math.max(GAP, Math.min(x, vw - w - GAP)), Math.max(GAP, Math.min(y, vh - h - GAP))];
  const fits = spots(hasT ? t : null, w, h, (sheet ? sheet.top : vh) - h - GAP, vw).map(clamp);
  const parts = strip ? [] : [...document.querySelectorAll('#cv .node')].map((n) => n.getBoundingClientRect());
  const clear = (rects) => fits.find(([fx, fy]) => !rects.some((a) => overlaps(rectAt(fx, fy, w, h), a)));
  const [x, y] = clear(avoid.concat(parts)) || clear(avoid) || fits[0];
  const where = `${Math.round(x)},${Math.round(y)}|` + (hasT ? `${Math.round(t.left)},${Math.round(t.top)},${Math.round(t.width)},${Math.round(t.height)}` : '');
  if (where === placed) return;
  placed = where;
  box.style.left = Math.round(x) + 'px'; box.style.top = Math.round(y) + 'px';
  ring.hidden = !hasT;
  if (hasT) Object.assign(ring.style, { left: t.left - 4 + 'px', top: t.top - 4 + 'px', width: t.width + 8 + 'px', height: t.height + 8 + 'px' });
}

/** True while the guide is running (not finished or skipped). */
export const guideOn = () => on;

/** "Reset level progress": forgets that the guide was finished, so it shows again. */
export function resetGuide() {
  if (GI < 0) return;
  removeStorage(KEY); acked.clear(); on = true; keepChecking();
}

/** The "Show the guide" button for mission `i`'s panel, or null when it has no guide, is done or the guide is on. */
export function guideButton(i) {
  if (i !== GI || S.done[i] || on) return null;
  const b = el('button', 'btn guide-show', 'Show the guide'); b.type = 'button'; b.id = 'guideShow';
  b.onclick = start;
  return b;
}

keepChecking();
