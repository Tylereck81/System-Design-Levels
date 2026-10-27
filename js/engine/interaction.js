// Adding, dragging, connecting and removing components.
import { level } from '../level.js';
import { $, svgEl, keepFocus } from '../dom.js';
import { TYPES, PALETTE, LIMIT_MSG, OK_PAIRS, BAD_PAIRS, pairKey, S, sel, connectFrom, save, byId, setSel, setConnectFrom, setRefocus } from '../state.js';
import { drawIcon } from './icons.js';
import { COMPONENTS, roleOf } from './components.js';
import { NW, NH, cv, previewLine, nodeRefs, renderEdges, renderCanvas, clampX, clampY, freeSpot } from './canvas.js';
import { setBanner } from '../ui/hud.js';
import { renderInspector } from '../ui/inspector.js';
import { togglePlay } from '../ui/controls.js';
import { log } from '../ui/log.js';
import { afterDesignChange } from '../main.js';
import { dropMissingCrashes } from './experiments.js';

/* ---------------- Palette ---------------- */
export const countType = (t) => S.nodes.filter(n => n.type === t).length;
export const atLimit = (t) => countType(t) >= (level.limits[t] ?? Infinity);
export function renderPalette() { keepFocus($('palList'), buildPalette); }
function buildPalette() {
  const list = $('palList'); list.textContent = '';
  for (const t of PALETTE) {
    const full = atLimit(t);
    const b = document.createElement('button');
    b.className = 'pal-item'; b.type = 'button'; b.dataset.type = t; b.dataset.focusKey = 'pal-' + t;
    b.setAttribute('aria-disabled', full ? 'true' : 'false');
    b.title = full ? LIMIT_MSG[t] : 'Drag onto the canvas, or tap to add';
    const ic = svgEl('svg', { viewBox: '-3 -3 36 30', 'aria-hidden': 'true' });
    drawIcon(t, ic, 0, 0);
    b.appendChild(ic);
    const nm = document.createElement('span'); nm.className = 'pn'; nm.textContent = TYPES[t].name;
    const sb = document.createElement('span'); sb.className = 'ps'; sb.textContent = full ? 'Added' : TYPES[t].short;
    b.append(nm, sb);
    list.appendChild(b);
  }
}

export const SLOTS = level.slots;

export function addNode(type, x, y) {
  if (atLimit(type)) { log(LIMIT_MSG[type], 'warn'); return; }
  const p = (x == null) ? SLOTS[type] : { x, y };
  const spot = freeSpot(clampX(p.x), clampY(p.y), null);
  const n = { id: 'n' + (S.seq++), type, x: spot.x, y: spot.y };
  if (COMPONENTS[type].sized) n.size = 'S';
  if (COMPONENTS[type].kinds) n.kind = null;
  if (COMPONENTS[type].algos) n.algo = COMPONENTS[type].defaultAlgo;
  S.nodes.push(n);
  setSel({ kind: 'node', id: n.id });
  afterDesignChange();
}

// palette pointer handling
export let pd = null;
$('palList').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.pal-item'); if (!b) return;
  if (b.getAttribute('aria-disabled') === 'true') { log(LIMIT_MSG[b.dataset.type], 'warn'); return; }
  e.preventDefault();
  b.setPointerCapture(e.pointerId);
  pd = { type: b.dataset.type, sx: e.clientX, sy: e.clientY, moved: false, ghost: null };
});
$('palList').addEventListener('pointermove', (e) => {
  if (!pd) return;
  if (!pd.moved && Math.hypot(e.clientX - pd.sx, e.clientY - pd.sy) > 6) {
    pd.moved = true;
    pd.ghost = document.createElement('div'); pd.ghost.className = 'ghost'; pd.ghost.textContent = TYPES[pd.type].name;
    document.body.appendChild(pd.ghost);
  }
  if (pd.ghost) { pd.ghost.style.left = e.clientX + 'px'; pd.ghost.style.top = e.clientY + 'px'; }
});
export const endPal = (e, cancel) => {
  if (!pd) return;
  const p = pd; pd = null;
  if (p.ghost) p.ghost.remove();
  if (cancel) return;
  if (!p.moved) { addNode(p.type); return; }
  const r = cv.getBoundingClientRect();
  if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
    const pt = svgPt(e); addNode(p.type, pt.x, pt.y);
  } else {
    log(`Drop the ${TYPES[p.type].name.toLowerCase()} on the canvas to add it, or tap it in the list.`, 'warn');
  }
};
$('palList').addEventListener('pointerup', (e) => endPal(e, false));
$('palList').addEventListener('pointercancel', (e) => endPal(e, true));
$('palList').addEventListener('keydown', (e) => {
  const b = e.target.closest('.pal-item');
  if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (b.getAttribute('aria-disabled') !== 'true') addNode(b.dataset.type); else log(LIMIT_MSG[b.dataset.type], 'warn'); }
});

/* ---------------- Canvas interaction ---------------- */
export function svgPt(e) {
  const pt = cv.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(cv.getScreenCTM().inverse());
}
export function nodeAt(p) {
  for (let i = S.nodes.length - 1; i >= 0; i--) {
    const n = S.nodes[i];
    if (Math.abs(p.x - n.x) <= NW / 2 && Math.abs(p.y - n.y) <= NH / 2 + 12) return n;
  }
  return null;
}
export function select(next) { setSel(next); renderCanvas(); renderInspector(); }
export function cancelConnect() { if (connectFrom) { setConnectFrom(null); setBanner(); } }

