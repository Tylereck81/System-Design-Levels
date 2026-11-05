// Search autocomplete (typeahead.js): its settings, the API servers and the trie cache.
import { COMPONENTS, choiceOf, optionOf, isOn } from '../catalog.js';

/** Search autocomplete's settings, from its API servers and trie cache (either may be missing). */
export function typeaheadSettingsOf(api, trie) {
  return {
    apis: api ? optionOf(api, 'count').count : 0, browser: isOn(api, 'browser'),
    method: trie ? choiceOf(trie, 'method') : 'table', shards: trie ? optionOf(trie, 'shards').count : 1,
    map: isOn(trie, 'split'), rebuild: trie ? choiceOf(trie, 'rebuild') : 'weekly',
  };
}

/**
 * The API servers answer what their capacity allows; the trie cache's busiest shard fails what it can't take. Time
 * per request: the API server's, then the lookup.
 */
function step(n, L, ctx) {
  const c = COMPONENTS[n.type], o = ctx.outcomes.typeahead, api = c.typeahead === 'api';
  const cap = api ? o.apiCap : c.cap * o.shards, ms = api ? c.base : o.lookupMs;
  const ok = api ? Math.min(1, cap / L) : (o.shardLoad > c.cap ? 1 - o.topShare * (1 - c.cap / o.shardLoad) : 1);
  ctx.settle(n, L * ok, { load: L, cap, util: api ? L / cap : o.shardLoad / c.cap, ms, mult: 1, base: ms, unit: c.unit, drop: 1 - ok, typeahead: o });
  ctx.forward(n, L * ok);
}

const apisOf = (n) => typeaheadSettingsOf(n, null).apis;
const shardsOf = (n) => typeaheadSettingsOf(null, n).shards;

/** The API servers. Each costs the type's price. */
export const typeaheadApi = {
  id: 'typeahead-api',
  matches: (c) => c.typeahead === 'api',
  outcome: 'typeahead',
  step,
  cost: (n) => COMPONENTS[n.type].cost * apisOf(n),
  redundant: (n) => apisOf(n) > 1,
};

/** The trie cache. Each shard costs the type's price, plus its rebuild schedule's monthly cost. */
export const typeaheadTrie = {
  id: 'typeahead-trie',
  matches: (c) => c.typeahead === 'trie',
  outcome: 'typeahead',
  step,
  cost: (n) => COMPONENTS[n.type].cost * shardsOf(n) + optionOf(n, 'rebuild').cost,
  redundant: (n) => shardsOf(n) > 1,
};
