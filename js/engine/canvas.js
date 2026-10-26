// Canvas rendering and layout.
import { fmt } from '../format.js';
import { $, svgEl } from '../dom.js';
import { TYPES, OK_PAIRS, pairKey, S, sel, connectFrom, refocus, run, byId, setRefocus } from '../state.js';
import { SIZES, COMPONENTS, runsAlone } from './components.js';
import { drawIcon } from './icons.js';
import { crashing } from './experiments.js';
import { isStandby } from './model.js';

export const VW = 760, VH = 520;
export let NW = 188, NH = 60, compact = false, curView = null;

export const cv = $('cv'), nodesG = $('nodesG'), edgesG = $('edgesG'), dotsG = $('dotsG'), tagsG = $('tagsG'), previewLine = $('previewLine');
export const nodeRefs = {};

export function nodeSub(n) {
  const c = COMPONENTS[n.type];
  if (!c.sized) return c.routing === 'standby' && isStandby(n) ? TYPES[n.type].standbySub : TYPES[n.type].sub;
  if (c.kinds) return n.kind ? `${TYPES[n.type].kinds.find(k => k.id === n.kind).short} · ${n.size} ${fmt(SIZES[n.size].cap)}/s` : TYPES[n.type].unsetSub;
  return runsAlone(n) ? `${n.size} · ${fmt(SIZES[n.size].cap * c.alone.capFactor)} req/s (½)` : `${n.size} · ${fmt(SIZES[n.size].cap)} req/s`;
  return '';
}

export function applyMode() {
  const w = cv.parentElement.clientWidth || VW;
  const c = w > 0 && w < 600;
  if (c !== compact) { compact = c; NW = c ? 150 : 188; NH = c ? 48 : 60; curView = null; }
  cv.classList.toggle('compact', compact);
}
export function fitView(force) {
  if (!compact) { cv.setAttribute('viewBox', `0 0 ${VW} ${VH}`); curView = null; return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of S.nodes) { x0 = Math.min(x0, n.x - NW / 2); x1 = Math.max(x1, n.x + NW / 2); y0 = Math.min(y0, n.y - NH / 2 - (n.type === 'users' ? 26 : 0)); y1 = Math.max(y1, n.y + NH / 2 + 20); }
  if (!force && curView && x0 >= curView.x && x1 <= curView.x + curView.w && y0 >= curView.y && y1 <= curView.y + curView.h) return;
  const pad = 14;
  const w = Math.max(360, x1 - x0 + pad * 2), h = Math.max(300, y1 - y0 + pad * 2);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  curView = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) };
  cv.setAttribute('viewBox', `${curView.x} ${curView.y} ${curView.w} ${curView.h}`);
}

export function renderNodes() {
  nodesG.textContent = '';
  for (const k in nodeRefs) delete nodeRefs[k];
  for (const n of S.nodes) {
    const isSel = (sel && sel.kind === 'node' && sel.id === n.id) || connectFrom === n.id;
    const sub = nodeSub(n);
    const g = svgEl('g', { class: 'node' + (isSel ? ' sel' : ''), 'data-node': n.id, tabindex: '0', role: 'button', 'aria-label': `${TYPES[n.type].name}, ${sub}${isSel ? ', selected' : ''}`, transform: `translate(${n.x - NW / 2} ${n.y - NH / 2})` }, nodesG);
    svgEl('rect', { x: 0, y: 0, width: NW, height: NH, rx: 11, class: 'node-box' }, g);
    if (compact) {
      drawIcon(n.type, g, 10, 12, 0.9);
      const name = svgEl('text', { x: 44, y: 29, class: 'node-name' }, g); name.textContent = TYPES[n.type].name;
    } else {
      drawIcon(n.type, g, 12, 18);
      const name = svgEl('text', { x: 52, y: 26, class: 'node-name' }, g); name.textContent = TYPES[n.type].name + ' ';
      const subEl = svgEl('text', { x: 52, y: 43, class: 'node-sub' + (COMPONENTS[n.type].kinds && !n.kind ? ' todo' : '') }, g); subEl.textContent = sub;
    }
    const ubg = svgEl('rect', { x: 12, y: NH - 7, width: NW - 24, height: 3, rx: 1.5, class: 'ubar-bg', visibility: 'hidden' }, g);
    const ub = svgEl('rect', { x: 12, y: NH - 7, width: 0, height: 3, rx: 1.5, class: 'ubar', visibility: 'hidden' }, g);
    const downG = svgEl('g', { visibility: 'hidden' }, g);
    svgEl('path', { d: `M${NW - 26} 10l14 14M${NW - 12} 10l-14 14`, class: 'down-x' }, downG);
    if (!compact) { const dt = svgEl('text', { x: NW - 19, y: 44, class: 'down-t', 'text-anchor': 'middle' }, downG); dt.textContent = 'DOWN'; }
    const h = svgEl('g', { class: 'handle', 'data-handle': n.id, transform: `translate(${NW / 2} ${NH})` }, g);
    svgEl('circle', { r: compact ? 20 : 15, class: 'hhit' }, h);
    svgEl('circle', { r: 9, class: 'hv' }, h);
    svgEl('path', { d: 'M-4 0h8M0 -4v8' }, h);
    const title = svgEl('title', {}, h); title.textContent = 'Drag to connect';
    nodeRefs[n.id] = { g, ub, ubg, downG };
  }
  if (refocus && nodeRefs[refocus]) nodeRefs[refocus].g.focus();
  setRefocus(null);
  paintLive();
}

