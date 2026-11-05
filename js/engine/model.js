// Simulation model: load, latency, failures and cost, for any graph of components.
import { MISSIONS, TXT, PALETTE, S, run, byId, WORKLOAD } from '../state.js';
import { COMPONENTS, T, qmul } from './catalog.js';
import { workloadsAt, trafficShape } from './workloads.js';
import { kindOf, RESULT_DEFAULTS, COMBINE } from './kinds/index.js';
import { clusterLayout } from './kinds/cluster.js';
import { botsOf } from './kinds/limiter.js';
import { roleOf, isServer, isReplica, isCache, isEdge, isStore, isSticky, scales, sessionsOn, holdsSessions, copiesFor, isLocated, isFar, isGeo, replicates, isQueue, isOffload, createQueries, isClustered, clusterHit, hitRate, edgeHit, fallsBack, staleSecs, costOf, serverSpec, splitRule } from './components.js';
import { activeExps, downIds, trafficFactor, uploadFactor, dayShift, resizeBy, expTotal, expFlag, textOf, PEAK } from './experiments.js';

const outs = (id) => S.edges.filter(e => e.from === id).map(e => byId(e.to)).filter(Boolean);
/** The components that connect to `id`. */
const ins = (id) => S.edges.filter(e => e.to === id).map(e => byId(e.from)).filter(Boolean);
/** Servers `n` sends requests to. A connection that copies data between servers of a type that syncs carries none. */
const sendsTo = (n) => outs(n.id).filter(c => isServer(c) && !(c.type === n.type && (COMPONENTS[n.type] || {}).syncs));

/** Downstream servers of a node, grouped by type (peers of the same type share the load). */
export function childGroups(n) {
  const groups = new Map();
  for (const c of sendsTo(n)) {
    if (!groups.has(c.type)) groups.set(c.type, []);
    groups.get(c.type).push(c);
  }
  return [...groups.values()];
}
/** The groups a server hands work to, leaving out its session store (every page reads that first, see storeGroup). */
const depGroups = (n) => childGroups(n).filter(grp => !isStore(grp[0]) && !isQueue(grp[0]) && !isOffload(grp[0]));
/** The store that takes a server's non-relational queries (offload), if it connects to one. */
const offloadGroup = (n) => childGroups(n).find(grp => isOffload(grp[0])) || null;
const nonRelShare = () => MISSIONS[S.mission].nonRel || 0; // share of queries that need no joins
// Bots: a mission's bot = { keys, rate }, API keys each sending `rate` requests a second, on top of the real traffic.
const botRate = () => botsOf(MISSIONS[S.mission]).rate;
const storeGroup = (n) => childGroups(n).find(grp => isStore(grp[0])) || null;
/** The queue a server publishes uploads to, instead of processing them itself. */
const queueGroup = (n) => childGroups(n).find(grp => isQueue(grp[0])) || null;

/** Servers reachable downstream from `start` (following connections to servers only). */
function serversFrom(start) {
  const seen = new Map(), stack = [...start];
  while (stack.length) { const n = stack.pop(); if (seen.has(n.id)) continue; seen.set(n.id, n); stack.push(...outs(n.id).filter(isServer)); }
  return [...seen.values()];
}

export function graph() {
  const users = S.nodes.find(n => roleOf(n) === 'client');
  const uo = users ? outs(users.id) : [];
  const dns = uo.find(n => roleOf(n) === 'resolver') || null;
  // entry: the servers Users send pages to. cdn: the CDNs they fetch files from (only where the level has files).
  const entry = uo.filter(c => isServer(c) && !isEdge(c)), cdn = uo.filter(isEdge);
  const needsDns = PALETTE.some(t => (COMPONENTS[t] || {}).role === 'resolver');
  const cost = S.nodes.reduce((s, n) => s + (scales(n) ? 0 : costOf(n)), 0);
  const ready = entry.length > 0 && (!needsDns || !!dns);
  // Goal helpers. They only count servers on the request path, i.e. reachable from Users.
  const path = serversFrom(entry.concat(cdn));
  const onPath = (type) => path.filter(n => n.type === type);
  const count = (type) => onPath(type).length;
  /** Every server of type `from` on the path reaches a server of type `to` (false when there are none). */
  const everyReaches = (from, to) => {
    const fs = onPath(from);
    return fs.length > 0 && fs.every(n => serversFrom(outs(n.id).filter(isServer)).some(c => c.type === to));
  };
  /** How many servers of type `to` on the path server `n` connects to directly. */
  const reached = (n, to) => outs(n.id).filter(c => c.type === to && path.includes(c)).length;
  const next = (n) => outs(n.id);
  // monitored: the servers a monitoring component watches.
  const monitored = new Set(S.edges.filter(e => roleOf(byId(e.from) || {}) === 'monitor').map(e => e.to));
  const g = { users, dns, hasDNS: !!dns, entry, cdn, needsDns, ready, cost, onPath, count, everyReaches, reached, next, peak: new Map(), monitored };
  // An autoscaled group pays for the servers it runs each hour, so its cost needs its load at the peak (peak).
  if (S.nodes.some(scales)) {
    const scratch = { node: {}, issue: null, staleSecs: 0, fileStaleSecs: 0, noDataPct: 0, lagWrites: 0, queues: {} };
    const M = MISSIONS[S.mission], env = workloadEnv(true), out = workloadsAt(M.qps, M.qps, env); // it ignores experiments
    loadPhase(g, out.qps, 1, new Set(), scratch, null, () => 0, M.uploads || 0, trafficOf(out, env));
    for (const n of S.nodes.filter(scales)) { const w = (scratch.node[n.id] || {}).load || 0; g.peak.set(n.id, w); g.cost += costOf(n, w); }
  }
  return g;
}

