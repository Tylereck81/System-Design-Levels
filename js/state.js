// Level data, game state and saved progress.
import { level } from './level.js';
import { SIZES, COMPONENTS } from './engine/components.js';

export const TARGET_MS = level.targets.latencyMs;
export const TARGET_SERVED = level.targets.servedPct;

export const TYPES = level.components;
export const PALETTE = level.palette;
export const LIMIT_MSG = level.limitMsg;
export const OK_PAIRS = level.connections.ok;
export const BAD_PAIRS = level.connections.bad;
export const pairKey = (a, b) => [a, b].sort().join('|');
/** A component's display name: its role's name when the level gives roles (e.g. "Read replica"). */
export const nameOf = (n) => { const t = TYPES[n.type], r = t.roles && n.role && t.roles[n.role]; return r ? r.name : t.nameOf ? t.nameOf(n) : t.name; };
/** A component's name inside a sentence: its role's lowercase name when the level gives one (e.g. "primary database"). */
export const lowerName = (n) => { const t = TYPES[n.type], r = t.roles && n.role && t.roles[n.role]; return (r && r.lower) || nameOf(n).toLowerCase(); };
/** Label and description of the connection a → b; a level can word it by the receiver's role. */
export const edgeInfo = (a, b) => {
  const info = OK_PAIRS[pairKey(a.type, b.type)], byRole = info && info.byRole && b.role && info.byRole[b.role];
  return byRole ? { ...info, ...byRole } : info;
};
export const MISSIONS = level.missions;
export const QUIZ = level.quiz.questions;
export const PASS = level.quiz.passScore;
export const TXT = level.text;
export const EXPERIMENTS = level.experiments;
export const WORKLOAD = level.workload || {};
/** True while a mission's estimate hides its traffic (some estimates are about something else, such as memory). */
export const trafficHidden = (M) => !!(M.gate && !S.est && M.gate.hidesTraffic !== false);
export const HOLD = 4; // seconds the targets must hold

/* ---------------- State ---------------- */
export const LS_KEY = level.saveKey;
// Break-it results are kept per mission: the same experiment can be a goal of several missions.
const expGoals = (i) => MISSIONS[i].goals.filter(x => x.type === 'exp').map(x => x.id);
const noResults = (i) => Object.fromEntries(expGoals(i).map(id => [id, false]));
// The quiz has its own version, so a save-format change doesn't throw away quiz answers.
const QUIZ_VERSION = level.quizVersion ?? level.saveVersion;
export const fresh = () => ({
  nodes: level.startNodes.map(n => ({ ...n })),
  edges: (level.startEdges || []).map(e => ({ ...e })), seq: 1, mission: 0,
  done: MISSIONS.map(() => false), verified: MISSIONS.map(() => false),
  est: false, estVal: '', exp: MISSIONS.map((_, i) => noResults(i)),
  quiz: {}, tab: 'lesson', v: level.saveVersion, qv: QUIZ_VERSION,
});
/** True when mission i's break-it goal `id` has passed. */
export const expPassed = (id, i = S.mission) => !!(S.exp[i] && S.exp[i][id]);
/** Forget the break-it results of every mission not finished yet (after a design change, as for verification). */
export function clearOpenResults() { S.exp = S.exp.map((r, i) => (S.done[i] ? r : noResults(i))); }
export let S = fresh();
export let sel = null;          // {kind:'node'|'edge', id}
export let connectFrom = null;  // tap-to-connect source id
export let refocus = null;      // node id to give keyboard focus after re-render
export const qsel = {};         // quiz selection before "Check"
export const run = { queues: {}, playing: false, t: 0, on: {}, hold: 0, dnsDone: false, dnsFlying: false, spawnAcc: 0, mdl: null, uiAcc: 1, expT: {}, active: new Set(), relog: new Set(), everPlayed: false, errored: false };

