// js/engine/ids.js: each ID method's shape, capacity, order and repeats, worked out by hand.
// Constants: 5,000 IDs/s a database server, 4,096 × 1,000 IDs/s a timestamp generator, a 20 ms clock step back.
import { test } from 'node:test';
import { idOutcome } from '../../js/engine/ids.js';
import { fields } from './near.mjs';

test('multi-primary (step): one server is ordered but a single point of failure', () => {
  fields(idOutcome({ method: 'step', servers: 1 }), { bits: 64, numeric: true, ordered: true, dup: 0, cap: 5000, healthy: 1, ms: 2, spof: true });
  // Two counters side by side: 2 × 5,000, no longer ordered.
  fields(idOutcome({ method: 'step', servers: 2 }), { ordered: false, cap: 10000, spof: false });
});

test('multi-primary: an added server repeats IDs; a lost one only lowers capacity', () => {
  // 2 + 1 = 3 servers: 3 × 5,000; the new one's numbers repeat 1 / 3 of IDs.
  fields(idOutcome({ method: 'step', servers: 2 }, { resize: 1 }), { healthy: 3, cap: 15000, dup: 1 / 3, ordered: false });
  // 2 − 1 = 1 healthy: 5,000; still two counters' IDs out there, so not ordered.
  fields(idOutcome({ method: 'step', servers: 2 }, { resize: -1 }), { healthy: 1, cap: 5000, dup: 0, ordered: false });
});

test('ticket servers: each counts on its own, so with k of them (k − 1) / k of numbers repeat', () => {
  fields(idOutcome({ method: 'ticket', servers: 1 }), { dup: 0, ordered: true, cap: 5000, spof: true });
  fields(idOutcome({ method: 'ticket', servers: 3 }), { dup: 2 / 3, ordered: false, cap: 15000 });
});

test('UUID: 128 bits, not numeric or ordered, made in the web server with no limit', () => {
  fields(idOutcome({ method: 'uuid', servers: 1 }), { bits: 128, numeric: false, ordered: false, dup: 0, cap: Infinity, healthy: 0, ms: 0, spof: false });
});

test('timestamp generator: 4,096,000 IDs/s each, ordered, 1 ms', () => {
  fields(idOutcome({ method: 'snow', servers: 2 }), { cap: 8192000, ordered: true, dup: 0, ms: 1, spof: false });
  fields(idOutcome({ method: 'snow', servers: 2 }, { resize: -1 }), { healthy: 1, cap: 4096000 });
  fields(idOutcome({ method: 'snow', servers: 1 }, { resize: -1 }), { healthy: 0, cap: 0 });
});

test('a clock set back: 1 / N of IDs repeat, unless the generator waits (20 ms / N on average)', () => {
  fields(idOutcome({ method: 'snow', servers: 2 }, { clockBack: true }), { dup: 0.5, ordered: false, ms: 1 });
  // 1 + 20 / 2 = 11 ms.
  fields(idOutcome({ method: 'snow', servers: 2, wait: true }, { clockBack: true }), { dup: 0, ordered: true, ms: 11 });
});
