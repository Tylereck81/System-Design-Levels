// Which missions were opened from the lesson, in Node, on Level 1 (a one-page lesson, save version 3): saved, kept,
// migrated from older saves, and the one rule that says whether a mission is open. saves.test.mjs covers a level
// whose lesson is not on one page.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel } from './harness.mjs';

// The game reads saves from localStorage, which Node does not have: an in-memory one stands in.
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
});

const { state } = await loadLevel(1);
const { S, fresh, load, save, replaceState, missionOpen, LS_KEY } = state;
const plain = (x) => JSON.parse(JSON.stringify(x));
const openNow = () => S.done.map((_, i) => missionOpen(i));

/** Saves `data` as the game's saved text, then starts the game from it. */
const startFrom = (data) => {
  store.set(LS_KEY, JSON.stringify(data));
  replaceState(fresh());
  load();
};

beforeEach(() => store.clear());

test('a new game has no mission open: each one opens from its card in the lesson', () => {
  replaceState(fresh());
  assert.deepEqual(S.opened, [false, false, false]);
  assert.deepEqual(openNow(), [false, false, false]);
});

test('opened missions are saved and load back, even one whose mission before it is not done', () => {
  replaceState(fresh());
  Object.assign(S, { opened: [true, false, true], done: [false, false, false] });
  save();
  replaceState(fresh());
  load();
  assert.deepEqual(S.opened, [true, false, true]);
  assert.deepEqual(openNow(), [true, false, true]); // the rule reads only what was opened
});

test('an older save without opened missions opens every mission the old rule opened', () => {
  const old = { ...plain(fresh()), v: 2, done: [true, true, false], verified: [true, true, false], mission: 2 };
  delete old.opened;
  startFrom(old);
  assert.deepEqual(S.opened, [true, true, true]); // Mission 1, and each mission whose previous one is done
  assert.equal(S.v, 3);
});

test('an older save with nothing done opens Mission 1 only; opened that is not a list is treated as missing', () => {
  startFrom({ ...plain(fresh()), v: 2, opened: undefined });
  assert.deepEqual(S.opened, [true, false, false]);
  startFrom({ ...plain(fresh()), done: [true, false, false], opened: 'yes' });
  assert.deepEqual(S.opened, [true, true, false]);
});

test('opened is a list of exactly one true or false per mission, and a finished mission is always opened', () => {
  startFrom({ ...plain(fresh()), opened: [1, 0, 'x', true] });
  assert.deepEqual(S.opened, [true, false, true]);
  startFrom({ ...plain(fresh()), done: [true, true, false], opened: [false, false, false] });
  assert.deepEqual(S.opened, [true, true, false]);
});
