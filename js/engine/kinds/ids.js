// A unique ID generator (ids.js): its settings and its load rule.
import { COMPONENTS, choiceOf, optionOf } from '../catalog.js';
import { idOutcome } from '../ids.js';

/** An ID generator's method, its servers and whether a timestamp-based one waits when its clock goes back. */
export function idSettingOf(n) {
  return { method: choiceOf(n, 'method'), servers: optionOf(n, 'servers').count, wait: !!optionOf(n, 'clock').wait };
}

/**
 * Each request needs WORKLOAD.idsPerRequest new IDs; requests whose IDs it can't make in time fail. The running
 * experiments may resize it or set its clock back. The result reports what its IDs look like, the share that repeat an
 * ID already made, whether it stops when one server fails, and the IDs it made. Each server costs the type's price;
 * UUIDs are made in the web servers, so they cost nothing and no server can fail.
 */
export const idGenerator = {
  id: 'id-generator',
  matches: (c) => !!c.ids,
  resultDefaults: { idDupPct: null, idBits: null, idNumeric: null, idOrdered: null, idSpof: null, idMade: null },
  step(n, L, ctx) {
    const c = COMPONENTS[n.type], o = idOutcome(idSettingOf(n), { resize: ctx.total('resize'), clockBack: ctx.flag('clockBack') });
    const want = L * (ctx.workload.idsPerRequest || 1), drop = Math.max(0, 1 - o.cap / want), u = o.cap === Infinity ? 0 : want / o.cap;
    ctx.settle(n, L * (1 - drop), { load: want, cap: o.cap, util: u, ms: o.ms, mult: 1, base: o.ms, unit: c.unit, drop, ids: o });
    ctx.report({ idDupPct: 100 * o.dup, idBits: o.bits, idNumeric: o.numeric, idOrdered: o.ordered, idSpof: o.spof, idMade: want * (1 - drop) });
  },
  cost(n) {
    const id = idSettingOf(n);
    return id.method === 'uuid' ? 0 : COMPONENTS[n.type].cost * id.servers;
  },
  redundant: (n) => !idOutcome(idSettingOf(n)).spof,
};
