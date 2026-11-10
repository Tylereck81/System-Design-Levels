// Workers that take jobs from a message queue.
import { T, COMPONENTS } from '../catalog.js';
import { fmt } from '../../format.js';

/**
 * A worker group takes jobs from its queue: at most its capacity, and all of it while a backlog waits. An autoscaled
 * group runs enough servers for the jobs arriving plus the backlog cleared within T.drain seconds. Jobs it can't take
 * yet wait in the queue instead of failing, so nothing is dropped.
 */
export const worker = {
  id: 'worker',
  matches: (c) => !!c.consumes,
  // Jobs in and out, and what waits in its queue; its step always runs, so they replace the generic rows.
  liveRowsOnly: true,
  liveRows: (st, n) => [
    { value: st.load.toFixed(2), label: 'jobs/s arriving' },
    { value: st.cap.toFixed(2), label: 'jobs/s it can take' },
    { value: `${Math.round(st.util * 100)}%`, label: 'busy' },
    { value: fmt(st.backlog), label: 'jobs waiting in the queue' },
    st.copies && { value: `${st.copies} ${st.copies === 1 ? 'server' : 'servers'} now`, label: `of size ${n.size}`, wide: true },
  ],
  step(n, L, ctx) {
    const sp = ctx.spec(n), q = ctx.senders(n).find((c) => COMPONENTS[c.type]?.queue);
    // Its share of the queue's backlog: the queue's jobs split like the jobs it sends now.
    const qIn = q ? ctx.servedOf(q.id) : 0, b = q ? ctx.backlog(q.id) * (qIn ? L / qIn : 1) : 0;
    const k = ctx.autoscale(n, L + b / T.drain, sp.cap);
    if (k) sp.cap *= k;
    const out = b > 0 ? sp.cap : Math.min(L, sp.cap);
    ctx.settle(n, out, { load: L, cap: sp.cap, util: out / sp.cap, ms: sp.base, mult: 1, base: sp.base, unit: sp.unit, drop: 0, consumer: true, backlog: b, ...(k ? { copies: k } : {}) });
  },
};
