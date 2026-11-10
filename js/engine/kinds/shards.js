// A sharded database: one box whose shards each hold part of the data, by a shard key.
import { T, choiceOf, optionOf, sizesOf, qmul } from '../catalog.js';
import { fmt } from '../../format.js';

/** Shards the shard key spreads data over (N in key % N). */
const keyedShards = (n) => optionOf(n, 'count').count;
/** All shards: the keyed ones, plus one per hot account given its own. */
const shardCount = (n) => keyedShards(n) + (optionOf(n, 'hot').own || 0);

/**
 * Share of a sharded box's queries each shard gets. A share H of the queries are about a few hot accounts.
 * By account_id % N the other queries spread evenly; by country the largest country (bigCountry) can't be split; by
 * sign-up date the newest accounts' range gets `newest`. The hot accounts all land on the first shard (with the largest
 * country, or the oldest dates), unless each gets a shard of its own.
 */
export function shardShares(n, H) {
  const N = keyedShards(n), own = optionOf(n, 'hot').own || 0;
  const key = choiceOf(n, 'key'), rest = 1 - H;
  let shares = Array.from({ length: N }, () => rest / N);
  if (key === 'country') shares = shares.map((_, i) => rest * (i === 0 ? Math.max(T.bigCountry, 1 / N) : (1 - Math.max(T.bigCountry, 1 / N)) / (N - 1)));
  if (key === 'date') shares = shares.map((_, i) => rest * (i === N - 1 ? Math.max(T.newest, 1 / N) : (1 - Math.max(T.newest, 1 / N)) / (N - 1)));
  if (own) return shares.concat(Array.from({ length: own }, () => H / own));
  shares[0] += H;
  return shares;
}

/**
 * Each shard is its own server with its share of the queries (the mission's `hot` share is about a few hot accounts).
 * The box reports its busiest shard, the average time of the queries it served, and the share that failed on
 * overloaded shards. The result reports the busiest shard of any sharded box and the keyed shards of all of them.
 * Each shard costs its size's price.
 */
export const shardedDb = {
  id: 'sharded-db',
  matches: (c) => !!c.sharded,
  liveRows: ({ shards }) => !shards ? [] : [
    { value: shards.map(x => fmt(x.load)).join(' · '), label: 'queries/s on each shard; the busiest sets the % busy', wide: true },
  ],
  resultDefaults: { maxShardUtil: null, shardCount: 0 },
  step(n, L, ctx) {
    const sp = ctx.spec(n), shares = shardShares(n, ctx.mission.hot || 0);
    const shards = shares.map(f => { const l = L * f * sp.per, u = l / sp.cap; return { load: l, util: u, ms: sp.base * qmul(u), drop: Math.max(0, 1 - sp.cap / l) }; });
    const ok = shares.reduce((a, f, i) => a + f * (1 - shards[i].drop), 0);
    const ms = ok ? shares.reduce((a, f, i) => a + f * (1 - shards[i].drop) * shards[i].ms, 0) / ok : 0;
    const util = Math.max(...shards.map(x => x.util));
    ctx.settle(n, L * ok, { load: L * sp.per, cap: sp.cap * shards.length, util, ms, mult: ms / sp.base, base: sp.base, unit: sp.unit, drop: 1 - ok, shards });
    ctx.report({ maxShardUtil: util }, 'max');
    ctx.report({ shardCount: keyedShards(n) }, 'sum');
  },
  cost: (n) => (n.size ? sizesOf(n.type)[n.size].cost * shardCount(n) : 0),
};
