// The inspector's view of a cache cluster: its hash ring (or hash % N) and each server's share of the keys.
import { el } from '../dom.js';
import { hashMethod, clusterLayout } from '../engine/components.js';
import { ringPoints } from '../engine/hashring.js';
import { resizeBy } from '../engine/experiments.js';

const pct = (x) => (100 * x).toFixed(1) + '%';

/** An empty box the live paint fills; call paintRing to draw into it. */
export function ringBox() { const d = el('div', 'ring-view'); d.id = 'ringView'; return d; }

/** Draw the cluster as it is now (resized while an experiment adds or removes a server). Skips work if unchanged. */
export function paintRing(n) {
  const box = document.getElementById('ringView'); if (!box) return;
  const method = hashMethod(n), resize = resizeBy(), lay = clusterLayout(n, resize);
  const key = `${method.mod ? 'mod' : method.vnodes}|${lay.names.join('')}|${resize}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const added = resize > 0 ? lay.names.at(-1) : null;
  let svg = '';
  if (!method.mod) {
    const pts = ringPoints(lay.names, method.vnodes), R = 70, c = 90;
    const at = (p, r) => { const a = 2 * Math.PI * p / 2 ** 32 - Math.PI / 2; return [(c + r * Math.cos(a)).toFixed(1), (c + r * Math.sin(a)).toFixed(1)]; };
    const ticks = pts.map(([p, s]) => { const [x1, y1] = at(p, R - 7), [x2, y2] = at(p, R + 7); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${s === added ? 'tick new' : 'tick'}"/>`; }).join('');
    const labels = method.vnodes === 1 ? pts.map(([p, s]) => { const [x, y] = at(p, R + 17); return `<text x="${x}" y="${y}" class="lbl">${s}</text>`; }).join('') : '';
    const ariaShares = lay.names.map((s) => `${s} ${pct(lay.shares[s])}`).join(', ');
    svg = `<svg viewBox="0 0 180 180" role="img" aria-label="Hash ring with ${lay.names.length} servers, ${method.vnodes} ${method.vnodes === 1 ? 'point' : 'points'} each. Shares of the keys: ${ariaShares}."><circle cx="${c}" cy="${c}" r="${R}" class="ring"/>${ticks}${labels}</svg>`;
  } else {
    svg = `<p class="kind-note">No ring: hash(key) % ${lay.names.length} picks the server.</p>`;
  }
  const max = Math.max(...lay.names.map((s) => lay.shares[s]));
  const bars = lay.names.map((s) => `<div class="row"><b>${s}</b><span class="bar"><i style="width:${(100 * lay.shares[s] / max).toFixed(1)}%"${s === added ? ' class="new"' : ''}></i></span><span>${pct(lay.shares[s])}</span></div>`).join('');
  const note = resize < 0 ? `Server C is gone: ${pct(lay.moved)} of keys moved.` : resize > 0 ? `Server ${added} joined: ${pct(lay.moved)} of keys moved.` : '';
  box.innerHTML = `${svg}<div class="ring-bars" aria-label="Share of the keys on each server">${bars}</div>${note ? `<p class="kind-note">${note}</p>` : ''}`;
}
