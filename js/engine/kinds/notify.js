// A notification system (notify.js): its settings, and the workers that send notifications out.
import { COMPONENTS, optionOf, isOn } from '../catalog.js';

/** A notification system's settings, from its notification server, message queues and workers (any may be missing). */
export function notifySettingsOf(notifier, queue, worker) {
  return {
    check: isOn(notifier, 'check'), limit: isOn(notifier, 'limit'),
    perChannel: !!queue && !!optionOf(queue, 'layout').perChannel,
    workers: worker ? optionOf(worker, 'count').count : 0,
    retry: isOn(worker, 'log'), dedupe: isOn(worker, 'dedupe'),
  };
}

const workersOf = (n) => notifySettingsOf(null, null, n).workers;

/**
 * The workers: they deliver the share of requests the outcome says goes out on time (or was rightly skipped); the rest
 * wait, fail or are lost. What they send goes on to the providers. Each worker costs the type's price.
 */
export const notifyWorker = {
  id: 'notify-worker',
  matches: (c) => c.notify === 'worker',
  liveRows: ({ notify: o }) => !o ? [] : [
    { value: `${o.workers} workers`, label: `${o.perChannel ? 'split over a queue per channel' : 'all on one shared queue'}${o.retry ? ', with a notification log' : ''}`, wide: true },
    o.lost > 0 && { value: `${(100 * o.lost).toFixed(0)}%`, label: 'of notifications lost', tone: 'bad', wide: true },
    o.dup > 0 && { value: `${(100 * o.dup).toFixed(0)}%`, label: 'sent twice', tone: 'warn', wide: true },
    o.waiting > 0 && { value: `${(100 * o.waiting).toFixed(0)}%`, label: 'waiting in the SMS queue for a retry', wide: true },
  ],
  outcome: 'notify',
  step(n, L, ctx) {
    const c = COMPONENTS[n.type], o = ctx.outcomes.notify, cap = c.cap * o.workers, s = L * o.served;
    ctx.settle(n, s, { load: L, cap, util: L / cap, ms: c.base, mult: 1, base: c.base, unit: c.unit, drop: 1 - o.served, notify: o });
    ctx.forward(n, s);
  },
  cost: (n) => COMPONENTS[n.type].cost * workersOf(n),
  redundant: (n) => workersOf(n) > 1,
};