/** Replicas that copy `n`'s writes: every replica of its type, when `n` is a primary. */
function replicasOf(n) {
  if (!(COMPONENTS[n.type] || {}).replicated || isReplica(n) || !n.role) return [];
  return S.nodes.filter(c => c.type === n.type && isReplica(c));
}
/** Servers that come after `n`: the ones it sends to, and the replicas that copy its writes. */
const after = (n) => sendsTo(n).concat(replicasOf(n));

/** Every server reachable from Users, in an order where each comes after all servers that send to it. */
function topoOrder(entry) {
  const seen = new Map(), stack = [...entry];
  while (stack.length) { const n = stack.pop(); if (seen.has(n.id)) continue; seen.set(n.id, n); stack.push(...after(n)); }
  const indeg = new Map([...seen.keys()].map(id => [id, 0]));
  for (const n of seen.values()) for (const c of after(n)) indeg.set(c.id, indeg.get(c.id) + 1);
  const order = [], queue = entry.filter(n => indeg.get(n.id) === 0);
  while (queue.length) {
    const n = queue.shift(); if (order.includes(n)) continue; order.push(n);
    for (const c of after(n)) { indeg.set(c.id, indeg.get(c.id) - 1); if (indeg.get(c.id) === 0) queue.push(c); }
  }
  return order; // servers inside a cycle never reach in-degree 0 and are left out, so a bad design cannot hang the loop
}

const standbyRouting = (group) => (COMPONENTS[group[0].type] || {}).routing === 'standby';

/**
 * Split `flow` across a group: healthy peers share it evenly; with none healthy, the dead ones receive it and fail.
 * For a standby-routed type, the first healthy peer takes it all and the others wait.
 * When the sender shares by capacity (a load balancer's weighted or least-connections method), bigger servers get more.
 */
function splitFlow(group, flow, down, sender, w) {
  if (group.some(isReplica)) return splitReadsWrites(group, flow, down, sender, w);
  const healthy = group.filter(c => !down.has(c.id));
  return share(healthy.length ? (standbyRouting(group) ? healthy.slice(0, 1) : healthy) : group, flow, sender);
}
function share(targets, flow, sender) {
  if (targets.length === 1) return [[targets[0], flow]];
  if (splitRule(sender) === 'capacity') {
    const caps = targets.map(c => serverSpec(c).cap), total = caps.reduce((a, b) => a + b, 0);
    return targets.map((c, i) => [c, flow * caps[i] / total]);
  }
  return targets.map(c => [c, flow / targets.length]);
}
/**
 * The environment a workload reads: the design, the mission, and the running experiments (none when `calm`):
 * flag(key) is true while one sets `key`, total(key) adds up a number they set.
 */
function workloadEnv(calm = false) {
  return { nodes: S.nodes, mission: MISSIONS[S.mission], workload: WORKLOAD, flag: calm ? () => false : expFlag, total: calm ? () => 0 : expTotal };
}
/** The share of requests that write: a workload's (a URL shortener's new links), else the mission's. */
const writeShareOf = (shape) => shape.writes ?? (MISSIONS[S.mission].writes || 0);
/**
 * What the load and path passes need from the workloads: their outcomes, the write share and the cache-hot share, and
 * the environment they were worked out in (`env`, see workloadEnv), which the component kinds' steps read too.
 */
const trafficOf = (out, env) => ({ outcomes: out.byField, writes: writeShareOf(out), cacheHot: out.cacheHot, env });
/** splitFlow with the write share `W` filled in when a caller gives none (the scopes that split traffic use this). */
const splitterFor = (W) => (group, flow, down, sender, w = W) => splitFlow(group, flow, down, sender, w);
const fileShare = () => MISSIONS[S.mission].files || 0; // share of requests that are static files (the rest are pages)
const farShare = () => MISSIONS[S.mission].far || 0;    // share of users far from the data center
const uploadShare = () => (MISSIONS[S.mission].uploads || 0) * uploadFactor(); // share of pages that are uploads
/**
 * Where Users send their file requests: to the CDN while it is up. With no CDN, or a down CDN that falls back,
 * to the origin like pages; otherwise to the down CDN, where they fail.
 */
function fileEntry(g, down) {
  if (g.cdn.some(c => !down.has(c.id))) return { group: g.cdn, edge: true };
  if (!g.cdn.length || g.cdn.some(fallsBack)) return { group: g.entry, edge: false };
  return { group: g.cdn, edge: true };
}
/**
 * Where one region's users enter when the entry servers are located (data centers): [server, share, rtt, noData].
 * GeoDNS sends a region to its own healthy servers, or to the healthy ones elsewhere when it has none; plain DNS hands
 * out every address, so the region spreads evenly over all of them, down or not. Away from its own region a request
 * takes the far round trip, and its page needs the data of its region's servers copied there, or it fails.
 */
