// The day panel: while a day experiment runs, a clock, the day's progress and a live chart of the traffic and the web
// servers running, hour by hour, across the top of the canvas. It only shows what the model already worked out; it
// keeps its own record of the hours it saw, which is never saved.
import { fmt } from '../format.js';
import { $, svgEl } from '../dom.js';
import { S, run, MISSIONS, WORKLOAD } from '../state.js';
import { activeExps, dayHour } from '../engine/experiments.js';

const HOURS = 24;
const W = 240, H = 40; // each chart's viewBox; it stretches to the panel's width
const clock = (h) => String(h).padStart(2, '0') + ':00';

/**
 * What the panel saw of the day it shows: per hour, the traffic and the servers each web server ran. `day` is the
 * running experiment's own state object, so starting the day again starts a new record.
 * @type {{ day: object, mission: number, hours: ({ qps: number, web: number[] } | undefined)[], lost: number, design?: string, closed?: boolean } | null}
 */
let rec = null;

/** The design as text, to notice a change after the day ended. */
const designOf = () => JSON.stringify([S.nodes, S.edges]);

/** Servers each web server on the path runs now: an autoscaled group's count, or 1 for a fixed server. */
const webCounts = (m) => m.g.onPath('web').map((n) => m.node[n.id]?.copies || 1);

/** Shoppers logged out, as words: "nobody", or a share. */
function lostText(pct) {
  if (pct <= 0) return 'nobody';
  const shown = pct < 10 ? pct.toFixed(1) : String(Math.round(pct));
  return shown === '0.0' ? 'under 0.1%' : `${shown}%`;
}

/** Record this hour while a day runs; forget the record when the day stopped early, the mission or the design changed. */
function record(m) {
  const exp = activeExps().find((e) => e.kind === 'day');
  if (exp) {
    const day = run.on[exp.id];
    if (!rec || rec.day !== day) rec = { day, mission: S.mission, hours: [], lost: 0 };
    rec.hours[dayHour()] = { qps: m.base, web: webCounts(m) };
    rec.lost = Math.max(rec.lost, m.lostPct || 0);
    return { h: dayHour(), t: Math.min(1, day.t / exp.secs), over: false };
  }
  if (!rec) return null;
  const finished = rec.hours[HOURS - 1] != null;
  rec.design ??= designOf();
  if (!finished || rec.closed || rec.mission !== S.mission || rec.design !== designOf()) { rec = null; return null; }
  return { h: HOURS - 1, t: 1, over: true };
}

/** One chart: the planned values as a faint outline, what the day has run so far filled in. */
function chart(svg, planned, seen, max, steps) {
  svg.textContent = '';
  const x = (h) => (h / HOURS) * W, y = (v) => H - 2 - (Math.min(v, max) / max) * (H - 4);
  if (planned) {
    const d = planned.map((v, h) => `${h ? 'L' : 'M'}${x(h + 0.5).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    svgEl('path', { d, class: 'day-plan' }, svg);
  }
  // Traffic: one bar an hour. Servers: one stepped line, joined from hour to hour, broken only at an hour not seen.
  let d = '';
  seen.forEach((v, h) => {
    if (v == null) return;
    if (!steps) d += `M${x(h)} ${H} V${y(v)} H${x(h + 1)} V${H}Z`;
    else d += `${seen[h - 1] == null ? `M${x(h)}` : 'V'} ${y(v)} H${x(h + 1)}`;
  });
  if (d) svgEl('path', { d, class: steps ? 'day-steps' : 'day-fill' }, svg);
}

/**
 * Show or hide the panel for the model's result `m`. Called with every dashboard repaint, so it follows the day as
 * it plays and notices a stop, a new mission or a design change.
 */
export function paintDay(m) {
  const panel = $('dayPanel');
  if (!panel) return;
  const at = record(m);
  panel.hidden = !at;
  panel.parentElement.classList.toggle('day-on', !!at);
  if (!at) return;
  const M = MISSIONS[S.mission];
  const last = rec.hours[at.h] || rec.hours.filter(Boolean).at(-1);
  const totals = rec.hours.map((x) => x && x.web.reduce((a, b) => a + b, 0));
  const shown = totals.filter((v) => v != null);

  $('dayClock').textContent = at.over ? '24:00' : clock(at.h);
  $('dayOf').textContent = at.over ? 'the day is over' : `hour ${at.h + 1} of ${HOURS}`;
  const bar = $('dayBar');
  bar.setAttribute('aria-valuenow', String(at.over ? HOURS : at.h));
  bar.setAttribute('aria-valuetext', at.over ? 'the day is over' : `${clock(at.h)}, hour ${at.h + 1} of ${HOURS}`);
  bar.firstElementChild.style.width = `${(100 * at.t).toFixed(1)}%`;

  const planned = WORKLOAD.day.map((share) => share * M.qps);
  chart($('dayTraffic'), planned, rec.hours.map((x) => x && x.qps), M.qps, false);
  chart($('dayServers'), null, totals, Math.max(4, ...shown), true);

  $('dayQps').textContent = at.over ? `${fmt(Math.min(...planned))} to ${fmt(M.qps)} req/s` : `${fmt(last.qps)} req/s`;
  const [fewest, most] = [Math.min(...shown), Math.max(...shown)];
  const range = fewest === most ? `${most} all day` : `${fewest} to ${most} in all`; // fixed servers never change
  $('dayWeb').textContent = at.over ? range : (last.web.join(' + ') || '—');
  $('dayLostRow').hidden = !M.sessions;
  $('dayLost').textContent = lostText(rec.lost);
  $('dayClose').hidden = !at.over;
}

$('dayClose')?.addEventListener('click', () => {
  if (rec) rec.closed = true;
  const panel = $('dayPanel');
  panel.hidden = true;
  panel.parentElement.classList.remove('day-on');
});
