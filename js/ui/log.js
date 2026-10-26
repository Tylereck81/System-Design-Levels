// Event log and live observations.
import { fmt } from '../format.js';
import { $, el } from '../dom.js';
import { TARGET_MS, TYPES, TXT, S, run, byId } from '../state.js';
import { T } from '../engine/components.js';

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
    const nm = TYPES[n.type].name;
    if (st.load > st.cap * 1.005) {
      overloaded = true;
      const lost = Math.max(1, Math.round((1 - st.cap / st.load) * 100));
      let extra = st.combined ? TXT.combinedOver : '';
      if (st.nosql) extra = TXT.nosqlOver;
      keys.set('over' + id, [`${nm} is over capacity: ${fmt(st.load)} ${st.unit} arriving, ${fmt(st.cap)} max. About ${lost}% of requests fail.${extra}`, 'bad']);
    } else if (st.util >= 0.7) {
      keys.set('busy' + id, [`${nm} is ${Math.min(100, Math.round(st.util * 100))}% busy. Requests wait in line, so each one takes ${st.mult.toFixed(1)}× its normal time.`, 'warn']);
    }
  }
  if (!overloaded && !run.crash && !run.spike && m.latency != null && m.latency >= TARGET_MS) {
    const parts = [`${T.rtt} ms network`];
    for (const id in m.node) { const st = m.node[id], n = byId(id); if (n && !st.down) parts.push(`${TYPES[n.type].name.toLowerCase()} ${fmt(st.ms)} ms (${Math.round(st.util * 100)}% busy)`); }
    const sig = S.nodes.map(n => (n.size || '') + (n.kind || '')).join('');
    keys.set('slow' + sig, [`Response time ${fmt(m.latency)} ms misses the ${TARGET_MS} ms goal: ${parts.join(' + ')}. Busy servers make requests wait; give the slowest one more capacity.`, 'warn']);
  }
  if (run.spike && m.g.web && !run.crash) keys.set('spikeNote', [TXT.spikeNote(m.base), 'bad']);
  for (const [k, [msg, tone]] of keys) if (!run.active.has(k)) log(msg, tone);
  const hadProblems = run.active.size > 0;
  run.active = new Set(keys.keys());
  if (hadProblems && keys.size === 0 && m.latency != null) log(`All good: ${m.servedPct.toFixed(1)}% served, ${fmt(m.latency)} ms average.`, 'ok');
}
