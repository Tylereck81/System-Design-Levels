// Saved progress in Node, on Level 3 (save version 3, quiz version 1, database roles, component limits): a valid save
// loads back as it was, an old save is migrated, and a broken save never leaves the game in a bad state.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel } from './harness.mjs';

// The game reads saves from localStorage, which Node does not have: an in-memory one stands in.
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
});

const { state } = await loadLevel(3);
const { S, fresh, load, save, replaceState, validState, LS_KEY } = state;
const plain = (x) => JSON.parse(JSON.stringify(x));
/** Runs `fn` and returns the first argument of each console.warn it made. */
const warningsOf = (fn) => {
  const seen = [], kept = console.warn;
  console.warn = (msg) => seen.push(msg);
  try { fn(); } finally { console.warn = kept; }
  return seen;
};

/** Saves `data` as the game's saved text (a string is stored as is), then starts the game from it. */
const startFrom = (data) => {
  store.set(LS_KEY, typeof data === 'string' ? data : JSON.stringify(data));
  replaceState(fresh()); // the game starts with a fresh state and lets load() replace it
  load();
};

const replica = (id, x) => ({ id, type: 'db', x, y: 384, size: 'XL', kind: 'sql', role: 'replica' });

beforeEach(() => store.clear());

test('the save key is the level\'s own', () => {
  assert.equal(LS_KEY, 'sdl-level3-v1');
});

test('a valid save loads back as it was saved, with default settings filled in', () => {
  replaceState(fresh());
  const s = S;
  s.nodes.push(replica('r7', 640));
  s.edges.push({ id: 'e8', from: 'w1', to: 'r7' });
  Object.assign(s, { seq: 12, mission: 1, done: [true, false, false], opened: [true, true, false], verified: [true, true, false], est: true, estVal: '2000',
    exp: [{ 'crash-replica': true }, { 'crash-replica': true }, { 'crash-primary': false }], quiz: { 0: 1, 2: 0 }, tab: 'build' });
  const saved = plain(s);
  save();
  replaceState(fresh());
  load();
  const { nodes, ...rest } = plain(S);
  const { nodes: savedNodes, ...savedRest } = saved;
  assert.deepEqual(rest, savedRest);
  // Every saved field of every component comes back; settings it had none for get their defaults (Users' queue: fifo).
  assert.deepEqual(nodes.map((n) => n.id), savedNodes.map((n) => n.id));
  savedNodes.forEach((n, i) => assert.deepEqual({ ...nodes[i], ...n }, nodes[i]));
  assert.equal(nodes[0].queues, 'fifo');
});

test('loading or resetting keeps the same state object, so every module holding it sees the change', () => {
  const before = state.S;
  startFrom({ ...plain(fresh()), mission: 2 });
  assert.equal(state.S, before);
  assert.equal(S.mission, 2);
  replaceState(fresh());
  assert.equal(state.S, before);
  assert.equal(S.mission, 0);
});

test('a save from before per-mission results is migrated to version 3', () => {
  const old = { ...plain(fresh()), v: 1, mission: 1, done: [true, false, false], verified: [true, false, false],
    exp: { 'crash-replica': true, 'crash-primary': true }, quiz: { 0: 1 } };
  delete old.qv;
  delete old.opened;
  startFrom(old);
  // Mission 1 is finished: its goals stay passed. Mission 2 was open: it keeps the old result. Mission 3 was not open.
  assert.deepEqual(S.exp, [{ 'crash-replica': true }, { 'crash-replica': true }, { 'crash-primary': false }]);
  assert.deepEqual(S.done, [true, false, false]);
  // Version 1 had the same quiz as quiz version 1, so the answers stay.
  assert.deepEqual(S.quiz, { 0: 1 });
  assert.equal(S.v, 3);
  assert.equal(S.qv, 1);
  // Version 3 records which missions were opened from the lesson: Mission 1, and Mission 2 because Mission 1 is done.
  assert.deepEqual(S.opened, [true, true, false]);
});

test('quiz answers from another quiz version are dropped; the rest of the save stays', () => {
  startFrom({ ...plain(fresh()), mission: 2, qv: 0, quiz: { 0: 1 } });
  assert.deepEqual(S.quiz, {});
  assert.equal(S.mission, 2);
});

