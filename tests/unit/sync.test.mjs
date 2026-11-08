// js/engine/sync.js: MB per upload, the storage bill and reconnects after a notification server dies, by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mbPerUpload, storageBill, reconnect } from '../../js/engine/sync.js';
import { near, fields } from './near.mjs';

test('mbPerUpload: 70% new 0.4 MB files, 30% edits of 20 MB files (1 MB changed), halved by compression', () => {
  near(mbPerUpload({ delta: false, compress: false }), 6.28); // 0.7 × 0.4 + 0.3 × 20 = 0.28 + 6
  near(mbPerUpload({ delta: true, compress: false }), 0.58); // 0.28 + 0.3 × 1
  near(mbPerUpload({ delta: false, compress: true }), 3.14); // 6.28 × 0.5
  near(mbPerUpload({ delta: true, compress: true }), 0.29); // 0.58 × 0.5
});

test('storageBill: 60M GB × versions × 2 regions, less dedupe, at $0.02 or a 30/70 hot/cold mix', () => {
  const none = { tenVersions: false, cold: false, dedupe: false };
  near(storageBill(none), 6e6); // 60e6 × 2.5 × 2 = 300e6 GB × $0.02
  near(storageBill(none, 2), 12e6); // twice the data
  near(storageBill({ ...none, tenVersions: true }), 3.12e6); // 60e6 × 1.3 × 2 = 156e6 × 0.02
  near(storageBill({ ...none, dedupe: true }), 5.1e6); // 300e6 × 0.85 × 0.02
  near(storageBill({ ...none, cold: true }), 2.64e6); // 300e6 × (0.3 × 0.02 + 0.7 × 0.004 = 0.0088)
  near(storageBill({ tenVersions: true, cold: true, dedupe: true }), 1166880); // 60e6 × 1.3 × 0.85 × 2 × 0.0088
});

test('reconnect: 4M clients, 1M a server; the others must hold them all, at 2,000 a second each', () => {
  // 5 servers: 800,000 each; 4 × 1M ≥ 4M → 800,000 / (4 × 2,000) = 100 s.
  fields(reconnect(5), { fits: true, perServer: 800000, seconds: 100 });
  // 10 servers: 400,000 / (9 × 2,000) = 22.2 s.
  fields(reconnect(10), { fits: true, perServer: 400000, seconds: 400000 / 18000 });
  // 4 servers fit (1M each) but 3 left hold only 3M < 4M: never all back.
  fields(reconnect(4), { fits: true, perServer: 1e6, seconds: Infinity });
  fields(reconnect(3), { fits: false, seconds: Infinity }); // 1.33M each > 1M
  assert.equal(reconnect(1).seconds, Infinity); // no server left to take them
});