export function validState(src) {
  if (!src || typeof src !== 'object' || !Array.isArray(src.nodes) || !Array.isArray(src.edges)) return false;
  if (!src.nodes.some(n => n && n.type === 'users')) return false;
  const okNode = (n) => n && typeof n.id === 'string' && TYPES[n.type] && Number.isFinite(n.x) && Number.isFinite(n.y) && (n.size == null || SIZES[n.size]);
  if (!src.nodes.every(okNode)) return false;
  const ids = new Set(src.nodes.map(n => n.id));
  if (!src.edges.every(e => e && ids.has(e.from) && ids.has(e.to))) return false;
  if (!Number.isInteger(src.mission) || src.mission < 0 || src.mission >= MISSIONS.length) return false;
  return true;
}
export function load(data) {
  let src = data && data.S ? data.S : null;
  if (!src) { try { src = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { src = null; } }
  if (!validState(src)) return;
  const f = fresh();
  S = Object.assign(f, src);
  const bools = (a) => MISSIONS.map((_, i) => !!(Array.isArray(a) && a[i]));
  S.done = bools(src.done); S.verified = bools(src.verified);
  // Results per mission. An older save kept one result per experiment for the whole level: it belongs to the
  // mission that was open. A finished mission keeps all its goals passed.
  const old = src.exp && typeof src.exp === 'object' && !Array.isArray(src.exp);
  S.exp = MISSIONS.map((_, i) => Object.fromEntries(expGoals(i).map(id => {
    if (S.done[i]) return [id, true];
    const r = old ? (i === src.mission ? src.exp[id] : false) : Array.isArray(src.exp) && src.exp[i] && src.exp[i][id];
    return [id, !!r];
  })));
  // At most the level's limit of each component type; extra ones (and their connections) are dropped.
  const kept = {};
  S.nodes = S.nodes.filter(n => { kept[n.type] = (kept[n.type] || 0) + 1; return kept[n.type] <= (level.limits[n.type] ?? Infinity); });
  const ids = new Set(S.nodes.map(n => n.id));
  S.edges = S.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  S.est = !!src.est; S.estVal = typeof src.estVal === 'string' ? src.estVal : '';
  const q = {};
  if (src.quiz && typeof src.quiz === 'object') for (const k in src.quiz) { const v = src.quiz[k]; if (Number.isInteger(v) && v >= 0 && Number.isInteger(+k) && +k >= 0 && +k < QUIZ.length && v < QUIZ[+k].o.length) q[k] = v; }
  S.quiz = (src.qv ?? src.v) === QUIZ_VERSION ? q : {}; // saved answers from another quiz version no longer line up
  S.v = level.saveVersion; S.qv = QUIZ_VERSION;
  if (!['lesson', 'build', 'quiz'].includes(S.tab)) S.tab = 'lesson';
  for (const n of S.nodes) {
    const c = COMPONENTS[n.type], t = TYPES[n.type];
    if (c.sized && !(c.sizes || SIZES)[n.size]) n.size = 'S';
    if (c.kinds && !Object.keys(c.kinds).includes(n.kind)) n.kind = t.kinds ? null : Object.keys(c.kinds)[0];
    if (c.algos && !c.algos[n.algo]) n.algo = c.defaultAlgo;
    for (const k in c.choices || {}) if (!c.choices[k].options[n[k]]) n[k] = c.choices[k].default;
    if (c.replicated && t.roles && !t.roles[n.role]) n.role = 'replica';
  }
  // One primary per type: any extra one goes back to being a replica.
  for (const type of Object.keys(TYPES)) S.nodes.filter(n => n.type === type && n.role === 'primary').slice(1).forEach(n => { n.role = 'replica'; });
  const maxId = Math.max(0, ...S.nodes.concat(S.edges).map(x => parseInt(String(x.id).replace(/\D/g, ''), 10) || 0));
  S.seq = Math.max(Number.isInteger(src.seq) ? src.seq : 1, maxId + 1);
}
export function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { /* storage unavailable */ } }
export const byId = (id) => S.nodes.find(n => n.id === id);

export function setS(v) { S = v; }

export function setSel(v) { sel = v; }

export function setConnectFrom(v) { connectFrom = v; }

export function setRefocus(v) { refocus = v; }