export let drag = null, conn = null;
cv.addEventListener('pointerdown', (e) => {
  // Clicking the canvas takes focus away from controls outside it, so Delete then acts on the canvas.
  const a = document.activeElement;
  if (a && a !== document.body && !cv.contains(a)) a.blur();
  const p = svgPt(e);
  const h = e.target.closest('[data-handle]');
  if (h) {
    e.preventDefault();
    if (connectFrom && connectFrom !== h.dataset.handle) { tryConnect(connectFrom, h.dataset.handle); setConnectFrom(null); setBanner(); renderCanvas(); return; }
    cv.setPointerCapture(e.pointerId);
    const n = byId(h.dataset.handle);
    conn = { from: n.id, sx: e.clientX, sy: e.clientY, moved: false };
    previewLine.setAttribute('x1', n.x); previewLine.setAttribute('y1', n.y + NH / 2);
    previewLine.setAttribute('x2', p.x); previewLine.setAttribute('y2', p.y);
    return;
  }
  const ng = e.target.closest('[data-node]');
  if (ng) {
    const n = byId(ng.dataset.node);
    if (connectFrom && connectFrom !== n.id) { tryConnect(connectFrom, n.id); setConnectFrom(null); setBanner(); renderCanvas(); return; }
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    drag = { id: n.id, ox: p.x - n.x, oy: p.y - n.y, sx: e.clientX, sy: e.clientY, moved: false };
    return;
  }
  const eg = e.target.closest('[data-edge]');
  if (eg) { cancelConnect(); select({ kind: 'edge', id: eg.dataset.edge }); return; }
  cancelConnect(); select(null);
});
cv.addEventListener('pointermove', (e) => {
  if (conn) {
    if (Math.hypot(e.clientX - conn.sx, e.clientY - conn.sy) > 5) { conn.moved = true; previewLine.setAttribute('visibility', 'visible'); }
    const p = svgPt(e); previewLine.setAttribute('x2', p.x); previewLine.setAttribute('y2', p.y);
    return;
  }
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const p = svgPt(e); const n = byId(drag.id); if (!n) { drag = null; return; }
    n.x = clampX(p.x - drag.ox); n.y = clampY(p.y - drag.oy);
    nodeRefs[n.id].g.setAttribute('transform', `translate(${n.x - NW / 2} ${n.y - NH / 2})`);
    renderEdges();
  }
});
export const endCanvas = (e) => {
  if (conn) {
    previewLine.setAttribute('visibility', 'hidden');
    const c = conn; conn = null;
    if (!c.moved) { setConnectFrom(c.from); setSel({ kind: 'node', id: c.from }); setBanner(); renderCanvas(); renderInspector(); return; }
    const t = nodeAt(svgPt(e));
    if (t && t.id !== c.from) tryConnect(c.from, t.id);
    return;
  }
  if (drag) {
    const d = drag; drag = null;
    if (!d.moved) { select({ kind: 'node', id: d.id }); return; }
    const n = byId(d.id);
    if (n) { const s = freeSpot(n.x, n.y, n.id); n.x = s.x; n.y = s.y; }
    renderCanvas(); save();
  }
};
cv.addEventListener('pointerup', endCanvas);
cv.addEventListener('pointercancel', () => { conn = null; drag = null; previewLine.setAttribute('visibility', 'hidden'); });

// keyboard on canvas nodes
cv.addEventListener('keydown', (e) => {
  const ng = e.target.closest && e.target.closest('[data-node]'); if (!ng) return;
  const n = byId(ng.dataset.node); if (!n) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); e.stopPropagation();
    if (connectFrom && connectFrom !== n.id) { tryConnect(connectFrom, n.id); setConnectFrom(null); setBanner(); }
    setSel({ kind: 'node', id: n.id }); setRefocus(n.id); renderCanvas(); renderInspector();
    return;
  }
  const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (mv) {
    e.preventDefault();
    const step = e.shiftKey ? 40 : 10;
    n.x = clampX(n.x + mv[0] * step); n.y = clampY(n.y + mv[1] * step);
    setRefocus(n.id); renderCanvas(); save();
  }
});

export function tryConnect(aId, bId) {
  const a = byId(aId), b = byId(bId);
  if (!a || !b || a.id === b.id) return false;
  const key = pairKey(a.type, b.type);
  const ok = OK_PAIRS[key];
  if (!ok) { log(BAD_PAIRS[key] || 'Those two components do not connect in this level.', 'bad'); return false; }
  const from = a.type === ok.from ? a : b, to = a.type === ok.from ? b : a;
  if (S.edges.some(e => e.from === from.id && e.to === to.id)) return false;
  S.edges.push({ id: 'e' + (S.seq++), from: from.id, to: to.id });
  log(`Connected ${TYPES[from.type].name} → ${TYPES[to.type].name} (${ok.label}).`);
  afterDesignChange();
  return true;
}
export function disconnect(aId, bId) {
  S.edges = S.edges.filter(e => !((e.from === aId && e.to === bId) || (e.from === bId && e.to === aId)));
  afterDesignChange();
}

export function removeSel() {
  if (!sel) return;
  if (sel.kind === 'node') {
    const n = byId(sel.id); if (!n || roleOf(n) === 'client') return;
    S.nodes = S.nodes.filter(x => x.id !== n.id);
    S.edges = S.edges.filter(e => e.from !== n.id && e.to !== n.id);
    if (connectFrom === n.id) setConnectFrom(null);
    dropMissingCrashes();
  } else {
    S.edges = S.edges.filter(e => e.id !== sel.id);
  }
  setSel(null); afterDesignChange();
}

document.addEventListener('keydown', (e) => {
  if (S.tab !== 'build') return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  const onCanvas = e.target === document.body || cv.contains(e.target); // not on a button, tab or other control
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel && onCanvas) { e.preventDefault(); removeSel(); }
  if (e.key === 'Escape') { setConnectFrom(null); setBanner(); select(null); }
  if (e.key === ' ' && e.target === document.body) { e.preventDefault(); togglePlay(); }
});
