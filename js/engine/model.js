// Simulation model: load, latency, failures and cost, for any graph of components.
import { MISSIONS, TXT, PALETTE, S, run, byId } from '../state.js';
import { COMPONENTS, T, roleOf, isServer, isReplica, isCache, isEdge, hitRate, edgeHit, fallsBack, staleSecs, costOf, serverSpec, splitRule } from './components.js';
import { activeExps, downIds, trafficFactor, textOf, PEAK } from './experiments.js';

export { SIZES, T } from './components.js';

const outs = (id) => S.edges.filter(e => e.from === id).map(e => byId(e.to)).filter(Boolean);

/** Downstream servers of a node, grouped by type (peers of the same type share the load). */
export function childGroups(n) {
  const groups = new Map();
  for (const c of outs(n.id)) {
    if (!isServer(c)) continue;
    if (!groups.has(c.type)) groups.set(c.type, []);
    groups.get(c.type).push(c);
  }
  return [...groups.values()];
}

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
  // web and db: the first web server Users reach, and its database (used by level goals).
  const web = entry.find(n => n.type === 'web') || null;
  const db = web ? (outs(web.id).find(n => n.type === 'db') || null) : null;
  const cost = S.nodes.reduce((s, n) => s + costOf(n), 0);
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
  return { users, dns, hasDNS: !!dns, entry, cdn, needsDns, ready, web, db, cost, onPath, count, everyReaches, reached, next };
}
export const qmul = (u) => (u >= 0.96 ? 25 : 1 / (1 - u));

/** Replicas that copy `n`'s writes: every replica of its type, when `n` is a primary. */
function replicasOf(n) {
  if (!(COMPONENTS[n.type] || {}).replicated || isReplica(n) || !n.role) return [];
  return S.nodes.filter(c => c.type === n.type && isReplica(c));
}
/** Servers that come after `n`: the ones it sends to, and the replicas that copy its writes. */
const after = (n) => outs(n.id).filter(isServer).concat(replicasOf(n));

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
function split(group, flow, down, sender, w = writeShare()) {
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
const writeShare = () => MISSIONS[S.mission].writes || 0;
const fileShare = () => MISSIONS[S.mission].files || 0; // share of requests that are static files (the rest are pages)
const farShare = () => MISSIONS[S.mission].far || 0;    // share of users far from the data center
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
  const groups = childGroups(n), caches = groups.find(grp => isCache(grp[0]));
  return caches ? { caches, others: groups.filter(grp => grp !== caches) } : null;
}
/**
 * Cache-aside: reads go to the caches first, keys split evenly over all of them. Each healthy cache answers its
 * hit share; its misses go on to the database after the lookup. A down cache's keys skip it (bypass).
 * Writes skip the caches. Returns the cache parts [cache, reads, hit rate] and the flows that go on.
 */
function cacheAside(caches, flow, down, w) {
  const each = flow * (1 - w) / caches.length, out = { parts: [], writes: flow * w, misses: 0, bypass: 0 };
  for (const c of caches) {
    if (down.has(c.id)) { out.bypass += each; continue; }
    const h = hitRate(c, caches.length);
    out.parts.push([c, each, h]);
    out.misses += each * (1 - h);
  }
  return out;
}

