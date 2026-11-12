// js/progress.js: a level's state on the home page, read from its saved text, and where Continue goes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressOf, nextStep } from '../../js/progress.js';

const save = (done) => JSON.stringify({ nodes: [], edges: [], mission: 0, done });
const NEW = { state: 'new', done: 0, total: 0 };

test('no save, or one the level would not load, is not started', () => {
  assert.deepEqual(progressOf(null), NEW);
  assert.deepEqual(progressOf(''), NEW);
  assert.deepEqual(progressOf('{not json'), NEW);
  assert.deepEqual(progressOf('null'), NEW);
  assert.deepEqual(progressOf('[1,2]'), NEW);
  assert.deepEqual(progressOf(JSON.stringify({ done: [true] })), NEW); // no nodes: the level starts fresh
  assert.deepEqual(progressOf(JSON.stringify({ nodes: [], done: 'yes' })), NEW);
  assert.deepEqual(progressOf(save([])), NEW);
});

test('a save with some missions done is in progress, with the count', () => {
  assert.deepEqual(progressOf(save([false, false, false])), { state: 'started', done: 0, total: 3 });
  assert.deepEqual(progressOf(save([true, false, false])), { state: 'started', done: 1, total: 3 });
  assert.deepEqual(progressOf(save([true, true])), { state: 'done', done: 2, total: 2 });
});

const levels = [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }, { id: 3, title: 'Three' }];
const done = { state: 'done', done: 3, total: 3 }, started = { state: 'started', done: 1, total: 3 };

test('Continue goes to the first level not done: its lesson if not started, else its Build tab', () => {
  assert.deepEqual(nextStep(levels, [NEW, NEW, NEW]), { href: '#lesson', label: 'Level 1 · One' });
  assert.deepEqual(nextStep(levels, [started, NEW, NEW]), { href: '#build', label: 'Level 1 · One' });
  assert.deepEqual(nextStep(levels, [done, NEW, started]), { href: '#level-2/lesson', label: 'Level 2 · Two' });
  assert.deepEqual(nextStep(levels, [done, done, started]), { href: '#level-3/build', label: 'Level 3 · Three' });
});

test('with every level done, Continue goes to the mock interview', () => {
  assert.deepEqual(nextStep(levels, [done, done, done]), { href: '#mock/lesson', label: 'Mock interview' });
});
