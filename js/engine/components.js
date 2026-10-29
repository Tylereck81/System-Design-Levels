// Component types: capacity, base time, cost and failure mode for everything on the canvas.
import { S, byId, WORKLOAD, MISSIONS } from '../state.js';

export const SIZES = {
  S: { cpu: 2, cap: 200, cost: 40 },
  M: { cpu: 4, cap: 400, cost: 90 },
  L: { cpu: 8, cap: 800, cost: 200 },
  XL: { cpu: 16, cap: 1600, cost: 450 },
};
export const T = { rtt: 40, web: 20, db: 10, dc: 0.5, dns: 5, nosqlLookup: 3, nosqlLookups: 3, lb: 1, lag: 1, cache: 0.1, far: 120, file: 2, cdn: 1, scaleAt: 0.6, maxCopies: 10 };
// lag: seconds a replica runs behind its primary; cache: ms for a lookup in memory; far: internet round trip for users far
// from the data center; file: ms a web server takes to send a static file; cdn: ms for an edge server to answer from its cache;
// scaleAt: how busy the autoscaler lets each server get; maxCopies: the most servers one autoscaled group runs

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
// files: the server sends static files itself (they end there; only pages go on). per = a file's work, as a share of a page's.
// edge: a CDN. Users send it their file requests (pages still go to the load balancer); it answers what its edges hold
//   (see edgeHit) and pulls misses from its origin, the servers it connects to. With no origin it holds nothing.
//   perGB: price of the data it sends, billed on the mission's average file traffic (see costOf).
// stateful: in a mission with sessions, the server keeps each user's session (login, cart) in its own memory, unless it
//   connects to a session store (see holdsSessions). A page that lands on a server without its session fails.
// store: a session store. Every page its sender serves reads the session there first (one lookup), then goes on.
// managed: run by a provider on several machines, so it never counts as a single point of failure.
// algos with sticky: true keep each user on the server they started on, so sessions held in memory are always found.
// choices: settings the player picks per server, stored as n[key]; each lists its options and a default.
//   staleBy names the choice whose option says (stale: true) that a changed item is served until its TTL ends.
//   An option with auto: true makes the server an autoscaled group (see copiesFor).
// Failure mode for every server: when down it serves nothing; its share moves to healthy peers,
// and with no healthy peer every request sent to it fails.
export const COMPONENTS = {
  users: { role: 'client' },
  dns: { role: 'resolver', cost: T.dns },
  lb: { role: 'server', cap: 5000, base: T.lb, cost: 20, unit: 'req/s', routing: 'standby', forwards: true,
    algos: { rr: { split: 'even' }, wrr: { split: 'capacity' }, lc: { split: 'capacity' }, sticky: { split: 'even', sticky: true } }, defaultAlgo: 'rr' },
  web: {
    role: 'server', sized: true, base: T.web, unit: 'req/s', alone: { missing: 'db', capFactor: 0.5, base: T.web + T.db }, files: { per: T.file / T.web, base: T.file },
    stateful: true, choices: { scaling: { options: { fixed: {}, auto: { auto: true } }, default: 'fixed' } },
  },
  session: { role: 'server', cap: 10000, base: T.nosqlLookup, cost: 150, unit: 'lookups/s', store: true, managed: true },
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
      onWrite: { options: { ttl: { stale: true }, delete: {} }, default: 'ttl' },
    },
    staleBy: 'onWrite',
  },
  cdn: {
    role: 'server', cap: 100000, base: T.cdn, unit: 'files/s', edge: true, perGB: 0.02,
    choices: {
      ttl: { options: { 60: { secs: 60 }, 600: { secs: 600 }, 3600: { secs: 3600 }, 86400: { secs: 86400 } }, default: '60' },
      // purge clears the edges, but browsers keep their own copy until its TTL ends, so it still counts as stale.
      onChange: { options: { ttl: { stale: true }, purge: { stale: true }, version: {} }, default: 'ttl' },
      fallback: { options: { none: {}, origin: { fallback: true } }, default: 'none' },
    },
    staleBy: 'onChange',
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
export const isEdge = (n) => !!(COMPONENTS[n.type] || {}).edge;
export const isStore = (n) => !!(COMPONENTS[n.type] || {}).store;
export const isSticky = (n) => { const c = n && COMPONENTS[n.type]; return !!(c && c.algos && (c.algos[n.algo] || c.algos[c.defaultAlgo]).sticky); };
/** True when the server runs as an autoscaled group. */
export const scales = (n) => { const c = COMPONENTS[n.type] || {}; return !!(c.choices && c.choices.scaling && c.choices.scaling.options[choiceOf(n, 'scaling')].auto); };
/** True when the mission's pages carry a session (a login and a cart). */
export const sessionsOn = () => !!MISSIONS[S.mission].sessions;
/** True when the server keeps sessions in its own memory: a stateful server with no session store to share them. */
export function holdsSessions(n) {
  return sessionsOn() && !!(COMPONENTS[n.type] || {}).stateful && !S.edges.some(e => e.from === n.id && isStore(byId(e.to) || {}));
}
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
  const ttl = ttlSecs(n);
  return Math.pow(held, Math.log(0.8) / Math.log(0.2)) * ttl / (ttl + WORKLOAD.readGapSecs);
}
const ttlSecs = (n) => COMPONENTS[n.type].choices.ttl.options[choiceOf(n, 'ttl')].secs;
/**
 * Share of file requests a CDN's edges answer. Each file is requested at an edge about every `fileGapSecs`; after a miss
 * the edge keeps it for the TTL, so a share TTL ÷ (TTL + gap) of requests find it there.
 */