function regionEntry(g, down, far) {
  const mine = (n) => isFar(n) === far, home = g.entry.filter(mine);
  let to = g.entry;
  if (isGeo(g.dns)) { const up = g.entry.filter(n => !down.has(n.id)), own = up.filter(mine); to = own.length ? own : (up.length ? up : g.entry); }
  return to.map(n => { const away = !mine(n); return [n, 1 / to.length, away ? T.far : T.rtt, away && home.length > 0 && !home.some(h => replicates(h, n))]; });
}
const located = (g) => g.entry.some(isLocated);
const regions = () => [[false, 1 - farShare()], [true, farShare()]].filter(([, sh]) => sh > 0);
/** A flow from Users split over the entry servers: by region when they are located, else evenly. */
function entryFlows(g, flow, down, w) {
  if (!located(g)) return splitFlow(g.entry, flow, down, g.users, w);
  const out = [];
  for (const [far, sh] of regions()) for (const [c, f] of regionEntry(g, down, far)) out.push([c, flow * sh * f]);
  return out;
}

/**
 * A group with replicas: writes go to the primary (with no primary in the group they fail), reads to the healthy
 * replicas, or to the primary when none is healthy. Write shares are tagged so the replicas can copy them.
 */
function splitReadsWrites(group, flow, down, sender, w) {
  const primary = group.find(c => !isReplica(c));
  const replicas = group.filter(isReplica), up = replicas.filter(c => !down.has(c.id));
  const parts = primary && w > 0 ? [[primary, flow * w, 'write']] : [];
  const reads = flow * (1 - w);
  if (up.length) return parts.concat(share(up, reads, sender));
  return parts.concat([[primary && !down.has(primary.id) ? primary : replicas[0], reads]]);
}

/** A sender's cache group and its other groups, when it has caches (cache-aside); null otherwise. */
function cacheSplit(n) {
  const groups = depGroups(n), caches = groups.find(grp => isCache(grp[0]));
  return caches ? { caches, others: groups.filter(grp => grp !== caches) } : null;
}
/** A cache cluster's hit rate now. Right after a resize, every moved key misses once: its new server doesn't hold it yet. */
function clusterReadHit(c) {
  const lay = clusterLayout(c, resizeBy());
  return clusterHit(c, lay.shares) * (1 - lay.moved);
}
/**
 * Cache-aside: reads go to the caches first, keys split evenly over all of them. Each healthy cache answers its
 * hit share; its misses go on to the database after the lookup. A down cache's keys skip it (bypass).
 * Writes skip the caches. Returns the cache parts [cache, reads, hit rate] and the flows that go on.
 */
function cacheAside(caches, flow, down, w, hot) {
  const each = flow * (1 - w) / caches.length, out = { parts: [], writes: flow * w, misses: 0, bypass: 0 };
  for (const c of caches) {
    if (down.has(c.id)) { out.bypass += each; continue; }
    const h0 = isClustered(c) ? clusterReadHit(c) : hitRate(c, caches.length);
    const h = hot ? h0 + (1 - h0) * hot : h0; // keys a workload keeps hot (a viral link) are always cached
    out.parts.push([c, each, h]);
    out.misses += each * (1 - h);
  }
  return out;
}

/**
 * Load: each server serves at most its capacity and passes on only what it served. Fills r.node with each server's
 * state and returns the load and served maps. Autoscaled groups size for the traffic times `sizing` (the hour's
 * traffic, without its wobble). While a day runs, `day` gives this hour's and the last hour's traffic as shares of
 * the peak, so a group that shrinks while holding sessions in memory is caught losing them. `backlog` gives each
 * queue's waiting jobs (none for the monthly cost), and U is the share of pages that are uploads. `traffic` has the
 * workloads' outcomes, the write share, the cache-hot share and their environment (see trafficOf).
 */
