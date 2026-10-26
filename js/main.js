import level from '../levels/level-01.js';
import { fmt } from './format.js';

(() => {
  'use strict';
  document.documentElement.lang = 'en';
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  /* ---------------- Game data ---------------- */
  const SIZES = {
    S: { cpu: 2, cap: 200, cost: 40 },
    M: { cpu: 4, cap: 400, cost: 90 },
    L: { cpu: 8, cap: 800, cost: 200 },
    XL: { cpu: 16, cap: 1600, cost: 450 },
  };
  const T = { rtt: 40, web: 20, db: 10, dc: 0.5, dns: 5, nosqlLookup: 3, nosqlLookups: 3 };
  const VW = 760, VH = 520;
  let NW = 188, NH = 60, compact = false, curView = null;
  const TARGET_MS = level.targets.latencyMs;
  const TARGET_SERVED = level.targets.servedPct;

  const TYPES = level.components;
  const PALETTE = level.palette;
  const LIMIT_MSG = level.limitMsg;
  const OK_PAIRS = level.connections.ok;
  const BAD_PAIRS = level.connections.bad;
  const pairKey = (a, b) => [a, b].sort().join('|');
  const MISSIONS = level.missions;
  const QUIZ = level.quiz.questions;
  const PASS = level.quiz.passScore;
  const TXT = level.text;
  const HOLD = 4; // seconds the targets must hold

  /* ---------------- State ---------------- */
  const LS_KEY = level.saveKey;
  const fresh = () => ({
    nodes: level.startNodes.map(n => ({ ...n })),
    edges: [], seq: 1, mission: 0,
    done: MISSIONS.map(() => false), verified: MISSIONS.map(() => false),
    est: false, estVal: '', exp: { crash: false, spike: false },
    quiz: {}, tab: 'lesson', v: level.saveVersion,
  });
  let S = fresh();
  let sel = null;          // {kind:'node'|'edge', id}
  let connectFrom = null;  // tap-to-connect source id
  let refocus = null;      // node id to give keyboard focus after re-render
  const qsel = {};         // quiz selection before "Check"
  const run = { playing: false, t: 0, crash: false, spike: false, hold: 0, dnsDone: false, dnsFlying: false, spawnAcc: 0, mdl: null, uiAcc: 1, expT: { crash: 0, spike: 0 }, active: new Set(), everPlayed: false, errored: false };
  let dots = [];
  let logLines = [];

  function validState(src) {
    if (!src || typeof src !== 'object' || !Array.isArray(src.nodes) || !Array.isArray(src.edges)) return false;
    if (!src.nodes.some(n => n && n.type === 'users')) return false;
    const okNode = (n) => n && typeof n.id === 'string' && TYPES[n.type] && Number.isFinite(n.x) && Number.isFinite(n.y) && (n.size == null || SIZES[n.size]);
    if (!src.nodes.every(okNode)) return false;
    const ids = new Set(src.nodes.map(n => n.id));
    if (!src.edges.every(e => e && ids.has(e.from) && ids.has(e.to))) return false;
    if (!Number.isInteger(src.mission) || src.mission < 0 || src.mission >= MISSIONS.length) return false;
    return true;
  }
  function load(data) {
    let src = data && data.S ? data.S : null;
    if (!src) { try { src = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { src = null; } }
    if (!validState(src)) return;
    const f = fresh();
    S = Object.assign(f, src);
    const bools = (a) => MISSIONS.map((_, i) => !!(Array.isArray(a) && a[i]));
    S.done = bools(src.done); S.verified = bools(src.verified);
    S.exp = { crash: !!(src.exp && src.exp.crash), spike: !!(src.exp && src.exp.spike) };
    S.est = !!src.est; S.estVal = typeof src.estVal === 'string' ? src.estVal : '';
    const q = {};
    if (src.quiz && typeof src.quiz === 'object') for (const k in src.quiz) { const v = src.quiz[k]; if (Number.isInteger(v) && v >= 0 && Number.isInteger(+k) && +k >= 0 && +k < QUIZ.length && v < QUIZ[+k].o.length) q[k] = v; }
    S.quiz = src.v === level.saveVersion ? q : {}; // saved answers from another quiz version no longer line up
    S.v = level.saveVersion;
    if (!['lesson', 'build', 'quiz'].includes(S.tab)) S.tab = 'lesson';
    for (const n of S.nodes) { if ((n.type === 'web' || n.type === 'db') && !n.size) n.size = 'S'; if (n.type === 'db' && !['sql', 'nosql'].includes(n.kind)) n.kind = null; }
    const maxId = Math.max(0, ...S.nodes.concat(S.edges).map(x => parseInt(String(x.id).replace(/\D/g, ''), 10) || 0));
    S.seq = Math.max(Number.isInteger(src.seq) ? src.seq : 1, maxId + 1);
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }
  const byId = (id) => S.nodes.find(n => n.id === id);

  /* ---------------- Topology + model ---------------- */
  function graph() {
    const users = S.nodes.find(n => n.type === 'users');
    const outs = (id) => S.edges.filter(e => e.from === id).map(e => byId(e.to)).filter(Boolean);
    const uo = users ? outs(users.id) : [];
    const dns = uo.find(n => n.type === 'dns') || null;
    const web = uo.find(n => n.type === 'web') || null;
    const db = web ? (outs(web.id).find(n => n.type === 'db') || null) : null;
    const cost = S.nodes.reduce((s, n) => s + (n.type === 'dns' ? T.dns : (n.size ? SIZES[n.size].cost : 0)), 0);
    return { users, dns, hasDNS: !!dns, web, db, cost };
  }
  const qmul = (u) => (u >= 0.96 ? 25 : 1 / (1 - u));
  const webHasDb = (web) => S.edges.some(e => e.from === web.id && (byId(e.to) || {}).type === 'db');

  function model() {
    const g = graph();
    const M = MISSIONS[S.mission];
    const base = M.qps * (run.spike ? 10 : 1);
    const qps = base * (1 + 0.02 * Math.sin(run.t * 1.7) + 0.01 * Math.sin(run.t * 4.1));
    const r = { qps, base, servedPct: 0, latency: null, cost: g.cost, spof: 0, node: {}, issue: null, g, dropW: 1, dropD: 0 };
    if (!g.web) { r.issue = TXT.noWeb; return r; }
    if (!g.hasDNS) { r.issue = TXT.noDns; return r; }
    r.spof = g.db ? 2 : 1;
    if (run.crash) {
      r.issue = TXT.webDown;
      r.node[g.web.id] = { down: true, util: 0, load: qps, cap: 0, ms: 0, mult: 1 };
      return r;
    }
    const capW = SIZES[g.web.size].cap;
    if (g.db) {
      const nosql = g.db.kind === 'nosql';
      const per = nosql ? T.nosqlLookups : 1;
      const dbBase = nosql ? T.nosqlLookup * T.nosqlLookups : T.db;
      const capD = SIZES[g.db.size].cap;
      const sW = Math.min(qps, capW);
      const sD = Math.min(sW, capD / per);
      const uW = qps / capW, uD = (sW * per) / capD;
      const mw = T.web * qmul(uW), md = dbBase * qmul(uD);
      r.latency = T.rtt + mw + T.dc + md;
      r.servedPct = 100 * sD / qps;
      r.dropW = Math.max(0, 1 - capW / qps);
      r.dropD = sW > 0 ? Math.max(0, 1 - (capD / per) / sW) : 0;
      r.node[g.web.id] = { load: qps, cap: capW, util: uW, ms: mw, mult: qmul(uW), base: T.web, unit: 'req/s' };
      r.node[g.db.id] = { load: sW * per, cap: capD, util: uD, ms: md, mult: qmul(uD), base: dbBase, unit: nosql ? 'lookups/s' : 'queries/s', nosql };
    } else {
      const cap = capW / 2, u = qps / cap, ms = (T.web + T.db) * qmul(u);
      r.latency = T.rtt + ms;
      r.servedPct = 100 * Math.min(qps, cap) / qps;
      r.dropW = Math.max(0, 1 - cap / qps);
      r.node[g.web.id] = { load: qps, cap, util: u, ms, mult: qmul(u), base: T.web + T.db, combined: true, unit: 'req/s' };
    }
    return r;
  }

  /* ---------------- Icons ---------------- */
  function drawIcon(type, parent, x, y, scale) {
    const g = svgEl('g', { transform: `translate(${x} ${y})` + (scale ? ` scale(${scale})` : '') }, parent);
    if (type === 'users') {
      svgEl('rect', { x: 0, y: 4, width: 17, height: 12, rx: 2, class: 'ic-stroke' }, g);
      svgEl('path', { d: 'M-2 19h21', class: 'ic-stroke' }, g);
      svgEl('rect', { x: 21, y: 2, width: 9, height: 17, rx: 2, class: 'ic-stroke' }, g);
    } else if (type === 'dns') {
      svgEl('circle', { cx: 13, cy: 12, r: 10.5, class: 'ic-stroke' }, g);
      svgEl('ellipse', { cx: 13, cy: 12, rx: 4.6, ry: 10.5, class: 'ic-stroke' }, g);
      svgEl('path', { d: 'M2.5 12h21M4.5 6.5h17M4.5 17.5h17', class: 'ic-stroke' }, g);
    } else if (type === 'web') {
      svgEl('rect', { x: 6, y: 0, width: 15, height: 24, rx: 2, class: 'ic-web' }, g);
      svgEl('path', { d: 'M9.5 5.5h8M9.5 16.5h8M9.5 20h8', class: 'ic-line' }, g);
    } else if (type === 'db') {
      svgEl('path', { d: 'M3.5 5v14a9.5 4 0 0 0 19 0V5z', class: 'ic-data' }, g);
      svgEl('ellipse', { cx: 13, cy: 5, rx: 9.5, ry: 4, class: 'ic-data-top' }, g);
    }
    return g;
  }

  /* ---------------- Rendering: canvas ---------------- */
  const cv = $('cv'), nodesG = $('nodesG'), edgesG = $('edgesG'), dotsG = $('dotsG'), tagsG = $('tagsG'), previewLine = $('previewLine');
  const nodeRefs = {};

  function nodeSub(n) {
    if (n.type === 'users' || n.type === 'dns') return TYPES[n.type].sub;
    if (n.type === 'web') return webHasDb(n) ? `${n.size} · ${fmt(SIZES[n.size].cap)} req/s` : `${n.size} · ${fmt(SIZES[n.size].cap / 2)} req/s (½)`;
    if (n.type === 'db') return n.kind ? `${TYPES.db.kinds.find(k => k.id === n.kind).short} · ${n.size} ${fmt(SIZES[n.size].cap)}/s` : TYPES.db.unsetSub;
    return '';
  }

  function applyMode() {
    const w = cv.parentElement.clientWidth || VW;
    const c = w > 0 && w < 600;
    if (c !== compact) { compact = c; NW = c ? 150 : 188; NH = c ? 48 : 60; curView = null; }
    cv.classList.toggle('compact', compact);
  }
  function fitView(force) {
    if (!compact) { cv.setAttribute('viewBox', `0 0 ${VW} ${VH}`); curView = null; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of S.nodes) { x0 = Math.min(x0, n.x - NW / 2); x1 = Math.max(x1, n.x + NW / 2); y0 = Math.min(y0, n.y - NH / 2 - (n.type === 'users' ? 26 : 0)); y1 = Math.max(y1, n.y + NH / 2 + 20); }
    if (!force && curView && x0 >= curView.x && x1 <= curView.x + curView.w && y0 >= curView.y && y1 <= curView.y + curView.h) return;
    const pad = 14;
    const w = Math.max(360, x1 - x0 + pad * 2), h = Math.max(300, y1 - y0 + pad * 2);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    curView = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) };
    cv.setAttribute('viewBox', `${curView.x} ${curView.y} ${curView.w} ${curView.h}`);
  }

  function renderNodes() {
    nodesG.textContent = '';
    for (const k in nodeRefs) delete nodeRefs[k];
    for (const n of S.nodes) {
      const isSel = (sel && sel.kind === 'node' && sel.id === n.id) || connectFrom === n.id;
      const sub = nodeSub(n);
      const g = svgEl('g', { class: 'node' + (isSel ? ' sel' : ''), 'data-node': n.id, tabindex: '0', role: 'button', 'aria-label': `${TYPES[n.type].name}, ${sub}${isSel ? ', selected' : ''}`, transform: `translate(${n.x - NW / 2} ${n.y - NH / 2})` }, nodesG);
      svgEl('rect', { x: 0, y: 0, width: NW, height: NH, rx: 11, class: 'node-box' }, g);
      if (compact) {
        drawIcon(n.type, g, 10, 12, 0.9);
        const name = svgEl('text', { x: 44, y: 29, class: 'node-name' }, g); name.textContent = TYPES[n.type].name;
      } else {
        drawIcon(n.type, g, 12, 18);
        const name = svgEl('text', { x: 52, y: 26, class: 'node-name' }, g); name.textContent = TYPES[n.type].name + ' ';
        const subEl = svgEl('text', { x: 52, y: 43, class: 'node-sub' + (n.type === 'db' && !n.kind ? ' todo' : '') }, g); subEl.textContent = sub;
      }
      const ubg = svgEl('rect', { x: 12, y: NH - 7, width: NW - 24, height: 3, rx: 1.5, class: 'ubar-bg', visibility: 'hidden' }, g);
      const ub = svgEl('rect', { x: 12, y: NH - 7, width: 0, height: 3, rx: 1.5, class: 'ubar', visibility: 'hidden' }, g);
      const downG = svgEl('g', { visibility: 'hidden' }, g);
      svgEl('path', { d: `M${NW - 26} 10l14 14M${NW - 12} 10l-14 14`, class: 'down-x' }, downG);
      if (!compact) { const dt = svgEl('text', { x: NW - 19, y: 44, class: 'down-t', 'text-anchor': 'middle' }, downG); dt.textContent = 'DOWN'; }
      const h = svgEl('g', { class: 'handle', 'data-handle': n.id, transform: `translate(${NW / 2} ${NH})` }, g);
      svgEl('circle', { r: compact ? 20 : 15, class: 'hhit' }, h);
      svgEl('circle', { r: 9, class: 'hv' }, h);
      svgEl('path', { d: 'M-4 0h8M0 -4v8' }, h);
      const title = svgEl('title', {}, h); title.textContent = 'Drag to connect';
      nodeRefs[n.id] = { g, ub, ubg, downG };
    }
    if (refocus && nodeRefs[refocus]) nodeRefs[refocus].g.focus();
    refocus = null;
    paintLive();
  }

  function edgePoint(n, tx, ty, pad) {
    const dx = tx - n.x, dy = ty - n.y;
    if (!dx && !dy) return { x: n.x, y: n.y };
    const hw = NW / 2 + pad, hh = NH / 2 + pad;
    const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return { x: n.x + dx * s, y: n.y + dy * s };
  }

  function renderEdges() {
    edgesG.textContent = '';
    for (const e of S.edges) {
      const a = byId(e.from), b = byId(e.to);
      if (!a || !b) continue;
      const p1 = edgePoint(a, b.x, b.y, 2), p2 = edgePoint(b, a.x, a.y, 5);
      const isSel = sel && sel.kind === 'edge' && sel.id === e.id;
      const g = svgEl('g', { class: 'edge' + (isSel ? ' sel' : ''), 'data-edge': e.id }, edgesG);
      svgEl('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'edge-line', 'marker-end': isSel ? 'url(#arrSel)' : 'url(#arr)' }, g);
      svgEl('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'edge-hit' }, g);
      const info = OK_PAIRS[pairKey(a.type, b.type)];
      if (info) {
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        const w = info.label.length * (compact ? 8 : 6.7) + 8;
        const horiz = Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y);
        const lx = horiz ? mx - w / 2 : mx + 6, ly = horiz ? my - 24 : my - 9;
        svgEl('rect', { x: lx, y: ly, width: w, height: compact ? 18 : 16, rx: 4, class: 'edge-label-bg' }, g);
        const t = svgEl('text', { x: lx + 4, y: ly + (compact ? 14 : 12), class: 'edge-label' }, g); t.textContent = info.label;
      }
    }
  }

  function renderCanvas(force) { applyMode(); fitView(!!force); renderEdges(); renderNodes(); }
  window.addEventListener('resize', () => { if (S.tab === 'build') renderCanvas(true); });

  function paintLive() {
    const m = run.mdl;
    for (const n of S.nodes) {
      const ref = nodeRefs[n.id]; if (!ref) continue;
      const st = m && run.everPlayed ? m.node[n.id] : null;
      const down = !!(run.crash && m && m.g.web && m.g.web.id === n.id && run.everPlayed);
      ref.g.classList.toggle('down', down);
      ref.downG.setAttribute('visibility', down ? 'visible' : 'hidden');
      if (st && !st.down) {
        const u = Math.min(1, st.util);
        ref.ubg.setAttribute('visibility', 'visible'); ref.ub.setAttribute('visibility', 'visible');
        ref.ub.setAttribute('width', ((NW - 24) * u).toFixed(1));
        ref.ub.setAttribute('class', 'ubar' + (st.load > st.cap * 1.005 ? ' bad' : st.util >= 0.8 ? ' warn' : ''));
      } else {
        ref.ubg.setAttribute('visibility', 'hidden'); ref.ub.setAttribute('visibility', 'hidden');
      }
    }
  }

  /* ---------------- Palette ---------------- */
  const countType = (t) => S.nodes.filter(n => n.type === t).length;
  const atLimit = (t) => countType(t) >= (level.limits[t] ?? Infinity);
  function renderPalette() {
    const list = $('palList'); list.textContent = '';
    for (const t of PALETTE) {
      const full = atLimit(t);
      const b = document.createElement('button');
      b.className = 'pal-item'; b.type = 'button'; b.dataset.type = t;
      b.setAttribute('aria-disabled', full ? 'true' : 'false');
      b.title = full ? LIMIT_MSG[t] : 'Drag onto the canvas, or tap to add';
      const ic = svgEl('svg', { viewBox: '-3 -3 36 30', 'aria-hidden': 'true' });
      drawIcon(t, ic, 0, 0);
      b.appendChild(ic);
      const nm = document.createElement('span'); nm.className = 'pn'; nm.textContent = TYPES[t].name;
      const sb = document.createElement('span'); sb.className = 'ps'; sb.textContent = full ? 'Added' : TYPES[t].short;
      b.append(nm, sb);
      list.appendChild(b);
    }
  }

  const SLOTS = level.slots;
  const clampX = (x) => Math.max(NW / 2 + 4, Math.min(VW - NW / 2 - 4, x));
  const clampY = (y) => Math.max(NH / 2 + 30, Math.min(VH - NH / 2 - 22, y));
  const overlaps = (x, y, id) => S.nodes.some(n => n.id !== id && Math.abs(n.x - x) < NW + 14 && Math.abs(n.y - y) < NH + 14);
  function freeSpot(x, y, id) {
    if (!overlaps(x, y, id)) return { x, y };
    const sx = NW + 24, sy = NH + 34;
    for (let r = 1; r <= 4; r++) {
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const nx = clampX(x + dx * sx * r), ny = clampY(y + dy * sy * r);
        if (!overlaps(nx, ny, id)) return { x: nx, y: ny };
      }
    }
    return { x, y };
  }
  function addNode(type, x, y) {
    if (atLimit(type)) { log(LIMIT_MSG[type], 'warn'); return; }
    const p = (x == null) ? SLOTS[type] : { x, y };
    const spot = freeSpot(clampX(p.x), clampY(p.y), null);
    const n = { id: 'n' + (S.seq++), type, x: spot.x, y: spot.y };
    if (type === 'web' || type === 'db') n.size = 'S';
    if (type === 'db') n.kind = null;
    S.nodes.push(n);
    sel = { kind: 'node', id: n.id };
    afterDesignChange();
  }

  // palette pointer handling
  let pd = null;
  $('palList').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.pal-item'); if (!b) return;
    if (b.getAttribute('aria-disabled') === 'true') { log(LIMIT_MSG[b.dataset.type], 'warn'); return; }
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    pd = { type: b.dataset.type, sx: e.clientX, sy: e.clientY, moved: false, ghost: null };
  });
  $('palList').addEventListener('pointermove', (e) => {
    if (!pd) return;
    if (!pd.moved && Math.hypot(e.clientX - pd.sx, e.clientY - pd.sy) > 6) {
      pd.moved = true;
      pd.ghost = document.createElement('div'); pd.ghost.className = 'ghost'; pd.ghost.textContent = TYPES[pd.type].name;
      document.body.appendChild(pd.ghost);
    }
    if (pd.ghost) { pd.ghost.style.left = e.clientX + 'px'; pd.ghost.style.top = e.clientY + 'px'; }
  });
  const endPal = (e, cancel) => {
    if (!pd) return;
    const p = pd; pd = null;
    if (p.ghost) p.ghost.remove();
    if (cancel) return;
    if (!p.moved) { addNode(p.type); return; }
    const r = cv.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const pt = svgPt(e); addNode(p.type, pt.x, pt.y);
    } else {
      log(`Drop the ${TYPES[p.type].name.toLowerCase()} on the canvas to add it, or tap it in the list.`, 'warn');
    }
  };
  $('palList').addEventListener('pointerup', (e) => endPal(e, false));
  $('palList').addEventListener('pointercancel', (e) => endPal(e, true));
  $('palList').addEventListener('keydown', (e) => {
    const b = e.target.closest('.pal-item');
    if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (b.getAttribute('aria-disabled') !== 'true') addNode(b.dataset.type); else log(LIMIT_MSG[b.dataset.type], 'warn'); }
  });

  /* ---------------- Canvas interaction ---------------- */
  function svgPt(e) {
    const pt = cv.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(cv.getScreenCTM().inverse());
  }
  function nodeAt(p) {
    for (let i = S.nodes.length - 1; i >= 0; i--) {
      const n = S.nodes[i];
      if (Math.abs(p.x - n.x) <= NW / 2 && Math.abs(p.y - n.y) <= NH / 2 + 12) return n;
    }
    return null;
  }
  function select(next) { sel = next; renderCanvas(); renderInspector(); }
  function cancelConnect() { if (connectFrom) { connectFrom = null; setBanner(); } }

  let drag = null, conn = null;
  cv.addEventListener('pointerdown', (e) => {
    const p = svgPt(e);
    const h = e.target.closest('[data-handle]');
    if (h) {
      e.preventDefault();
      if (connectFrom && connectFrom !== h.dataset.handle) { tryConnect(connectFrom, h.dataset.handle); connectFrom = null; setBanner(); renderCanvas(); return; }
      cv.setPointerCapture(e.pointerId);
      const n = byId(h.dataset.handle);
      conn = { from: n.id, sx: e.clientX, sy: e.clientY, moved: false };
      previewLine.setAttribute('x1', n.x); previewLine.setAttribute('y1', n.y + NH / 2);
      previewLine.setAttribute('x2', p.x); previewLine.setAttribute('y2', p.y);
      return;
    }
    const ng = e.target.closest('[data-node]');
    if (ng) {
      const n = byId(ng.dataset.node);
      if (connectFrom && connectFrom !== n.id) { tryConnect(connectFrom, n.id); connectFrom = null; setBanner(); renderCanvas(); return; }
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      drag = { id: n.id, ox: p.x - n.x, oy: p.y - n.y, sx: e.clientX, sy: e.clientY, moved: false };
      return;
    }
    const eg = e.target.closest('[data-edge]');
    if (eg) { cancelConnect(); select({ kind: 'edge', id: eg.dataset.edge }); return; }
    cancelConnect(); select(null);
  });
  cv.addEventListener('pointermove', (e) => {
    if (conn) {
      if (Math.hypot(e.clientX - conn.sx, e.clientY - conn.sy) > 5) { conn.moved = true; previewLine.setAttribute('visibility', 'visible'); }
      const p = svgPt(e); previewLine.setAttribute('x2', p.x); previewLine.setAttribute('y2', p.y);
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
      if (!drag.moved) return;
      const p = svgPt(e); const n = byId(drag.id); if (!n) { drag = null; return; }
      n.x = clampX(p.x - drag.ox); n.y = clampY(p.y - drag.oy);
      nodeRefs[n.id].g.setAttribute('transform', `translate(${n.x - NW / 2} ${n.y - NH / 2})`);
      renderEdges();
    }
  });
  const endCanvas = (e) => {
    if (conn) {
      previewLine.setAttribute('visibility', 'hidden');
      const c = conn; conn = null;
      if (!c.moved) { connectFrom = c.from; sel = { kind: 'node', id: c.from }; setBanner(); renderCanvas(); renderInspector(); return; }
      const t = nodeAt(svgPt(e));
      if (t && t.id !== c.from) tryConnect(c.from, t.id);
      return;
    }
    if (drag) {
      const d = drag; drag = null;
      if (!d.moved) { select({ kind: 'node', id: d.id }); return; }
      const n = byId(d.id);
      if (n) { const s = freeSpot(n.x, n.y, n.id); n.x = s.x; n.y = s.y; }
      renderCanvas(); save();
    }
  };
  cv.addEventListener('pointerup', endCanvas);
  cv.addEventListener('pointercancel', () => { conn = null; drag = null; previewLine.setAttribute('visibility', 'hidden'); });

  // keyboard on canvas nodes
  cv.addEventListener('keydown', (e) => {
    const ng = e.target.closest && e.target.closest('[data-node]'); if (!ng) return;
    const n = byId(ng.dataset.node); if (!n) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); e.stopPropagation();
      if (connectFrom && connectFrom !== n.id) { tryConnect(connectFrom, n.id); connectFrom = null; setBanner(); }
      sel = { kind: 'node', id: n.id }; refocus = n.id; renderCanvas(); renderInspector();
      return;
    }
    const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (mv) {
      e.preventDefault();
      const step = e.shiftKey ? 40 : 10;
      n.x = clampX(n.x + mv[0] * step); n.y = clampY(n.y + mv[1] * step);
      refocus = n.id; renderCanvas(); save();
    }
  });

  function tryConnect(aId, bId) {
    const a = byId(aId), b = byId(bId);
    if (!a || !b || a.id === b.id) return false;
    const key = pairKey(a.type, b.type);
    const ok = OK_PAIRS[key];
    if (!ok) { log(BAD_PAIRS[key] || 'Those two components do not connect in this level.', 'bad'); return false; }
    const from = a.type === ok.from ? a : b, to = a.type === ok.from ? b : a;
    if (S.edges.some(e => e.from === from.id && e.to === to.id)) return false;
    S.edges.push({ id: 'e' + (S.seq++), from: from.id, to: to.id });
    log(`Connected ${TYPES[from.type].name} → ${TYPES[to.type].name} (${ok.label}).`);
    afterDesignChange();
    return true;
  }
  function disconnect(aId, bId) {
    S.edges = S.edges.filter(e => !((e.from === aId && e.to === bId) || (e.from === bId && e.to === aId)));
    afterDesignChange();
  }

  function removeSel() {
    if (!sel) return;
    if (sel.kind === 'node') {
      const n = byId(sel.id); if (!n || n.type === 'users') return;
      S.nodes = S.nodes.filter(x => x.id !== n.id);
      S.edges = S.edges.filter(e => e.from !== n.id && e.to !== n.id);
      if (connectFrom === n.id) connectFrom = null;
      if (run.crash && !graph().web) { run.crash = false; }
    } else {
      S.edges = S.edges.filter(e => e.id !== sel.id);
    }
    sel = null; afterDesignChange();
  }

  document.addEventListener('keydown', (e) => {
    if (S.tab !== 'build') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSel(); }
    if (e.key === 'Escape') { connectFrom = null; setBanner(); select(null); }
    if (e.key === ' ' && e.target === document.body) { e.preventDefault(); togglePlay(); }
  });

  function setBanner() {
    const b = $('banner');
    if (connectFrom && !byId(connectFrom)) connectFrom = null;
    if (connectFrom) { b.className = 'banner info'; b.textContent = `Tap another component to connect it to ${TYPES[byId(connectFrom).type].name}. Press Esc to cancel.`; b.hidden = false; return; }
    const m = run.mdl;
    if (run.playing && m && m.issue && !run.crash) { b.className = 'banner'; b.textContent = m.issue; b.hidden = false; return; }
    b.hidden = true;
  }

  /* ---------------- Inspector ---------------- */
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function renderInspector() {
    const box = $('insp'); box.textContent = '';
    box.appendChild(el('p', 'label', 'Inspector'));
    if (sel && sel.kind === 'node' && !byId(sel.id)) sel = null;
    if (sel && sel.kind === 'edge' && !S.edges.some(x => x.id === sel.id)) sel = null;
    if (!sel) {
      box.appendChild(el('p', 'empty', 'Select a component on the canvas (click it, or Tab to it and press Enter) to see what it does, change its size and manage its connections.'));
      return;
    }
    if (sel.kind === 'edge') {
      const e = S.edges.find(x => x.id === sel.id);
      const a = byId(e.from), b = byId(e.to), info = OK_PAIRS[pairKey(a.type, b.type)];
      box.appendChild(el('h2', null, `${TYPES[a.type].name} → ${TYPES[b.type].name}`));
      box.appendChild(el('p', 'desc', info.desc));
      const rm = el('button', 'btn danger', 'Remove connection'); rm.type = 'button'; rm.onclick = removeSel;
      box.appendChild(rm); return;
    }
    const n = byId(sel.id);
    box.appendChild(el('h2', null, TYPES[n.type].name));
    box.appendChild(el('p', 'desc', TYPES[n.type].desc));
    if (n.type === 'db') {
      box.appendChild(el('p', 'label', TYPES.db.kindsLabel));
      const seg = el('div', 'seg two');
      for (const kind of TYPES.db.kinds) {
        const b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', n.kind === kind.id ? 'true' : 'false');
        b.innerHTML = `<b>${kind.name}</b><span>${kind.sub}</span>`;
        b.onclick = () => { n.kind = kind.id; afterDesignChange(); log(kind.log, kind.tone); };
        seg.appendChild(b);
      }
      box.appendChild(seg);
      const chosen = TYPES.db.kinds.find(k => k.id === n.kind);
      box.appendChild(el('p', 'kind-note', chosen ? chosen.note : TYPES.db.unsetNote));
    }
    if (n.type === 'web' || n.type === 'db') {
      box.appendChild(el('p', 'label', 'Server size (scale up)'));
      const seg = el('div', 'seg');
      for (const k of Object.keys(SIZES)) {
        const b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', n.size === k ? 'true' : 'false');
        b.innerHTML = `<b>${k}</b> <span>${fmt(SIZES[k].cap)}/s</span><br><span>$${SIZES[k].cost}</span>`;
        b.title = `${SIZES[k].cpu} vCPU · ${fmt(SIZES[k].cap)} requests/s · $${SIZES[k].cost}/month`;
        b.setAttribute('aria-label', `${k} ${fmt(SIZES[k].cap)}/s, $${SIZES[k].cost} a month`);
        b.onclick = () => { n.size = k; afterDesignChange(); };
        seg.appendChild(b);
      }
      box.appendChild(seg);
      if (n.type === 'web' && !webHasDb(n)) box.appendChild(el('p', 'kind-note', TYPES.web.noDbNote));
      const live = el('div', 'live'); live.id = 'inspLive'; box.appendChild(live);
      paintInspectorLive();
    }
    if (n.type === 'users') {
      const M0 = MISSIONS[S.mission], hid = M0.gate && !S.est;
      const live = el('div', 'live');
      live.innerHTML = `<div><b>${hid ? '?' : fmt(M0.qps * (run.spike ? 10 : 1))}</b><span>req/s at peak</span></div><div><b>${T.rtt} ms</b><span>internet round trip</span></div>`;
      box.appendChild(live);
    }
    // connections (keyboard- and touch-friendly alternative to dragging)
    const partners = S.nodes.filter(m => m.id !== n.id && OK_PAIRS[pairKey(n.type, m.type)]);
    if (partners.length) {
      box.appendChild(el('p', 'label', 'Connections'));
      const list = el('div', 'conns');
      for (const m of partners) {
        const ok = OK_PAIRS[pairKey(n.type, m.type)];
        const from = n.type === ok.from ? n : m, to = n.type === ok.from ? m : n;
        const linked = S.edges.some(e => e.from === from.id && e.to === to.id);
        const row = el('div', 'conn');
        row.appendChild(el('span', null, `${TYPES[from.type].name} → ${TYPES[to.type].name}`));
        const b = el('button', 'btn sm' + (linked ? ' danger' : ''), linked ? 'Disconnect' : 'Connect'); b.type = 'button';
        b.onclick = () => { if (linked) { disconnect(from.id, to.id); log(`Disconnected ${TYPES[from.type].name} → ${TYPES[to.type].name}.`); } else tryConnect(from.id, to.id); };
        row.appendChild(b); list.appendChild(row);
      }
      box.appendChild(list);
    }
    if (n.type !== 'users') {
      const rm = el('button', 'btn danger', 'Remove ' + TYPES[n.type].name.toLowerCase()); rm.type = 'button'; rm.onclick = removeSel;
      box.appendChild(rm);
    }
  }
  function paintInspectorLive() {
    const live = $('inspLive'); if (!live || !sel || sel.kind !== 'node') return;
    const n = byId(sel.id); if (!n || !n.size) return;
    const st = run.mdl && run.everPlayed ? run.mdl.node[n.id] : null;
    if (!st) { live.innerHTML = `<div><b>${fmt(SIZES[n.size].cap / (n.type === 'web' && !webHasDb(n) ? 2 : 1))}</b><span>capacity, per second</span></div><div><b>—</b><span>press Play for load</span></div>`; return; }
    if (st.down) { live.innerHTML = `<div><b style="color:var(--bad)">down</b><span>serving nothing</span></div><div><b>0</b><span>req/s served</span></div>`; return; }
    const pct = Math.round(st.util * 100);
    const col = st.load > st.cap * 1.005 ? 'var(--bad)' : st.util >= 0.8 ? 'var(--warn)' : 'var(--ok)';
    live.innerHTML = `<div><b>${fmt(st.load)}</b><span>${st.unit} arriving</span></div><div><b>${fmt(st.cap)}</b><span>capacity${st.combined ? ' (code + data)' : ''}</span></div><div><b style="color:${col}">${pct}%</b><span>busy</span></div><div><b>${st.ms.toFixed(st.ms < 10 ? 1 : 0)} ms</b><span>per request (${st.mult.toFixed(1)}× base)</span></div>`;
  }

  /* ---------------- HUD ---------------- */
  function renderHUD() {
    const m = run.mdl || model();
    const M = MISSIONS[S.mission];
    const played = run.everPlayed;
    const hidden = M.gate && !S.est;
    const cells = [
      { l: 'Traffic', v: hidden ? '?' : fmt(m.base), u: 'req/s', t: hidden ? 'estimate first' : (run.spike ? '10× spike' : 'at peak'), s: '' },
      { l: 'Served', v: played ? m.servedPct.toFixed(1) : '—', u: played ? '%' : '', t: `goal ≥ ${TARGET_SERVED}%`, s: played ? (m.servedPct >= TARGET_SERVED ? 'pass' : 'fail') : '' },
      { l: 'Response', v: played && m.latency != null ? fmt(m.latency) : '—', u: played && m.latency != null ? 'ms' : '', t: `goal < ${TARGET_MS} ms`, s: played ? (m.latency != null && m.latency < TARGET_MS ? 'pass' : 'fail') : '' },
      { l: 'Cost', v: '$' + fmt(m.cost), u: '/mo', t: M.budget ? 'budget $' + M.budget : 'no budget', s: M.budget ? (m.cost <= M.budget ? 'pass' : 'fail') : '' },
      { l: 'SPOFs', v: String(m.spof), u: '', t: 'no redundancy', s: '' },
    ];
    $('hud').innerHTML = cells.map(c => `<div class="metric ${c.s}"><p class="label">${c.l}</p><div class="mv">${c.v}<small>${c.u}</small></div><div class="mt" title="${c.t}">${c.t}</div></div>`).join('');
  }

  /* ---------------- Mission panel ---------------- */
  const unlocked = (i) => i === 0 || S.done[i - 1];
  function renderMissionTabs() {
    const box = $('mtabs'); box.textContent = '';
    MISSIONS.forEach((M, i) => {
      const b = el('button', S.done[i] ? 'done' : '', (S.done[i] ? '✓ ' : '') + 'Mission ' + (i + 1)); b.type = 'button';
      b.disabled = !unlocked(i);
      b.setAttribute('aria-current', S.mission === i ? 'true' : 'false');
      b.title = unlocked(i) ? M.title : 'Finish the previous mission first';
      b.onclick = () => switchMission(i);
      box.appendChild(b);
    });
  }

  function switchMission(i) {
    if (!unlocked(i) || i === S.mission) return;
    S.mission = i;
    stopRun(true);
    afterChange(true);
    log(`Mission ${i + 1}: ${MISSIONS[i].title}. Traffic is now ${MISSIONS[i].gate && !S.est ? 'unknown until you estimate it' : fmt(MISSIONS[i].qps) + ' req/s'}.`);
  }

  function renderMission() {
    renderMissionTabs();
    const M = MISSIONS[S.mission], i = S.mission;
    const box = $('mission'); box.textContent = '';
    box.appendChild(el('p', 'label', `Mission ${i + 1} of ${MISSIONS.length} · ${M.ref}`));
    box.appendChild(el('h2', null, M.title));
    box.appendChild(el('p', 'story', M.story));
    const facts = el('div', 'facts');
    const trafficTxt = M.gate && !S.est ? '?' : fmt(M.qps);
    facts.innerHTML = `<div><b>${trafficTxt}</b><span>req/s at peak</span></div><div><b>${M.budget ? '$' + M.budget : '—'}</b><span>monthly budget</span></div><div><b>&lt;${TARGET_MS} ms</b><span>response</span></div>`;
    box.appendChild(facts);
    if (M.gate) box.appendChild(renderGate(M));
    const ul = el('ul', 'goals'); ul.id = 'goals'; box.appendChild(ul);
    const vf = el('div'); vf.id = 'verify'; box.appendChild(vf);
    paintGoals();
    if (S.done[i]) {
      const c = el('div', 'complete');
      const last = i === MISSIONS.length - 1;
      c.innerHTML = `<b>Mission complete.</b><p>${M.takeaway}</p>`;
      const nb = el('button', 'btn primary', last ? 'Take the quiz →' : `Mission ${i + 2} →`); nb.type = 'button';
      nb.onclick = () => last ? setTab('quiz') : switchMission(i + 1);
      c.appendChild(nb); box.appendChild(c);
    } else {
      const d = el('details', 'hint');
      d.appendChild(el('summary', null, 'Stuck? Show a hint'));
      d.appendChild(el('p', null, M.hint));
      box.appendChild(d);
    }
    $('expGroup').hidden = !M.gate;
    paintControls();
  }

  function renderGate(M) {
    const g = el('div', 'gate' + (S.est ? ' passed' : ''));
    if (S.est) {
      g.innerHTML = M.gate.acceptedHtml;
      return g;
    }
    g.innerHTML = `<p>${M.gate.prompt}</p>
      <div class="row"><label for="estIn" class="label">${M.gate.label}</label><input id="estIn" inputmode="numeric" autocomplete="off" placeholder="${M.gate.placeholder}"><button class="btn primary" id="estBtn" type="button">Check</button></div>
      <div class="fb" id="estFb" aria-live="polite"></div>`;
    const inp = g.querySelector('#estIn'), btn = g.querySelector('#estBtn'), fb = g.querySelector('#estFb');
    inp.value = S.estVal || '';
    const check = () => {
      S.estVal = inp.value;
      const m = (inp.value || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
      if (!m) { fb.className = 'fb bad'; fb.textContent = M.gate.notNumber; return; }
      const v = parseFloat(m[0]);
      if (v >= M.gate.lo && v <= M.gate.hi) { S.est = true; log(M.gate.acceptedLog, 'ok'); afterChange(); return; }
      fb.className = 'fb bad';
      const hint = M.gate.hints.find(h => h.test(v));
      fb.textContent = hint ? hint.text : M.gate.fallback;
    };
    btn.onclick = check;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    inp.addEventListener('input', () => { S.estVal = inp.value; fb.textContent = ''; });
    return g;
  }

  const ICONS = {
    pass: '<svg class="gi" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.5" fill="var(--ok)"/><path d="M4.6 8.2l2.2 2.2 4.6-4.8" fill="none" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fail: '<svg class="gi" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.5" fill="var(--bad)"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round"/></svg>',
    todo: '<svg class="gi" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="var(--ink-3)" stroke-width="1.4"/></svg>',
  };
  const STATUS_TXT = { pass: 'met', fail: 'not met', todo: 'not tested yet' };
  const liveMetrics = () => run.everPlayed && !run.crash && !run.spike;

  function goalStatus(goal, m, g) {
    if (goal.type === 'struct') return goal.test(g) ? 'pass' : (run.everPlayed || goal.id === 'cost' ? 'fail' : 'todo');
    if (goal.type === 'gate') return S.est ? 'pass' : 'todo';
    if (goal.type === 'exp') return S.exp[goal.id] ? 'pass' : 'todo';
    if (liveMetrics()) return goal.test(m) ? 'pass' : 'fail';
    return S.verified[S.mission] ? 'pass' : 'todo';
  }

  function paintGoals() {
    const ul = $('goals'); if (!ul) return;
    const M = MISSIONS[S.mission];
    const m = run.mdl || model(); const g = m.g;
    let met = 0;
    ul.innerHTML = M.goals.map(goal => {
      const s = goalStatus(goal, m, g); if (s === 'pass') met++;
      let v = '';
      if (goal.val && (goal.type === 'struct' || liveMetrics())) v = goal.val(m, g);
      return `<li class="${s}">${ICONS[s]}<span>${goal.text}<span class="sr-only"> (${STATUS_TXT[s]})</span></span><span class="gv">${v}</span></li>`;
    }).join('');
    const strip = $('mstrip');
    strip.innerHTML = `<span><b>Mission ${S.mission + 1}:</b> ${M.title}</span><span>${S.done[S.mission] ? 'complete' : met + '/' + M.goals.length + ' goals'} · brief ↓</span>`;
    const vf = $('verify'); if (!vf) return;
    const failingNow = liveMetrics() && M.goals.some(x => x.type === 'metric' && !x.test(m));
    if (S.done[S.mission] && failingNow) { vf.innerHTML = '<p class="verify bad">Your current design no longer meets the targets.</p>'; return; }
    if (S.verified[S.mission]) { vf.innerHTML = `<p class="verify ok">Targets held for ${HOLD} s.${M.goals.some(x => x.type === 'exp') && !S.done[S.mission] ? ' Now break it.' : ''}</p>`; return; }
    if (run.playing && (run.crash || run.spike)) { vf.innerHTML = '<p class="verify">Experiment running: targets are paused.</p>'; return; }
    if (run.playing && run.hold > 0) { vf.innerHTML = `<p class="verify">Holding targets… ${run.hold.toFixed(1)} / ${HOLD} s</p><div class="vbar"><i style="width:${Math.min(100, run.hold / HOLD * 100)}%"></i></div>`; return; }
    vf.innerHTML = run.everPlayed ? '' : `<p class="verify">Press Play to test your design. Targets must hold for ${HOLD} seconds.</p>`;
  }
  $('mstrip').addEventListener('click', () => { const c = $('missionCard'); c.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); c.focus({ preventScroll: true }); });

  /* ---------------- Controls ---------------- */
  function paintControls() {
    const M = MISSIONS[S.mission];
    const pb = $('playBtn');
    const blocked = !!(M.gate && !S.est);
    pb.disabled = blocked;
    pb.title = blocked ? 'Estimate peak traffic first' : (run.playing ? 'Pause the simulation' : 'Start the simulation');
    $('playIcon').textContent = run.playing ? '❚❚' : '▶';
    $('playTxt').textContent = blocked ? 'Estimate first' : (run.playing ? 'Pause' : 'Play');
    const cb = $('crashBtn'), sb = $('spikeBtn');
    cb.disabled = blocked; sb.disabled = blocked;
    cb.setAttribute('aria-pressed', run.crash ? 'true' : 'false');
    sb.setAttribute('aria-pressed', run.spike ? 'true' : 'false');
    cb.textContent = (S.exp.crash ? '✓ ' : '') + (run.crash ? TXT.crashBtnOn : TXT.crashBtn);
    sb.textContent = (S.exp.spike ? '✓ ' : '') + (run.spike ? TXT.spikeBtnOn : TXT.spikeBtn);
  }
  function togglePlay() {
    const M = MISSIONS[S.mission];
    if (M.gate && !S.est) return;
    run.playing = !run.playing;
    if (run.playing) { run.everPlayed = true; run.errored = false; log(run.t === 0 ? 'Simulation started.' : 'Resumed.'); }
    else log('Paused.');
    paintControls(); setBanner(); renderInspector(); paintGoals(); renderHUD();
  }
  $('playBtn').onclick = togglePlay;
  const designReady = () => { const g = graph(); return !!(g.web && g.hasDNS); };
  $('crashBtn').onclick = () => {
    if (!run.crash && !designReady()) { log(TXT.crashNeedsDesign, 'warn'); return; }
    run.crash = !run.crash; run.hold = 0;
    if (run.crash) { log(TXT.crashOn, 'bad'); if (!run.playing) togglePlay(); }
    else log(TXT.crashOff, 'ok');
    run.mdl = model(); paintControls(); paintGoals(); renderInspector(); paintLive();
  };
  $('spikeBtn').onclick = () => {
    if (!run.spike && !designReady()) { log(TXT.spikeNeedsDesign, 'warn'); return; }
    run.spike = !run.spike; run.hold = 0;
    if (run.spike) { log(TXT.spikeOn(MISSIONS[S.mission].qps * 10), 'warn'); if (!run.playing) togglePlay(); }
    else log(TXT.spikeOff, 'ok');
    run.mdl = model(); paintControls(); paintGoals(); renderInspector(); renderHUD();
  };
  function armButton(btn, label, armedLabel, action) {
    let armed = false, timer = null;
    btn.onclick = () => {
      if (!armed) { armed = true; btn.textContent = armedLabel; timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000); return; }
      clearTimeout(timer); armed = false; btn.textContent = label; action();
    };
  }
  armButton($('resetBtn'), 'Clear canvas', 'Click again to clear', () => {
    S.nodes = S.nodes.filter(n => n.type === 'users'); S.edges = []; sel = null; connectFrom = null;
    stopRun(true); afterDesignChange(); log('Canvas cleared.');
  });
  armButton($('resetLevel'), 'Reset level progress', 'Click again: this clears your missions and canvas', () => {
    const keepQuiz = S.quiz, keepTab = S.tab;
    S = fresh(); S.quiz = keepQuiz; S.tab = keepTab; sel = null; connectFrom = null;
    stopRun(true); afterChange(true); log('Level progress reset. Mission 1 is waiting.');
  });

  function stopRun(full) {
    run.playing = false; run.crash = false; run.spike = false; run.hold = 0; run.spawnAcc = 0;
    run.expT = { crash: 0, spike: 0 }; run.active = new Set();
    if (full) { run.t = 0; run.dnsDone = false; run.dnsFlying = false; run.everPlayed = false; run.mdl = null; }
    dots.forEach(d => d.c.remove()); dots = []; tagsG.textContent = '';
  }

  /* ---------------- Log ---------------- */
  function log(msg, tone) {
    logLines.unshift({ t: run.t, msg, tone: tone || '' });
    logLines = logLines.slice(0, 6);
    const box = $('log'); box.textContent = '';
    for (const l of logLines) {
      const row = el('div'); row.appendChild(el('span', 'lt', `t=${l.t.toFixed(1)}s`)); row.appendChild(el('span', l.tone, l.msg)); box.appendChild(row);
    }
  }

  function observe(m) {
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

  /* ---------------- Simulation loop ---------------- */
  function spawn(route, kind, failAt) {
    const c = svgEl('circle', { r: 4.3, class: 'dot ' + kind, cx: -20, cy: -20 }, dotsG);
    const jx = (Math.random() - 0.5) * 18, jy = (Math.random() - 0.5) * 8;
    const turn = Math.floor((route.length - 1) / 2);
    const d = { c, route, i: 0, t: 0, dur: 0.4, dwell: 0, kind, failAt, turn, dead: 0, jx, jy, x: 0, y: 0 };
    d.dur = segDur(d);
    dots.push(d);
    return d;
  }
  function segDur(d) {
    const a = byId(d.route[d.i]), b = byId(d.route[d.i + 1]);
    if (!a || !b) return 0.3;
    return Math.max(0.28, Math.hypot(b.x - a.x, b.y - a.y) / 360);
  }
  function dwellFor(id, forward) {
    const n = byId(id); if (!n) return 0;
    if (n.type === 'dns') return 0.25;
    if (!forward) return 0.02;
    const st = run.mdl && run.mdl.node[id];
    if (!st) return 0.05;
    return Math.min(1.4, 0.06 * (st.mult || 1));
  }
  function showIpTag(n) {
    tagsG.textContent = '';
    const g = svgEl('g', { class: 'ip-tag', transform: `translate(${n.x - NW / 2} ${n.y - NH / 2 - 26})` }, tagsG);
    svgEl('rect', { x: 0, y: 0, width: 168, height: 20, rx: 5 }, g);
    const t = svgEl('text', { x: 8, y: 14 }, g); t.textContent = TXT.ipTag;
    setTimeout(() => { if (g.parentNode) g.remove(); }, 2600);
  }

  function step(dt) {
    run.t += dt;
    const m = model(); run.mdl = m; const g = m.g;

    if (g.hasDNS && g.web && !run.dnsDone && !run.dnsFlying && !run.crash) {
      run.dnsFlying = true;
      const d = spawn([g.users.id, g.dns.id, g.users.id], 'dns', -1);
      d.onDone = () => { run.dnsDone = true; run.dnsFlying = false; showIpTag(g.users); log(TXT.dnsAnswered, ''); };
    }
    if (!g.hasDNS) run.dnsDone = false;

    if (g.users && g.web && g.hasDNS && (!m.issue || run.crash) && (run.dnsDone || run.crash)) {
      const rate = Math.max(2.5, Math.min(12, m.qps / 14));
      run.spawnAcc += dt * rate;
      while (run.spawnAcc >= 1) {
        run.spawnAcc -= 1;
        if (dots.length > 90) break;
        const route = g.db ? [g.users.id, g.web.id, g.db.id, g.web.id, g.users.id] : [g.users.id, g.web.id, g.users.id];
        let failAt = -1;
        if (run.crash || Math.random() < m.dropW) failAt = 1;
        else if (g.db && Math.random() < m.dropD) failAt = 2;
        spawn(route, 'req', failAt);
      }
    }

    const M = MISSIONS[S.mission], i = S.mission;
    if (!S.verified[i]) {
      const allOk = !run.crash && !run.spike && M.goals.every(goal => {
        if (goal.type === 'exp') return true;
        if (goal.type === 'gate') return S.est;
        if (goal.type === 'struct') return goal.test(g);
        return goal.test(m);
      });
      run.hold = allOk ? run.hold + dt : 0;
      if (run.hold >= HOLD) { S.verified[i] = true; log(`Targets held for ${HOLD} seconds.`, 'ok'); checkDone(); save(); renderMission(); }
    }
    const built = !!(g.web && g.hasDNS);
    for (const k of ['crash', 'spike']) {
      if (run[k] && built && M.goals.some(x => x.id === k) && !S.exp[k]) {
        run.expT[k] += dt;
        if (run.expT[k] >= 1.5) {
          S.exp[k] = true;
          log(k === 'crash' ? TXT.crashObserved : TXT.spikeObserved, 'ok');
          checkDone(); save(); renderMission();
        }
      }
    }
  }

  function checkDone() {
    const i = S.mission, M = MISSIONS[i];
    if (S.done[i]) return;
    const expsOk = M.goals.filter(x => x.type === 'exp').every(x => S.exp[x.id]);
    if (S.verified[i] && expsOk && (!M.gate || S.est)) {
      S.done[i] = true;
      log(i === MISSIONS.length - 1 ? TXT.levelComplete : `Mission ${i + 1} complete.`, 'ok');
      renderTabs();
    }
  }

  function moveDots(dt) {
    for (let k = dots.length - 1; k >= 0; k--) {
      const d = dots[k];
      if (d.dead) {
        d.dead += dt;
        d.c.setAttribute('opacity', Math.max(0, 1 - d.dead / 0.7).toFixed(2));
        d.c.setAttribute('r', (4.3 + d.dead * 4).toFixed(1));
        if (d.dead > 0.7) { d.c.remove(); dots.splice(k, 1); }
        continue;
      }
      const a = byId(d.route[d.i]), b = byId(d.route[d.i + 1]);
      if (!a || !b) { d.c.remove(); dots.splice(k, 1); if (d.onDone) run.dnsFlying = false; continue; }
      if (d.dwell > 0) { d.dwell -= dt; continue; }
      d.t += dt;
      const f = Math.min(1, d.t / d.dur);
      const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      const p1 = edgePoint(a, b.x, b.y, 0), p2 = edgePoint(b, a.x, a.y, 0);
      d.x = p1.x + (p2.x - p1.x) * e; d.y = p1.y + (p2.y - p1.y) * e;
      d.c.setAttribute('cx', d.x.toFixed(1)); d.c.setAttribute('cy', d.y.toFixed(1));
      if (f >= 1) {
        d.i++;
        if (d.i === d.failAt) {
          d.dead = 0.001; d.c.setAttribute('class', 'dot fail');
          d.c.setAttribute('cx', (d.x + d.jx).toFixed(1)); d.c.setAttribute('cy', (d.y + d.jy * 0.5).toFixed(1));
          continue;
        }
        if (d.i >= d.route.length - 1) { d.c.remove(); dots.splice(k, 1); if (d.onDone) d.onDone(); continue; }
        if (d.i === d.turn && d.kind === 'req') { d.kind = 'res'; d.c.setAttribute('class', 'dot res'); }
        d.dwell = dwellFor(d.route[d.i], d.i <= d.turn);
        if (d.dwell > 0.1) { d.c.setAttribute('cx', (d.x + d.jx).toFixed(1)); d.c.setAttribute('cy', (d.y + d.jy).toFixed(1)); }
        d.t = 0; d.dur = segDur(d);
      }
    }
  }

  let last = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    const raw = last ? (ts - last) / 1000 : 0; last = ts;
    if (!(run.playing && S.tab === 'build')) return;
    try {
      let left = Math.min(0.25, raw);
      while (left > 1e-6) { const h = Math.min(0.05, left); step(h); moveDots(h); left -= h; }
      run.uiAcc += raw;
      if (run.uiAcc > 0.2) {
        run.uiAcc = 0;
        observe(run.mdl); renderHUD(); paintLive(); paintGoals(); paintInspectorLive(); setBanner();
      }
    } catch (err) {
      console.error(err);
      run.playing = false;
      if (!run.errored) { run.errored = true; log('The simulation hit an unexpected error and paused. Press Play to continue.', 'bad'); }
      paintControls();
    }
  }

  /* ---------------- Tabs + glue ---------------- */
  const TABS = ['lesson', 'build', 'quiz'];
  function renderTabs() {
    for (const t of TABS) {
      const b = $('tab-' + t);
      b.setAttribute('aria-selected', S.tab === t ? 'true' : 'false');
      b.tabIndex = S.tab === t ? 0 : -1;
      $('view-' + t).hidden = S.tab !== t;
    }
    const nd = S.done.filter(Boolean).length;
    const bm = $('buildMeta'); bm.textContent = nd + '/' + MISSIONS.length; bm.classList.toggle('done', nd === MISSIONS.length);
    const qa = quizScore(), qm = $('quizMeta');
    if (qa.answered < QUIZ.length) { qm.textContent = qa.answered + '/' + QUIZ.length; qm.title = 'Questions answered'; qm.classList.remove('done'); }
    else { const pass = qa.correct >= PASS; qm.textContent = (pass ? '✓ ' : '') + qa.correct + '/' + QUIZ.length; qm.title = `Score: ${qa.correct} correct${pass ? ', passed' : ''}`; qm.classList.toggle('done', pass); }
  }
  function setTab(t, focusTab) {
    if (!TABS.includes(t)) return;
    S.tab = t;
    if (t !== 'build' && run.playing) { run.playing = false; paintControls(); }
    renderTabs(); save();
    try { history.replaceState(null, '', '#' + t); } catch (e) { /* ignore */ }
    if (t === 'build') { renderCanvas(true); renderHUD(); }
    if (focusTab) $('tab-' + t).focus();
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('startBuild').onclick = () => setTab('build');
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    const idx = TABS.indexOf(S.tab);
    if (e.key === 'ArrowRight') { e.preventDefault(); setTab(TABS[(idx + 1) % 3], true); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setTab(TABS[(idx + 2) % 3], true); }
    if (e.key === 'Home') { e.preventDefault(); setTab('lesson', true); }
    if (e.key === 'End') { e.preventDefault(); setTab('quiz', true); }
  });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== S.tab) setTab(h); });

  function afterChange(forceFit) {
    if (connectFrom && !byId(connectFrom)) connectFrom = null;
    run.mdl = model();
    renderPalette(); renderCanvas(forceFit); renderInspector(); renderHUD(); renderMission(); renderTabs(); setBanner();
    save();
  }
  function afterDesignChange() {
    const i = S.mission;
    if (!S.done[i] && S.verified[i]) { S.verified[i] = false; log('Design changed. Run it again to check the targets.', ''); }
    run.hold = 0;
    afterChange(true);
  }

  /* ---------------- Lesson figures ---------------- */
  function figNode(svg, type, x, y, name, sub) {
    const w = 188, h = 60;
    const g = svgEl('g', { transform: `translate(${x - w / 2} ${y - h / 2})` }, svg);
    svgEl('rect', { x: 0, y: 0, width: w, height: h, rx: 11, class: 'node-box' }, g);
    drawIcon(type, g, 12, 18);
    const t = svgEl('text', { x: 52, y: 26, class: 'node-name' }, g); t.textContent = name;
    const s = svgEl('text', { x: 52, y: 43, class: 'node-sub' }, g); s.textContent = sub;
  }
  function figArrow(svg, x1, y1, x2, y2, label, step, lx, ly, anchor) {
    svgEl('line', { x1, y1, x2, y2, class: 'd-line', 'marker-end': 'url(#figArr)' }, svg);
    if (step) {
      svgEl('circle', { cx: lx - 13, cy: ly - 4, r: 9, class: 'd-step' }, svg);
      const s = svgEl('text', { x: lx - 13, y: ly, class: 'd-step-t', 'text-anchor': 'middle' }, svg); s.textContent = step;
    }
    const t = svgEl('text', { x: lx, y: ly, class: 'd-label', 'text-anchor': anchor || 'start' }, svg); t.textContent = label;
  }
  function figDefs(svg) {
    const defs = svgEl('defs', {}, svg);
    const mk = svgEl('marker', { id: 'figArr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    svgEl('path', { d: 'M0 0L10 5L0 10z', class: 'arrowhead' }, mk);
  }
  const drawFigures = () => level.drawFigures({ $, svgEl, figNode, figArrow, figDefs });

  /* ---------------- Quiz ---------------- */
  function quizScore() {
    let answered = 0, correct = 0;
    QUIZ.forEach((q, i) => { if (S.quiz[i] != null) { answered++; if (S.quiz[i] === q.a) correct++; } });
    return { answered, correct };
  }
  function renderQuiz() {
    const list = $('qList'); list.textContent = '';
    QUIZ.forEach((q, i) => {
      const card = el('div', 'q'); card.id = 'q' + i;
      const h = el('h2'); h.appendChild(el('span', null, String(i + 1).padStart(2, '0'))); h.appendChild(document.createTextNode(q.q));
      const opts = el('div', 'opts'); opts.setAttribute('role', 'group'); opts.setAttribute('aria-label', 'Answers to question ' + (i + 1));
      const ans = S.quiz[i];
      q.o.forEach((o, j) => {
        const b = el('button'); b.type = 'button';
        b.appendChild(el('span', 'k', 'ABCD'[j])); b.appendChild(el('span', null, o));
        if (ans != null) {
          b.disabled = true;
          if (j === q.a) b.classList.add('right');
          else if (j === ans) b.classList.add('wrong');
        } else {
          b.setAttribute('aria-pressed', qsel[i] === j ? 'true' : 'false');
          b.onclick = () => { qsel[i] = j; renderQuiz(); const nb = $('q' + i).querySelectorAll('.opts button')[j]; if (nb) nb.focus(); };
        }
        opts.appendChild(b);
      });
      card.append(h, opts);
      if (ans == null) {
        const row = el('div', 'qcheck');
        const cb = el('button', 'btn primary sm', 'Check answer'); cb.type = 'button';
        cb.disabled = qsel[i] == null;
        cb.onclick = () => { S.quiz[i] = qsel[i]; delete qsel[i]; save(); renderQuiz(); renderTabs(); const nc = $('q' + i).querySelector('.expl'); if (nc) nc.focus(); };
        row.appendChild(cb);
        row.appendChild(el('span', null, qsel[i] == null ? 'Choose an answer first.' : 'You can change your choice until you check it.'));
        card.appendChild(row);
      } else {
        const ex = el('div', 'expl'); ex.tabIndex = -1;
        const b = el('b', ans === q.a ? 'r' : 'w', ans === q.a ? 'Correct. ' : 'Not quite. ');
        ex.appendChild(b); ex.appendChild(document.createTextNode(q.e));
        ex.appendChild(el('span', 'ref', q.r));
        card.appendChild(ex);
      }
      list.appendChild(card);
    });
    const sc = quizScore();
    $('qScoreTxt').textContent = `${sc.answered} answered · ${sc.correct} correct`;
    $('qBar').style.width = (sc.answered / QUIZ.length * 100) + '%';
    const res = $('qResult'); res.textContent = '';
    if (sc.answered === QUIZ.length) {
      const pass = sc.correct >= PASS;
      const box = el('div', 'result');
      box.appendChild(el('h2', null, `${sc.correct} / ${QUIZ.length}${pass ? ': passed' : ''}`));
      box.appendChild(el('p', null, pass ? level.quiz.passText : level.quiz.failText(PASS)));
      const row = el('div', 'row');
      const retry = el('button', 'btn', 'Retake the quiz'); retry.type = 'button';
      retry.onclick = () => { S.quiz = {}; for (const k in qsel) delete qsel[k]; save(); renderQuiz(); renderTabs(); window.scrollTo({ top: 0 }); };
      const back = el('button', 'btn', 'Back to the lesson'); back.type = 'button';
      back.onclick = () => setTab('lesson');
      row.append(retry, back); box.appendChild(row); res.appendChild(box);
    }
  }

  /* ---------------- Boot ---------------- */
  function start(data) {
    try { load(data); } catch (e) { S = fresh(); }
    const h = (location.hash || '').slice(1);
    if (TABS.includes(h)) S.tab = h;
    drawFigures();
    run.mdl = model();
    renderPalette(); renderCanvas(true); renderInspector(); renderHUD(); renderMission(); renderQuiz(); renderTabs();
    log(S.done.every(Boolean) ? 'Welcome back. All missions done: replay any mission, or take the quiz.' : `Mission ${S.mission + 1}: ${MISSIONS[S.mission].title}.`);
    requestAnimationFrame(frame);
  }
  window.claude?.hot?.snapshot?.(() => ({ S }));
  window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
  window.__sdl = { get S() { return S; }, run, model, addNode, tryConnect, setTab, switchMission, togglePlay, step, afterChange, afterDesignChange };
})();
