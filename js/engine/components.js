// Component helpers: what each component does with its settings, its capacity, cost and failure mode. The data they
// read (component types, sizes, time constants) is in catalog.js.
import { S, byId, WORKLOAD, MISSIONS } from '../state.js';
import { T, COMPONENTS, choiceOf, sizesOf, countOf } from './catalog.js';
import { serverNames, keyShares, movedShare } from './hashring.js';
import { idOutcome } from './ids.js';
import { CREATE_QUERIES } from './links.js';
import { downloaderRate } from './crawl.js';
import { feedOutcome } from './feed.js';
import { videoOutcome } from './video.js';
import { storageBill } from './sync.js';

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
export const isIdGen = (n) => !!(COMPONENTS[n.type] || {}).ids;
/** An ID generator's method, its servers and whether a timestamp-based one waits when its clock goes back. */
export function idSettingOf(n) {
  const ch = COMPONENTS[n.type].choices;
  return { method: choiceOf(n, 'method'), servers: ch.servers.options[choiceOf(n, 'servers')].count, wait: !!ch.clock.options[choiceOf(n, 'clock')].wait };
}
/** True when the ID generator stops if one machine fails: one server, for every method but UUIDs. */
export const idSpof = (n) => idOutcome(idSettingOf(n)).spof;
/** A crawler downloader's machines and pages a second each, given whether the DNS provider is slow. */
export function downloaderOf(n, slowDns = false) {
  const ch = COMPONENTS[n.type].choices, count = ch.count.options[choiceOf(n, 'count')].count, dnsCache = !!ch.dns.options[choiceOf(n, 'dns')].cache;
  return { count, dnsCache, per: downloaderRate({ dnsCache }, { slowDns }) };
}
/** A crawler's settings: per-host queues on its frontier (`users`), and its parser's duplicate check and URL filter. */
export function crawlSettingsOf(users, parser) {
  const on = (key) => !!parser && !!COMPONENTS[parser.type].choices[key].options[choiceOf(parser, key)].on;
  return { perHost: !!users && choiceOf(users, 'queues') === 'host', dedup: on('dedup'), filter: on('filter') };
}
/** A notification system's settings, from its notification server, message queues and workers (any may be missing). */
export function notifySettingsOf(notifier, queue, worker) {
  const on = (n, key) => !!n && !!COMPONENTS[n.type].choices[key].options[choiceOf(n, key)].on;
  return {
    check: on(notifier, 'check'), limit: on(notifier, 'limit'),
    perChannel: !!queue && !!COMPONENTS[queue.type].choices.layout.options[choiceOf(queue, 'layout')].perChannel,
    workers: worker ? COMPONENTS[worker.type].choices.count.options[choiceOf(worker, 'count')].count : 0,
    retry: on(worker, 'log'), dedupe: on(worker, 'dedupe'),
  };
}
/** A news feed's settings, from its feed service and feed cache (either may be missing). */
export function feedSettingsOf(svc, cache) {
  const ch = (n, key) => COMPONENTS[n.type].choices[key].options[choiceOf(n, key)];
  return {
    fanout: svc ? choiceOf(svc, 'fanout') : 'read', workers: svc ? ch(svc, 'workers').count : 0,
    skipInactive: !!svc && !!ch(svc, 'inactive').skip, idsOnly: !!cache && !!ch(cache, 'store').ids,
  };
}
/** GB the feed cache holds, given the feed service on the canvas (none when feeds are built at read time). */
export const feedCacheGB = (cache) => feedOutcome(feedSettingsOf(S.nodes.find(n => COMPONENTS[n.type] && COMPONENTS[n.type].feed), cache), { reads: 0, posts: 0 }).cacheGB;
/** A chat system's settings, from its chat servers and message store (either may be missing). */
export function chatSettingsOf(srv, store) {
  const on = (n, key) => !!n && !!COMPONENTS[n.type].choices[key].options[choiceOf(n, key)].on;
  return {
    servers: srv ? COMPONENTS[srv.type].choices.count.options[choiceOf(srv, 'count')].count : 0,
    protocol: srv ? choiceOf(srv, 'protocol') : 'poll', discovery: on(srv, 'reconnect'), heartbeat: on(srv, 'presence'), push: on(store, 'offline'),
  };
}
/** Search autocomplete's settings, from its API servers and trie cache (either may be missing). */
export function typeaheadSettingsOf(api, trie) {
  const ch = (n, key) => COMPONENTS[n.type].choices[key].options[choiceOf(n, key)];
  return {
    apis: api ? ch(api, 'count').count : 0, browser: !!api && !!ch(api, 'browser').on,
    method: trie ? choiceOf(trie, 'method') : 'table', shards: trie ? ch(trie, 'shards').count : 1,
    map: !!trie && !!ch(trie, 'split').on, rebuild: trie ? choiceOf(trie, 'rebuild') : 'weekly',
  };
}
/** A video platform's settings, from its upload service, transcoding servers and delivery (any may be missing). */
export function videoSettingsOf(up, tc, sv) {
  const on = (n, key) => !!n && !!COMPONENTS[n.type].choices[key].options[choiceOf(n, key)].on;
  return {
    presigned: on(up, 'url'), chunks: on(up, 'chunks'), retry: on(tc, 'retry'), popularOnly: on(sv, 'deliver'),
    workers: tc ? COMPONENTS[tc.type].choices.workers.options[choiceOf(tc, 'workers')].count : 0,
  };
}
/** Cloud file sync's settings, from its block servers, notification servers and cloud storage (any may be missing). */
export function syncSettingsOf(block, poll, store) {
  const on = (n, key) => !!n && !!COMPONENTS[n.type].choices[key].options[choiceOf(n, key)].on;
  const count = (n) => (n ? COMPONENTS[n.type].choices.count.options[choiceOf(n, 'count')].count : 0);
  return {
    blocks: count(block), delta: on(block, 'delta'), compress: on(block, 'compress'), polls: count(poll),
    tenVersions: on(store, 'versions'), cold: on(store, 'cold'), dedupe: on(store, 'dedupe'),
  };
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
/** True for the far region ('far'), false for the near one, for a located server. */
export const isFar = (n) => choiceOf(n, 'region') === 'far';
/** True when DNS answers by the user's location (GeoDNS), with health checks. */
export const isGeo = (dns) => !!dns && !!(COMPONENTS[dns.type].choices || {}).routing && COMPONENTS[dns.type].choices.routing.options[choiceOf(dns, 'routing')].geo === true;
/** True when `a` copies its data to `b` (a connection between two servers of a type that syncs). */
export const replicates = (a, b) => a.type === b.type && !!(COMPONENTS[a.type] || {}).syncs && S.edges.some(e => e.from === a.id && e.to === b.id);
export const isSticky = (n) => { const c = n && COMPONENTS[n.type]; return !!(c && c.algos && (c.algos[n.algo] || c.algos[c.defaultAlgo]).sticky); };
/** True when the server runs as an autoscaled group. */
/** A URL shortener's settings on its web server: 301 redirects, a per-account limit on new links, how codes are made. */
export function linkSettingsOf(n) {
  const ch = COMPONENTS[n.type].choices;
  return { permanent: !!ch.redirect.options[choiceOf(n, 'redirect')].permanent, limit: !!ch.limit.options[choiceOf(n, 'limit')].limit, code: choiceOf(n, 'code') };
}
/** Database queries one new link costs the server's database (1 except for a URL shortener's hashed codes). */
export const createQueries = (n) => { const ch = (COMPONENTS[n.type] || {}).choices; return ch && ch.code ? CREATE_QUERIES[choiceOf(n, 'code')] : 1; };
export const scales = (n) => { const c = COMPONENTS[n.type] || {}; return !!(c.choices && c.choices.scaling && c.choices.scaling.options[choiceOf(n, 'scaling')].auto); };
/** True when the mission's pages carry a session (a login and a cart). */
export const sessionsOn = () => !!MISSIONS[S.mission].sessions;
/** True when the server keeps sessions in its own memory: a stateful server with no session store to share them. */
export function holdsSessions(n) {
  return sessionsOn() && !!(COMPONENTS[n.type] || {}).stateful && !S.edges.some(e => e.from === n.id && isStore(byId(e.to) || {}));
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
  if (c.sync === 'block') return c.cost * syncSettingsOf(n, null, null).blocks;
  if (c.sync === 'poll') return c.cost * syncSettingsOf(null, n, null).polls;
  if (c.sync === 'store') return Math.round(storageBill(syncSettingsOf(null, null, n)));
  if (c.video === 'transcode') return c.cost * videoSettingsOf(null, n, null).workers;
  if (c.video === 'serve') return Math.round(videoOutcome(videoSettingsOf(null, null, n), { rate: 1 }).bill);
  if (c.typeahead === 'api') return c.cost * typeaheadSettingsOf(n, null).apis;
  if (c.typeahead === 'trie') return c.cost * typeaheadSettingsOf(null, n).shards + COMPONENTS[n.type].choices.rebuild.options[choiceOf(n, 'rebuild')].cost;
  if (c.chat === 'server') return c.cost * chatSettingsOf(n, null).servers;
  if (c.feed) return c.cost + 100 * feedSettingsOf(n, null).workers;
  if (c.feedCache) return Math.round(2 * feedCacheGB(n));
  if (c.notify === 'worker') return c.cost * notifySettingsOf(null, null, n).workers;
  if (c.crawl === 'download') return c.cost * downloaderOf(n).count;
  if (c.ids) { const id = idSettingOf(n); return id.method === 'uuid' ? 0 : c.cost * id.servers; }
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