/** The model at this moment, or with `peak` at the top of the traffic's wobble (see PEAK). */
export function model({ peak = false } = {}) {
  const g = graph();
  const M = MISSIONS[S.mission];
  const base = M.qps * trafficFactor();
  const qps = peak ? base * PEAK : base * (1 + 0.02 * Math.sin(run.t * 1.7) + 0.01 * Math.sin(run.t * 4.1));
  const r = { qps, base, servedPct: 0, latency: null, cost: g.cost, spof: 0, node: {}, issue: null, g, down: downIds(), bottleneck: null, hitRate: null, staleSecs: 0, fileStaleSecs: 0, farFileMs: null };
  if (!g.entry.length) { r.issue = TXT.noWeb; return r; }
  if (g.needsDns && !g.hasDNS) { r.issue = TXT.noDns; return r; }
  r.spof = countSpofs(g);
  const down = r.down;

  // 1. Load: each server serves at most its capacity and passes on only what it served.
  const load = new Map(), served = new Map(), writes = new Map(), copied = new Map(), hitOf = new Map(), files = new Map();
  let reads = 0, hits = 0; // reads that went to a cache group, and how many it answered
  const add = (m, c, f) => m.set(c.id, (m.get(c.id) || 0) + f);
  const F = fileShare();
  for (const [c, f] of split(g.entry, F ? qps * (1 - F) : qps, down, g.users)) add(load, c, f);
  if (F) for (const [c, f] of split(fileEntry(g, down).group, qps * F, down, g.users)) { add(load, c, f); add(files, c, f); }
  for (const n of topoOrder(g.entry.concat(g.cdn))) {
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
    const sp = serverSpec(n);
    const Lf = files.get(n.id) || 0, ownFiles = Lf > 0 && sp.filePer != null; // a server that sends files itself
    const work = ownFiles ? (L - Lf) * sp.per + Lf * sp.filePer : L * sp.per;
    const u = work / sp.cap;
    const s = ownFiles ? (u > 1 ? L / u : L) : Math.min(L, sp.cap / sp.per);
    served.set(n.id, s);
    const st = { load: work, cap: sp.cap, util: u, ms: sp.base * qmul(u), mult: qmul(u), base: sp.base, unit: sp.unit, drop: ownFiles ? 1 - s / L : Math.max(0, 1 - (sp.cap / sp.per) / L) };
    if (ownFiles) Object.assign(st, { pages: L - Lf, files: Lf, fileMs: sp.fileBase * qmul(u) });
    if (isEdge(n)) {
      // A CDN answers what its edges hold and pulls the misses from its origin. With no origin it has nothing to hold.
      const origin = childGroups(n), h = origin.length ? edgeHit(n) : 0;
      Object.assign(st, { hit: h, misses: s * (1 - h), drop: origin.length ? 0 : 1 });
      if (!origin.length) r.issue = r.issue || TXT.noOrigin || null;
      r.fileStaleSecs = Math.max(r.fileStaleSecs, staleSecs(n));
      r.node[n.id] = st;
      for (const grp of origin) for (const [c, f] of split(grp, st.misses, down, n)) { add(load, c, f); add(files, c, f); }
      continue;
    }
    if (sp.combined) st.combined = true;
    if ('nosql' in sp) st.nosql = sp.nosql;
    if (COMPONENTS[n.type].forwards && !childGroups(n).length) { st.drop = 1; r.issue = r.issue || TXT.noBackend || null; }
    if (copied.has(n.id)) st.copied = copied.get(n.id) * sp.per;
    if (hitOf.has(n.id)) { st.hit = hitOf.get(n.id); st.misses = L * (1 - st.hit); r.staleSecs = Math.max(r.staleSecs, staleSecs(n)); }
    r.node[n.id] = st;
    // The bottleneck: the server furthest over its capacity.
    if (st.drop > 0 && (!r.bottleneck || st.util > r.node[r.bottleneck.id].util)) r.bottleneck = { id: n.id, type: n.type };
    const cs = cacheSplit(n);
    // Files a server sends itself end there; a forwarder passes its files on (fileFrac of each share it sends).
    const on = ownFiles ? s * (1 - Lf / L) : s, fileFrac = ownFiles ? 0 : Lf / L;
    const send = (grp, flow, w) => {
      if (grp.some(isReplica) && grp.every(isReplica)) r.issue = r.issue || TXT.noPrimary || null;
      for (const [c, f, kind] of split(grp, flow, down, n, w)) { add(load, c, f); if (kind === 'write') add(writes, c, f); if (fileFrac) add(files, c, f * fileFrac); }
    };
    if (cs) {
      const a = cacheAside(cs.caches, on, down, writeShare());
      reads += on * (1 - writeShare());
      for (const [c, f, h] of a.parts) { add(load, c, f); hitOf.set(c.id, h); hits += f * h; }
      for (const grp of cs.others) { send(grp, a.writes, 1); send(grp, a.misses + a.bypass, 0); }
    } else {
      for (const grp of childGroups(n)) send(grp, on);
    }
    // Each healthy replica applies every write the primary served.
    const wrote = (writes.get(n.id) || 0) * s / L;
    if (wrote > 0) for (const c of replicasOf(n)) if (!down.has(c.id)) { add(load, c, wrote); add(copied, c, wrote); }
  }

  // 2. Served requests and response time, following each path.
  //    `flow` is the requests per second arriving along this path, `t` the time spent before this server.
  //    Times are added in path order, so a single chain gives exactly rtt + web + hop + db.
  //    Each class of request (pages or files, from near or far users) is walked on its own: `fileWalk` says which
  //    kind, and `extra` is how much longer than the nearby round trip the user's trip to the data center is.
  const NONE = { served: 0, end: null };
  let fileWalk = false, extra = 0;
  const viaGroup = (grp, flow, t, path, sender, w) => {
    const parts = split(grp, flow, down, sender, w).map(([c, f]) => walk(c, f, t, path)).filter(p => p.served > 0);
    const sv = parts.reduce((a, p) => a + p.served, 0);
    if (!sv) return NONE;
    return { served: sv, end: parts.length === 1 ? parts[0].end : parts.reduce((a, p) => a + p.served * p.end, 0) / sv };
  };
  const walk = (n, flow, t, path) => {
    const L = load.get(n.id), s = served.get(n.id);
    if (!s || !L || path.has(n.id)) return NONE;
    const passed = flow === L ? s : flow * s / L;   // this path's share of what the server served
    if (fileWalk && r.node[n.id].fileMs != null) return { served: passed, end: t + r.node[n.id].fileMs }; // it sends the file itself
    const end0 = t + r.node[n.id].ms;
    const next = new Set(path).add(n.id), groups = childGroups(n);
    if (isEdge(n)) return viaEdge(n, passed, end0, next);
    const cs = cacheSplit(n);
    if (cs) return viaCache(n, cs, passed, end0, next);
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
    const a = cacheAside(cs.caches, passed, down, writeShare()), results = [];
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
  for (const [share, rtt] of [[1 - far, T.rtt], [far, T.far]]) {
    if (share <= 0) continue;
    classes.push({ flow: F ? qps * share * (1 - F) : qps * share, file: false, rtt });
    if (F) classes.push({ flow: qps * share * F, file: true, rtt, far: rtt === T.far });
  }
  const results = classes.map((k) => {
    fileWalk = k.file; extra = k.rtt - T.rtt;
    const fe = k.file ? fileEntry(g, down) : { group: g.entry, edge: false };
    const res = viaGroup(fe.group, k.flow, fe.edge ? T.rtt : k.rtt, new Set(), g.users);
    if (k.far && res.served) r.farFileMs = res.end;
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

/** Servers on the request path with no peer of the same type to take over. DNS is third-party and not counted. */
function countSpofs(g) {
  const spof = new Set();
  const visit = (group, seen) => {
    for (const n of group) {
      if (group.length === 1) spof.add(n.id);
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      for (const grp of childGroups(n)) visit(grp, seen);
    }
  };
  visit(g.entry, new Set());
  return spof.size;
}

/** One request's route for the animation: Users → the servers it passes through → back, and where it fails. */
export function sampleRoute(m) {
  const fwd = [m.g.users.id], seen = new Set();
  const F = fileShare(), file = F > 0 && Math.random() < F; // a file goes to the CDN, or ends at a web server
  let group = file ? fileEntry(m.g, m.down).group : m.g.entry, sender = m.g.users, lost = -1, w;
  while (group && group.length) {
    const down = new Set(group.filter(c => m.node[c.id] && m.node[c.id].down).map(c => c.id));
    const shares = split(group, 1, down, sender, w), total = shares.reduce((a, [, f]) => a + f, 0);
    let pick = Math.random(), n = total > 1 - 1e-9 ? shares[shares.length - 1][0] : null;
    for (const [c, f] of shares) { if (pick < f) { n = c; break; } pick -= f; }
    if (!n) { lost = fwd.length - 1; break; } // e.g. a write with no primary to take it
    if (seen.has(n.id)) break;
    seen.add(n.id); fwd.push(n.id);
    sender = n; w = undefined;
    if (file) {
      const st = m.node[n.id];
      if (st && st.fileMs != null) break; // the web server sends the file
      if (isEdge(n) && (!st || st.down || st.drop || Math.random() < st.hit)) break; // a hit ends at the edge
      group = childGroups(n)[0]; continue; // a miss goes on to the origin
    }
    const cs = cacheSplit(n);
    if (!cs) { group = childGroups(n)[0]; continue; }
    w = Math.random() < writeShare() ? 1 : 0;
    const c = cs.caches[Math.floor(Math.random() * cs.caches.length)], st = m.node[c.id];
    if (!w && st && !st.down && Math.random() < (st.hit || 0)) { fwd.push(c.id); break; } // a hit ends at the cache
    group = cs.others[0]; // a miss or a write goes on to the database (the dot skips the cache)
  }
  let failAt = lost;
  for (let i = 1; i < fwd.length && failAt < 0; i++) {
    const st = m.node[fwd[i]];
    if (!st || st.down || Math.random() < st.drop) { failAt = i; break; }
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