function loadPhase(g, qps, sizing, down, r, day, backlog, U, traffic) {
  const W = traffic.writes, outcomes = traffic.outcomes, split = splitterFor(W);
  const load = new Map(), served = new Map(), writes = new Map(), copied = new Map(), hitOf = new Map(), files = new Map(), pool = new Map(), bots = new Map();
  let reads = 0, hits = 0, lost = 0; // reads that went to a cache group and how many it answered; pages whose session was lost
  const add = (m, c, f) => m.set(c.id, (m.get(c.id) || 0) + f);
  const noteIssue = (key) => { r.issue = r.issue || TXT[key] || null; }; // the first problem found explains the design
  /** Servers an autoscaled group runs for `work`, sized for the hour's traffic; 0 when `n` is not autoscaled. */
  const autoscale = (n, work, cap) => (scales(n) ? copiesFor(work * sizing, cap) : 0);
  // What a component kind's step may read and do: the fixed set documented in kinds/index.js.
  const ctx = {
    ...traffic.env, outcomes, writes: W, entry: g.entry, down,
    spec: serverSpec, autoscale, senders: (n) => ins(n.id),
    servedOf: (id) => served.get(id) || 0, backlog, hitRate: (id) => hitOf.get(id) || 0, botLoad: (id) => bots.get(id) || 0,
    groupsOf: (n) => ({ deps: depGroups(n), store: storeGroup(n) }),
    settle(n, s, stat) { served.set(n.id, s); r.node[n.id] = stat; },
    forward(n, flow, groups = depGroups(n)) { for (const grp of groups) for (const [c, f] of split(grp, flow, down, n)) add(load, c, f); },
    report(values, rule = 'set') { for (const [field, v] of Object.entries(values)) r[field] = COMBINE[rule](r[field], v); },
    issue: noteIssue,
  };
  // Sessions: the share of a pool's pages each server receives, the share landing where sessions are shared, and
  // whether the sender keeps each user on one server. A down server that held sessions in memory loses its users' sessions.
  const notePool = (grp, sender, parts, flow, fileFrac) => {
    if (!sessionsOn() || !flow || !(COMPONENTS[grp[0].type] || {}).stateful) return;
    const shared = parts.filter(([c]) => !holdsSessions(c)).reduce((a, [, f]) => a + f, 0) / flow;
    for (const [c, f] of parts) pool.set(c.id, { p: f / flow, shared, sticky: isSticky(sender) });
    for (const [c, f] of split(grp, flow, new Set(), sender)) if (down.has(c.id) && holdsSessions(c)) lost += f * (1 - fileFrac);
  };
  const F = fileShare();
  const pages = F ? qps * (1 - F) : qps, entryParts = entryFlows(g, pages, down, W);
  for (const [c, f] of entryParts) add(load, c, f);
  if (g.entry.length) notePool(g.entry, g.users, entryParts, pages, 0);
  const B = botRate();
  if (B) for (const [c, f] of entryFlows(g, B, down, W)) { add(load, c, f); add(bots, c, f); }
  const fe = F ? fileEntry(g, down) : null;
  if (F) for (const [c, f] of (fe.edge ? split(fe.group, qps * F, down, g.users) : entryFlows(g, qps * F, down, W))) { add(load, c, f); add(files, c, f); }
  if (located(g)) {
    // Pages served away from their region's data fail; when a region's own servers are all down, the others serve it
    // from replicated data, which runs dcLag seconds behind (the writes of those seconds had not arrived yet).
    for (const [far, sh] of regions()) {
      const parts = regionEntry(g, down, far), home = g.entry.filter(n => isFar(n) === far);
      for (const [, f, , noData] of parts) if (noData) r.noDataPct += 100 * sh * f * pages / qps;
      if (home.length && home.every(n => down.has(n.id))) r.lagWrites += parts.filter(p => !p[3] && !down.has(p[0].id)).reduce((a, p) => a + p[1], 0) * pages * sh * W * T.dcLag;
    }
  }
  const order = topoOrder(g.entry.concat(g.cdn));
  for (const n of order) {
    const L = load.get(n.id) || 0;
    if (down.has(n.id)) {
      served.set(n.id, 0);
      r.node[n.id] = { down: true, util: 0, load: L, cap: 0, ms: 0, mult: 1 };
      continue;
    }
    if (L <= 0) {
      // A waiting standby is shown idle; anything else that gets no traffic sits behind a failed component.
      if ((COMPONENTS[n.type] || {}).routing === 'standby') {
        const sp = serverSpec(n);
        r.node[n.id] = { standby: true, load: 0, cap: sp.cap, util: 0, ms: 0, mult: 1, base: sp.base, unit: sp.unit, drop: 0 };
      }
      continue;
    }
    // A kind whose workload is off takes the plain server step below. No level does that today: every level whose
    // palette has such a type turns its workload on, and a mock interview keeps its level's workload.
    const nodeKind = kindOf(n);
    if (nodeKind?.step && (!nodeKind.outcome || outcomes[nodeKind.outcome])) { nodeKind.step(n, L, ctx); continue; }
    const sp = serverSpec(n);
    const Lf = files.get(n.id) || 0, ownFiles = Lf > 0 && sp.filePer != null; // a server that sends files itself
    // Uploads (a share U of its pages): published to its queue as an ordinary request, or processed here.
    const Lj = U > 0 && sp.jobPer != null ? (L - Lf) * U : 0, ownJobs = Lj > 0 && !queueGroup(n);
    const work = (ownFiles ? (L - Lf) * sp.per + Lf * sp.filePer : L * sp.per) + (ownJobs ? Lj * (sp.jobPer - sp.per) : 0);
    const k = autoscale(n, work, sp.cap), cap1 = sp.cap; // an autoscaled group runs k servers of this size
    if (k) sp.cap *= k;
    const u = work / sp.cap, mixed = ownFiles || ownJobs;
    const s = mixed ? (u > 1 ? L / u : L) : Math.min(L, sp.cap / sp.per);
    served.set(n.id, s);
    const mult = sp.flat ? 1 : qmul(u);
    const st = { load: work, cap: sp.cap, util: u, ms: sp.base * mult, mult, base: sp.base, unit: sp.unit, drop: mixed ? 1 - s / L : Math.max(0, 1 - (sp.cap / sp.per) / L) };
    if (ownFiles) Object.assign(st, { pages: L - Lf, files: Lf, fileMs: sp.fileBase * mult });
    if (Lj) { st.uploads = Lj; if (ownJobs) st.jobMs = sp.jobBase * mult; }
    if (k) {
      st.copies = k;
      // A group that holds sessions in memory loses those on the servers it removes as traffic falls.
      if (day && holdsSessions(n)) { const was = copiesFor(work * sizing * day.prev / day.now, cap1); if (was > k) lost += (L - Lf) * (was - k) / was; }
    }
    // A page finds its session on the server that holds it, or wherever sessions are shared; with a sticky sender, always.
    const pl = pool.get(n.id);
    if (pl && !pl.sticky) { const found = holdsSessions(n) ? pl.p / (k || 1) : pl.shared; if (found < 1 - 1e-9) st.sessionMiss = 1 - found; }
    if (isEdge(n)) {
      // A CDN answers what its edges hold and pulls the misses from its origin. With no origin it has nothing to hold.
      const origin = childGroups(n), h = origin.length ? edgeHit(n) : 0;
      Object.assign(st, { hit: h, misses: s * (1 - h), drop: origin.length ? 0 : 1 });
      if (!origin.length) noteIssue('noOrigin');
      r.fileStaleSecs = Math.max(r.fileStaleSecs, staleSecs(n));
      r.node[n.id] = st;
      for (const grp of origin) for (const [c, f] of split(grp, st.misses, down, n)) { add(load, c, f); add(files, c, f); }
      continue;
    }
    if (sp.combined) st.combined = true;
    if ('nosql' in sp) st.nosql = sp.nosql;
    if (COMPONENTS[n.type].forwards && !childGroups(n).length) { st.drop = 1; noteIssue('noBackend'); }
    if (copied.has(n.id)) st.copied = copied.get(n.id) * sp.per;
    if (hitOf.has(n.id)) { st.hit = hitOf.get(n.id); st.misses = L * (1 - st.hit); r.staleSecs = Math.max(r.staleSecs, staleSecs(n)); }
    r.node[n.id] = st;
    // The bottleneck: the server furthest over its capacity.
    if (st.drop > 0 && (!r.bottleneck || st.util > r.node[r.bottleneck.id].util)) r.bottleneck = { id: n.id, type: n.type };
    const cs = cacheSplit(n);
    // Files a server sends itself end there; a forwarder passes its files on (fileFrac of each share it sends).
    const keep = (ownFiles ? Lf : 0) + Lj, on = keep ? s * (1 - keep / L) : s, fileFrac = ownFiles ? 0 : Lf / L;
    const send = (grp, flow, w) => {
      if (grp.some(isReplica) && grp.every(isReplica)) noteIssue('noPrimary');
      const parts = split(grp, flow, down, n, w);
      for (const [c, f, kind] of parts) { add(load, c, f); if (kind === 'write') add(writes, c, f); if (fileFrac) add(files, c, f * fileFrac); }
      notePool(grp, n, parts, flow, fileFrac);
    };
    const sg = storeGroup(n), qg = Lj && queueGroup(n);
    if (sg) send(sg, on); // one session lookup for every page
    if (qg) send(qg, s * Lj / L); // one message for every upload
    if (cs) {
      const a = cacheAside(cs.caches, on, down, W, traffic.cacheHot);
      reads += on * (1 - W);
      for (const [c, f, h] of a.parts) { add(load, c, f); hitOf.set(c.id, h); hits += f * h; }
      for (const grp of cs.others) { send(grp, a.writes * createQueries(n), 1); send(grp, a.misses + a.bypass, 0); }
    } else {
      // A store that takes the non-relational queries gets that share; the database gets the rest.
      const og = offloadGroup(n), R = og ? nonRelShare() : 0;
      if (og) send(og, on * R);
      const perLink = createQueries(n);
      for (const grp of depGroups(n)) {
        if (perLink === 1) send(grp, R ? on * (1 - R) : on);
        else { send(grp, on * (1 - W), 0); send(grp, on * W * perLink, 1); } // each new link costs perLink queries
      }
    }
    // Each healthy replica applies every write the primary served.
    const wrote = (writes.get(n.id) || 0) * s / L;
    if (wrote > 0) for (const c of replicasOf(n)) if (!down.has(c.id)) { add(load, c, wrote); add(copied, c, wrote); }
  }
  if (sessionsOn()) r.lostPct = 100 * lost / pages;
  // Each queue's jobs per second in (messages it took) and out (jobs its workers took).
  for (const q of order) if (isQueue(q)) r.queues[q.id] = { in: served.get(q.id) || 0, out: childGroups(q).flat().reduce((a, c) => a + (served.get(c.id) || 0), 0) };
  return { load, served, reads, hits };
}

