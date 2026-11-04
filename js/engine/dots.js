// Request dots moving along the connections.
import { svgEl } from '../dom.js';
import { TXT, run, byId } from '../state.js';
import { NW, NH, dotsG, tagsG, edgePoint } from './canvas.js';
import { roleOf } from './components.js';

export let dots = [];

export function spawn(route, kind, failAt) {
  const c = svgEl('circle', { r: 4.3, class: 'dot ' + kind, cx: -20, cy: -20 }, dotsG);
  const jx = (Math.random() - 0.5) * 18, jy = (Math.random() - 0.5) * 8;
  const turn = Math.floor((route.length - 1) / 2);
  const d = { c, route, i: 0, t: 0, dur: 0.4, dwell: 0, kind, failAt, turn, dead: 0, jx, jy, jit: false, x: 0, y: 0 };
  d.dur = segDur(d);
  dots.push(d);
  return d;
}
export function segDur(d) {
  const a = byId(d.route[d.i]), b = byId(d.route[d.i + 1]);
  if (!a || !b) return 0.3;
  return Math.max(0.28, Math.hypot(b.x - a.x, b.y - a.y) / 360);
}
export function dwellFor(id, forward) {
  const n = byId(id); if (!n) return 0;
  if (roleOf(n) === 'resolver') return 0.25;
  if (!forward) return 0.02;
  const st = run.mdl && run.mdl.node[id];
  if (!st) return 0.05;
  return Math.min(1.4, 0.06 * (st.mult || 1));
}
export function showIpTag(n) {
  tagsG.textContent = '';
  const g = svgEl('g', { class: 'ip-tag', transform: `translate(${n.x - NW / 2} ${n.y - NH / 2 - 26})` }, tagsG);
  svgEl('rect', { x: 0, y: 0, width: 168, height: 20, rx: 5 }, g);
  const t = svgEl('text', { x: 8, y: 14 }, g); t.textContent = TXT.ipTag;
  setTimeout(() => { if (g.parentNode) g.remove(); }, 2600);
}

const ease = (f) => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);

// Draw a dot where its route and progress put it, from the components' current positions. A moving dot is on its
// current connection; a dot resting at a component or failing sits at the end of the connection it just finished,
// nudged by its jitter so a queue of dots stays visible.
function placeDot(d) {
  const atNode = d.dead || d.dwell > 0;
  const j = atNode ? d.i - 1 : d.i;
  const a = byId(d.route[j]), b = byId(d.route[j + 1]);
  if (!a || !b) return;
  const e = atNode ? 1 : ease(Math.min(1, d.t / d.dur));
  const p1 = edgePoint(a, b.x, b.y, 0), p2 = edgePoint(b, a.x, a.y, 0);
  d.x = p1.x + (p2.x - p1.x) * e; d.y = p1.y + (p2.y - p1.y) * e;
  const rest = !d.dead && d.dwell > 0 && d.jit;
  const ox = d.dead || rest ? d.jx : 0, oy = d.dead ? d.jy * 0.5 : rest ? d.jy : 0;
  d.c.setAttribute('cx', (d.x + ox).toFixed(1)); d.c.setAttribute('cy', (d.y + oy).toFixed(1));
}

// Redraw every dot after components move. The frame loop only runs while playing, so a paused design needs this.
export function placeDots() { for (const d of dots) placeDot(d); }

export function moveDots(dt) {
  for (let k = dots.length - 1; k >= 0; k--) {
    const d = dots[k];
    if (d.dead) {
      d.dead += dt;
      d.c.setAttribute('opacity', Math.max(0, 1 - d.dead / 0.7).toFixed(2));
      d.c.setAttribute('r', (4.3 + d.dead * 4).toFixed(1));
      if (d.dead > 0.7) { d.c.remove(); dots.splice(k, 1); }
      continue;
    }
    const a = byId(d.route[d.i]), b = byId(d.route[d.i + 1]);
    if (!a || !b) { d.c.remove(); dots.splice(k, 1); if (d.onDone) run.dnsFlying = false; continue; }
    if (d.dwell > 0) { d.dwell -= dt; continue; }
    d.t += dt;
    placeDot(d);
    if (d.t >= d.dur) {
      d.i++;
      if (d.i === d.failAt) {
        d.dead = 0.001; d.c.setAttribute('class', 'dot fail');
        placeDot(d);
        continue;
      }
      if (d.i >= d.route.length - 1) { d.c.remove(); dots.splice(k, 1); if (d.onDone) d.onDone(); continue; }
      if (d.i === d.turn && d.kind === 'req') { d.kind = 'res'; d.c.setAttribute('class', 'dot res'); }
      d.dwell = dwellFor(d.route[d.i], d.i <= d.turn);
      d.jit = d.dwell > 0.1;
      if (d.dwell > 0) placeDot(d);
      d.t = 0; d.dur = segDur(d);
    }
  }
}

export function setDots(v) { dots = v; }