const users = { id: 'u', type: 'users', x: 250, y: 60 };
const broken = {
  'text that is not JSON': 'not json',
  'null': 'null',
  'nodes that are not a list': { nodes: 'oops', edges: [], mission: 0 },
  'no edges list': { nodes: [users], mission: 0 },
  'no Users': { nodes: [{ id: 'w', type: 'web', x: 1, y: 1, size: 'S' }], edges: [], mission: 0 },
  'an unknown component': { nodes: [users, { id: 'q', type: 'mainframe', x: 1, y: 1 }], edges: [], mission: 0 },
  'a position that is not a number': { nodes: [{ ...users, x: 'left' }], edges: [], mission: 0 },
  'an unknown size': { nodes: [users, { id: 'w', type: 'web', x: 1, y: 1, size: 'XXL' }], edges: [], mission: 0 },
  'a node id that is not text': { nodes: [{ ...users, id: 7 }], edges: [], mission: 0 },
  'a connection to a missing component': { nodes: [users], edges: [{ id: 'e1', from: 'u', to: 'zz' }], mission: 0 },
  'mission 4 of 3': { nodes: [users], edges: [], mission: 3 },
  'mission −1': { nodes: [users], edges: [], mission: -1 },
  'mission 1.5': { nodes: [users], edges: [], mission: 1.5 },
  'mission as text': { nodes: [users], edges: [], mission: '1' },
};
for (const [what, data] of Object.entries(broken)) {
  test(`a save with ${what} is ignored: the game starts fresh`, () => {
    const expected = { 'text that is not JSON': ['Saved progress is not valid JSON; starting fresh.'], null: [] }[what]
      ?? ['Saved progress does not fit this level; starting fresh.'];
    assert.deepEqual(warningsOf(() => startFrom(data)), expected); // a discarded save leaves a trace in the console
    assert.deepEqual(plain(S), plain(fresh()));
    assert.ok(validState(S));
  });
}

test('with no save, or no storage at all, the game starts fresh', () => {
  assert.deepEqual(warningsOf(() => startFrom('')), []);
  assert.deepEqual(plain(S), plain(fresh()));
  const kept = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    replaceState(fresh());
    load();
    assert.deepEqual(plain(S), plain(fresh()));
  } finally {
    Object.defineProperty(globalThis, 'localStorage', kept);
  }
});

test('a loadable save with bad fields is repaired into a valid state', () => {
  const start = plain(fresh());
  const nodes = [...start.nodes, replica('r10', 640), replica('r11', 250), replica('r12', 510), replica('r13', 700)];
  nodes.find((n) => n.id === 'r10').role = 'primary'; // a second primary
  nodes.find((n) => n.id === 'r11').role = 'boss'; // a role the level does not have
  startFrom({ ...start, nodes, edges: [...start.edges, { id: 'e20', from: 'w1', to: 'r13' }],
    done: 'yes', verified: [1, 0, 0, 1], est: 'maybe', estVal: 42, quiz: { 0: 99, 1: 1, 50: 0, x: 1, 2: -1 }, tab: 'admin', seq: 'x' });
  const s = S;
  // The level allows 4 databases: the 5th (r13) and its connection are dropped.
  assert.deepEqual(s.nodes.filter((n) => n.type === 'db').map((n) => n.id), ['b', 'r10', 'r11', 'r12']);
  assert.equal(s.edges.some((e) => e.to === 'r13'), false);
  // One primary (the first one); the unknown role loads as a replica.
  assert.deepEqual(s.nodes.filter((n) => n.type === 'db').map((n) => n.role), ['primary', 'replica', 'replica', 'replica']);
  // Not lists → no mission done; extra entries are cut to the 3 missions.
  assert.deepEqual(s.done, [false, false, false]);
  assert.deepEqual(s.verified, [true, false, false]);
  assert.equal(s.est, true);
  assert.equal(s.estVal, '');
  // Only answer 1 to question 1 is a real option of a real question.
  assert.deepEqual(s.quiz, { 1: 1 });
  assert.equal(s.tab, 'lesson');
  // The next id is above the highest one in use (r12, s9, e…): 13.
  assert.equal(s.seq, 13);
  assert.ok(validState(s));
});

test('when storage is full, saving warns once and the game goes on', () => {
  const kept = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } } });
  try {
    replaceState(fresh());
    assert.deepEqual(warningsOf(() => { save(); save(); }), ['Progress could not be saved: browser storage is unavailable or full.']);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', kept);
  }
});
