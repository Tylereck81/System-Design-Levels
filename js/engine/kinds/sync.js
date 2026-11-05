// Cloud file sync (sync.js): its settings, the block and notification servers, and cloud storage's monthly bill.
import { COMPONENTS, optionOf, isOn } from '../catalog.js';
import { ONLINE, storageBill } from '../sync.js';

/** Cloud file sync's settings, from its block servers, notification servers and cloud storage (any may be missing). */
export function syncSettingsOf(block, poll, store) {
  const count = (n) => (n ? optionOf(n, 'count').count : 0);
  return {
    blocks: count(block), delta: isOn(block, 'delta'), compress: isOn(block, 'compress'), polls: count(poll),
    tenVersions: isOn(store, 'versions'), cold: isOn(store, 'cold'), dedupe: isOn(store, 'dedupe'),
  };
}

/**
 * Block servers move each upload's bytes, up to their links; notification servers hold every online client's
 * long-poll connection (clients that can't connect can't sync).
 */
function step(n, L, ctx) {
  const c = COMPONENTS[n.type], o = ctx.outcomes.sync, block = c.sync === 'block';
  const work = block ? L * o.mbPerUpload : ONLINE, cap = c.cap * (block ? o.blocks : o.polls), ok = Math.min(1, cap / work);
  ctx.settle(n, L * ok, { load: work, cap, util: work / cap, ms: c.base, mult: 1, base: c.base, unit: c.unit, drop: 1 - ok, sync: o });
  ctx.forward(n, L * ok);
}

const blocksOf = (n) => syncSettingsOf(n, null, null).blocks;
const pollsOf = (n) => syncSettingsOf(null, n, null).polls;

/** The block servers. Each costs the type's price. */
export const syncBlock = {
  id: 'sync-block',
  matches: (c) => c.sync === 'block',
  outcome: 'sync',
  step,
  cost: (n) => COMPONENTS[n.type].cost * blocksOf(n),
  redundant: (n) => blocksOf(n) > 1,
};

/** The notification servers. Each costs the type's price. */
export const syncPoll = {
  id: 'sync-poll',
  matches: (c) => c.sync === 'poll',
  outcome: 'sync',
  step,
  cost: (n) => COMPONENTS[n.type].cost * pollsOf(n),
  redundant: (n) => pollsOf(n) > 1,
};

/** Cloud storage: a managed service whose cost is the month's storage bill. */
export const syncStore = {
  id: 'sync-store',
  matches: (c) => c.sync === 'store',
  cost: (n) => Math.round(storageBill(syncSettingsOf(null, null, n))),
};
