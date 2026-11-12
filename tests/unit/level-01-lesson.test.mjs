// Level 1's lesson writes some game numbers as words ("nine times", "triple", "a million users"); these checks fail
// when the missions stop matching those words. The first debrief's "can carry 100" and "one request in three" are
// checked against the simulation in tests/integration/level-01.test.mjs. Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import level from '../../levels/level-01.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const { intro, parts } = level.lesson;
const [first, second, third] = level.missions;

test('"grows nine times": Mission 3 has about nine times the traffic of Mission 1', () => {
  assert.equal(Math.round(third.qps / first.qps), 9); // 463 ÷ 50 = 9.26
  assert.match(intro.story, /grows nine times/);
});

test('"triple": Mission 2 has three times the traffic of Mission 1', () => {
  assert.equal(second.qps, 3 * first.qps);
  assert.match(parts[0].debrief.next, /^Traffic is about to triple to 150 req\/s\./);
});

test('"a million users": Mission 3 is built on 1,000,000 daily users', () => {
  assert.match(third.story, /1,000,000 daily active users/);
  assert.match(parts[1].debrief.next, /a million users/);
  assert.match(parts[2].sections[0].title, /a million users/);
});

test('Mission 2\'s hint says "takes 4× as long"', () => {
  assert.match(second.hint, /take 4× as long/);
  assert.doesNotMatch(second.hint, /longer/);
});

test('numbers of a million or more are written with the word ("40 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
