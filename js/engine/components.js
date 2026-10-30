// Component types: capacity, base time, cost and failure mode for everything on the canvas.
import { S, byId, WORKLOAD, MISSIONS } from '../state.js';
import { serverNames, keyShares, movedShare } from './hashring.js';

export const SIZES = {
  S: { cpu: 2, cap: 200, cost: 40 },
  M: { cpu: 4, cap: 400, cost: 90 },
  L: { cpu: 8, cap: 800, cost: 200 },
  XL: { cpu: 16, cap: 1600, cost: 450 },
};
export const T = { rtt: 40, web: 20, db: 10, dc: 0.5, dns: 5, nosqlLookup: 3, nosqlLookups: 3, lb: 1, lag: 1, cache: 0.1, far: 120, file: 2, cdn: 1, scaleAt: 0.6, maxCopies: 10, dcPage: 50, dcLag: 1, job: 20000, publish: 2, drain: 60, bigCountry: 0.42, newest: 0.5, keyLimit: 1, burst: 12, burstSecs: 2 };
// lag: seconds a replica runs behind its primary; cache: ms for a lookup in memory; far: internet round trip for users far
// from the data center; file: ms a web server takes to send a static file; cdn: ms for an edge server to answer from its cache;
// scaleAt: how busy the autoscaler lets each server get; maxCopies: the most servers one autoscaled group runs;
// dcPage: ms a page spends inside a data center; dcLag: seconds data replicated to another data center runs behind;
// job: ms of one vCPU to process one uploaded file; publish: ms to put a message on a queue;
// drain: seconds an autoscaled worker group aims to clear its queue's backlog in;
// bigCountry: share of queries from the largest country; newest: share of queries on the newest accounts' range;
// keyLimit: requests per second an API key may send on average (60 a minute); burst: requests a real user sends in
// burstSecs seconds while typing a search

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
// flat: the time inside stays at its base up to full capacity (the servers inside scale out to keep it there).
// located: a server in one of the users' regions (its region choice: 'near' or 'far'). DNS with geo: true sends each
//   region to its own healthy servers; plain DNS hands out every address, so each region spreads over all of them.
// syncs: a connection to a server of the same type copies data to it (replication), not requests.
// jobs: in a mission with uploads, the server processes an upload itself (per = its work, as a share of a page's;
//   base = ms) unless it connects to a queue. Then it only publishes a message there, and the request ends.
// queue: a message queue. It answers at once; the servers it connects to (consumers) take its jobs later.
// consumes: a worker. It takes jobs from its queue as fast as its capacity allows; jobs it can't take yet wait
//   in the queue (the backlog, kept by the simulation loop) instead of failing.
// role 'monitor': off the request path; it watches the queues it connects to and alerts when one grows.
// An option with count: n runs n servers of the chosen size (see countOf).
// sharded: one box for a database split into shards (see shardShares): each holds part of the data, by a shard key.
// offload: a store that takes the mission's non-relational share of a server's queries (nonRel) off its database.
// clustered: one box for a cache cluster of `count` servers. Keys are placed by its hashing choice (see clusterLayout);
//   each server's memory holds part of its own keys (see clusterHit). Read like a cache (aside), it is a single point
//   of failure only with one server: a lost server's keys move to the others.
// quorum: a replicated key-value store, one box for its nodes and coordinator. Each key is kept on N replicas; a write
//   waits for W of them and a read for R (see quorumOutcome). Its cost is per replica (cost × N).
// limits: a rate limiter. It checks each request against its API key's quota (see limiterRule), answers the excess with
//   429, and forwards the rest. Connected to a store, it keeps its counters there, shared with the other limiters.
// algos with sticky: true keep each user on the server they started on, so sessions held in memory are always found.
// choices: settings the player picks per server, stored as n[key]; each lists its options and a default.
//   staleBy names the choice whose option says (stale: true) that a changed item is served until its TTL ends.
//   An option with auto: true makes the server an autoscaled group (see copiesFor).
// Failure mode for every server: when down it serves nothing; its share moves to healthy peers,
// and with no healthy peer every request sent to it fails.
export const COMPONENTS = {
  users: { role: 'client' },
  dns: { role: 'resolver', cost: T.dns, choices: { routing: { options: { rr: {}, geo: { geo: true } }, default: 'rr' } } },
  lb: { role: 'server', cap: 5000, base: T.lb, cost: 20, unit: 'req/s', routing: 'standby', forwards: true,
    algos: { rr: { split: 'even' }, wrr: { split: 'capacity' }, lc: { split: 'capacity' }, sticky: { split: 'even', sticky: true } }, defaultAlgo: 'rr' },
  web: {
    role: 'server', sized: true, base: T.web, unit: 'req/s', alone: { missing: ['db', 'shards'], capFactor: 0.5, base: T.web + T.db }, files: { per: T.file / T.web, base: T.file },
    jobs: { per: 2000, base: T.job }, // a web server of a size does as many jobs as a worker of that size
    stateful: true, choices: { scaling: { options: { fixed: {}, auto: { auto: true } }, default: 'fixed' } },
  },
  session: { role: 'server', cap: 10000, base: T.nosqlLookup, cost: 150, unit: 'lookups/s', store: true, managed: true },
  queue: { role: 'server', cap: 10000, base: T.publish, cost: 50, unit: 'messages/s', queue: true, managed: true },
  worker: {
    role: 'server', sized: true, base: T.job, unit: 'jobs/s', consumes: true,
    sizes: { S: { cpu: 2, cap: 2000 / T.job, cost: 40 }, M: { cpu: 4, cap: 4000 / T.job, cost: 90 }, L: { cpu: 8, cap: 8000 / T.job, cost: 200 }, XL: { cpu: 16, cap: 16000 / T.job, cost: 450 } },
    choices: { scaling: { options: { 1: { count: 1 }, 2: { count: 2 }, 4: { count: 4 }, 8: { count: 8 }, auto: { auto: true } }, default: '1' } },
  },
  monitor: { role: 'monitor', cost: 30 },
  shards: {
    role: 'server', sized: true, base: T.db, unit: 'queries/s', sharded: true,
    choices: {
      count: { options: { 2: { count: 2 }, 3: { count: 3 }, 4: { count: 4 }, 8: { count: 8 } }, default: '2' },
      key: { options: { account: {}, country: {}, date: {} }, default: 'account' },
      hot: { options: { stay: {}, own: { own: 3 } }, default: 'stay' },
    },
  },
  limiter: {
    role: 'server', cap: 6000, base: T.lb, cost: 100, unit: 'req/s', forwards: true, limits: true,
    choices: {
      algo: { options: { token: {}, leaky: {}, fixed: {}, slog: {}, scount: {} }, default: 'token' },
      bucket: { options: { 4: { size: 4 }, 12: { size: 12 }, 60: { size: 60 } }, default: '4' },
      refill: { options: { 1: { rate: 1 }, 5: { rate: 5 } }, default: '1' },
    },
  },
  ring: {
    role: 'server', sized: true, base: T.cache, unit: 'lookups/s', aside: true, clustered: true,
    sizes: {
      S: { mem: 2, cap: 10000, cost: 20 },
      M: { mem: 4, cap: 10000, cost: 40 },
      L: { mem: 8, cap: 10000, cost: 80 },
      XL: { mem: 16, cap: 10000, cost: 160 },
    },
    choices: {
      count: { options: { 3: { count: 3 }, 5: { count: 5 }, 6: { count: 6 }, 8: { count: 8 }, 10: { count: 10 } }, default: '5' },
      hashing: { options: { mod: { mod: true }, ring: { vnodes: 1 }, v10: { vnodes: 10 }, v100: { vnodes: 100 }, v500: { vnodes: 500 } }, default: 'mod' },
    },
  },
  kv: {
    role: 'server', cap: 20000, base: 2, cost: 150, unit: 'requests/s', quorum: true,
    choices: {
      n: { options: { 1: { n: 1 }, 3: { n: 3 }, 5: { n: 5 } }, default: '3' },
      w: { options: { 1: { q: 1 }, 2: { q: 2 }, 3: { q: 3 }, 4: { q: 4 }, 5: { q: 5 } }, default: '1' },
      r: { options: { 1: { q: 1 }, 2: { q: 2 }, 3: { q: 3 }, 4: { q: 4 }, 5: { q: 5 } }, default: '1' },
      mode: { options: { strict: {}, sloppy: { sloppy: true } }, default: 'strict' },
    },
  },
  counter: { role: 'server', cap: 50000, base: T.cache, cost: 60, unit: 'ops/s', store: true, managed: true },
  nosql: { role: 'server', cap: 20000, base: T.nosqlLookup, cost: 200, unit: 'lookups/s', offload: true, managed: true },
  // A whole data center: load balancers, autoscaled web servers, caches, databases and a session store.
  dc: {
    role: 'server', sized: true, base: T.dcPage, unit: 'pages/s', flat: true, located: true, syncs: true, files: { per: T.file / T.web, base: T.file },
    sizes: { S: { cap: 800, cost: 700 }, M: { cap: 1600, cost: 1200 }, L: { cap: 2400, cost: 1700 } },
    choices: { region: { options: { near: {}, far: {} }, default: 'near' } },
  },
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
export const isLocated = (n) => !!(COMPONENTS[n.type] || {}).located;
export const isQueue = (n) => !!(COMPONENTS[n.type] || {}).queue;
export const isOffload = (n) => !!(COMPONENTS[n.type] || {}).offload;
export const isQuorum = (n) => !!(COMPONENTS[n.type] || {}).quorum;
/** A key-value store's replicas (N), write and read quorums (W, R, at most N) and whether its quorum is sloppy. */
export function quorumOf(n) {
  const ch = COMPONENTS[n.type].choices, N = ch.n.options[choiceOf(n, 'n')].n;
  return { N, W: Math.min(N, ch.w.options[choiceOf(n, 'w')].q), R: Math.min(N, ch.r.options[choiceOf(n, 'r')].q), sloppy: !!ch.mode.options[choiceOf(n, 'mode')].sloppy };
}
export const isClustered = (n) => !!(COMPONENTS[n.type] || {}).clustered;
/** Servers in a cache cluster. */
export const clusterSize = (n) => COMPONENTS[n.type].choices.count.options[choiceOf(n, 'count')].count;
/** The cluster's servers by name (A, B, C…). Resized by −1, server C has gone; by +1, the next letter has joined. */
export function clusterNames(n, resize = 0) {
  const names = serverNames(clusterSize(n) + Math.max(0, resize));
  return resize < 0 ? names.filter((s) => s !== 'C') : names;
}
/** The cluster's hashing: { mod: true } for hash % N, or { vnodes } points per server on a hash ring. */
export const hashMethod = (n) => COMPONENTS[n.type].choices.hashing.options[choiceOf(n, 'hashing')];
/** Share of the keys each server holds, and the share whose server changed when the cluster was resized. */
export function clusterLayout(n, resize = 0) {
  const names = clusterNames(n, resize), method = hashMethod(n);
  return { names, shares: keyShares(names, method), moved: resize ? movedShare(clusterNames(n), names, method) : 0 };
}
/**
 * Share of reads a cache cluster answers. Each server holds its share of the keys and keeps as many of them as its
 * memory fits, the most read first (the 80/20 rule, as in hitRate), so a server holding more than its share keeps
 * a smaller part of it. Items stay WORKLOAD.cacheTtlSecs.
 */
export function clusterHit(n, shares) {
  const mem = sizesOf(n.type)[n.size].mem, ttl = WORKLOAD.cacheTtlSecs, a = Math.log(0.8) / Math.log(0.2);
  return Object.values(shares).reduce((sum, x) => sum + (x > 0 ? x * Math.pow(Math.min(1, mem / (WORKLOAD.catalogGB * x)), a) : 0), 0) * ttl / (ttl + WORKLOAD.readGapSecs);
}
/**
 * What a rate limiter's algorithm does, per API key:
 * q: the requests a key gets through in any rolling minute, as a multiple of the limit (60). Token and leaking buckets
 *   pass `refill` a second; at a window edge a token bucket also passes its whole bucket, and a fixed window passes
 *   its quota on both sides of the edge (2×). Sliding windows and the leaking bucket's fixed outflow stay at 1.
 * fb: the share of a real user's requests blocked. A user types a search: `burst` requests in `burstSecs` seconds.
 *   A bucket holds `size` and refills `rate` a second, so a burst bigger than size + rate × burstSecs is cut.
 * wait: ms a real request waits in a leaking bucket's queue, which sends requests on at its fixed rate.
 */
export function limiterRule(n, edge) {
  const ch = COMPONENTS[n.type].choices, algo = choiceOf(n, 'algo');
  const size = ch.bucket.options[choiceOf(n, 'bucket')].size, rate = ch.refill.options[choiceOf(n, 'refill')].rate;
  const fb = Math.max(0, T.burst - size - rate * T.burstSecs) / T.burst;
  if (algo === 'token') return { q: edge ? (size + 60 * rate * T.keyLimit) / 60 : rate, fb, wait: 0 };
  if (algo === 'leaky') return { q: rate, fb, wait: Math.max(0, 1000 * (T.burst / rate - T.burstSecs) / 2) };
  if (algo === 'fixed') return { q: edge ? 2 : 1, fb: 0, wait: 0 };
  return { q: 1, fb: 0, wait: 0 }; // sliding window log or counter
}
/** Shards the shard key spreads data over (N in key % N), and all shards, including one per hot account given its own. */
export const keyedShards = (n) => COMPONENTS[n.type].choices.count.options[choiceOf(n, 'count')].count;
export const shardCount = (n) => keyedShards(n) + (COMPONENTS[n.type].choices.hot.options[choiceOf(n, 'hot')].own || 0);
/**
 * Share of a sharded box's queries each shard gets. A share H of the queries are about a few hot accounts.
 * By account_id % N the other queries spread evenly; by country the largest country (bigCountry) can't be split; by
 * sign-up date the newest accounts' range gets `newest`. The hot accounts all land on the first shard (with the largest
 * country, or the oldest dates), unless each gets a shard of its own.
 */
export function shardShares(n, H) {
  const ch = COMPONENTS[n.type].choices, N = ch.count.options[choiceOf(n, 'count')].count, own = ch.hot.options[choiceOf(n, 'hot')].own || 0;
  const key = choiceOf(n, 'key'), rest = 1 - H;
  let shares = Array.from({ length: N }, () => rest / N);
  if (key === 'country') shares = shares.map((_, i) => rest * (i === 0 ? Math.max(T.bigCountry, 1 / N) : (1 - Math.max(T.bigCountry, 1 / N)) / (N - 1)));
  if (key === 'date') shares = shares.map((_, i) => rest * (i === N - 1 ? Math.max(T.newest, 1 / N) : (1 - Math.max(T.newest, 1 / N)) / (N - 1)));
  if (own) return shares.concat(Array.from({ length: own }, () => H / own));
  shares[0] += H;
  return shares;
}
/** How many servers a fixed choice runs (1 unless its scaling option gives a count). */
export const countOf = (n) => { const c = COMPONENTS[n.type] || {}; return (c.choices && c.choices.scaling && c.choices.scaling.options[choiceOf(n, 'scaling')].count) || 1; };
/** True for the far region ('far'), false for the near one, for a located server. */
export const isFar = (n) => choiceOf(n, 'region') === 'far';
/** True when DNS answers by the user's location (GeoDNS), with health checks. */
export const isGeo = (dns) => !!dns && !!(COMPONENTS[dns.type].choices || {}).routing && COMPONENTS[dns.type].choices.routing.options[choiceOf(dns, 'routing')].geo === true;
/** True when `a` copies its data to `b` (a connection between two servers of a type that syncs). */
export const replicates = (a, b) => a.type === b.type && !!(COMPONENTS[a.type] || {}).syncs && S.edges.some(e => e.from === a.id && e.to === b.id);
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
  if (c.sharded) return n.size ? sizesOf(n.type)[n.size].cost * shardCount(n) : 0;
  if (c.clustered) return n.size ? sizesOf(n.type)[n.size].cost * clusterSize(n) : 0;
  if (c.quorum) return c.cost * quorumOf(n).N;
  if (c.sized && scales(n)) { const k = dayCopies(work, serverSpec(n).cap); return Math.round(sizesOf(n.type)[n.size].cost * k.reduce((a, b) => a + b, 0) / k.length); }
  if (c.sized) return n.size ? sizesOf(n.type)[n.size].cost * countOf(n) : 0;
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
  return !!a && !S.edges.some(e => e.from === n.id && [].concat(a.missing).includes((byId(e.to) || {}).type));
}

