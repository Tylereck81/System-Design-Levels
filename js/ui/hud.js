// Dashboard metrics and the canvas banner.
import { fmt } from '../format.js';
import { $ } from '../dom.js';
import { TARGET_MS, TARGET_SERVED, TYPES, MISSIONS, S, connectFrom, run, byId, setConnectFrom } from '../state.js';
import { model } from '../engine/model.js';
import { crashing, spikeHud } from '../engine/experiments.js';

export function renderHUD() {
  const m = run.mdl || model();
  const M = MISSIONS[S.mission];
  const played = run.everPlayed;
  const hidden = M.gate && !S.est;
  const cells = [
    { l: 'Traffic', v: hidden ? '?' : fmt(m.base), u: 'req/s', t: hidden ? 'estimate first' : (spikeHud() || 'at peak'), s: '' },
    { l: 'Served', v: played ? m.servedPct.toFixed(1) : '—', u: played ? '%' : '', t: `goal ≥ ${TARGET_SERVED}%`, s: played ? (m.servedPct >= TARGET_SERVED ? 'pass' : 'fail') : '' },
    { l: 'Response', v: played && m.latency != null ? fmt(m.latency) : '—', u: played && m.latency != null ? 'ms' : '', t: `goal < ${TARGET_MS} ms`, s: played ? (m.latency != null && m.latency < TARGET_MS ? 'pass' : 'fail') : '' },
    { l: 'Cost', v: '$' + fmt(m.cost), u: '/mo', t: M.budget ? 'budget $' + M.budget : 'no budget', s: M.budget ? (m.cost <= M.budget ? 'pass' : 'fail') : '' },
    { l: 'SPOFs', v: String(m.spof), u: '', t: 'no redundancy', s: '' },
  ];
  $('hud').innerHTML = cells.map(c => `<div class="metric ${c.s}"><p class="label">${c.l}</p><div class="mv">${c.v}<small>${c.u}</small></div><div class="mt" title="${c.t}">${c.t}</div></div>`).join('');
}

export function setBanner() {
  const b = $('banner');
  if (connectFrom && !byId(connectFrom)) setConnectFrom(null);
  if (connectFrom) { b.className = 'banner info'; b.textContent = `Tap another component to connect it to ${TYPES[byId(connectFrom).type].name}. Press Esc to cancel.`; b.hidden = false; return; }
  const m = run.mdl;
  if (run.playing && m && m.issue && !crashing()) { b.className = 'banner'; b.textContent = m.issue; b.hidden = false; return; }
  b.hidden = true;
}
