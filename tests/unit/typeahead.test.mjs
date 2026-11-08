// js/engine/typeahead.js: requests reaching the servers, the busiest trie shard, lookup time and freshness, by hand.
// Constants: browser answers 30%; 12,000 req/s an API server, 25,000 lookups/s a shard.
import { test } from 'node:test';
import { typeaheadOutcome } from '../../js/engine/typeahead.js';
import { fields } from './near.mjs';

const cfg = (o) => ({ browser: false, apis: 1, method: 'trie', shards: 1, map: false, rebuild: 'weekly', ...o });

test('within capacity: all served; lookup and staleness come from the method and the rebuild', () => {
  fields(typeaheadOutcome(cfg(), { qps: 10000 }), { reach: 10000, apiCap: 12000, lookupMs: 60, topShare: 1, shardLoad: 10000, served: 1, staleH: 168 });
  fields(typeaheadOutcome(cfg({ method: 'table', rebuild: 'daily' }), { qps: 10000 }), { lookupMs: 100, staleH: 24 });
  fields(typeaheadOutcome(cfg({ method: 'topk', rebuild: 'hourly' }), { qps: 10000 }), { lookupMs: 1, staleH: 1 });
});

test('browser caching: 30% never reach the servers', () => {
  // 10,000 × 0.7 = 7,000 reach; (3,000 + 7,000) / 10,000 served.
  fields(typeaheadOutcome(cfg({ browser: true }), { qps: 10000 }), { reach: 7000, served: 1 });
});

test('API servers overloaded: served is their capacity over what reaches them', () => {
  // 12,000 / 24,000 = 0.5; the shard sees only the 12,000 handled.
  fields(typeaheadOutcome(cfg(), { qps: 24000 }), { served: 0.5, shardLoad: 12000 });
});

test('the busiest shard overloaded: its lookups beyond capacity fail', () => {
  // 2 letter-range shards: busiest 0.6 × 100,000 = 60,000 > 25,000; 1 − 0.6 × (1 − 25,000 / 60,000) = 0.65.
  fields(typeaheadOutcome(cfg({ apis: 10, shards: 2 }), { qps: 100000 }), { topShare: 0.6, shardLoad: 60000, served: 0.65 });
  // A shard map evens them out: 0.5 × 100,000 = 50,000; 1 − 0.5 × (1 − 0.5) = 0.75.
  fields(typeaheadOutcome(cfg({ apis: 10, shards: 2, map: true }), { qps: 100000 }), { topShare: 0.5, served: 0.75 });
});

test('letter ranges by shard count, a count with no entry, and no traffic', () => {
  fields(typeaheadOutcome(cfg({ shards: 3 }), { qps: 1000 }), { topShare: 0.45 });
  fields(typeaheadOutcome(cfg({ shards: 4 }), { qps: 1000 }), { topShare: 0.36 });
  fields(typeaheadOutcome(cfg({ shards: 5 }), { qps: 1000 }), { topShare: 1 }); // no entry: treated as one range
  fields(typeaheadOutcome(cfg({ shards: 5, map: true }), { qps: 1000 }), { topShare: 0.2 });
  fields(typeaheadOutcome(cfg(), { qps: 0 }), { reach: 0, served: 1 });
});
