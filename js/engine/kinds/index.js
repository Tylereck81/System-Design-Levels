// Component kinds: what a component type with its own rules does, in one place, so a new type adds a file here instead
// of a branch in loadPhase, costOf and countSpofs. A type with no kind follows the generic rules.
//
// A kind: { id, matches(c), outcome?, step?(n, L, ctx), cost?(n, work, nodes), redundant?(n), resultDefaults? }
//   matches    true for the catalog entry `c` (COMPONENTS[type]) of the types it describes, by catalog flag
//   outcome    the workload field (workloads.js) its step reads; while that outcome is null the type takes the generic
//              server step instead
//   step       its load rule for `L` requests a second in loadPhase (model.js), given ctx (below)
//   cost       its monthly cost (components.js costOf), given its `work` at the peak and the design's `nodes`
//   redundant  true when it keeps working with one machine down, so it is not a single point of failure on its own
//   resultDefaults  the model result fields its step reports, with their value when no such component runs; model()
//              starts its result with every kind's defaults
//
// ctx, what a step may read and do (model.js loadPhase builds it once per load pass; nothing else is in it):
//   mission, workload, flag(key), total(key), nodes   the workload environment (workloads.js): the mission, the level's
//              WORKLOAD, and the running experiments: flag(key) is true while one sets `key`, total(key) adds up a
//              number they set. The monthly-cost pass sees no experiment.
//   outcomes, writes      the workloads' outcomes by field, and the share of requests that write
//   entry, down           the servers Users send pages to, and the set of ids of the components that are down
//   spec(n)               serverSpec(n): its capacity, work per request, base time and unit (a fresh object)
//   autoscale(n, work, cap)  servers an autoscaled group runs for `work` (sized for the hour); 0 when `n` is not one
//   senders(n)            the components that connect to `n`
//   servedOf(id)          what an earlier server in this pass served (0 when none); backlog(id): a queue's waiting jobs
//   hitRate(id)           the hit rate its senders' cache-aside gave a cache (0 when none)
//   botLoad(id)           the bots' requests a second reaching an entry server
//   groupsOf(n)           { deps, store }: the server groups `n` hands work to, and its session or counter store (or null)
//   settle(n, served, stat)  record what `n` served and its stat (r.node[n.id])
//   forward(n, flow, groups = deps)  send `flow` on, split over each group as its sender's routing says
//   report(values, rule)  put result fields, combining with what other components reported (see COMBINE)
//   issue(key)            the message TXT[key] explains the design's problem, unless another already does
// Kind files import only catalog.js and pure outcome modules (tests/unit/kinds.test.mjs checks it), so components.js
// and model.js can import them without a cycle.
import { notifyWorker } from './notify.js';
import { feedService, feedCache } from './feed.js';
import { chatServer } from './chat.js';
import { typeaheadApi, typeaheadTrie } from './typeahead.js';
import { videoUpload, videoTranscode, videoServe } from './video.js';
import { syncBlock, syncPoll, syncStore } from './sync.js';
import { worker } from './worker.js';
import { shardedDb } from './shards.js';
import { cacheCluster } from './cluster.js';
import { kvStore } from './quorum.js';
import { idGenerator } from './ids.js';
import { downloader, parser } from './crawl.js';
import { rateLimiter } from './limiter.js';
import { COMPONENTS } from '../catalog.js';

/** Every kind; a type matches at most one (tests/unit/kinds.test.mjs checks it). */
export const KINDS = [
  notifyWorker, feedService, feedCache, chatServer, typeaheadApi, typeaheadTrie,
  videoUpload, videoTranscode, videoServe, syncBlock, syncPoll, syncStore,
  worker, shardedDb, cacheCluster, kvStore, idGenerator, downloader, parser, rateLimiter,
];

/** Every kind's result fields at their value when no component of that kind runs. */
export const RESULT_DEFAULTS = Object.assign({}, ...KINDS.map((k) => k.resultDefaults));

/**
 * How report() combines a value with the field's value so far, when several components report one field:
 * set: the last one; sum: added up; max: the largest (at least 0); and: true while every one is true.
 */
export const COMBINE = {
  set: (_, v) => v,
  sum: (a, v) => (a || 0) + v,
  max: (a, v) => Math.max(a || 0, v),
  and: (a, v) => a !== false && v,
};

const byType = new Map(); // the catalog does not change, so each type's kind is looked up once
/** The kind of node `n`'s type, or null when it has none (or its type is unknown). */
export function kindOf(n) {
  if (!byType.has(n.type)) {
    const c = COMPONENTS[n.type];
    byType.set(n.type, (c && KINDS.find((k) => k.matches(c))) || null);
  }
  return byType.get(n.type);
}
