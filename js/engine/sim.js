// Simulation step: the model, queue backlogs, the 4-second target hold, experiment timers and mission completion.
// It knows nothing about the page: js/view/loop.js calls advance() every frame, draws the result, and passes in the
// callbacks the engine reports through.
import { MISSIONS, TXT, HOLD, EXPERIMENTS, S, run, save } from '../state.js';
import { level } from '../level.js';
import { model } from './model.js';
import { anyOn, expectMet, textOf, activeExps, dayHour, stopExp } from './experiments.js';

const OBSERVE_SECS = 1.5; // an experiment counts once it has run this long

/**
 * How the engine tells the page what happened. `log` adds a line to the event log; `progress` says a mission or an
 * experiment changed state, so the mission panel, the experiment buttons and the tabs need drawing again.
 * @typedef {{ log: (msg: string, tone?: string) => void, progress: () => void }} Report
 */

/** Stops the run. `full` also rewinds the clock and forgets the DNS lookup, the last result and the queue backlogs. */
export function resetRun(full) {
  run.playing = false; run.on = {}; run.hold = 0; run.spawnAcc = 0;
  run.expT = {}; run.active = new Set();
  if (full) { run.t = 0; run.dnsDone = false; run.dnsFlying = false; run.everPlayed = false; run.mdl = null; run.queues = {}; }
}

/**
 * Moves the simulation on by `dt` seconds: runs the model, grows or drains the queues, and checks the targets and
 * the running experiments. Returns the model's result, which the view draws.
 * @param {number} dt
 * @param {Report} report
 */
export function advance(dt, report) {
  run.t += dt;
  for (const e of activeExps()) if (e.kind === 'day') run.on[e.id].t += dt;
  const m = model(); run.mdl = m;
  // A running experiment with a required outcome is judged at the top of the traffic's wobble.
  if (activeExps().some(e => e.expect)) m.atPeak = model({ peak: true });
  // Queues keep what their workers could not take yet: the backlog grows by the jobs in minus the jobs out.
  for (const id in run.queues) if (!m.queues[id]) delete run.queues[id];
  for (const [id, q] of Object.entries(m.queues)) run.queues[id] = Math.max(0, (run.queues[id] || 0) + (q.in - q.out) * dt);
  holdTargets(m, dt, report);
  stepExperiments(m, dt, report);
  return m;
}

/** The mission's targets count once they have all held, with no experiment running, for HOLD seconds in a row. */
function holdTargets(m, dt, report) {
  const M = MISSIONS[S.mission], i = S.mission;
  if (S.verified[i] || !M.goals.length) return; // a mock interview has no goals to verify
  const allOk = !anyOn() && M.goals.every(goal => {
    if (goal.type === 'exp') return true;
    if (goal.type === 'gate') return S.est;
    if (goal.type === 'struct') return goal.test(m.g);
    return goal.test(m);
  });
  run.hold = allOk ? run.hold + dt : 0;
  if (run.hold >= HOLD) { S.verified[i] = true; report.log(`Targets held for ${HOLD} seconds.`, 'ok'); progressMade(report); }
}

function stepExperiments(m, dt, report) {
  const M = MISSIONS[S.mission], i = S.mission;
  const built = m.g.ready;
  for (const exp of EXPERIMENTS) {
    const k = exp.id;
    if (exp.kind === 'day') { if (run.on[k]) stepDay(exp, m.atPeak || m, built && M.goals.some(x => x.id === k) && !S.exp[i][k], report); continue; }
    // In a mock interview no experiment is a goal: each one says once what it observed, if its outcome held.
    const mockOnce = level.interview && !run.expT['seen-' + k];
    if (run.on[k] && built && ((M.goals.some(x => x.id === k) && !S.exp[i][k]) || mockOnce)) {
      const mx = m.atPeak || m;
      if (!expectMet(exp, mx)) { run.expT[k] = 0; continue; } // the required outcome must hold the whole time
      run.expT[k] = (run.expT[k] || 0) + dt;
      if (run.expT[k] >= OBSERVE_SECS && mockOnce) { run.expT['seen-' + k] = 1; report.log(textOf(exp.observed, mx), 'ok'); continue; }
      if (run.expT[k] >= OBSERVE_SECS) {
        S.exp[i][k] = true;
        report.log(textOf(exp.observed, mx), 'ok');
        progressMade(report);
      }
    }
  }
}

const clock = (h) => String(h).padStart(2, '0') + ':00';
/** A day counts when its outcome held every hour. The first hour it failed is kept and reported when the day ends. */
function stepDay(exp, m, counts, report) {
  const d = run.on[exp.id];
  if (counts && !d.fail && !expectMet(exp, m)) d.fail = { at: dayHour(), msg: textOf(exp.notMet, m) };
  if (d.t < exp.secs) return;
  stopExp(exp);
  if (counts && !d.fail) { S.exp[S.mission][exp.id] = true; report.log(textOf(exp.observed, m), 'ok'); checkDone(report); save(); }
  else if (d.fail) report.log(`The day is over, but it does not count. At ${clock(d.fail.at)}: ${d.fail.msg}`, 'warn');
  else report.log(exp.off, 'ok');
  report.progress(); // the day's experiment button is off now
}

/** A target held or an experiment counted: the mission may be complete; save, and tell the page. */
function progressMade(report) { checkDone(report); save(); report.progress(); }

function checkDone(report) {
  const i = S.mission, M = MISSIONS[i];
  if (S.done[i]) return;
  const expsOk = M.goals.filter(x => x.type === 'exp').every(x => S.exp[i][x.id]);
  if (S.verified[i] && expsOk && (!M.gate || S.est)) {
    S.done[i] = true;
    report.log(i === MISSIONS.length - 1 ? TXT.levelComplete : `Mission ${i + 1} complete.`, 'ok');
  }
}
