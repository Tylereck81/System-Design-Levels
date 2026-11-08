// js/engine/notify.js: on-time sends, losses, duplicates and spam, worked out by hand.
// Constants: 60% push, 10% SMS, 30% email; 10 ms a send, 1,000 ms when the provider is down; 5% opted out;
// a blast is 2 × traffic; a crash holds 2% in flight. One worker sends 1,000 / 10 = 100 a second.
import { test } from 'node:test';
import { notifyOutcome } from '../../js/engine/notify.js';
import { fields } from './near.mjs';

const cfg = (o) => ({ perChannel: false, workers: 10, check: false, limit: false, retry: false, dedupe: false, ...o });

test('one shared queue within capacity: everything on time; opted-out users still get sent to', () => {
  // 10 × 100 = 1,000/s ≥ 500.
  fields(notifyOutcome(cfg(), { rate: 500 }), { served: 1, others: 1, lost: 0, waiting: 0, dup: 0, optSent: 0.05, spam: false });
});

test('overloaded: the on-time share is capacity over sends; skipping opted-out users frees some', () => {
  // 1,000 / 2,000 = 0.5.
  fields(notifyOutcome(cfg(), { rate: 2000 }), { served: 0.5, others: 0.5 });
  // Check: 2,000 × 0.95 = 1,900 sends, 1,000 / 1,900 on time; served 0.05 + 0.95 × 1,000 / 1,900 = 0.55.
  fields(notifyOutcome(cfg({ check: true }), { rate: 2000 }), { served: 0.55, optSent: 0 });
  // Per channel: each channel gets its share of workers and of sends, 1,000 × s / (2,000 × s) = 0.5.
  fields(notifyOutcome(cfg({ perChannel: true }), { rate: 2000 }), { served: 0.5, others: 0.5 });
});

test('SMS provider down, one shared queue: every SMS holds a worker for 1 s', () => {
  // Average send 0.6 × 10 + 0.1 × 1,000 + 0.3 × 10 = 109 ms; 10 × 1,000 / 109 / 500 = 10,000 / 54,500 on time.
  // SMS sends nothing: served 0.9 × 10,000 / 54,500; SMS lost (0.1) without retry.
  fields(notifyOutcome(cfg(), { rate: 500, smsDown: true }), { served: 9000 / 54500, others: 10000 / 54500, lost: 0.1, waiting: 0 });
});

test('SMS provider down, a queue per channel: push and email keep going; retry keeps the SMS waiting', () => {
  // Push: 10 × 0.6 × 100 = 600/s for 500 × 0.6 = 300 → 1; email likewise. served 0.6 + 0.3 = 0.9.
  fields(notifyOutcome(cfg({ perChannel: true }), { rate: 500, smsDown: true }), { served: 0.9, others: 1, lost: 0.1 });
  fields(notifyOutcome(cfg({ perChannel: true, retry: true }), { rate: 500, smsDown: true }), { lost: 0, waiting: 0.1 });
});

test('a marketing blast: spam and extra load without a daily limit', () => {
  // 500 + 2 × 500 = 1,500 sends; 1,000 / 1,500 on time.
  fields(notifyOutcome(cfg(), { rate: 500, blast: true }), { served: 2 / 3, spam: true });
  fields(notifyOutcome(cfg({ limit: true }), { rate: 500, blast: true }), { served: 1, spam: false });
});

test('workers crash: in-flight lost; with the log resent, half of it twice unless deduped', () => {
  fields(notifyOutcome(cfg(), { rate: 500, crash: true }), { lost: 0.02, dup: 0 });
  fields(notifyOutcome(cfg({ retry: true }), { rate: 500, crash: true }), { lost: 0, dup: 0.01 }); // 0.02 / 2
  fields(notifyOutcome(cfg({ retry: true, dedupe: true }), { rate: 500, crash: true }), { dup: 0 });
  fields(notifyOutcome(cfg(), { rate: 500, crash: true, smsDown: true }), { lost: 0.12 }); // 0.1 + 0.02
});
