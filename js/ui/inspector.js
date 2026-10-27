// Inspector panel for the selected component or connection.
import { fmt } from '../format.js';
import { $, el, keepFocus } from '../dom.js';
import { TYPES, OK_PAIRS, pairKey, nameOf, lowerName, edgeInfo, MISSIONS, S, sel, run, byId, setSel, trafficHidden } from '../state.js';
import { T, COMPONENTS, roleOf, runsAlone, serverSpec, sizesOf, choiceOf } from '../engine/components.js';
import { tryConnect, disconnect, removeSel, promote } from '../engine/interaction.js';
import { log } from './log.js';
import { afterDesignChange } from '../main.js';
import { trafficFactor, downIds } from '../engine/experiments.js';
import { isStandby } from '../engine/model.js';

export function renderInspector() {
  keepFocus($('insp'), buildInspector, () => { const b = $('insp'); b.tabIndex = -1; return b; });
}
function buildInspector() {
  const box = $('insp'); box.textContent = '';
  box.appendChild(el('p', 'label', 'Inspector'));
  if (sel && sel.kind === 'node' && !byId(sel.id)) setSel(null);
  if (sel && sel.kind === 'edge' && !S.edges.some(x => x.id === sel.id)) setSel(null);
  if (!sel) {
    box.appendChild(el('p', 'empty', 'Select a component on the canvas (click it, or Tab to it and press Enter) to see what it does, change its size and manage its connections.'));
    return;
  }
  if (sel.kind === 'edge') {
    const e = S.edges.find(x => x.id === sel.id);
    const a = byId(e.from), b = byId(e.to), info = edgeInfo(a, b);
    box.appendChild(el('h2', null, `${nameOf(a)} → ${nameOf(b)}`));
    box.appendChild(el('p', 'desc', info.desc));
    const rm = el('button', 'btn danger', 'Remove connection'); rm.type = 'button'; rm.dataset.focusKey = 'remove'; rm.onclick = removeSel;
    box.appendChild(rm); return;
  }
  const n = byId(sel.id);
  const role = COMPONENTS[n.type].replicated && TYPES[n.type].roles && TYPES[n.type].roles[n.role];
  box.appendChild(el('h2', null, nameOf(n)));
  box.appendChild(el('p', 'desc', role ? role.desc : TYPES[n.type].desc));
  if (role && n.role === 'replica') {
    const down = downIds().has(n.id);
    const b = el('button', 'btn', 'Promote to primary'); b.type = 'button'; b.dataset.focusKey = 'promote';
    b.disabled = down;
    b.onclick = () => promote(n);
    box.appendChild(b);
    box.appendChild(el('p', 'kind-note', down ? TYPES[n.type].downNote : TYPES[n.type].promoteNote));
  }
  if (COMPONENTS[n.type].kinds && TYPES[n.type].kinds) {
    box.appendChild(el('p', 'label', TYPES[n.type].kindsLabel));
    const seg = el('div', 'seg two');
    for (const kind of TYPES[n.type].kinds) {
      const b = el('button'); b.type = 'button'; b.dataset.focusKey = 'kind-' + kind.id; b.setAttribute('aria-pressed', n.kind === kind.id ? 'true' : 'false');
      b.innerHTML = `<b>${kind.name}</b><span>${kind.sub}</span>`;
      b.onclick = () => { n.kind = kind.id; afterDesignChange(); log(kind.log, kind.tone); };
      seg.appendChild(b);
    }
    box.appendChild(seg);
    const chosen = TYPES[n.type].kinds.find(k => k.id === n.kind);
    box.appendChild(el('p', 'kind-note', chosen ? chosen.note : TYPES[n.type].unsetNote));
  }
  if (COMPONENTS[n.type].algos && TYPES[n.type].algos) {
    box.appendChild(el('p', 'label', TYPES[n.type].algosLabel));
    const seg = el('div', 'seg stack');
    const current = n.algo || COMPONENTS[n.type].defaultAlgo;
    for (const algo of TYPES[n.type].algos) {
      const b = el('button'); b.type = 'button'; b.dataset.focusKey = 'algo-' + algo.id; b.setAttribute('aria-pressed', current === algo.id ? 'true' : 'false');
      b.innerHTML = `<b>${algo.name}</b><span>${algo.sub}</span>`;
      b.onclick = () => { n.algo = algo.id; afterDesignChange(); log(algo.log); };
      seg.appendChild(b);
    }
    box.appendChild(seg);
    box.appendChild(el('p', 'kind-note', TYPES[n.type].algos.find(a => a.id === current).note));
    if (isStandby(n) && TYPES[n.type].standbyNote) box.appendChild(el('p', 'kind-note', TYPES[n.type].standbyNote));
  }
  // Settings the level offers for this component (e.g. a cache's TTL), in the order the level lists them.
  for (const ch of (COMPONENTS[n.type].choices && TYPES[n.type].choices) || []) {
    box.appendChild(el('p', 'label', ch.label));
    const seg = el('div', 'seg stack');
    const current = choiceOf(n, ch.key);
    for (const opt of ch.options) {
      const b = el('button'); b.type = 'button'; b.dataset.focusKey = ch.key + '-' + opt.id; b.setAttribute('aria-pressed', current === opt.id ? 'true' : 'false');
      b.innerHTML = `<b>${opt.name}</b><span>${opt.sub}</span>`;
      b.onclick = () => { n[ch.key] = opt.id; afterDesignChange(); log(opt.log); };
      seg.appendChild(b);
    }
    box.appendChild(seg);
    box.appendChild(el('p', 'kind-note', ch.options.find(o => o.id === current).note));
  }
  if (COMPONENTS[n.type].sized) {
    const SIZES = sizesOf(n.type), mem = (k) => SIZES[k].mem;
    box.appendChild(el('p', 'label', mem('S') ? 'Memory (scale up)' : 'Server size (scale up)'));
    const seg = el('div', 'seg');
    for (const k of Object.keys(SIZES)) {
      const b = el('button'); b.type = 'button'; b.dataset.focusKey = 'size-' + k; b.setAttribute('aria-pressed', n.size === k ? 'true' : 'false');
      const what = mem(k) ? `${mem(k)} GB` : `${fmt(SIZES[k].cap)}/s`;
      b.innerHTML = `<b>${k}</b> <span>${what}</span><br><span>$${SIZES[k].cost}</span>`;
      b.title = mem(k) ? `${mem(k)} GB memory · $${SIZES[k].cost}/month` : `${SIZES[k].cpu} vCPU · ${fmt(SIZES[k].cap)} requests/s · $${SIZES[k].cost}/month`;
      b.setAttribute('aria-label', `${k} ${what}, $${SIZES[k].cost} a month`);
      b.onclick = () => { n.size = k; afterDesignChange(); };
      seg.appendChild(b);
    }
    box.appendChild(seg);
    if (runsAlone(n)) box.appendChild(el('p', 'kind-note', TYPES[n.type].noDbNote));
  }
  if (roleOf(n) === 'server') {
    const live = el('div', 'live'); live.id = 'inspLive'; box.appendChild(live);
    paintInspectorLive();
  }
  if (roleOf(n) === 'client') {
    const M0 = MISSIONS[S.mission], hid = trafficHidden(M0);
    const live = el('div', 'live');
    live.innerHTML = `<div><b>${hid ? '?' : fmt(M0.qps * trafficFactor())}</b><span>req/s at peak</span></div><div><b>${T.rtt} ms</b><span>internet round trip</span></div>`;
    box.appendChild(live);
  }
  // connections (keyboard- and touch-friendly alternative to dragging)
  const partners = S.nodes.filter(m => m.id !== n.id && OK_PAIRS[pairKey(n.type, m.type)]);
  if (partners.length) {
    box.appendChild(el('p', 'label', 'Connections'));
    const list = el('div', 'conns');
    for (const m of partners) {
      const ok = OK_PAIRS[pairKey(n.type, m.type)];
      const from = n.type === ok.from ? n : m, to = n.type === ok.from ? m : n;
      const linked = S.edges.some(e => e.from === from.id && e.to === to.id);
      const row = el('div', 'conn');
      row.appendChild(el('span', null, `${nameOf(from)} → ${nameOf(to)}`));
      const b = el('button', 'btn sm' + (linked ? ' danger' : ''), linked ? 'Disconnect' : 'Connect'); b.type = 'button'; b.dataset.focusKey = 'conn-' + m.id;
      b.onclick = () => { if (linked) { disconnect(from.id, to.id); log(`Disconnected ${nameOf(from)} → ${nameOf(to)}.`); } else tryConnect(from.id, to.id); };
      row.appendChild(b); list.appendChild(row);
    }
    box.appendChild(list);
  }
  if (roleOf(n) !== 'client') {
    const rm = el('button', 'btn danger', 'Remove ' + lowerName(n)); rm.type = 'button'; rm.dataset.focusKey = 'remove'; rm.onclick = removeSel;
    box.appendChild(rm);
  }
}
export function paintInspectorLive() {
  const live = $('inspLive'); if (!live || !sel || sel.kind !== 'node') return;
  const n = byId(sel.id); if (!n || roleOf(n) !== 'server') return;
  const st = run.mdl && run.everPlayed ? run.mdl.node[n.id] : null;
  if (!st) { live.innerHTML = `<div><b>${fmt(serverSpec(n).cap)}</b><span>capacity, per second</span></div><div><b>—</b><span>press Play for load</span></div>`; return; }
  if (st.standby) { live.innerHTML = `<div><b>standby</b><span>takes no traffic</span></div><div><b>${fmt(st.cap)}</b><span>capacity, ready to take over</span></div>`; return; }
  if (st.down) { live.innerHTML = `<div><b style="color:var(--bad)">down</b><span>serving nothing</span></div><div><b>0</b><span>req/s served</span></div>`; return; }
  if (st.hit != null) {
    live.innerHTML = `<div><b>${fmt(st.load)}</b><span>reads arriving, per second</span></div><div><b>${Math.round(st.hit * 100)}%</b><span>hit rate</span></div>`
      + `<div><b>${fmt(st.misses)}</b><span>misses/s sent to the database</span></div><div><b>${st.ms.toFixed(1)} ms</b><span>per lookup</span></div>`;
    return;
  }
  const pct = Math.round(st.util * 100);
  const col = st.load > st.cap * 1.005 ? 'var(--bad)' : st.util >= 0.8 ? 'var(--warn)' : 'var(--ok)';
  live.innerHTML = `<div><b>${fmt(st.load)}</b><span>${st.unit} arriving</span></div><div><b>${fmt(st.cap)}</b><span>capacity${st.combined ? ' (code + data)' : ''}</span></div><div><b style="color:${col}">${pct}%</b><span>busy</span></div><div><b>${st.ms.toFixed(st.ms < 10 ? 1 : 0)} ms</b><span>per request (${st.mult.toFixed(1)}× base)</span></div>`
    + (st.copied ? `<div class="wide"><b>${fmt(st.load - st.copied)} + ${fmt(st.copied)}</b><span>reads + writes copied from the primary</span></div>` : '');
}