/** Capacity and work per request for a server, given its size, kind and dependencies. */
export function serverSpec(n) {
  const c = COMPONENTS[n.type];
  const kind = c.kinds ? c.kinds[n.kind] || c.kinds[Object.keys(c.kinds)[0]] : null;
  const spec = { cap: c.sized ? sizesOf(n.type)[n.size].cap : c.cap, per: 1, base: c.base, unit: c.unit };
  if (kind) Object.assign(spec, { per: kind.per, base: kind.base, unit: kind.unit, nosql: n.kind === 'nosql' });
  if (c.files) Object.assign(spec, { filePer: c.files.per, fileBase: c.files.base });
  if (c.jobs) Object.assign(spec, { jobPer: c.jobs.per, jobBase: c.jobs.base });
  if (countOf(n) > 1) spec.cap *= countOf(n);
  if (c.flat) spec.flat = true;
  if (runsAlone(n)) Object.assign(spec, { cap: spec.cap * c.alone.capFactor, base: c.alone.base, combined: true });
  return spec;
}

/** How `n` splits traffic over the servers behind it: 'even' (default) or 'capacity'. */
export function splitRule(n) {
  const c = n && COMPONENTS[n.type];
  if (!c || !c.algos) return 'even';
  return (c.algos[n.algo] || c.algos[c.defaultAlgo]).split;
}
