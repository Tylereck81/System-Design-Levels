// Simulation model: load, latency, failures and cost, for any graph of components.
import { MISSIONS, TXT, PALETTE, S, run, byId } from '../state.js';
import { COMPONENTS, T, roleOf, isServer, costOf, serverSpec } from './components.js';
import { activeExps, downIds, trafficFactor } from './experiments.js';

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

export function graph() {
  const users = S.nodes.find(n => roleOf(n) === 'client');
  const uo = users ? outs(users.id) : [];
  const dns = uo.find(n => roleOf(n) === 'resolver') || null;
  const entry = uo.filter(isServer);
  const needsDns = PALETTE.some(t => (COMPONENTS[t] || {}).role === 'resolver');
  // web and db: the first web server Users reach, and its database (used by level goals).
  const web = entry.find(n => n.type === 'web') || null;
  const db = web ? (outs(web.id).find(n => n.type === 'db') || null) : null;
  const cost = S.nodes.reduce((s, n) => s + costOf(n), 0);
  const ready = entry.length > 0 && (!needsDns || !!dns);
  return { users, dns, hasDNS: !!dns, entry, needsDns, ready, web, db, cost };
}
export const qmul = (u) => (u >= 0.96 ? 25 : 1 / (1 - u));

/** Every server reachable from Users, in an order where each comes after all servers that send to it. */
function topoOrder(entry) {
  const seen = new Set(), stack = [...entry];
  while (stack.length) { const n = stack.pop(); if (seen.has(n.id)) continue; seen.add(n.id); stack.push(...outs(n.id).filter(isServer)); }
  const indeg = new Map([...seen].map(id => [id, 0]));
  for (const id of seen) for (const c of outs(id).filter(isServer)) indeg.set(c.id, indeg.get(c.id) + 1);
  const order = [], queue = entry.filter(n => indeg.get(n.id) === 0);
  while (queue.length) {
    const n = queue.shift(); if (order.includes(n)) continue; order.push(n);
    for (const c of outs(n.id).filter(isServer)) { indeg.set(c.id, indeg.get(c.id) - 1); if (indeg.get(c.id) === 0) queue.push(c); }
  }
  return order; // servers inside a cycle never reach in-degree 0 and are left out, so a bad design cannot hang the loop
}

/** Split `flow` across a group: healthy peers share it evenly; with none healthy, the dead ones receive it and fail. */
function split(group, flow, down) {
  const healthy = group.filter(c => !down.has(c.id));
  const targets = healthy.length ? healthy : group;
  return targets.map(c => [c, targets.length === 1 ? flow : flow / targets.length]);
}

export function model() {
  const g = graph();
  const M = MISSIONS[S.mission];
  const base = M.qps * trafficFactor();
  const qps = base * (1 + 0.02 * Math.sin(run.t * 1.7) + 0.01 * Math.sin(run.t * 4.1));
  const r = { qps, base, servedPct: 0, latency: null, cost: g.cost, spof: 0, node: {}, issue: null, g, down: downIds() };
  if (!g.entry.length) { r.issue = TXT.noWeb; return r; }
  if (g.needsDns && !g.hasDNS) { r.issue = TXT.noDns; return r; }
  r.spof = countSpofs(g);
  const down = r.down;
  const crash = activeExps().find(e => e.kind === 'crash' && e.issue);
  if (crash) r.issue = crash.issue;

  // 1. Load: each server serves at most its capacity and passes on only what it served.
  const load = new Map(), served = new Map();
  for (const [c, f] of split(g.entry, qps, down)) load.set(c.id, (load.get(c.id) || 0) + f);
  for (const n of topoOrder(g.entry)) {
    const L = load.get(n.id) || 0;
    if (down.has(n.id)) {
      served.set(n.id, 0);
      r.node[n.id] = { down: true, util: 0, load: L, cap: 0, ms: 0, mult: 1 };
      continue;
    }
    if (L <= 0) continue; // nothing reaches it (behind a failed component)
    const sp = serverSpec(n);
    const u = (L * sp.per) / sp.cap;
    const s = Math.min(L, sp.cap / sp.per);
    served.set(n.id, s);
    const st = { load: L * sp.per, cap: sp.cap, util: u, ms: sp.base * qmul(u), mult: qmul(u), base: sp.base, unit: sp.unit, drop: Math.max(0, 1 - (sp.cap / sp.per) / L) };
    if (sp.combined) st.combined = true;
    if ('nosql' in sp) st.nosql = sp.nosql;
    r.node[n.id] = st;
    for (const grp of childGroups(n)) for (const [c, f] of split(grp, s, down)) load.set(c.id, (load.get(c.id) || 0) + f);
  }

  // 2. Served requests and response time, following each path.
  //    `flow` is the requests per second arriving along this path, `t` the time spent before this server.
  //    Times are added in path order, so a single chain gives exactly rtt + web + hop + db.
  const NONE = { served: 0, end: null };
  const viaGroup = (grp, flow, t, path) => {
    const parts = split(grp, flow, down).map(([c, f]) => walk(c, f, t, path)).filter(p => p.served > 0);
    const sv = parts.reduce((a, p) => a + p.served, 0);
    if (!sv) return NONE;
    return { served: sv, end: parts.length === 1 ? parts[0].end : parts.reduce((a, p) => a + p.served * p.end, 0) / sv };
  };
  const walk = (n, flow, t, path) => {
    const L = load.get(n.id), s = served.get(n.id);
    if (!s || !L || path.has(n.id)) return NONE;
    const passed = flow === L ? s : flow * s / L;   // this path's share of what the server served
    const end0 = t + r.node[n.id].ms;
    const next = new Set(path).add(n.id), groups = childGroups(n);
    if (!groups.length) return { served: passed, end: end0 };
    if (groups.length === 1) return viaGroup(groups[0], passed, end0 + T.dc, next);
    // Several dependencies (e.g. a cache and a database): a request needs all of them, one after another.
    let frac = 1, end = end0;
    for (const grp of groups) {
      const res = viaGroup(grp, passed, end0 + T.dc, next);
      if (!res.served) return NONE;
      frac *= res.served / passed;
      end += res.end - end0;
    }
    return { served: passed * frac, end };
  };
  const res = viaGroup(g.entry, qps, T.rtt, new Set());
  r.servedPct = 100 * res.served / qps;
  r.latency = res.served > 0 ? res.end : null;
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
  let group = m.g.entry;
  while (group && group.length) {
    const healthy = group.filter(c => !(m.node[c.id] && m.node[c.id].down));
    const pool = healthy.length ? healthy : group;
    const n = pool.length === 1 ? pool[0] : pool[Math.floor(Math.random() * pool.length)];
    if (seen.has(n.id)) break;
    seen.add(n.id); fwd.push(n.id);
    group = childGroups(n)[0];
  }
  let failAt = -1;
  for (let i = 1; i < fwd.length; i++) {
    const st = m.node[fwd[i]];
    if (!st || st.down || Math.random() < st.drop) { failAt = i; break; }
  }
  return { route: fwd.concat(fwd.slice(0, -1).reverse()), failAt };
}
