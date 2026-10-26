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

/** Start an experiment. A crash records the component its target picks now, so it stays on that one component. */
export function startExp(exp, g) {
  if (exp.kind === 'crash') {
    const n = exp.target(g);
    if (!n) return false;
    run.on[exp.id] = { node: n.id };
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
