// Simulation model: load, latency, failures and cost.
import { MISSIONS, TXT, S, run, byId } from '../state.js';

export const SIZES = {
  S: { cpu: 2, cap: 200, cost: 40 },
  M: { cpu: 4, cap: 400, cost: 90 },
  L: { cpu: 8, cap: 800, cost: 200 },
  XL: { cpu: 16, cap: 1600, cost: 450 },
};
export const T = { rtt: 40, web: 20, db: 10, dc: 0.5, dns: 5, nosqlLookup: 3, nosqlLookups: 3 };

export function graph() {
  const users = S.nodes.find(n => n.type === 'users');
  const outs = (id) => S.edges.filter(e => e.from === id).map(e => byId(e.to)).filter(Boolean);
  const uo = users ? outs(users.id) : [];
  const dns = uo.find(n => n.type === 'dns') || null;
  const web = uo.find(n => n.type === 'web') || null;
  const db = web ? (outs(web.id).find(n => n.type === 'db') || null) : null;
  const cost = S.nodes.reduce((s, n) => s + (n.type === 'dns' ? T.dns : (n.size ? SIZES[n.size].cost : 0)), 0);
  return { users, dns, hasDNS: !!dns, web, db, cost };
}
export const qmul = (u) => (u >= 0.96 ? 25 : 1 / (1 - u));
export const webHasDb = (web) => S.edges.some(e => e.from === web.id && (byId(e.to) || {}).type === 'db');

export function model() {
  const g = graph();
  const M = MISSIONS[S.mission];
  const base = M.qps * (run.spike ? 10 : 1);
  const qps = base * (1 + 0.02 * Math.sin(run.t * 1.7) + 0.01 * Math.sin(run.t * 4.1));
  const r = { qps, base, servedPct: 0, latency: null, cost: g.cost, spof: 0, node: {}, issue: null, g, dropW: 1, dropD: 0 };
  if (!g.web) { r.issue = TXT.noWeb; return r; }
  if (!g.hasDNS) { r.issue = TXT.noDns; return r; }
  r.spof = g.db ? 2 : 1;
  if (run.crash) {
    r.issue = TXT.webDown;
    r.node[g.web.id] = { down: true, util: 0, load: qps, cap: 0, ms: 0, mult: 1 };
    return r;
  }
  const capW = SIZES[g.web.size].cap;
  if (g.db) {
    const nosql = g.db.kind === 'nosql';
    const per = nosql ? T.nosqlLookups : 1;
    const dbBase = nosql ? T.nosqlLookup * T.nosqlLookups : T.db;
    const capD = SIZES[g.db.size].cap;
    const sW = Math.min(qps, capW);
    const sD = Math.min(sW, capD / per);
    const uW = qps / capW, uD = (sW * per) / capD;
    const mw = T.web * qmul(uW), md = dbBase * qmul(uD);
    r.latency = T.rtt + mw + T.dc + md;
    r.servedPct = 100 * sD / qps;
    r.dropW = Math.max(0, 1 - capW / qps);
    r.dropD = sW > 0 ? Math.max(0, 1 - (capD / per) / sW) : 0;
    r.node[g.web.id] = { load: qps, cap: capW, util: uW, ms: mw, mult: qmul(uW), base: T.web, unit: 'req/s' };
    r.node[g.db.id] = { load: sW * per, cap: capD, util: uD, ms: md, mult: qmul(uD), base: dbBase, unit: nosql ? 'lookups/s' : 'queries/s', nosql };
  } else {
    const cap = capW / 2, u = qps / cap, ms = (T.web + T.db) * qmul(u);
    r.latency = T.rtt + ms;
    r.servedPct = 100 * Math.min(qps, cap) / qps;
    r.dropW = Math.max(0, 1 - cap / qps);
    r.node[g.web.id] = { load: qps, cap, util: u, ms, mult: qmul(u), base: T.web + T.db, combined: true, unit: 'req/s' };
  }
  return r;
}
