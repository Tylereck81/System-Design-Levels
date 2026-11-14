// Which missions are open, in Node, on Level 6, whose lesson is not on one page yet: nothing about opened missions
// is saved, and a mission opens when the one before it is done. Move it to the next such level when Level 6's
// lesson moves to one page. saves-opened.test.mjs covers a one-page lesson.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLevel } from './harness.mjs';

// The game reads saves from localStorage, which Node does not have: an in-memory one stands in.
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
});

const { level, state } = await loadLevel(6);
const { S, fresh, load, replaceState, missionOpen, LS_KEY } = state;

test('without a one-page lesson nothing about opened missions is saved: a mission opens when the one before it is done', () => {
  assert.equal('lesson' in level, false);
  assert.equal('opened' in fresh(), false);
  store.set(LS_KEY, JSON.stringify({ ...JSON.parse(JSON.stringify(fresh())), done: [true, false, false], opened: [false, false, false] }));
  replaceState(fresh());
  load();
  assert.equal('opened' in S, false);
  assert.deepEqual([0, 1, 2].map((i) => missionOpen(i)), [true, true, false]);
});