export function edgePoint(n, tx, ty, pad) {
  const dx = tx - n.x, dy = ty - n.y;
  if (!dx && !dy) return { x: n.x, y: n.y };
  const hw = NW / 2 + pad, hh = NH / 2 + pad;
  const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: n.x + dx * s, y: n.y + dy * s };
}

export function renderEdges() {
  edgesG.textContent = '';
  // Label each kind of connection once per sender and once per receiver, so a pool of servers stays readable.
  // In a group, the label goes on the first connection where it doesn't sit on top of a component.
  const labelled = new Set();
  const covers = (x, y, w, h) => S.nodes.some(n => x < n.x + NW / 2 && x + w > n.x - NW / 2 && y < n.y + NH / 2 + 12 && y + h > n.y - NH / 2);
  const labelOf = (e) => { const a = byId(e.from), b = byId(e.to); const info = a && b && OK_PAIRS[pairKey(a.type, b.type)]; return info ? info.label : null; };
  const shared = (end, id, label) => S.edges.filter(e => e[end] === id && labelOf(e) === label).length;
  for (const e of S.edges) {
    const a = byId(e.from), b = byId(e.to);
    if (!a || !b) continue;
    const p1 = edgePoint(a, b.x, b.y, 2), p2 = edgePoint(b, a.x, a.y, 5);
    const isSel = sel && sel.kind === 'edge' && sel.id === e.id;
    const g = svgEl('g', { class: 'edge' + (isSel ? ' sel' : ''), 'data-edge': e.id }, edgesG);
    svgEl('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'edge-line', 'marker-end': isSel ? 'url(#arrSel)' : 'url(#arr)' }, g);
    svgEl('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'edge-hit' }, g);
    const info = OK_PAIRS[pairKey(a.type, b.type)];
    if (!info) continue;
    const fromKey = `from ${a.id} ${info.label}`, toKey = `to ${b.id} ${info.label}`;
    if (labelled.has(fromKey) || labelled.has(toKey)) continue;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const w = info.label.length * (compact ? 8 : 6.7) + 8, h = compact ? 18 : 16;
    const horiz = Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y);
    const lx = horiz ? mx - w / 2 : mx + 6, ly = horiz ? my - 24 : my - 9;
    const inGroup = shared('from', a.id, info.label) > 1 || shared('to', b.id, info.label) > 1;
    if (inGroup && covers(lx, ly, w, h)) continue; // try the next connection in the group
    labelled.add(fromKey); labelled.add(toKey);
    svgEl('rect', { x: lx, y: ly, width: w, height: h, rx: 4, class: 'edge-label-bg' }, g);
    const t = svgEl('text', { x: lx + 4, y: ly + (compact ? 14 : 12), class: 'edge-label' }, g); t.textContent = info.label;
  }
}

export function renderCanvas(force) { applyMode(); fitView(!!force); renderEdges(); renderNodes(); }
window.addEventListener('resize', () => { if (S.tab === 'build') renderCanvas(true); });

export function paintLive() {
  const m = run.mdl;
  for (const n of S.nodes) {
    const ref = nodeRefs[n.id]; if (!ref) continue;
    const st = m && run.everPlayed ? m.node[n.id] : null;
    const down = !!(run.everPlayed && m && crashing() && m.down.has(n.id));
    ref.g.classList.toggle('down', down);
    ref.downG.setAttribute('visibility', down ? 'visible' : 'hidden');
    if (st && !st.down) {
      const u = Math.min(1, st.util);
      ref.ubg.setAttribute('visibility', 'visible'); ref.ub.setAttribute('visibility', 'visible');
      ref.ub.setAttribute('width', ((NW - 24) * u).toFixed(1));
      ref.ub.setAttribute('class', 'ubar' + (st.load > st.cap * 1.005 ? ' bad' : st.util >= 0.8 ? ' warn' : ''));
    } else {
      ref.ubg.setAttribute('visibility', 'hidden'); ref.ub.setAttribute('visibility', 'hidden');
    }
  }
}

export const clampX = (x) => Math.max(NW / 2 + 4, Math.min(VW - NW / 2 - 4, x));
export const clampY = (y) => Math.max(NH / 2 + 30, Math.min(VH - NH / 2 - 22, y));
export const overlaps = (x, y, id) => S.nodes.some(n => n.id !== id && Math.abs(n.x - x) < NW + 14 && Math.abs(n.y - y) < NH + 14);
export function freeSpot(x, y, id) {
  if (!overlaps(x, y, id)) return { x, y };
  const sx = NW + 24, sy = NH + 34;
  for (let r = 1; r <= 4; r++) {
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const nx = clampX(x + dx * sx * r), ny = clampY(y + dy * sy * r);
      if (!overlaps(nx, ny, id)) return { x: nx, y: ny };
    }
  }
  return { x, y };
}
