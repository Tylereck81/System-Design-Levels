// js/engine/quorum.js: the chance a read misses a spreading write, latency by quorum, and partitions, by hand.
// Replies arrive at 2, 4, 10, 12 and 20 ms, fastest first.
import { test } from 'node:test';
import { missShare, quorumOutcome } from '../../js/engine/quorum.js';
import { near, fields } from './near.mjs';

test('missShare: C(N − W, R) / C(N, R), zero once W + R > N', () => {
  near(missShare(3, 1, 1), 2 / 3); // C(2,1) / C(3,1)
  near(missShare(3, 2, 1), 1 / 3); // C(1,1) / C(3,1)
  near(missShare(3, 1, 2), 1 / 3); // C(2,2) / C(3,2)
  near(missShare(5, 2, 2), 3 / 10); // C(3,2) / C(5,2)
  near(missShare(3, 2, 2), 0); // C(1,2) = 0
  near(missShare(3, 3, 1), 0); // C(0,1) = 0
});

test('no partition: wait for the W-th or R-th reply; stale = recent × missShare', () => {
  fields(quorumOutcome({ N: 3, W: 2, R: 2 }, { recent: 0.1 }), { readMs: 4, writeMs: 4, readFail: 0, writeFail: 0, stale: 0 });
  fields(quorumOutcome({ N: 3, W: 1, R: 1 }, { recent: 0.1 }), { readMs: 2, writeMs: 2, stale: 0.1 * 2 / 3 });
  fields(quorumOutcome({ N: 5, W: 5, R: 5 }, { recent: 0.1 }), { readMs: 20, writeMs: 20 });
  // W above N is capped at N = 3: the third reply, 10 ms.
  fields(quorumOutcome({ N: 3, W: 5, R: 1 }, { recent: 0.1 }), { writeMs: 10, readMs: 2 });
});

const split = { recent: 0.1, far: 0.2, partition: true }; // 20% of users, floor(3 / 3) = 1 replica cut off

test('strict quorum in a partition: the side without enough replicas fails', () => {
  // Main side: 2 replicas ≥ 2 → answers; far side: 1 < 2 → fails its 0.2. Main reads n = 2, W = R = 2: never stale.
  fields(quorumOutcome({ N: 3, W: 2, R: 2, sloppy: false }, split), { readFail: 0.2, writeFail: 0.2, stale: 0 });
  // W = R = 3: neither side has 3 → everything fails, no reads answered.
  fields(quorumOutcome({ N: 3, W: 3, R: 3, sloppy: false }, split), { readFail: 1, writeFail: 1, stale: 0 });
});

test('W = R = 1 in a partition: both sides answer, each missing the other side', () => {
  // Main: 0.8 × 0.1 × (0.2 + 0.8 × missShare(2,1,1) = 1/2) = 0.048. Far: 0.2 × 0.1 × (0.8 + 0.2 × 0) = 0.016.
  fields(quorumOutcome({ N: 3, W: 1, R: 1, sloppy: false }, split), { readFail: 0, writeFail: 0, stale: 0.064 });
});

test('sloppy quorum in a partition: nothing fails, reads miss the other side', () => {
  // Main: 0.8 × 0.1 × (0.2 + 0) = 0.016; far: 0.2 × 0.1 × (0.8 + 0) = 0.016; 0.032 of all reads answered.
  fields(quorumOutcome({ N: 3, W: 2, R: 2, sloppy: true }, split), { readFail: 0, writeFail: 0, stale: 0.032 });
});
