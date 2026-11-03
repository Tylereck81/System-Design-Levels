// Inspector panel for the selected component or connection.
import { fmt } from '../format.js';
import { $, el, keepFocus } from '../dom.js';
import { TYPES, OK_PAIRS, pairKey, nameOf, lowerName, edgeInfo, MISSIONS, S, sel, run, byId, setSel, trafficHidden } from '../state.js';
import { T, COMPONENTS, roleOf, runsAlone, holdsSessions, scales, dayCopies, serverSpec, sizesOf, choiceOf, isEdge, isClustered, costOf, monthlyFileGB } from '../engine/components.js';
import { ringBox, paintRing } from './ring-view.js';
import { tryConnect, disconnect, removeSel, promote } from '../engine/interaction.js';
import { log } from './log.js';
import { afterDesignChange } from '../main.js';
import { trafficFactor, downIds } from '../engine/experiments.js';
import { graph, isStandby } from '../engine/model.js';

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
    box.appendChild(el('p', 'label', TYPES[n.type].sizeLabel || (mem('S') ? 'Memory (scale up)' : 'Server size (scale up)')));
    const seg = el('div', 'seg');
    for (const k of Object.keys(SIZES)) {
      const b = el('button'); b.type = 'button'; b.dataset.focusKey = 'size-' + k; b.setAttribute('aria-pressed', n.size === k ? 'true' : 'false');
      const what = TYPES[n.type].sizeWhat ? TYPES[n.type].sizeWhat(SIZES[k]) : mem(k) ? `${mem(k)} GB` : `${fmt(SIZES[k].cap)}/s`;
      b.innerHTML = `<b>${k}</b> <span>${what}</span><br><span>$${fmt(SIZES[k].cost)}</span>`;
      b.title = TYPES[n.type].sizeWhat ? `${what} · $${fmt(SIZES[k].cost)}/month` : mem(k) ? `${mem(k)} GB memory · $${fmt(SIZES[k].cost)}/month` : SIZES[k].cpu ? `${SIZES[k].cpu} vCPU · ${fmt(SIZES[k].cap)} requests/s · $${fmt(SIZES[k].cost)}/month` : `${fmt(SIZES[k].cap)}/s · $${fmt(SIZES[k].cost)}/month`;
      b.setAttribute('aria-label', `${k} ${what}, $${fmt(SIZES[k].cost)} a month`);
      b.onclick = () => { n.size = k; afterDesignChange(); };
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
    live.innerHTML = `<div><b>${hid ? '?' : fmt(M0.qps * trafficFactor())}</b><span>req/s at peak</span></div>`
      + (rg ? `<div><b>${T.rtt} ms</b><span>round trip, ${rg.near} (${Math.round(100 * (1 - M0.far))}%)</span></div><div><b>${T.far} ms</b><span>round trip, ${rg.far} (${Math.round(100 * M0.far)}%)</span></div>`
        : `<div><b>${T.rtt} ms</b><span>internet round trip</span></div>`);
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
  if (isClustered(n)) paintRing(n); // it changes while an experiment adds or removes a server
  const st = run.mdl && run.everPlayed ? run.mdl.node[n.id] : null;
  if (!st && scales(n)) {
    // An autoscaled group: what it costs, and how many servers it runs over a day, from its load at the peak.
    const w = graph().peak.get(n.id) || 0, k = dayCopies(w, serverSpec(n).cap);
    live.innerHTML = `<div><b>$${fmt(costOf(n, w))}</b><span>a month, paid by the hour</span></div><div><b>${Math.min(...k)} to ${Math.max(...k)}</b><span>servers over a day</span></div>`;
    return;
  }
  if (!st && isEdge(n)) { live.innerHTML = `<div><b>$${fmt(costOf(n))}</b><span>a month, for ${fmt(monthlyFileGB() / 1000)} TB sent</span></div><div><b>—</b><span>press Play for load</span></div>`; return; }
  if (!st) { live.innerHTML = `<div><b>${fmt(serverSpec(n).cap)}</b><span>capacity, per second</span></div><div><b>—</b><span>press Play for load</span></div>`; return; }
  if (st.standby) { live.innerHTML = `<div><b>standby</b><span>takes no traffic</span></div><div><b>${fmt(st.cap)}</b><span>capacity, ready to take over</span></div>`; return; }
  if (st.down) { live.innerHTML = `<div><b style="color:var(--bad)">down</b><span>serving nothing</span></div><div><b>0</b><span>req/s served</span></div>`; return; }
  if (st.consumer) {
    // A worker group: jobs in and out, and what waits in its queue.
    live.innerHTML = `<div><b>${st.load.toFixed(2)}</b><span>jobs/s arriving</span></div><div><b>${st.cap.toFixed(2)}</b><span>jobs/s it can take</span></div>`
      + `<div><b>${Math.round(st.util * 100)}%</b><span>busy</span></div><div><b>${fmt(st.backlog)}</b><span>jobs waiting in the queue</span></div>`
      + (st.copies ? `<div class="wide"><b>${st.copies} ${st.copies === 1 ? 'server' : 'servers'} now</b><span>of size ${n.size}</span></div>` : '');
    return;
  }
  if (st.ids) {
    // An ID generator: IDs asked for and what it can make, what its IDs look like, and repeats.
    const x = st.ids, col = st.load > st.cap * 1.005 ? 'var(--bad)' : 'var(--ok)';
    live.innerHTML = `<div><b>${fmt(st.load)}</b><span>IDs/s asked for</span></div>`
      + (x.method === 'uuid' ? '<div><b>no limit</b><span>made in each web server</span></div>' : `<div><b style="color:${col}">${fmt(st.cap)}</b><span>IDs/s on ${x.healthy} ${x.healthy === 1 ? 'server' : 'servers'}</span></div>`)
      + `<div class="wide"><b>${x.bits} bits</b><span>${x.numeric ? 'a number' : 'written as hex digits and dashes'}, ${x.ordered ? 'in time order' : 'not in time order'}</span></div>`
      + (x.dup > 0 ? `<div class="wide"><b style="color:var(--bad)">${(100 * x.dup).toFixed(0)}%</b><span>of IDs repeat one already made</span></div>` : '');
    return;
  }
  if (st.hit != null) {
    // A cache's words by default; a level can word them for another type (e.g. a CDN's files and origin).
    const w = { arriving: 'reads arriving, per second', misses: 'misses/s sent to the database', per: 'per lookup', ...TYPES[n.type].live };
    live.innerHTML = `<div><b>${fmt(st.load)}</b><span>${w.arriving}</span></div><div><b>${Math.round(st.hit * 100)}%</b><span>hit rate</span></div>`
      + `<div><b>${fmt(st.misses)}</b><span>${w.misses}</span></div><div><b>${st.ms.toFixed(1)} ms</b><span>${w.per}</span></div>`;
    return;
  }
  const pct = Math.round(st.util * 100);
  const col = st.load > st.cap * 1.005 ? 'var(--bad)' : st.util >= 0.8 ? 'var(--warn)' : 'var(--ok)';
  live.innerHTML = `<div><b>${fmt(st.load)}</b><span>${st.files ? `${st.unit} of work` : `${st.unit} arriving`}</span></div><div><b>${fmt(st.cap)}</b><span>capacity${st.combined ? ' (code + data)' : ''}</span></div><div><b style="color:${col}">${pct}%</b><span>busy</span></div><div><b>${st.ms.toFixed(st.ms < 10 ? 1 : 0)} ms</b><span>per request (${st.mult.toFixed(1)}× base)</span></div>`
    + (st.copied ? `<div class="wide"><b>${fmt(st.load - st.copied)} + ${fmt(st.copied)}</b><span>reads + writes copied from the primary</span></div>` : '')
    + (st.files ? `<div class="wide"><b>${fmt(st.pages)} + ${fmt(st.files)}</b><span>pages + files arriving per second. A file takes ${fmt(100 * serverSpec(n).filePer)}% of a page's work.</span></div>` : '')
    + (st.copies ? `<div class="wide"><b>${st.copies} ${st.copies === 1 ? 'server' : 'servers'} now</b><span>of size ${n.size}, each at most ${Math.round(100 * T.scaleAt)}% busy</span></div>` : '')
    + (st.limiter ? `<div class="wide"><b>${fmt(st.bots)} → ${fmt(st.botPass)}</b><span>bot requests/s arriving → let through</span></div>` : '')
    + (st.limiter && st.falseBlock > 0 ? `<div class="wide"><b style="color:var(--bad)">${Math.round(st.falseBlock * 100)}%</b><span>of real users' requests rejected: their bursts don't fit</span></div>` : '')
    + (st.limiter && st.waitMs > 0 ? `<div class="wide"><b>${(st.waitMs / 1000).toFixed(1)} s</b><span>a real request waits in the queue, on average</span></div>` : '')
    + (st.kv ? `<div class="wide"><b>${st.kv.readMs} ms · ${st.kv.writeMs} ms</b><span>a read waits for ${st.kv.R} of ${st.kv.N} replicas, a write for ${st.kv.W}</span></div><div class="wide"><b${st.kv.stale > 0 ? ' style="color:var(--warn)"' : ''}>${(100 * st.kv.stale).toFixed(1)}%</b><span>of reads return an old value</span></div>` : '')
    + (st.kv && st.kv.failed > 0 ? `<div class="wide"><b style="color:var(--bad)">${(100 * st.kv.failed).toFixed(0)}%</b><span>of requests fail: no quorum on their side of the partition</span></div>` : '')
    + (st.typeahead && st.typeahead.shards && COMPONENTS[n.type].typeahead === 'trie' ? `<div class="wide"><b>${Math.round(100 * st.typeahead.topShare)}%</b><span>of lookups on the busiest of ${st.typeahead.shards} ${st.typeahead.shards === 1 ? 'shard' : 'shards'}: ${fmt(st.typeahead.shardLoad)} a second</span></div><div class="wide"><b>${st.typeahead.staleH} h</b><span>until a new trending search can show up</span></div>` : '')
    + (st.chat ? `<div class="wide"><b>${st.chat.delay < 1 ? fmt(st.chat.delay * 1000) + ' ms' : st.chat.delay.toFixed(1) + ' s'}</b><span>for a message to arrive, by ${{ poll: 'polling', long: 'long polling', ws: 'WebSocket' }[st.chat.protocol]}</span></div><div class="wide"><b>${st.chat.memoryGB.toFixed(1)} GB</b><span>of connections on each chat server (8 GB each)</span></div>` : '')
    + (st.feed ? `<div class="wide"><b>${fmt(st.feed.writes)}</b><span>feed cache writes a second (fanout), ${fmt(st.feed.cacheGB)} GB cached</span></div><div class="wide"><b${st.feed.lag > 5 ? ' style="color:var(--bad)"' : ''}>${st.feed.lag === Infinity ? 'never' : fmt(st.feed.lag) + ' s'}</b><span>for a post to reach friends' feeds</span></div>` : '')
    + (st.notify ? `<div class="wide"><b>${st.notify.workers} workers</b><span>${st.notify.perChannel ? 'split over a queue per channel' : 'all on one shared queue'}${st.notify.retry ? ', with a notification log' : ''}</span></div>` : '')
    + (st.notify && st.notify.lost > 0 ? `<div class="wide"><b style="color:var(--bad)">${(100 * st.notify.lost).toFixed(0)}%</b><span>of notifications lost</span></div>` : '')
    + (st.notify && st.notify.dup > 0 ? `<div class="wide"><b style="color:var(--warn)">${(100 * st.notify.dup).toFixed(0)}%</b><span>sent twice</span></div>` : '')
    + (st.notify && st.notify.waiting > 0 ? `<div class="wide"><b>${(100 * st.notify.waiting).toFixed(0)}%</b><span>waiting in the SMS queue for a retry</span></div>` : '')
    + (st.crawl ? `<div class="wide"><b>${st.crawl.count} × ${fmt(st.crawl.per)}</b><span>machines × pages/s each${st.crawl.dnsCache ? ', with a DNS cache' : ': DNS lookups one at a time'}</span></div>` : '')
    + (st.crawl && st.crawl.refused > 0 ? `<div class="wide"><b style="color:var(--bad)">${Math.round(100 * st.crawl.refused)}%</b><span>of downloads refused by a flooded host</span></div>` : '')
    + (st.shards ? `<div class="wide"><b>${st.shards.map(x => fmt(x.load)).join(' · ')}</b><span>queries/s on each shard; the busiest sets the % busy</span></div>` : '')
    + (run.queues[n.id] != null ? `<div class="wide"><b>${fmt(run.queues[n.id])} jobs</b><span>waiting for a worker</span></div>` : '')
    + (st.uploads ? `<div class="wide"><b>${st.jobMs != null ? (st.jobMs / 1000).toFixed(0) + ' s' : 'published'}</b><span>per upload${st.jobMs != null ? ', processed here before it answers' : ' to the queue, then answered'}</span></div>` : '')
    + (st.sessionMiss ? `<div class="wide"><b style="color:var(--bad)">${Math.round(100 * st.sessionMiss)}% of pages</b><span>land here without their session and fail: the cart is on another server</span></div>` : '');
}
