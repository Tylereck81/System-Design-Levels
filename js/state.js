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
export const MISSIONS = level.missions;
export const QUIZ = level.quiz.questions;
export const PASS = level.quiz.passScore;
export const TXT = level.text;
export const EXPERIMENTS = level.experiments;
export const HOLD = 4; // seconds the targets must hold

/* ---------------- State ---------------- */
export const LS_KEY = level.saveKey;
export const fresh = () => ({
  nodes: level.startNodes.map(n => ({ ...n })),
  edges: [], seq: 1, mission: 0,
  done: MISSIONS.map(() => false), verified: MISSIONS.map(() => false),
  est: false, estVal: '', exp: Object.fromEntries(EXPERIMENTS.map(e => [e.id, false])),
  quiz: {}, tab: 'lesson', v: level.saveVersion,
});
export let S = fresh();
export let sel = null;          // {kind:'node'|'edge', id}
export let connectFrom = null;  // tap-to-connect source id
export let refocus = null;      // node id to give keyboard focus after re-render
export const qsel = {};         // quiz selection before "Check"
export const run = { playing: false, t: 0, on: {}, hold: 0, dnsDone: false, dnsFlying: false, spawnAcc: 0, mdl: null, uiAcc: 1, expT: {}, active: new Set(), everPlayed: false, errored: false };

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
  if (!src) { try { src = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { src = null; } }
  if (!validState(src)) return;
  const f = fresh();
  S = Object.assign(f, src);
  const bools = (a) => MISSIONS.map((_, i) => !!(Array.isArray(a) && a[i]));
  S.done = bools(src.done); S.verified = bools(src.verified);
  S.exp = Object.fromEntries(EXPERIMENTS.map(e => [e.id, !!(src.exp && src.exp[e.id])]));
  S.est = !!src.est; S.estVal = typeof src.estVal === 'string' ? src.estVal : '';
  const q = {};
  if (src.quiz && typeof src.quiz === 'object') for (const k in src.quiz) { const v = src.quiz[k]; if (Number.isInteger(v) && v >= 0 && Number.isInteger(+k) && +k >= 0 && +k < QUIZ.length && v < QUIZ[+k].o.length) q[k] = v; }
  S.quiz = src.v === level.saveVersion ? q : {}; // saved answers from another quiz version no longer line up
  S.v = level.saveVersion;
  if (!['lesson', 'build', 'quiz'].includes(S.tab)) S.tab = 'lesson';
  for (const n of S.nodes) { const c = COMPONENTS[n.type]; if (c.sized && !n.size) n.size = 'S'; if (c.kinds && !Object.keys(c.kinds).includes(n.kind)) n.kind = null; }
  const maxId = Math.max(0, ...S.nodes.concat(S.edges).map(x => parseInt(String(x.id).replace(/\D/g, ''), 10) || 0));
  S.seq = Math.max(Number.isInteger(src.seq) ? src.seq : 1, maxId + 1);
}
export function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }
export const byId = (id) => S.nodes.find(n => n.id === id);

export function setS(v) { S = v; }

export function setSel(v) { sel = v; }

export function setConnectFrom(v) { connectFrom = v; }

export function setRefocus(v) { refocus = v; }
