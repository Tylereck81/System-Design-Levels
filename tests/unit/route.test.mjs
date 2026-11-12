// js/route.js: every address form the game reads, and the address it writes for each level and tab.
// Level 1 uses the short form (#build), other levels #level-N/tab, the mock interview #mock/tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeHash } from '../../js/route.js';

test('Level 1 short form: the hash is the tab', () => {
  assert.deepEqual(parseRoute('#lesson'), { level: 1, tab: 'lesson' });
  assert.deepEqual(parseRoute('#build'), { level: 1, tab: 'build' });
  assert.deepEqual(parseRoute('#quiz'), { level: 1, tab: 'quiz' });
});

test('no hash means the home page', () => {
  assert.deepEqual(parseRoute(''), { level: 'home', tab: null });
  assert.deepEqual(parseRoute('#'), { level: 'home', tab: null });
  assert.deepEqual(parseRoute('#/'), { level: 'home', tab: null });
  assert.deepEqual(parseRoute(undefined), { level: 'home', tab: null });
});

test('an unknown short address still means Level 1', () => {
  assert.deepEqual(parseRoute('#xyz'), { level: 1, tab: 'xyz' });
});

test('#level-N/tab, with or without a tab', () => {
  assert.deepEqual(parseRoute('#level-2/build'), { level: 2, tab: 'build' });
  assert.deepEqual(parseRoute('#level-21/quiz'), { level: 21, tab: 'quiz' });
  assert.deepEqual(parseRoute('#level-2'), { level: 2, tab: null });
  assert.deepEqual(parseRoute('#level-2/'), { level: 2, tab: null });
  assert.deepEqual(parseRoute('level-3/lesson'), { level: 3, tab: 'lesson' }); // the leading # is optional
});

test('#mock/tab, with or without a tab', () => {
  assert.deepEqual(parseRoute('#mock/build'), { level: 'mock', tab: 'build' });
  assert.deepEqual(parseRoute('#mock'), { level: 'mock', tab: null });
  assert.deepEqual(parseRoute('#mock/'), { level: 'mock', tab: null });
});

test('upper case and trailing slashes are ignored', () => {
  assert.deepEqual(parseRoute('#LEVEL-2/Build'), { level: 2, tab: 'build' });
  assert.deepEqual(parseRoute('#Level-4/QUIZ//'), { level: 4, tab: 'quiz' });
  assert.deepEqual(parseRoute('#MOCK/Lesson/'), { level: 'mock', tab: 'lesson' });
  assert.deepEqual(parseRoute('#BUILD/'), { level: 1, tab: 'build' });
});

test('percent-escapes are decoded before matching', () => {
  assert.deepEqual(parseRoute('#level%2D5%2Fbuild'), { level: 5, tab: 'build' }); // %2D = "-", %2F = "/"
});

test('an unknown level number is passed on as is: the caller falls back to Level 1', () => {
  assert.deepEqual(parseRoute('#level-99/build'), { level: 99, tab: 'build' });
  assert.deepEqual(parseRoute('#level-0'), { level: 0, tab: null });
});

test('junk is read as a Level 1 tab, which the caller replaces with a real one', () => {
  assert.deepEqual(parseRoute('#level-x/build'), { level: 1, tab: 'level-x/build' });
  assert.deepEqual(parseRoute('#level-2/build/extra'), { level: 1, tab: 'level-2/build/extra' });
  assert.deepEqual(parseRoute('#level-2/tab2'), { level: 1, tab: 'level-2/tab2' }); // tabs are letters only
  assert.deepEqual(parseRoute('#mockery'), { level: 1, tab: 'mockery' });
  assert.deepEqual(parseRoute('#xyz'), { level: 1, tab: 'xyz' });
});

test('routeHash writes each level\'s own form', () => {
  assert.equal(routeHash(1, 'build'), '#build');
  assert.equal(routeHash(7, 'lesson'), '#level-7/lesson');
  assert.equal(routeHash('mock', 'quiz'), '#mock/quiz');
});

test('parseRoute reads back every address routeHash writes', () => {
  for (const level of [1, 2, 21, 'mock']) {
    for (const tab of ['lesson', 'build', 'quiz']) assert.deepEqual(parseRoute(routeHash(level, tab)), { level, tab });
  }
});
