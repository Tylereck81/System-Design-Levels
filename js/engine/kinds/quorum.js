// A replicated key-value store (quorum.js): its quorum settings and its load rule.
import { COMPONENTS, optionOf } from '../catalog.js';
import { quorumOutcome } from '../quorum.js';

/** A key-value store's replicas (N), write and read quorums (W, R, at most N) and whether its quorum is sloppy. */
export function quorumOf(n) {
  const N = optionOf(n, 'n').n;
  return { N, W: Math.min(N, optionOf(n, 'w').q), R: Math.min(N, optionOf(n, 'r').q), sloppy: !!optionOf(n, 'mode').sloppy };
}

/**
 * A request takes as long as the W-th (write) or R-th (read) replica to reply. In a network partition (an experiment's
 * `partition` flag), requests a side can't get a quorum for fail (strict quorum); reads can be stale. The result reports
 * the store's stale reads, quorums, read time and failures. Each replica costs the type's price.
 */
export const kvStore = {
  id: 'kv-store',
  matches: (c) => !!c.quorum,
  liveRows: ({ kv }) => !kv ? [] : [
    { value: `${kv.readMs} ms · ${kv.writeMs} ms`, label: `a read waits for ${kv.R} of ${kv.N} replicas, a write for ${kv.W}`, wide: true },
    { value: `${(100 * kv.stale).toFixed(1)}%`, label: 'of reads return an old value', tone: kv.stale > 0 ? 'warn' : null, wide: true },
    kv.failed > 0 && { value: `${(100 * kv.failed).toFixed(0)}%`, label: 'of requests fail: no quorum on their side of the partition', tone: 'bad', wide: true },
  ],
  resultDefaults: { kvStalePct: null, kvReadMs: null, kvFailPct: null, kvQuorum: null },
  step(n, L, ctx) {
    const q = quorumOf(n), w = ctx.writes, c = COMPONENTS[n.type]; // w: the share of its requests that write
    const o = quorumOutcome(q, { recent: ctx.workload.recentShare || 0, far: ctx.workload.partitionFar || 0, partition: ctx.flag('partition') });
    const failed = (1 - w) * o.readFail + w * o.writeFail, ms = (1 - w) * o.readMs + w * o.writeMs;
    ctx.settle(n, L * (1 - failed), { load: L, cap: c.cap, util: L / c.cap, ms, mult: 1, base: ms, unit: c.unit, drop: failed, kv: { ...q, ...o, failed } });
    ctx.report({ kvStalePct: 100 * o.stale, kvQuorum: { N: q.N, W: q.W, R: q.R, sloppy: q.sloppy }, kvReadMs: o.readMs, kvFailPct: 100 * failed });
  },
  cost: (n) => COMPONENTS[n.type].cost * quorumOf(n).N,
  redundant: (n) => quorumOf(n).N > 1,
};
