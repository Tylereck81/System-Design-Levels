// Component helpers: what each component does with its settings, its capacity, cost and failure mode. The data they
// read (component types, sizes, time constants) is in catalog.js.
import { S, byId, WORKLOAD, MISSIONS } from '../state.js';
import { T, COMPONENTS, choiceOf, optionOf, sizesOf, countOf, componentOf, hasFlag } from './catalog.js';
import { CREATE_QUERIES } from './links.js';
import { kindOf } from './kinds/index.js';

export const roleOf = (n) => componentOf(n).role;
export const isServer = (n) => roleOf(n) === 'server';
export const isReplicated = hasFlag('replicated');
export const isReplica = (n) => isReplicated(n) && n.role === 'replica';
export const isCache = hasFlag('aside');
export const isEdge = hasFlag('edge');
export const isStore = hasFlag('store');
export const isLocated = hasFlag('located');
export const isQueue = hasFlag('queue');
export const isOffload = hasFlag('offload');
export const isClustered = hasFlag('clustered');
/** True for a type whose servers copy their data to each other when connected (see replicates). */
export const isSyncing = hasFlag('syncs');
export const isStateful = hasFlag('stateful');
/**
 * Share of reads a cache cluster answers. Each server holds its share of the keys and keeps as many of them as its
 * memory fits, the most read first (the 80/20 rule, as in hitRate), so a server holding more than its share keeps
 * a smaller part of it. Items stay WORKLOAD.cacheTtlSecs.
 */
export function clusterHit(n, shares) {
  const mem = sizesOf(n.type)[n.size].mem, ttl = WORKLOAD.cacheTtlSecs, a = Math.log(0.8) / Math.log(0.2);
  return Object.values(shares).reduce((sum, x) => sum + (x > 0 ? x * Math.pow(Math.min(1, mem / (WORKLOAD.catalogGB * x)), a) : 0), 0) * ttl / (ttl + WORKLOAD.readGapSecs);
}
/** True for the far region ('far'), false for the near one, for a located server. */
export const isFar = (n) => choiceOf(n, 'region') === 'far';
/** True when DNS answers by the user's location (GeoDNS), with health checks. */
export const isGeo = (dns) => !!componentOf(dns).choices?.routing && optionOf(dns, 'routing').geo === true;
/** True when `a` copies its data to `b` (a connection between two servers of a type that syncs). */
export const replicates = (a, b) => a.type === b.type && isSyncing(a) && S.edges.some(e => e.from === a.id && e.to === b.id);
/** The balancing algorithm node `n` runs (its type's default when none is picked); undefined for a type with none. */
const algoOf = (n) => { const c = componentOf(n); return c.algos && (c.algos[n.algo] ?? c.algos[c.defaultAlgo]); };
export const isSticky = (n) => !!algoOf(n)?.sticky;
/** A URL shortener's settings on its web server: 301 redirects, a per-account limit on new links, how codes are made. */
export function linkSettingsOf(n) {
  const ch = COMPONENTS[n.type].choices;
  return { permanent: !!ch.redirect.options[choiceOf(n, 'redirect')].permanent, limit: !!ch.limit.options[choiceOf(n, 'limit')].limit, code: choiceOf(n, 'code') };
}
/** Database queries one new link costs the server's database (1 except for a URL shortener's hashed codes). */
export const createQueries = (n) => componentOf(n).choices?.code ? CREATE_QUERIES[choiceOf(n, 'code')] : 1;
/** True when the server runs as an autoscaled group. */
export const scales = (n) => !!componentOf(n).choices?.scaling?.options[choiceOf(n, 'scaling')].auto;
/** True when the mission's pages carry a session (a login and a cart). */
export const sessionsOn = () => !!MISSIONS[S.mission].sessions;
/** True when the server keeps sessions in its own memory: a stateful server with no session store to share them. */
export function holdsSessions(n) {
  return sessionsOn() && isStateful(n) && !S.edges.some(e => e.from === n.id && isStore(byId(e.to)));
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

/**
 * Monthly cost of one component: its kind's price (kinds/) when it has one, else by its catalog entry. An autoscaled group
 * pays for the servers it runs each hour, given its `work` at the peak.
 */
export function costOf(n, work = 0) {
  const kind = kindOf(n);
  if (kind?.cost) return kind.cost(n, work, S.nodes);
  const c = componentOf(n);
  if (c.sized && scales(n)) { const k = dayCopies(work, serverSpec(n).cap); return Math.round(sizesOf(n.type)[n.size].cost * k.reduce((a, b) => a + b, 0) / k.length); }
  if (c.sized) return n.size ? sizesOf(n.type)[n.size].cost * countOf(n) : 0;
  if (c.perGB) return Math.round(monthlyFileGB() * c.perGB);
  return c.cost || 0;
}
/**
 * The inspector rows node `n`'s kind adds for its stat `st` (kinds/index.js, liveRows), and whether they replace the
 * generic rows. A type with no kind adds none.
 */
export function kindRows(n, st) {
  const kind = kindOf(n);
  return { rows: kind?.liveRows?.(st, n) ?? [], only: !!kind?.liveRowsOnly };
}
/** GB of files sent in a 30-day month. Traffic averages half its peak over a day. */
export function monthlyFileGB() {
  const M = MISSIONS[S.mission];
  return M.qps * (M.files || 0) / 2 * (WORKLOAD.fileKB || 0) * 30 * 86400 / 1e6;
}

/** True when a server lacks the dependency it normally hands work to, so it does that work itself. */
export function runsAlone(n) {
  const a = componentOf(n).alone;
  return !!a && !S.edges.some(e => e.from === n.id && [].concat(a.missing).includes(byId(e.to)?.type));
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
export const splitRule = (n) => algoOf(n)?.split ?? 'even';
