// Component types: capacity, base time, cost and failure mode for everything on the canvas.
import { S, byId, WORKLOAD } from '../state.js';

export const SIZES = {
  S: { cpu: 2, cap: 200, cost: 40 },
  M: { cpu: 4, cap: 400, cost: 90 },
  L: { cpu: 8, cap: 800, cost: 200 },
  XL: { cpu: 16, cap: 1600, cost: 450 },
};
export const T = { rtt: 40, web: 20, db: 10, dc: 0.5, dns: 5, nosqlLookup: 3, nosqlLookups: 3, lb: 1, lag: 1, cache: 0.1 }; // lag: seconds a replica runs behind its primary; cache: ms for a lookup in memory

// role: 'client' sends traffic, 'resolver' answers name lookups off the request path,
//       'server' sits on the request path and has a capacity.
// sized: capacity and cost come from the server size (S–XL); `sizes` replaces the default table (e.g. memory sizes).
// kinds: variants that change the work per request (per = operations per request, base = ms per request).
// alone: what happens when a dependency is missing (the server does that work itself).
// cap, cost: fixed capacity (req/s) and monthly cost for servers that have no sizes.
// routing 'standby': peers of this type don't share traffic; the first healthy one takes it all
//   and the others wait as standbys (default: healthy peers split traffic evenly).
// forwards: the server only passes requests on; with no server behind it, every request it gets fails.
// algos: routing methods the player can pick for the servers behind it. split 'even' gives each the same share;
//   'capacity' shares in proportion to each server's capacity. defaultAlgo is used when none is chosen.
// replicated: each server is the primary or a replica (n.role), when the level gives roles. A sender whose group
//   holds replicas sends writes (the mission's write share) to the primary and reads to the healthy replicas,
//   or to the primary when none is healthy. Every replica also applies each write the primary serves.
// aside: a cache the sender checks first (cache-aside). Reads it holds are answered there (hit rate from its
//   memory and TTL, see hitRate); misses and writes go on to the sender's other servers. Keys are split evenly
//   over the sender's cache servers; a down cache's keys go straight to the database.
// choices: settings the player picks per server, stored as n[key]; each lists its options and a default.
// Failure mode for every server: when down it serves nothing; its share moves to healthy peers,
// and with no healthy peer every request sent to it fails.
export const COMPONENTS = {
  users: { role: 'client' },
  dns: { role: 'resolver', cost: T.dns },
  lb: { role: 'server', cap: 5000, base: T.lb, cost: 20, unit: 'req/s', routing: 'standby', forwards: true,
    algos: { rr: { split: 'even' }, wrr: { split: 'capacity' }, lc: { split: 'capacity' } }, defaultAlgo: 'rr' },
  web: { role: 'server', sized: true, base: T.web, unit: 'req/s', alone: { missing: 'db', capFactor: 0.5, base: T.web + T.db } },
  cache: {
    role: 'server', sized: true, base: T.cache, unit: 'lookups/s', aside: true,
    sizes: {
      S: { mem: 2, cap: 10000, cost: 20 },
      M: { mem: 4, cap: 10000, cost: 40 },
      L: { mem: 8, cap: 10000, cost: 80 },
      XL: { mem: 16, cap: 10000, cost: 160 },
    },
    choices: {
      ttl: { options: { 10: { secs: 10 }, 60: { secs: 60 }, 600: { secs: 600 }, 3600: { secs: 3600 } }, default: '60' },
      onWrite: { options: { ttl: {}, delete: {} }, default: 'ttl' },
    },
  },
  db: {
    role: 'server', sized: true, replicated: true,
    kinds: {
      sql: { per: 1, base: T.db, unit: 'queries/s' },
      nosql: { per: T.nosqlLookups, base: T.nosqlLookup * T.nosqlLookups, unit: 'lookups/s' },
    },
  },
};

export const roleOf = (n) => (COMPONENTS[n.type] || {}).role;
export const isServer = (n) => roleOf(n) === 'server';
export const isReplica = (n) => !!(COMPONENTS[n.type] || {}).replicated && n.role === 'replica';
export const isCache = (n) => !!(COMPONENTS[n.type] || {}).aside;
export const sizesOf = (type) => (COMPONENTS[type] || {}).sizes || SIZES;
/** The option a server has picked for one of its choices (its default when none is picked). */
export function choiceOf(n, key) {
  const ch = COMPONENTS[n.type].choices[key];
  return ch.options[n[key]] ? n[key] : ch.default;
}

/**
 * Share of reads a cache server answers, when its sender splits keys over `servers` cache servers.
 * Popularity follows the 80/20 rule at every scale (80% of reads go to the top 20% of items, and so on), so memory
 * holding a share x of the catalog covers x^(ln 0.8 / ln 0.2) of reads. An item expires after the TTL; the next
 * read misses and reloads it, so with a read every `gap` seconds a share TTL ÷ (TTL + gap) of reads find it fresh.
 */
export function hitRate(n, servers) {
  const held = Math.min(1, sizesOf(n.type)[n.size].mem * servers / WORKLOAD.catalogGB);
  const ttl = COMPONENTS[n.type].choices.ttl.options[choiceOf(n, 'ttl')].secs;
  return Math.pow(held, Math.log(0.8) / Math.log(0.2)) * ttl / (ttl + WORKLOAD.readGapSecs);
}
/** How long a changed item can still be served from this cache: until its TTL ends, or not at all when writes delete it. */
export const staleSecs = (n) => (choiceOf(n, 'onWrite') === 'delete' ? 0 : COMPONENTS[n.type].choices.ttl.options[choiceOf(n, 'ttl')].secs);

/** Monthly cost of one component. */
export function costOf(n) {
  const c = COMPONENTS[n.type] || {};
  if (c.sized) return n.size ? sizesOf(n.type)[n.size].cost : 0;
  return c.cost || 0;
}

/** True when a server lacks the dependency it normally hands work to, so it does that work itself. */
export function runsAlone(n) {
  const a = (COMPONENTS[n.type] || {}).alone;
  return !!a && !S.edges.some(e => e.from === n.id && (byId(e.to) || {}).type === a.missing);
}

/** Capacity and work per request for a server, given its size, kind and dependencies. */
export function serverSpec(n) {
  const c = COMPONENTS[n.type];
  const kind = c.kinds ? c.kinds[n.kind] || c.kinds[Object.keys(c.kinds)[0]] : null;
  const spec = { cap: c.sized ? sizesOf(n.type)[n.size].cap : c.cap, per: 1, base: c.base, unit: c.unit };
  if (kind) Object.assign(spec, { per: kind.per, base: kind.base, unit: kind.unit, nosql: n.kind === 'nosql' });
  if (runsAlone(n)) Object.assign(spec, { cap: spec.cap * c.alone.capFactor, base: c.alone.base, combined: true });
  return spec;
}

/** How `n` splits traffic over the servers behind it: 'even' (default) or 'capacity'. */
export function splitRule(n) {
  const c = n && COMPONENTS[n.type];
  if (!c || !c.algos) return 'even';
  return (c.algos[n.algo] || c.algos[c.defaultAlgo]).split;
}
