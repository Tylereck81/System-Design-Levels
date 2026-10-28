// Break-it experiments: which are running, what they take down, how much they multiply traffic.
// The experiments themselves (labels, targets, messages) are defined in the level file.
import { EXPERIMENTS, run, byId } from '../state.js';

export const isOn = (id) => !!run.on[id];
export const activeExps = () => EXPERIMENTS.filter(e => run.on[e.id]);
export const anyOn = () => EXPERIMENTS.some(e => run.on[e.id]);
export const crashing = () => activeExps().some(e => e.kind === 'crash');

/** Traffic multiplier from the running spike experiments (1 when none). */
export const trafficFactor = () => activeExps().filter(e => e.kind === 'spike').reduce((f, e) => f * e.factor, 1);

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
    run.on[exp.id] = {};
  }
  return true;
}
export const stopExp = (exp) => { delete run.on[exp.id]; };

/** Stop crash experiments whose component no longer exists. */
export function dropMissingCrashes() {
  for (const e of activeExps()) if (e.kind === 'crash' && !byId(run.on[e.id].node)) delete run.on[e.id];
}

/** Dashboard label for the running spike (e.g. "10× spike"), if any. */
export const spikeHud = () => (activeExps().find(e => e.kind === 'spike') || {}).hud;

/** A message can be fixed text or a function of the model's result, so it can describe what actually happened. */
export const textOf = (msg, m) => (typeof msg === 'function' ? msg(m) : msg);

/** Traffic at the top of its wobble: a required outcome is checked here, so a lucky moment can't pass it. */
export const PEAK = 1.03;

/** True when the experiment has no required outcome, or the outcome holds in model result `m`. */
export const expectMet = (exp, m) => !exp.expect || !!exp.expect(m);
