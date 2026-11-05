// Goals and number formats that many levels share. Pure: it imports only the formatting helper, so level files (and
// Node) can load it. A level that words a goal its own way passes `text`; everything else is the same in every level.
import { fmt } from '../../js/format.js';

/**
 * A percentage as text, with one decimal by default: `fmtPct(99.46)` is "99.5%".
 * `scale: 100` turns a 0–1 share into a percent. Values at or above `wholeFrom`, and at or below `wholeUpTo`, are
 * shown as whole numbers: `{ wholeFrom: 10 }` gives "9.5%" but "12%".
 */
export const fmtPct = (x, { scale = 1, wholeFrom = Infinity, wholeUpTo = -Infinity } = {}) => {
  const v = scale === 1 ? x : scale * x; // unscaled, a missing value still throws instead of showing "NaN%"
  return v.toFixed(v > wholeUpTo && v < wholeFrom ? 1 : 0) + '%';
};

/** Dollars as text: "$1,900". With `millions`, $1,000,000 and up is shortened: "$1.25M". */
export const fmtMoney = (x, { millions = false } = {}) => '$' + (millions && x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : fmt(x));

/** True when the result serves at least `pct` percent of requests. */
export const servedAtLeast = (pct) => (m) => m.servedPct >= pct;

/** Serve at least the level's target share of requests. */
export const servedGoal = (targets, { text = `Serve at least ${targets.servedPct}% of requests` } = {}) => ({
  id: 'served', type: 'metric', text, test: servedAtLeast(targets.servedPct), val: (m) => fmtPct(m.servedPct),
});

/** Average response time under the level's target. */
export const latGoal = (targets, { text = `Response time under ${targets.latencyMs} ms` } = {}) => ({
  id: 'lat', type: 'metric', text,
  test: (m) => m.latency != null && m.latency < targets.latencyMs,
  val: (m) => (m.latency == null ? '—' : fmt(m.latency) + ' ms'),
});

/** The design's monthly cost stays within `max`. `money` is passed to fmtMoney (e.g. `{ millions: true }`). */
export const costGoal = (max, money = {}) => ({
  id: 'cost', type: 'struct', text: `Spend at most ${fmtMoney(max, money)} per month`,
  test: (g) => g.cost <= max, val: (m, g) => fmtMoney(g.cost, money),
});

/** No component whose failure stops the service. */
export const spofGoal = () => ({ id: 'spof', type: 'metric', text: 'No single point of failure', test: (m) => m.spof === 0, val: (m) => String(m.spof) });
