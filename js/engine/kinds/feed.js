// A news feed (feed.js): its settings, the feed service, and the feed cache's monthly bill.
import { COMPONENTS, choiceOf, optionOf, byFlag } from '../catalog.js';
import { fmt } from '../../format.js';
import { feedOutcome } from '../feed.js';

/** A news feed's settings, from its feed service and feed cache (either may be missing). */
export function feedSettingsOf(svc, cache) {
  return {
    fanout: svc ? choiceOf(svc, 'fanout') : 'read', workers: svc ? optionOf(svc, 'workers').count : 0,
    skipInactive: !!svc && !!optionOf(svc, 'inactive').skip, idsOnly: !!cache && !!optionOf(cache, 'store').ids,
  };
}
/** GB the feed cache holds, given the feed service among `nodes` (none when feeds are built at read time). */
export function feedCacheGB(cache, nodes) {
  return feedOutcome(feedSettingsOf(byFlag(nodes, 'feed'), cache), { reads: 0, posts: 0 }).cacheGB;
}

/**
 * The feed service: posts are always taken; feed loads are answered as far as the post store keeps up with what is
 * pulled at read time. It reads and writes the feed cache. It costs the type's price plus $100 per fanout worker.
 */
export const feedService = {
  id: 'feed-service',
  matches: (c) => !!c.feed,
  liveRows: ({ feed }) => !feed ? [] : [
    { value: fmt(feed.writes), label: `feed cache writes a second (fanout), ${fmt(feed.cacheGB)} GB cached`, wide: true },
    { value: feed.lag === Infinity ? 'never' : fmt(feed.lag) + ' s', label: 'for a post to reach friends\' feeds', tone: feed.lag > 5 ? 'bad' : null, wide: true },
  ],
  outcome: 'feed',
  step(n, L, ctx) {
    const c = COMPONENTS[n.type], o = ctx.outcomes.feed, w = ctx.writes, s = L * (w + (1 - w) * o.served);
    ctx.settle(n, s, { load: L, cap: c.cap, util: L / c.cap, ms: o.readMs, mult: 1, base: o.readMs, unit: c.unit, drop: 1 - s / L, feed: o });
    ctx.forward(n, s);
  },
  cost: (n) => COMPONENTS[n.type].cost + 100 * feedSettingsOf(n, null).workers,
};

/** The feed cache: a managed store that costs $2 a month per GB it holds. */
export const feedCache = {
  id: 'feed-cache',
  matches: (c) => !!c.feedCache,
  cost: (n, work, nodes) => Math.round(2 * feedCacheGB(n, nodes)),
};
