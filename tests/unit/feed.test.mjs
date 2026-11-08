// js/engine/feed.js: read time, post-store load, fanout lag and feed cache size, worked out by hand.
// Constants: 300 friends, 15M users, 500 posts kept, 16 or 1,000 bytes an entry, 20,000 writes/s a worker.
import { test } from 'node:test';
import { feedOutcome } from '../../js/engine/feed.js';
import { fields } from './near.mjs';

const cfg = (o) => ({ fanout: 'write', workers: 2, skipInactive: false, idsOnly: true, ...o });

test('fanout on write within capacity: one cached list per load, posts arrive in a second', () => {
  // Writes 100 × 300 = 30,000 ≤ 2 × 20,000. Read 5 ms. Cache 15e6 × 500 × 16 B / 1e9 = 120 GB.
  fields(feedOutcome(cfg(), { reads: 10000, posts: 100 }), { readMs: 5, served: 1, lag: 1, writes: 30000, cacheGB: 120 });
  // Whole posts: 15e6 × 500 × 1,000 B / 1e9 = 7,500 GB.
  fields(feedOutcome(cfg({ idsOnly: false }), { reads: 10000, posts: 100 }), { cacheGB: 7500 });
});

test('fanout on write: workers fall behind when writes reach their capacity', () => {
  // 1 worker: 30,000 > 20,000. 3 workers at 200 posts: 60,000 = 60,000, no spare → still behind.
  fields(feedOutcome(cfg({ workers: 1 }), { reads: 0, posts: 100 }), { lag: Infinity });
  fields(feedOutcome(cfg({ workers: 3 }), { reads: 0, posts: 200 }), { lag: Infinity });
  fields(feedOutcome(cfg({ workers: 1 }), { reads: 0, posts: 100, star: true }), { lag: Infinity });
});

test("a star's post on fanout on write waits for the workers' spare capacity", () => {
  // Spare 40,000 − 30,000 = 10,000; 5,000,000 / 10,000 = 500 s.
  fields(feedOutcome(cfg(), { reads: 0, posts: 100, star: true }), { lag: 500 });
  // Skipping inactive: writes 30,000 × 0.6 = 18,000, spare 22,000; 5,000,000 × 0.6 / 22,000 = 136.36 s.
  fields(feedOutcome(cfg({ skipInactive: true }), { reads: 0, posts: 100, star: true }), { writes: 18000, lag: 3e6 / 22000 });
});

test('fanout on read: every friend looked up at load time, no cache, no lag', () => {
  // Read 5 + 0.3 × 300 = 95 ms. 1,000 loads × 300 = 300,000 lookups ≤ 500,000.
  fields(feedOutcome(cfg({ fanout: 'read' }), { reads: 1000, posts: 100, star: true }), { readMs: 95, served: 1, lag: 0, writes: 0, cacheGB: 0 });
  // Exactly at capacity (hybrid pulls 5): 100,000 × 5 = 500,000 → still all served.
  fields(feedOutcome(cfg({ fanout: 'hybrid' }), { reads: 100000, posts: 0 }), { served: 1 });
  // 2,000 × 300 = 600,000 lookups → 500,000 / 600,000.
  fields(feedOutcome(cfg({ fanout: 'read' }), { reads: 2000, posts: 0 }), { served: 500000 / 600000 });
});

test("hybrid: pushes posts, pulls the 5 stars followed; a star's post doesn't stall it", () => {
  // Read 5 + 0.3 × 5 = 6.5 ms. 10,000 × 5 = 50,000 lookups.
  fields(feedOutcome(cfg({ fanout: 'hybrid' }), { reads: 10000, posts: 100, star: true }), { readMs: 6.5, served: 1, lag: 1, writes: 30000, cacheGB: 120 });
});
