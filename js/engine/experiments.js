// Break-it experiments: which are running, what they take down, how much they multiply traffic.
// The experiments themselves (labels, targets, messages) are defined in the level file.
import { EXPERIMENTS, WORKLOAD, run, byId } from '../state.js';

export const isOn = (id) => !!run.on[id];
export const activeExps = () => EXPERIMENTS.filter(e => run.on[e.id]);
export const anyOn = () => EXPERIMENTS.some(e => run.on[e.id]);
export const crashing = () => activeExps().some(e => e.kind === 'crash');

/**
 * Traffic multiplier from the running experiments (1 when none): each one's factor (a spike, or a crash at a quieter
 * hour), times the hour's share of the peak while a day runs.
 */
export const trafficFactor = () => { const h = dayHour(); return activeExps().filter(e => e.factor).reduce((f, e) => f * e.factor, 1) * (h == null ? 1 : WORKLOAD.day[h]); };

/** True while an experiment has bots send each key's quota right around a window edge. */
export const botEdge = () => activeExps().some(e => e.botEdge);
/** True while a running experiment splits the network in two. */
export const partitioned = () => activeExps().some(e => e.partition);
/** Extra clicks a second on one link from the running experiments (a link gone viral). */
export const viralClicks = () => activeExps().reduce((s, e) => s + (e.viral || 0), 0);
/** New links a second one account creates in bulk in the running experiments. */
export const bulkCreates = () => activeExps().reduce((s, e) => s + (e.bulk || 0), 0);
/** True while a running experiment sets an ID generator's clock back. */
export const clockBack = () => activeExps().some(e => e.clockBack);
/** Servers the running experiments add to (+1) or take from (−1) a cache cluster. */
export const resizeBy = () => activeExps().reduce((d, e) => d + (e.resize || 0), 0);
/** Multiplier on the share of uploads from the running experiments (1 when none). */
export const uploadFactor = () => activeExps().filter(e => e.uploadFactor).reduce((f, e) => f * e.uploadFactor, 1);

/** The hour (0–23) of the running day experiment, which plays 24 hours in `secs` seconds; null when no day runs. */
export function dayHour() {
  const e = activeExps().find(x => x.kind === 'day');
  return e ? Math.min(23, Math.floor(run.on[e.id].t / e.secs * 24)) : null;
}
/** While a day runs: this hour's and the last hour's traffic, as shares of the peak. */
export function dayShift() {
  const h = dayHour();
  return h == null ? null : { now: WORKLOAD.day[h], prev: WORKLOAD.day[(h + 23) % 24] };
}

/** Components taken down by the running crash experiments (each crash remembers the component it hit). */
export function downIds() {
  return new Set(activeExps().filter(e => e.kind === 'crash').map(e => run.on[e.id].node).filter(id => id && byId(id)));
}

/** The components a crash could take down: its `targets` (peers to choose from), or the one its `target` picks. */
export const crashCandidates = (exp, g) => (exp.targets ? exp.targets(g) : [exp.target(g)]).filter(Boolean);

/**
 * Start an experiment. A crash records the component it takes down, so it stays on that one component. With several
 * candidates it takes down the one whose loss hurts most: `served(id)` gives the % served with that one down.
 */
export function startExp(exp, g, served) {
  if (exp.kind === 'crash') {
    const list = crashCandidates(exp, g);
    if (!list.length) return false;
    let pick = list[0];
    if (list.length > 1 && served) {
      let worst = Infinity;
      for (const n of list) { const s = served(exp, n.id); if (s < worst - 1e-9) { worst = s; pick = n; } }
    }
    run.on[exp.id] = { node: pick.id };
  } else {
    run.on[exp.id] = exp.kind === 'day' ? { t: 0 } : {};
  }
  return true;
}
/** The log's key for an experiment's "not met" message, which it logs once while the key stays active. */
export const notMetKey = (id) => 'notmet-' + id;
/** Stop an experiment. Its next run logs its message again, even if no log check ran in between. */
export const stopExp = (exp) => { delete run.on[exp.id]; run.relog.add(notMetKey(exp.id)); };
/** Log every running experiment's message again at the next check: a changed design may change the advice. */
export const relogNotMet = () => { for (const e of EXPERIMENTS) run.relog.add(notMetKey(e.id)); };

/** Stop crash experiments whose component no longer exists. */
export function dropMissingCrashes() {
  for (const e of activeExps()) if (e.kind === 'crash' && !byId(run.on[e.id].node)) delete run.on[e.id];
}

/** Dashboard label for the running experiment's traffic (e.g. "10× spike", or the hour of a day), if it has one. */
export const spikeHud = () => { const e = activeExps().find(x => x.hud); return e && (typeof e.hud === 'function' ? e.hud(dayHour()) : e.hud); };

/** A message can be fixed text or a function of the model's result, so it can describe what actually happened. */
export const textOf = (msg, m) => (typeof msg === 'function' ? msg(m) : msg);

/** Traffic at the top of its wobble: a required outcome is checked here, so a lucky moment can't pass it. */
export const PEAK = 1.03;

/** True when the experiment has no required outcome, or the outcome holds in model result `m`. */
export const expectMet = (exp, m) => !exp.expect || !!exp.expect(m);