/** The model at this moment, or with `peak` at the top of the traffic's wobble (see PEAK). */
export function model({ peak = false } = {}) {
  const g = graph();
  const M = MISSIONS[S.mission];
  let base = M.qps * trafficFactor();
  let qps = peak ? base * PEAK : base * (1 + 0.02 * Math.sin(run.t * 1.7) + 0.01 * Math.sin(run.t * 4.1));
  // The level's workload: its outcome, and the traffic that reaches the servers after it (e.g. the keystrokes
  // browsers do not answer themselves).
  const env = workloadEnv(), out = workloadsAt(qps, base, env);
  qps = out.qps; base = out.base;
  const traffic = trafficOf(out, env), W = traffic.writes, split = splitterFor(W);
  const r = { mission: S.mission, qps, base, ...out.byField, servedPct: 0, latency: null, cost: g.cost, spof: 0, node: {}, issue: null, g, down: downIds(), bottleneck: null, hitRate: null, staleSecs: 0, fileStaleSecs: 0, farFileMs: null, lostPct: 0, farPageMs: null, noDataPct: 0, lagWrites: 0, queues: {}, uploadMs: null, jobsIn: 0, jobsOut: 0, backlog: 0, alert: null, bots: botRate(), ...RESULT_DEFAULTS };
  if (!g.entry.length) { r.issue = TXT.noWeb; return r; }
  if (g.needsDns && !g.hasDNS) { r.issue = TXT.noDns; return r; }
  r.spof = countSpofs(g);
  const down = r.down;
  const F = fileShare();
  const { load, served, reads, hits } = loadPhase(g, qps, base / qps, down, r, dayShift(), (id) => run.queues[id] || 0, uploadShare(), traffic);
  // Queues: jobs in and out, the backlog, and alerts from monitoring that watches a growing queue.
  for (const [id, q] of Object.entries(r.queues)) {
    r.jobsIn += q.in; r.jobsOut += q.out; r.backlog += run.queues[id] || 0;
    const growing = q.in - q.out > 1e-6;
    if (growing && g.monitored.has(id)) r.alert = r.alert || { queue: id, grow: q.in - q.out };
  }

  // 2. Served requests and response time, following each path.
  //    `flow` is the requests per second arriving along this path, `t` the time spent before this server.
  //    Times are added in path order, so a single chain gives exactly rtt + web + hop + db.
  //    Each class of request (pages or files, from near or far users) is walked on its own: `fileWalk` says which
  //    kind, and `extra` is how much longer than the nearby round trip the user's trip to the data center is.
  const NONE = { served: 0, end: null };
  let fileWalk = false, jobWalk = false, extra = 0;
  const viaGroup = (grp, flow, t, path, sender, w) => {
    const parts = split(grp, flow, down, sender, w).map(([c, f]) => walk(c, f, t, path)).filter(p => p.served > 0);
    const sv = parts.reduce((a, p) => a + p.served, 0);
    if (!sv) return NONE;
    return { served: sv, end: parts.length === 1 ? parts[0].end : parts.reduce((a, p) => a + p.served * p.end, 0) / sv };
  };
  const walk = (n, flow, t, path) => {
    const L = load.get(n.id), s = served.get(n.id);
    if (!s || !L || path.has(n.id)) return NONE;
    let passed = flow === L ? s : flow * s / L;   // this path's share of what the server served
    const st = r.node[n.id];
    if (st.realPass != null) passed = flow * st.realPass; // a server that counts bots apart: real users lose only their own share
    if (fileWalk && st.fileMs != null) return { served: passed, end: t + st.fileMs }; // it sends the file itself
    if (jobWalk && st.jobMs != null) return { served: passed, end: t + st.jobMs }; // it processes the upload itself
    if (isQueue(n)) return { served: passed, end: t + st.ms }; // the job waits for a worker; the request is done
    if (!fileWalk && st.sessionMiss) passed *= 1 - st.sessionMiss; // pages that landed away from their session fail
    let end0 = t + st.ms + (st.waitMs || 0); // waitMs: time a request waits before the server sends it on
    const next = new Set(path).add(n.id), groups = depGroups(n);
    if (isEdge(n)) return viaEdge(n, passed, end0, next);
    const qg = jobWalk && queueGroup(n);
    if (qg) return viaGroup(qg, passed, end0 + T.dc, next, n); // an upload is published, then answered
    // Every page reads its session first, then goes on.
    const sg = !fileWalk && storeGroup(n);
    if (sg) { const res = viaGroup(sg, passed, end0 + T.dc, next, n); if (!res.served) return NONE; passed = res.served; end0 = res.end; }
    const cs = cacheSplit(n);
    if (cs) return viaCache(n, cs, passed, end0, next);
    const og = offloadGroup(n);
    if (og) {
      // Non-relational queries go to their store; the rest to the database, as below.
      const R = nonRelShare(), parts = [viaGroup(og, passed * R, end0 + T.dc, next, n), viaAll(groups, passed * (1 - R), end0, next, n)].filter(p => p.served > 0);
      const sv = parts.reduce((a, p) => a + p.served, 0);
      return sv ? { served: sv, end: parts.reduce((a, p) => a + p.served * p.end, 0) / sv } : NONE;
    }
    if (!groups.length) return COMPONENTS[n.type].forwards ? NONE : { served: passed, end: end0 };
    if (groups.length === 1) return viaGroup(groups[0], passed, end0 + T.dc, next, n);
    // Several dependencies (e.g. a cache and a database): a request needs all of them, one after another.
    let frac = 1, end = end0;
    for (const grp of groups) {
      const res = viaGroup(grp, passed, end0 + T.dc, next, n);
      if (!res.served) return NONE;
      frac *= res.served / passed;
      end += res.end - end0;
    }
    return { served: passed * frac, end };
  };
  // A flow that needs every one of `groups` (writes, or reads the cache missed), starting at time t.
  const viaAll = (groups, flow, t, path, n, w) => {
    if (!flow) return NONE;
    if (!groups.length) return COMPONENTS[n.type].forwards ? NONE : { served: flow, end: t };
    let frac = 1, end = t;
    for (const grp of groups) {
      const res = viaGroup(grp, flow, t + T.dc, path, n, w);
      if (!res.served) return NONE;
      frac *= res.served / flow;
      end += res.end - t;
    }
    return { served: flow * frac, end };
  };
  // Cache-aside from server n: hits end at the cache; misses go on after the lookup; writes and bypassed keys go straight on.
  const viaCache = (n, cs, passed, end0, path) => {
    const a = cacheAside(cs.caches, passed, down, W, traffic.cacheHot), results = [];
    for (const [c, f, h] of a.parts) {
      const L = load.get(c.id), s = served.get(c.id);
      if (!s || !L) continue;
      const got = f * s / L, tc = end0 + T.dc + r.node[c.id].ms;
      results.push({ served: got * h, end: tc }, viaAll(cs.others, got * (1 - h), tc, path, n, 0));
    }
    results.push(viaAll(cs.others, a.bypass, end0, path, n, 0), viaAll(cs.others, a.writes, end0, path, n, 1));
    const ok = results.filter(p => p.served > 0), sv = ok.reduce((x, p) => x + p.served, 0);
    return sv ? { served: sv, end: ok.reduce((x, p) => x + p.served * p.end, 0) / sv } : NONE;
  };
  // A CDN: hits end at the edge. A miss goes on to the origin, which adds the rest of the user's distance to it.
  const viaEdge = (n, passed, end0, path) => {
    const h = r.node[n.id].hit, origin = childGroups(n)[0];
    const miss = origin ? viaGroup(origin, passed * (1 - h), end0 + extra, path, n) : NONE;
    const sv = passed * h + miss.served;
    return sv ? { served: sv, end: (passed * h * end0 + miss.served * (miss.end || 0)) / sv } : NONE;
  };
  // Pages go to the entry servers. Files go to the CDN while one is up (its edges are near every user), else to the origin.
  const classes = [], far = farShare();
  const U = uploadShare();
  for (const [regionShare, rtt] of [[1 - far, T.rtt], [far, T.far]]) {
    if (regionShare <= 0) continue;
    const pf = F ? qps * regionShare * (1 - F) : qps * regionShare;
    classes.push({ flow: U ? pf * (1 - U) : pf, file: false, rtt });
    if (U) classes.push({ flow: pf * U, file: false, job: true, rtt });
    if (F) classes.push({ flow: qps * regionShare * F, file: true, rtt, far: rtt === T.far });
  }
  // With located entry servers, each region goes where its DNS sends it, with that trip's round trip.
  const viaRegion = (k) => {
    const farRegion = k.rtt === T.far, parts = regionEntry(g, down, farRegion).filter(p => k.file || !p[3]).map(([n, sh, rtt]) => walk(n, k.flow * sh, rtt, new Set())).filter(p => p.served > 0);
    const sv = parts.reduce((a, p) => a + p.served, 0);
    const res = sv ? { served: sv, end: parts.reduce((a, p) => a + p.served * p.end, 0) / sv } : NONE;
    if (farRegion && !k.file && res.served) r.farPageMs = res.end;
    return res;
  };
  const results = classes.map((k) => {
    fileWalk = k.file; jobWalk = !!k.job; extra = k.rtt - T.rtt;
    const fe = k.file ? fileEntry(g, down) : { group: g.entry, edge: false };
    const res = !fe.edge && located(g) ? viaRegion(k) : viaGroup(fe.group, k.flow, fe.edge ? T.rtt : k.rtt, new Set(), g.users);
    if (k.far && res.served) r.farFileMs = res.end;
    if (k.job && res.served && k.rtt === T.rtt) r.uploadMs = res.end;
    return res;
  });
  const sv = results.reduce((a, p) => a + p.served, 0);
  const res = results.length === 1 ? results[0] : { served: sv, end: sv ? results.reduce((a, p) => a + p.served * (p.end || 0), 0) / sv : null };
  if (reads > 0) r.hitRate = hits / reads;
  r.servedPct = 100 * res.served / qps;
  r.latency = res.served > 0 ? res.end : null;
  // A crash's message applies only when requests still reach the crashed component (no healthy peer took over).
  const hit = [...down].some(id => r.node[id] && r.node[id].load > 0);
  const crash = hit && activeExps().find(e => e.kind === 'crash' && e.issue);
  if (crash) r.issue = textOf(crash.issue, r);
  return r;
}

