// Event log and live observations.
import { fmt } from '../format.js';
import { $, el } from '../dom.js';
import { TARGET_MS, TXT, S, run, byId, nameOf, lowerName } from '../state.js';
import { T, serverSpec } from '../engine/components.js';
import { activeExps, anyOn, crashing, expectMet, textOf } from '../engine/experiments.js';

export let logLines = [];

export function log(msg, tone) {
  logLines.unshift({ t: run.t, msg, tone: tone || '' });
  logLines = logLines.slice(0, 6);
  const box = $('log'); box.textContent = '';
  for (const l of logLines) {
    const row = el('div'); row.appendChild(el('span', 'lt', `t=${l.t.toFixed(1)}s`)); row.appendChild(el('span', l.tone, l.msg)); box.appendChild(row);
  }
}

export function observe(m) {
  const keys = new Map();
  if (m.issue) keys.set('issue', [m.issue, 'bad']);
  let overloaded = false;
  for (const id in m.node) {
    const st = m.node[id], n = byId(id); if (!n || st.down) continue;
    const nm = nameOf(n);
    if (st.consumer) continue; // a worker that can't keep up leaves jobs waiting in its queue (see below), not failed requests
    const copied = st.copied && TXT.copiedWrites ? TXT.copiedWrites(st) : '';
    if (st.sessionMiss && TXT.sessionMiss) keys.set('sess' + id, [TXT.sessionMiss(nm, st.sessionMiss), 'bad']);
    if (st.load > st.cap * 1.005) {
      overloaded = true;
      const lost = Math.max(1, Math.round((1 - st.cap / st.load) * 100));
      let extra = st.combined ? TXT.combinedOver : '';
      if (st.nosql) extra = TXT.nosqlOver;
      if (copied) extra = copied;
      // A demoted primary that came back smaller than the replicas around it.
      const bigger = S.nodes.some(x => x.type === n.type && x.id !== n.id && x.role === 'replica' && serverSpec(x).cap > serverSpec(n).cap);
      if (n.wasPrimary && n.role === 'replica' && bigger && TXT.oldPrimarySmall) extra += TXT.oldPrimarySmall;
      keys.set('over' + id, [`${nm} is over capacity: ${fmt(st.load)} ${st.unit} arriving, ${fmt(st.cap)} max. About ${lost}% of requests fail.${extra}`, 'bad']);
    } else if (st.util >= 0.7 && st.mult > 1) {
      keys.set('busy' + id, [`${nm} is ${Math.min(100, Math.round(st.util * 100))}% busy. Requests wait in line, so each one takes ${st.mult.toFixed(1)}× its normal time.${copied}`, 'warn']);
    }
  }
  if (!overloaded && !anyOn() && m.latency != null && m.latency >= TARGET_MS) {
    const parts = [`${T.rtt} ms network`];
    for (const id in m.node) { const st = m.node[id], n = byId(id); if (n && !st.down && !st.consumer) parts.push(`${lowerName(n)} ${fmt(st.ms)} ms (${Math.round(st.util * 100)}% busy)`); }
    const sig = S.nodes.map(n => (n.size || '') + (n.kind || '') + (n.role || '')).join('');
    keys.set('slow' + sig, [`Response time ${fmt(m.latency)} ms misses the ${TARGET_MS} ms goal: ${parts.join(' + ')}. Busy servers make requests wait; give the slowest one more capacity.`, 'warn']);
  }
  for (const [id, q] of Object.entries(m.queues || {})) if (q.in - q.out > 1e-6 && TXT.queueGrowing) keys.set('queue' + id, [TXT.queueGrowing(q, m.alert, run.queues[id]), m.alert ? 'warn' : 'bad']);
  for (const exp of activeExps()) if (exp.note && m.g.entry.length && !crashing()) keys.set('note-' + exp.id, [exp.note(m.base), 'bad']);
  const mx = m.atPeak || m; // outcomes are judged at peak traffic (see sim.js)
  for (const exp of activeExps()) if (exp.notMet && !expectMet(exp, mx)) keys.set('notmet-' + exp.id, [textOf(exp.notMet, mx), 'warn']);
  const seen = new Set();
  for (const [k, [msg, tone]] of keys) if (!run.active.has(k) && !seen.has(msg)) { seen.add(msg); log(msg, tone); }
  const hadProblems = run.active.size > 0;
  run.active = new Set(keys.keys());
  if (hadProblems && keys.size === 0 && m.latency != null) log(`All good: ${m.servedPct.toFixed(1)}% served, ${fmt(m.latency)} ms average.`, 'ok');
}