export const edgeHit = (n) => ttlSecs(n) / (ttlSecs(n) + WORKLOAD.fileGapSecs);
/** True when pages fetch their files from the origin while this CDN is down. */
export const fallsBack = (n) => !!COMPONENTS[n.type].choices.fallback.options[choiceOf(n, 'fallback')].fallback;
/** How long a changed item can still be served: until its TTL ends, or not at all when the change replaces it everywhere. */
export function staleSecs(n) {
  const key = COMPONENTS[n.type].staleBy;
  return COMPONENTS[n.type].choices[key].options[choiceOf(n, key)].stale ? ttlSecs(n) : 0;
}

/**
 * Servers an autoscaled group runs for `work` requests per second, each `cap` strong: as many as keep each one at most
 * scaleAt busy, from 1 to maxCopies.
 */
export const copiesFor = (work, cap) => Math.min(T.maxCopies, Math.max(1, Math.ceil(work / (T.scaleAt * cap) - 1e-9)));
/**
 * The hours of a day an autoscaled group runs, for `work` at the peak: each hour the traffic is the level's day curve
 * (a share of the peak), and the group runs copiesFor that hour's work. Without a curve, the peak all day.
 */
export const dayCopies = (work, cap) => (WORKLOAD.day || [1]).map(f => copiesFor(work * f, cap));

/** Monthly cost of one component. An autoscaled group pays for the servers it runs each hour, given its `work` at the peak. */
export function costOf(n, work = 0) {
  const c = COMPONENTS[n.type] || {};
  if (c.sized && scales(n)) { const k = dayCopies(work, serverSpec(n).cap); return Math.round(sizesOf(n.type)[n.size].cost * k.reduce((a, b) => a + b, 0) / k.length); }
  if (c.sized) return n.size ? sizesOf(n.type)[n.size].cost : 0;
  if (c.perGB) return Math.round(monthlyFileGB() * c.perGB);
  return c.cost || 0;
}
/** GB of files sent in a 30-day month. Traffic averages half its peak over a day. */
export function monthlyFileGB() {
  const M = MISSIONS[S.mission];
  return M.qps * (M.files || 0) / 2 * (WORKLOAD.fileKB || 0) * 30 * 86400 / 1e6;
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
  if (c.files) Object.assign(spec, { filePer: c.files.per, fileBase: c.files.base });
  if (runsAlone(n)) Object.assign(spec, { cap: spec.cap * c.alone.capFactor, base: c.alone.base, combined: true });
  return spec;
}

/** How `n` splits traffic over the servers behind it: 'even' (default) or 'capacity'. */
export function splitRule(n) {
  const c = n && COMPONENTS[n.type];
  if (!c || !c.algos) return 'even';
  return (c.algos[n.algo] || c.algos[c.defaultAlgo]).split;
}
