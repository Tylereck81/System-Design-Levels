// A rate limiter: what its algorithm lets through per API key, the mission's bots, and its load rule.
import { T, COMPONENTS, choiceOf, optionOf, qmul } from '../catalog.js';

/** A mission's bots: `keys` API keys sending `rate` requests a second in all (none when the mission has no `bot`). */
export function botsOf(mission) {
  const bot = mission.bot || {}, keys = bot.keys || 0;
  return { keys, rate: keys * (bot.rate || 0) };
}

/**
 * What a rate limiter's algorithm does, per API key:
 * q: the requests a key gets through in any rolling minute, as a multiple of the limit (60). Token and leaking buckets
 *   pass `refill` a second; at a window edge a token bucket also passes its whole bucket, and a fixed window passes
 *   its quota on both sides of the edge (2×). Sliding windows and the leaking bucket's fixed outflow stay at 1.
 * fb: the share of a real user's requests blocked. A user types a search: `burst` requests in `burstSecs` seconds.
 *   A bucket holds `size` and refills `rate` a second, so a burst bigger than size + rate × burstSecs is cut.
 * wait: ms a real request waits in a leaking bucket's queue, which sends requests on at its fixed rate.
 */
export function limiterRule(n, edge) {
  const algo = choiceOf(n, 'algo'), size = optionOf(n, 'bucket').size, rate = optionOf(n, 'refill').rate;
  const fb = Math.max(0, T.burst - size - rate * T.burstSecs) / T.burst;
  if (algo === 'token') return { q: edge ? (size + 60 * rate * T.keyLimit) / 60 : rate, fb, wait: 0 };
  if (algo === 'leaky') return { q: rate, fb, wait: Math.max(0, 1000 * (T.burst / rate - T.burstSecs) / 2) };
  if (algo === 'fixed') return { q: edge ? 2 : 1, fb: 0, wait: 0 };
  return { q: 1, fb: 0, wait: 0 }; // sliding window log or counter
}

/**
 * Real users' requests pass unless their bursts don't fit (fb); bots get their keys' quota (q) through, more while an
 * experiment's `botEdge` flag has them send it around a window edge. Without a shared counter store, each limiter at
 * the entry counts a key's requests on its own, so the key gets its quota once per limiter. Every request it checks
 * reads its counter in the store; the ones it passes go on.
 * Its stat's realPass and waitMs are the generic fields the path pass reads: the share of real users' requests let
 * through (bots are counted apart, in bots and botPass) and the extra ms a request waits before going on.
 * The result reports the largest quota a key gets, whether every limiter shares its counters, and the bots let through.
 */
export const rateLimiter = {
  id: 'rate-limiter',
  matches: (c) => !!c.limits,
  resultDefaults: { keyQuota: null, botThrough: 0 }, // limitShared has no default: it is set once a limiter runs
  step(n, L, ctx) {
    const sp = ctx.spec(n), Lb = ctx.botLoad(n.id), Lr = L - Lb, u = L / sp.cap, d = Math.max(0, 1 - sp.cap / L);
    const rule = limiterRule(n, ctx.flag('botEdge')), { store, deps } = ctx.groupsOf(n), back = deps.length > 0;
    const peers = ctx.entry.filter(c => COMPONENTS[c.type].limits && !ctx.down.has(c.id)).length || 1;
    const q = rule.q * (store ? 1 : peers), bots = botsOf(ctx.mission);
    const botPass = bots.rate ? Math.min(Lb, bots.keys * T.keyLimit * q * Lb / bots.rate) : 0;
    const s = back ? (Lr * (1 - rule.fb) + botPass) * (1 - d) : 0, mult = qmul(u);
    ctx.settle(n, s, { load: L, cap: sp.cap, util: u, ms: sp.base * mult, mult, base: sp.base, unit: sp.unit, drop: 1 - s / L, limiter: true,
      realPass: back ? (1 - rule.fb) * (1 - d) : 0, waitMs: rule.wait, falseBlock: rule.fb, bots: Lb, botPass: botPass * (1 - d) });
    if (!back) ctx.issue('noBackend');
    ctx.report({ keyQuota: q }, 'max');
    ctx.report({ limitShared: !!store || peers === 1 }, 'and'); // one limiter needs no shared store
    ctx.report({ botThrough: botPass * (1 - d) }, 'sum');
    if (store) ctx.forward(n, L * (1 - d), [store]);
    ctx.forward(n, s);
  },
};
