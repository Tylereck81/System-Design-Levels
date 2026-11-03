// A news feed: how fast a feed loads, how long a post takes to reach friends' feeds, and how big the feed cache is.

/** Friends a user has on average, users, and the posts each feed keeps in the cache. */
export const FRIENDS = 300;
export const USERS = 15e6;
export const FEED_KEEP = 500;
/** Bytes per feed cache entry: a post ID and a user ID, or the whole post. */
export const ID_BYTES = 16;
export const POST_BYTES = 1000;
/** Feed cache writes a second one fanout worker makes. */
export const WORKER_WRITES = 20000;
/** Share of a user's friends who haven't opened the app in a month. */
export const INACTIVE = 0.4;
/** Followers of the star account in the experiment, and the stars an average user follows. */
export const STAR = 5e6;
export const STARS_FOLLOWED = 5;
/** ms to read a feed's IDs from the cache, and per post looked up at read time. */
export const CACHE_MS = 5;
export const LOOKUP_MS = 0.3;
/** Post lookups a second the post store answers. */
export const LOOKUPS_CAP = 500000;
/** Seconds for a post to reach friends' feeds while the fanout workers keep up. */
export const LAG_OK = 1;

/**
 * The feed's outcome for `reads` feed loads and `posts` new posts a second. Fanout on write ('write') puts each post's
 * ID in every friend's cached feed (fewer writes when inactive friends are skipped), so a load reads one list. Fanout
 * on read ('read') looks up every friend's recent posts at load time. The hybrid pushes everyone's posts except
 * stars', which followers pull at load time. A star's post on fanout on write is millions of writes, waiting for the
 * workers' spare capacity.
 * Returns readMs, served (share of feed loads the post store can answer), lag (seconds for a post to reach feeds;
 * Infinity when the workers fall behind), writes (feed cache writes a second) and cacheGB.
 */
export function feedOutcome({ fanout, workers, skipInactive, idsOnly }, { reads, posts, star = false }) {
  const push = fanout !== 'read', pulled = fanout === 'read' ? FRIENDS : fanout === 'hybrid' ? STARS_FOLLOWED : 0;
  const writes = push ? posts * FRIENDS * (skipInactive ? 1 - INACTIVE : 1) : 0, spare = workers * WORKER_WRITES - writes;
  let lag = !push ? 0 : spare <= 0 ? Infinity : LAG_OK;
  if (star && fanout === 'write' && spare > 0) lag = Math.max(lag, STAR * (skipInactive ? 1 - INACTIVE : 1) / spare);
  const lookups = reads * pulled;
  return {
    readMs: CACHE_MS + LOOKUP_MS * pulled,
    served: lookups > LOOKUPS_CAP ? LOOKUPS_CAP / lookups : 1,
    lag, writes,
    cacheGB: push ? USERS * FEED_KEEP * (idsOnly ? ID_BYTES : POST_BYTES) / 1e9 : 0,
  };
}
