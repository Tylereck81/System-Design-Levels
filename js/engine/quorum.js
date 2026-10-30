// A replicated key-value store: what a read or a write costs, and what it returns, for N replicas and quorums W and R.
// The coordinator sends each request to the key's N replicas and answers once W (a write) or R (a read) have replied.

/** ms each replica takes to reply, fastest first: the first two are in the coordinator's zone, the others further away. */
export const REPLICA_MS = [2, 4, 10, 12, 20];

const choose = (n, k) => { if (k < 0 || k > n) return 0; let c = 1; for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1); return c; };

/**
 * Share of reads that miss the latest write while it is still spreading: the R replicas read (any R of the N) include
 * none of the W that have it. Zero whenever W + R > N.
 */
export const missShare = (N, W, R) => choose(N - W, R) / choose(N, R);

/**
 * The outcome of a quorum setting. `recent` is the share of reads whose key was written so recently that the write is
 * still spreading. In a network partition, a share `far` of the users and floor(N / 3) of the replicas are cut off from
 * the rest. With a strict quorum a side answers only what its replicas can confirm (W for a write, R for a read) and
 * fails the rest. With a sloppy quorum every side answers, other nodes standing in for the unreachable replicas, so a
 * read misses any write made on the other side.
 * Returns readMs, writeMs, failed (share of reads and of writes that fail) and stale (share of the reads answered).
 */
export function quorumOutcome({ N, W, R, sloppy }, { recent, far, partition }) {
  W = Math.min(W, N); R = Math.min(R, N);
  const readMs = REPLICA_MS[R - 1], writeMs = REPLICA_MS[W - 1];
  if (!partition) return { readMs, writeMs, readFail: 0, writeFail: 0, stale: recent * missShare(N, W, R) };
  const cut = Math.floor(N / 3);
  const sides = [{ share: 1 - far, replicas: N - cut }, { share: far, replicas: cut }];
  for (const s of sides) { s.read = sloppy || s.replicas >= R; s.write = sloppy || s.replicas >= W; }
  let readFail = 0, writeFail = 0, answered = 0, stale = 0;
  sides.forEach((s, i) => {
    if (!s.write) writeFail += s.share;
    if (!s.read) { readFail += s.share; return; }
    // A read answered here misses the writes made on the other side, and, within this side, the writes still spreading.
    const other = sides[1 - i], fromOther = other.write ? other.share : 0;
    const n = sloppy ? N : s.replicas, w = Math.min(W, n), r = Math.min(R, n);
    answered += s.share;
    stale += s.share * recent * (fromOther + (1 - fromOther) * missShare(n, w, r));
  });
  return { readMs, writeMs, readFail, writeFail, stale: answered ? stale / answered : 0 };
}
