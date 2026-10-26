// Component types: capacity, base time, cost and failure mode for everything on the canvas.
import { S, byId } from '../state.js';

export const SIZES = {
  S: { cpu: 2, cap: 200, cost: 40 },
  M: { cpu: 4, cap: 400, cost: 90 },
  L: { cpu: 8, cap: 800, cost: 200 },
  XL: { cpu: 16, cap: 1600, cost: 450 },
};
export const T = { rtt: 40, web: 20, db: 10, dc: 0.5, dns: 5, nosqlLookup: 3, nosqlLookups: 3, lb: 1 };

// role: 'client' sends traffic, 'resolver' answers name lookups off the request path,
//       'server' sits on the request path and has a capacity.
// sized: capacity and cost come from the server size (S–XL).
// kinds: variants that change the work per request (per = operations per request, base = ms per request).
// alone: what happens when a dependency is missing (the server does that work itself).
// cap, cost: fixed capacity (req/s) and monthly cost for servers that have no sizes.
// routing 'standby': peers of this type don't share traffic; the first healthy one takes it all
//   and the others wait as standbys (default: healthy peers split traffic evenly).
// forwards: the server only passes requests on; with no server behind it, every request it gets fails.
// Failure mode for every server: when down it serves nothing; its share moves to healthy peers,
// and with no healthy peer every request sent to it fails.
export const COMPONENTS = {
  users: { role: 'client' },
  dns: { role: 'resolver', cost: T.dns },
  lb: { role: 'server', cap: 5000, base: T.lb, cost: 20, unit: 'req/s', routing: 'standby', forwards: true },
  web: { role: 'server', sized: true, base: T.web, unit: 'req/s', alone: { missing: 'db', capFactor: 0.5, base: T.web + T.db } },
  db: {
    role: 'server', sized: true,
    kinds: {
      sql: { per: 1, base: T.db, unit: 'queries/s' },
      nosql: { per: T.nosqlLookups, base: T.nosqlLookup * T.nosqlLookups, unit: 'lookups/s' },
    },
  },
};

export const roleOf = (n) => (COMPONENTS[n.type] || {}).role;
export const isServer = (n) => roleOf(n) === 'server';

/** Monthly cost of one component. */
export function costOf(n) {
  const c = COMPONENTS[n.type] || {};
  if (c.sized) return n.size ? SIZES[n.size].cost : 0;
  return c.cost || 0;
}

/** True when a server lacks the dependency it normally hands work to, so it does that work itself. */
export function runsAlone(n) {
  const a = (COMPONENTS[n.type] || {}).alone;
  return !!a && !S.edges.some(e => e.from === n.id && (byId(e.to) || {}).type === a.missing);
}

/** Capacity and work per request for a server, given its size, kind and dependencies. */
export function serverSpec(n) {
  const c = COMPONENTS[n.type];
  const kind = c.kinds ? c.kinds[n.kind] || c.kinds[Object.keys(c.kinds)[0]] : null;
  const spec = { cap: c.sized ? SIZES[n.size].cap : c.cap, per: 1, base: c.base, unit: c.unit };
  if (kind) Object.assign(spec, { per: kind.per, base: kind.base, unit: kind.unit, nosql: n.kind === 'nosql' });
  if (runsAlone(n)) Object.assign(spec, { cap: spec.cap * c.alone.capFactor, base: c.alone.base, combined: true });
  return spec;
}
