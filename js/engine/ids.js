// A unique ID generator: what each method's IDs look like, how many it can make, and when they repeat.

/** IDs a second one auto_increment database server hands out (ticket server, multi-primary). */
export const DB_IDS = 5000;
/** IDs a second one timestamp-based generator can make: 12 sequence bits give 4,096 IDs per millisecond. */
export const SNOW_IDS = 4096 * 1000;
/** ms to get an ID: a round trip to a database, a call to a generator service, or made in the web server itself. */
export const ID_MS = { step: 2, ticket: 2, snow: 1, uuid: 0 };
/** ms a clock is set back by the time sync in the clock experiment. */
export const CLOCK_BACK_MS = 20;

/**
 * The outcome of an ID generator: `method` is 'step' (multi-primary, each server counts up by k), 'uuid', 'ticket' or
 * 'snow' (timestamp, data center, machine and sequence bits), on `servers` servers; `wait` makes a timestamp-based
 * generator wait when its clock goes back. `resize` servers are added (+1) or lost (−1); `clockBack` sets one
 * generator's clock back. Returns bits, numeric, ordered (later IDs are larger), dup (share of IDs that repeat one
 * already made), cap (IDs/s), healthy (servers running), ms and spof.
 */
export function idOutcome({ method, servers, wait }, { resize = 0, clockBack = false } = {}) {
  const k = servers + Math.max(0, resize), healthy = Math.max(0, servers + resize);
  const out = { method, bits: 64, numeric: true, ordered: true, dup: 0, cap: 0, healthy, ms: ID_MS[method], spof: servers === 1 };
  if (method === 'uuid') return { ...out, bits: 128, numeric: false, ordered: false, cap: Infinity, healthy: 0, spof: false };
  if (method === 'snow') {
    out.cap = healthy * SNOW_IDS;
    // A clock set back makes its generator reuse timestamps it has already used: its IDs repeat, unless it waits.
    if (clockBack && wait) out.ms += CLOCK_BACK_MS / servers;
    else if (clockBack) { out.dup = 1 / servers; out.ordered = false; }
    return out;
  }
  out.cap = healthy * DB_IDS;
  out.ordered = k === 1; // several counters run side by side, so a later ID can be smaller
  // Ticket servers each count 1, 2, 3… on their own, so each number is handed out by every one of them. A server added
  // to a multi-primary setup counts with the new step from its own offset, onto numbers already handed out.
  if (method === 'ticket') out.dup = (k - 1) / k;
  else if (resize > 0) out.dup = resize / k;
  return out;
}
