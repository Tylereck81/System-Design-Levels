// A URL shortener's traffic: which clicks and link creations reach its servers, and what each creation costs the database.

/**
 * Database queries for one new link, by how its short code is made: base 62 of a unique ID inserts it; a hash's first
 * 7 characters must first be looked up in case another link already has them; a bloom filter in memory answers most of
 * those lookups, so only its false positives (1%) reach the database.
 */
export const CREATE_QUERIES = { base62: 1, hash: 2, bloom: 1.01 };

/**
 * Traffic that reaches the servers, per second. `qps` real requests, a share `writes` of them new links and the rest
 * clicks. With a 301 redirect the browser keeps the redirect, so a share `repeat` of clicks (a browser following a link
 * it has followed before) never reach the servers, and aren't counted. `viral` extra clicks on one link come from new
 * visitors, so the browser can't answer them. `bulk` new links a second come from one account; a per-account limit
 * turns them away at once (the check is too cheap to count).
 * Returns qps (reaching), writes (their share of new links), hot (share of clicks on the viral link), counted (share of
 * all clicks that reach the servers) and bots (bulk creations let through).
 */
export function linkTraffic({ permanent, limit }, { qps, writes, repeat, viral = 0, bulk = 0 }) {
  const clicks = qps * (1 - writes), creates = qps * writes;
  const reach = clicks * (permanent ? 1 - repeat : 1) + viral, bots = limit ? 0 : bulk;
  const total = reach + creates + bots;
  return { qps: total, writes: total ? (creates + bots) / total : 0, hot: reach ? viral / reach : 0, counted: (clicks + viral) ? reach / (clicks + viral) : 1, bots };
}
