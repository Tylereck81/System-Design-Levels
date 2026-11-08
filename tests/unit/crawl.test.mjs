// js/engine/crawl.js: downloader speed and what the crawl does to hosts, traps and storage, worked out by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloaderRate, crawlOutcome } from '../../js/engine/crawl.js';
import { fields } from './near.mjs';

test('downloaderRate: DNS one lookup at a time limits it until a cache is added', () => {
  // Threads: 100 × 1000 / 500 ms = 200 pages/s. DNS: 1000 / 10 ms = 100 → 100.
  assert.equal(downloaderRate({ dnsCache: false }), 100);
  // Slow DNS: 1000 / 200 ms = 5.
  assert.equal(downloaderRate({ dnsCache: false }, { slowDns: true }), 5);
  // Cache: only 2% look up, 1000 / (0.02 × 10) = 5,000 → threads' 200; even slow, 1000 / (0.02 × 200) = 250 → 200.
  assert.equal(downloaderRate({ dnsCache: true }), 200);
  assert.equal(downloaderRate({ dnsCache: true }, { slowDns: true }), 200);
});

const cfg = (o) => ({ perHost: false, dedup: false, filter: false, ...o });

test('a normal FIFO crawl: the busiest host gets its share; storage for the month', () => {
  // 1,000 × 0.02 = 20 req/s to one host. Storage 2e9 pages × 300 KB / 1e9 = 600 TB; dedupe keeps 1 − 0.29 → 426 TB.
  fields(crawlOutcome(cfg(), { rate: 1000 }), { hostRate: 20, refused: 0, wasted: 0, trapAdds: 0, storageTB: 600 });
  fields(crawlOutcome(cfg({ dedup: true }), { rate: 1000 }), { storageTB: 426 });
});

test('one site floods the frontier: FIFO hammers it and is refused; per-host queues stay polite', () => {
  // 1,000 × 0.3 = 300 req/s, refused 0.3 of downloads. Per host: 1 req/s.
  fields(crawlOutcome(cfg(), { rate: 1000, flood: true }), { hostRate: 300, refused: 0.3 });
  fields(crawlOutcome(cfg({ perHost: true }), { rate: 1000, flood: true }), { hostRate: 1, refused: 0 });
});

test('a crawler trap: its share of a FIFO crawl, one a second per host, none with a URL filter', () => {
  // FIFO: 1,000 × 0.4 = 400 trap pages/s → wasted 0.4, 400 × 10 = 4,000 new URLs/s.
  fields(crawlOutcome(cfg(), { rate: 1000, trap: true }), { wasted: 0.4, trapAdds: 4000 });
  // Per host: 1 page/s → wasted 1 / 1,000, 10 new URLs/s.
  fields(crawlOutcome(cfg({ perHost: true }), { rate: 1000, trap: true }), { wasted: 0.001, trapAdds: 10 });
  fields(crawlOutcome(cfg({ filter: true }), { rate: 1000, trap: true }), { wasted: 0, trapAdds: 0 });
});

test('no downloads: nothing wasted (no divide by zero)', () => {
  fields(crawlOutcome(cfg({ perHost: true }), { rate: 0, trap: true }), { hostRate: 1, wasted: 0, trapAdds: 10 });
  fields(crawlOutcome(cfg(), { rate: 0 }), { hostRate: 0, wasted: 0 });
});
