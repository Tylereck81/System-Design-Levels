// Search autocomplete: how many keystroke requests reach the servers, how fast the trie answers, and how fresh it is.

/** Share of keystroke requests a browser answers from its own cache (results kept an hour). */
export const BROWSER_HIT = 0.3;
/** Requests a second one API server handles, and lookups a second one trie cache shard handles. */
export const API_CAP = 12000;
export const SHARD_CAP = 25000;
/** ms to find the top 5 for a prefix: a database query over the frequency table, a trie walk of the prefix's subtree,
 * or reading the 5 kept at the prefix's node. */
export const LOOKUP_MS = { table: 100, trie: 60, topk: 1 };
/** Share of lookups on the busiest shard when the alphabet is cut into equal letter ranges, by shard count: more
 * queries start with some letters (c, s) than others (x, z). A shard map built from past traffic evens them out. */
export const LETTER_TOP = { 1: 1, 2: 0.6, 3: 0.45, 4: 0.36 };
/** Hours between trie rebuilds. */
export const REBUILD_H = { weekly: 168, daily: 24, hourly: 1 };

/**
 * The outcome for `qps` keystroke requests a second. Browser caching answers BROWSER_HIT of them before they reach
 * the servers. The trie cache's busiest shard takes its share; lookups beyond its capacity fail.
 * Returns reach (requests reaching the API servers), apiCap, lookupMs, topShare (busiest shard), shardLoad, served
 * (share answered) and staleH (hours until a new trending search shows up).
 */
export function typeaheadOutcome({ browser, apis, method, shards, map, rebuild }, { qps }) {
  const reach = qps * (browser ? 1 - BROWSER_HIT : 1), apiCap = apis * API_CAP;
  const topShare = map ? 1 / shards : LETTER_TOP[shards] || 1, shardLoad = Math.min(reach, apiCap) * topShare;
  const apiOk = reach ? Math.min(1, apiCap / reach) : 1;
  // Lookups on an overloaded shard fail; the others are fine.
  const shardOk = shardLoad > SHARD_CAP ? 1 - topShare * (1 - SHARD_CAP / shardLoad) : 1;
  return {
    reach, apiCap, lookupMs: LOOKUP_MS[method], topShare, shardLoad,
    served: qps ? (qps - reach + reach * apiOk * shardOk) / qps : 1,
    staleH: REBUILD_H[rebuild],
  };
}