/**
 * Servers on the request path with no peer of the same type to take over. DNS is third-party and not counted. A CDN
 * is a provider's service too, but if pages can't fall back to the origin when it fails, every file fails with it.
 */
function countSpofs(g) {
  const spof = new Set();
  const visit = (group, seen) => {
    for (const n of group) {
      if (group.length === 1 && !COMPONENTS[n.type].managed && !kindOf(n)?.redundant?.(n)) spof.add(n.id);
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      for (const grp of childGroups(n)) visit(grp, seen);
    }
  };
  visit(g.entry, new Set());
  for (const c of g.cdn || []) if (!fallsBack(c)) spof.add(c.id);
  return spof.size;
}

/** One request's route for the animation: Users → the servers it passes through → back, and where it fails. */
export function sampleRoute(m) {
  const W = writeShareOf(trafficShape(m)), split = splitterFor(W);
  const fwd = [m.g.users.id], seen = new Set();
  const F = fileShare(), file = F > 0 && Math.random() < F; // a file goes to the CDN, or ends at a web server
  // Uploads are rare, so dots show them more often than they happen (one dot in 6) to make the queue visible.
  const job = !file && uploadShare() > 0 && Math.random() < 1 / 6;
  // Bot requests show as their share of the traffic, at most half of the dots so real ones stay visible.
  const bot = !file && botRate() > 0 && Math.random() < Math.min(0.5, botRate() / (botRate() + m.qps));
  let group = file ? fileEntry(m.g, m.down).group : m.g.entry, sender = m.g.users, lost = -1, w;
  if (group === m.g.entry && located(m.g)) {
    // A data center is one box: the dot goes there and back, and fails there if it is down, full, or lacks the data.
    let pick = Math.random();
    const parts = regionEntry(m.g, m.down, Math.random() < farShare()), [n, , , noData] = parts.find(([, f]) => (pick -= f) < 0) || parts[parts.length - 1];
    const st = m.node[n.id];
    return { route: [m.g.users.id, n.id, m.g.users.id], failAt: !st || st.down || (!file && noData) || Math.random() < st.drop ? 1 : -1 };
  }
  while (group && group.length) {
    const down = new Set(group.filter(c => m.node[c.id] && m.node[c.id].down).map(c => c.id));
    const shares = split(group, 1, down, sender, w), total = shares.reduce((a, [, f]) => a + f, 0);
    let pick = Math.random(), n = total > 1 - 1e-9 ? shares[shares.length - 1][0] : null;
    for (const [c, f] of shares) { if (pick < f) { n = c; break; } pick -= f; }
    if (!n) { lost = fwd.length - 1; break; } // e.g. a write with no primary to take it
    if (seen.has(n.id)) break;
    seen.add(n.id); fwd.push(n.id);
    sender = n; w = undefined;
    if (job) {
      if (isQueue(n) || (m.node[n.id] || {}).jobMs != null) break; // published, or processed right here
      const qg = queueGroup(n);
      if (qg) { group = qg; continue; }
    }
    // A page reads its session and then its data; the dot shows one of the two.
    const sg = !file && storeGroup(n);
    if (sg && Math.random() < 0.5) { group = sg; continue; }
    if (file) {
      const st = m.node[n.id];
      if (st && st.fileMs != null) break; // the web server sends the file
      if (isEdge(n) && (!st || st.down || st.drop || Math.random() < st.hit)) break; // a hit ends at the edge
      group = childGroups(n)[0]; continue; // a miss goes on to the origin
    }
    const cs = cacheSplit(n);
    if (!cs) { group = depGroups(n)[0]; continue; }
    w = Math.random() < W ? 1 : 0;
    const c = cs.caches[Math.floor(Math.random() * cs.caches.length)], st = m.node[c.id];
    if (!w && st && !st.down && Math.random() < (st.hit || 0)) { fwd.push(c.id); break; } // a hit ends at the cache
    group = cs.others[0]; // a miss or a write goes on to the database (the dot skips the cache)
  }
  let failAt = lost;
  for (let i = 1; i < fwd.length && failAt < 0; i++) {
    const st = m.node[fwd[i]];
    const drop = st && st.realPass != null ? (bot ? 1 - st.botPass / Math.max(st.bots, 1e-9) : 1 - st.realPass) : st ? st.drop + (!file && st.sessionMiss || 0) : 1;
    if (!st || st.down || Math.random() < drop) { failAt = i; break; }
  }
  return { route: fwd.concat(fwd.slice(0, -1).reverse()), failAt };
}

/** For standby-routed types: true when `n` is not the first of its peers, so it waits while the first is healthy. */
export const isStandby = (n) => standbyPeers(n).index > 0;
/** For standby-routed types: n's place among the peers its sender reaches (0 = active), and how many there are. */
export function standbyPeers(n) {
  if ((COMPONENTS[n.type] || {}).routing !== 'standby') return { index: 0, count: 1 };
  const parent = S.edges.find(e => e.to === n.id);
  if (!parent) return { index: 0, count: 1 };
  const p = byId(parent.from);
  const peers = (p ? outs(p.id) : []).filter(c => c.type === n.type);
  return { index: Math.max(0, peers.indexOf(n)), count: peers.length };
}
