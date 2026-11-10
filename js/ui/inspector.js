// Inspector panel for the selected component or connection.
import { fmt } from '../format.js';
import { $, el, keepFocus, html, setHtml, setHtmlIfChanged } from '../dom.js';
import { TYPES, OK_PAIRS, pairKey, nameOf, lowerName, edgeInfo, MISSIONS, S, ui, run, byId, trafficHidden } from '../state.js';
import { T, COMPONENTS, choiceOf, sizesOf } from '../engine/catalog.js';
import { roleOf, runsAlone, holdsSessions, scales, dayCopies, serverSpec, isEdge, isClustered, costOf, monthlyFileGB, kindRows } from '../engine/components.js';
import { ringBox, paintRing } from './ring-view.js';
import { tryConnect, disconnect, removeSel, promote } from '../view/interaction.js';
import { log } from './log.js';
import { hooks } from '../hooks.js';
import { trafficFactor, downIds } from '../engine/experiments.js';
import { graph, isStandby } from '../engine/model.js';

export function renderInspector() {
  keepFocus($('insp'), buildInspector, () => { const b = $('insp'); b.tabIndex = -1; return b; });
}
function buildInspector() {
  const box = $('insp'); box.textContent = '';
  box.appendChild(el('p', 'label', 'Inspector'));
  if (ui.sel?.kind === 'node' && !byId(ui.sel.id)) ui.sel = null;
  if (ui.sel?.kind === 'edge' && !S.edges.some(x => x.id === ui.sel.id)) ui.sel = null;
  if (!ui.sel) {
    box.appendChild(el('p', 'empty', 'Select a component on the canvas (click it, or Tab to it and press Enter) to see what it does, change its size and manage its connections.'));
    return;
  }
  if (ui.sel.kind === 'edge') {
    const e = S.edges.find(x => x.id === ui.sel.id);
    const a = byId(e.from), b = byId(e.to), info = edgeInfo(a, b);
    box.appendChild(el('h2', null, `${nameOf(a)} → ${nameOf(b)}`));
    box.appendChild(el('p', 'desc', info.desc));
    const rm = el('button', 'btn danger', 'Remove connection'); rm.type = 'button'; rm.dataset.focusKey = 'remove'; rm.onclick = removeSel;
    box.appendChild(rm); return;
  }
  const n = byId(ui.sel.id);
  const role = COMPONENTS[n.type].replicated && TYPES[n.type].roles && TYPES[n.type].roles[n.role];
  box.appendChild(el('h2', null, nameOf(n)));
  box.appendChild(el('p', 'desc', role ? role.desc : TYPES[n.type].desc));
  if (isClustered(n)) { box.appendChild(el('p', 'label', 'Where keys land')); box.appendChild(ringBox()); paintRing(n); }
  if (role && n.role === 'replica') {
    const down = downIds().has(n.id);
    const b = el('button', 'btn', 'Promote to primary'); b.type = 'button'; b.dataset.focusKey = 'promote';
    b.disabled = down;
    b.onclick = () => promote(n);
    box.appendChild(b);
    box.appendChild(el('p', 'kind-note', down ? TYPES[n.type].downNote : TYPES[n.type].promoteNote));
  }
  if (COMPONENTS[n.type].kinds && TYPES[n.type].kinds) {
    segmented(box, n, { field: 'kind', label: TYPES[n.type].kindsLabel, layout: 'two', options: TYPES[n.type].kinds, current: n.kind });
    const chosen = TYPES[n.type].kinds.find(k => k.id === n.kind);
    box.appendChild(el('p', 'kind-note', chosen ? chosen.note : TYPES[n.type].unsetNote));
  }
  if (COMPONENTS[n.type].algos && TYPES[n.type].algos) {
    const current = n.algo || COMPONENTS[n.type].defaultAlgo;
    segmented(box, n, { field: 'algo', label: TYPES[n.type].algosLabel, layout: 'stack', options: TYPES[n.type].algos, current });
    box.appendChild(el('p', 'kind-note', TYPES[n.type].algos.find(a => a.id === current).note));
    if (isStandby(n) && TYPES[n.type].standbyNote) box.appendChild(el('p', 'kind-note', TYPES[n.type].standbyNote));
  }
  // Settings the level offers for this component (e.g. a cache's TTL), in the order the level lists them.
  for (const ch of (COMPONENTS[n.type].choices && TYPES[n.type].choices) || []) {
    const current = choiceOf(n, ch.key);
    segmented(box, n, { field: ch.key, label: ch.label, layout: 'stack', options: ch.options, current });
    box.appendChild(el('p', 'kind-note', ch.options.find(o => o.id === current).note));
  }
  if (COMPONENTS[n.type].sized) {
    const SIZES = sizesOf(n.type), mem = (k) => SIZES[k].mem;
    box.appendChild(el('p', 'label', TYPES[n.type].sizeLabel || (mem('S') ? 'Memory (scale up)' : 'Server size (scale up)')));
    const seg = el('div', 'seg');
    for (const k of Object.keys(SIZES)) {
      const b = el('button'); b.type = 'button'; b.dataset.focusKey = 'size-' + k; b.setAttribute('aria-pressed', n.size === k ? 'true' : 'false');
      const what = TYPES[n.type].sizeWhat ? TYPES[n.type].sizeWhat(SIZES[k]) : mem(k) ? `${mem(k)} GB` : `${fmt(SIZES[k].cap)}/s`;
      setHtml(b, html`<b>${k}</b> <span>${what}</span><br><span>$${fmt(SIZES[k].cost)}</span>`);
      b.title = TYPES[n.type].sizeWhat ? `${what} · $${fmt(SIZES[k].cost)}/month` : mem(k) ? `${mem(k)} GB memory · $${fmt(SIZES[k].cost)}/month` : SIZES[k].cpu ? `${SIZES[k].cpu} vCPU · ${fmt(SIZES[k].cap)} requests/s · $${fmt(SIZES[k].cost)}/month` : `${fmt(SIZES[k].cap)}/s · $${fmt(SIZES[k].cost)}/month`;
      b.setAttribute('aria-label', `${k} ${what}, $${fmt(SIZES[k].cost)} a month`);
      b.onclick = () => { n.size = k; hooks.afterDesignChange(); };
      seg.appendChild(b);
    }
    box.appendChild(seg);
    if (runsAlone(n)) box.appendChild(el('p', 'kind-note', TYPES[n.type].noDbNote));
    if (holdsSessions(n) && TYPES[n.type].statefulNote) box.appendChild(el('p', 'kind-note', TYPES[n.type].statefulNote));
  }
  if (roleOf(n) === 'server') {
    const live = el('div', 'live'); live.id = 'inspLive'; box.appendChild(live);
    paintInspectorLive();
  }
  if (roleOf(n) === 'client') {
    const M0 = MISSIONS[S.mission], hid = trafficHidden(M0);
    const live = el('div', 'live');
    // With users near and far from the data center (TYPES.users.regions), show both round trips.
    const rg = M0.far && TYPES[n.type].regions;
    setHtml(live, [html`<div><b>${hid ? '?' : fmt(M0.qps * trafficFactor())}</b><span>req/s at peak</span></div>`,
      rg ? html`<div><b>${T.rtt} ms</b><span>round trip, ${rg.near} (${Math.round(100 * (1 - M0.far))}%)</span></div><div><b>${T.far} ms</b><span>round trip, ${rg.far} (${Math.round(100 * M0.far)}%)</span></div>`
        : html`<div><b>${T.rtt} ms</b><span>internet round trip</span></div>`]);
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
/**
 * A label and one button per option for setting `n[field]`, the `current` one pressed. Picking one sets the field,
 * reruns the design and logs the option's line.
 */
function segmented(box, n, { field, label, layout, options, current }) {
  box.appendChild(el('p', 'label', label));
  const seg = el('div', 'seg ' + layout);
  for (const opt of options) {
    const b = el('button'); b.type = 'button'; b.dataset.focusKey = field + '-' + opt.id; b.setAttribute('aria-pressed', current === opt.id ? 'true' : 'false');
    setHtml(b, html`<b>${opt.name}</b><span>${opt.sub}</span>`);
    b.onclick = () => { n[field] = opt.id; hooks.afterDesignChange(); log(opt.log, opt.tone); };
    seg.appendChild(b);
  }
  box.appendChild(seg);
}

export function paintInspectorLive() {
  const live = $('inspLive'); if (!live || !ui.sel || ui.sel.kind !== 'node') return;
  const n = byId(ui.sel.id); if (!n || roleOf(n) !== 'server') return;
  if (isClustered(n)) paintRing(n); // it changes while an experiment adds or removes a server
  const st = run.mdl && run.everPlayed ? run.mdl.node[n.id] : null;
  setHtmlIfChanged(live, liveRows(n, st).filter(Boolean).map(rowHtml));
}

/** One number and what it means: `tone` colours the number, a `wide` row spans the panel. */
function rowHtml({ value, label, tone, wide }) {
  const b = tone ? html`<b style="color:var(--${tone})">${value}</b>` : html`<b>${value}</b>`;
  return wide ? html`<div class="wide">${b}<span>${label}</span></div>` : html`<div>${b}<span>${label}</span></div>`;
}

const PRESS_PLAY = { value: '—', label: 'press Play for load' };

/** Server `n`'s live rows, from its stat `st` (null before Play). A false entry is skipped. */
function liveRows(n, st) {
  if (!st) return idleRows(n);
  if (st.standby) return [{ value: 'standby', label: 'takes no traffic' }, { value: fmt(st.cap), label: 'capacity, ready to take over' }];
  if (st.down) return [{ value: 'down', label: 'serving nothing', tone: 'bad' }, { value: '0', label: 'req/s served' }];
  const kind = kindRows(n, st);
  if (kind.only) return kind.rows;
  if (st.hit != null) {
    // A cache's words by default; a level can word them for another type (e.g. a CDN's files and origin).
    const w = { arriving: 'reads arriving, per second', misses: 'misses/s sent to the database', per: 'per lookup', ...TYPES[n.type].live };
    return [{ value: fmt(st.load), label: w.arriving }, { value: `${Math.round(st.hit * 100)}%`, label: 'hit rate' },
      { value: fmt(st.misses), label: w.misses }, { value: `${st.ms.toFixed(1)} ms`, label: w.per }];
  }
  const tone = st.load > st.cap * 1.005 ? 'bad' : st.util >= 0.8 ? 'warn' : 'ok';
  return [
    { value: fmt(st.load), label: st.files ? `${st.unit} of work` : `${st.unit} arriving` },
    { value: fmt(st.cap), label: `capacity${st.combined ? ' (code + data)' : ''}` },
    { value: `${Math.round(st.util * 100)}%`, label: 'busy', tone },
    { value: `${st.ms.toFixed(st.ms < 10 ? 1 : 0)} ms`, label: `per request (${st.mult.toFixed(1)}× base)` },
    st.copied && { value: `${fmt(st.load - st.copied)} + ${fmt(st.copied)}`, label: 'reads + writes copied from the primary', wide: true },
    st.files && { value: `${fmt(st.pages)} + ${fmt(st.files)}`, label: `pages + files arriving per second. A file takes ${fmt(100 * serverSpec(n).filePer)}% of a page's work.`, wide: true },
    st.copies && { value: `${st.copies} ${st.copies === 1 ? 'server' : 'servers'} now`, label: `of size ${n.size}, each at most ${Math.round(100 * T.scaleAt)}% busy`, wide: true },
    ...kind.rows,
    run.queues[n.id] != null && { value: `${fmt(run.queues[n.id])} jobs`, label: 'waiting for a worker', wide: true },
    st.uploads && { value: st.jobMs != null ? (st.jobMs / 1000).toFixed(0) + ' s' : 'published', label: `per upload${st.jobMs != null ? ', processed here before it answers' : ' to the queue, then answered'}`, wide: true },
    st.sessionMiss && { value: `${Math.round(100 * st.sessionMiss)}% of pages`, label: 'land here without their session and fail: the cart is on another server', tone: 'bad', wide: true },
  ];
}

/** Before Play: an autoscaled group's cost and servers over a day, a CDN's cost, else the server's capacity. */
function idleRows(n) {
  if (scales(n)) {
    const w = graph().peak.get(n.id) || 0, k = dayCopies(w, serverSpec(n).cap);
    return [{ value: `$${fmt(costOf(n, w))}`, label: 'a month, paid by the hour' }, { value: `${Math.min(...k)} to ${Math.max(...k)}`, label: 'servers over a day' }];
  }
  if (isEdge(n)) return [{ value: `$${fmt(costOf(n))}`, label: `a month, for ${fmt(monthlyFileGB() / 1000)} TB sent` }, PRESS_PLAY];
  return [{ value: fmt(serverSpec(n).cap), label: 'capacity, per second' }, PRESS_PLAY];
}
