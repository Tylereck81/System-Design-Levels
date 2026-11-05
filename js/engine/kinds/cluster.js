// A cache cluster (hashring.js): its servers, where its keys land, and its load rule.
import { optionOf, sizesOf, qmul } from '../catalog.js';
import { serverNames, keyShares, movedShare } from '../hashring.js';

/** Servers in a cache cluster. */
export const clusterSize = (n) => optionOf(n, 'count').count;
/** The cluster's servers by name (A, B, C…). Resized by −1, server C has gone; by +1, the next letter has joined. */
function clusterNames(n, resize = 0) {
  const names = serverNames(clusterSize(n) + Math.max(0, resize));
  return resize < 0 ? names.filter((s) => s !== 'C') : names;
}
/** The cluster's hashing: { mod: true } for hash % N, or { vnodes } points per server on a hash ring. */
export const hashMethod = (n) => optionOf(n, 'hashing');
/** Share of the keys each server holds, and the share whose server changed when the cluster was resized. */
export function clusterLayout(n, resize = 0) {
  const names = clusterNames(n, resize), method = hashMethod(n);
  return { names, shares: keyShares(names, method), moved: resize ? movedShare(clusterNames(n), names, method) : 0 };
}

/**
 * Each server gets the lookups for its share of the keys; the running experiments may resize the cluster. The box
 * reports its busiest server, its hit rate (set by its senders' cache-aside), the share of keys that moved in a resize,
 * and the spread: how far the busiest server is above the average. The result reports the largest of each over all
 * clusters. Each server costs its size's price; with more than one, a lost server's keys move to the others.
 */
export const cacheCluster = {
  id: 'cache-cluster',
  matches: (c) => !!c.clustered,
  resultDefaults: { ringMoved: null, ringSpread: null },
  step(n, L, ctx) {
    const sp = ctx.spec(n), lay = clusterLayout(n, ctx.total('resize')), N = lay.names.length;
    const servers = lay.names.map((name) => { const l = L * lay.shares[name], u = l / sp.cap; return { name, share: lay.shares[name], load: l, util: u, drop: Math.max(0, 1 - sp.cap / l) }; });
    const ok = servers.reduce((a, x) => a + x.share * (1 - x.drop), 0), util = Math.max(...servers.map((x) => x.util));
    const h = ctx.hitRate(n.id), spread = Math.max(...servers.map((x) => x.share)) * N - 1, mult = qmul(util);
    ctx.settle(n, L * ok, { load: L, cap: sp.cap * N, util, ms: sp.base * mult, mult, base: sp.base, unit: sp.unit, drop: 1 - ok, hit: h, misses: L * (1 - h), servers, moved: lay.moved, spread });
    ctx.report({ ringMoved: lay.moved, ringSpread: spread }, 'max');
  },
  cost: (n) => (n.size ? sizesOf(n.type)[n.size].cost * clusterSize(n) : 0),
  redundant: (n) => clusterSize(n) > 1,
};
