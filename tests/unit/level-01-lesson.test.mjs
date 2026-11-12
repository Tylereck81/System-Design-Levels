// Level 1's lesson writes some game numbers as words ("nine times", "triple", "one request in three", "a million
// users"); these checks fail when the missions stop matching those words. Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import level from '../../levels/level-01.js';
import { lessonWarnings } from '../../js/validate-lesson.js';
import { SIZES, COMPONENTS } from '../../js/engine/catalog.js';

const { intro, chapters } = level.lesson;
const [first, second, third] = level.missions;

test('"grows nine times": Mission 3 has about nine times the traffic of Mission 1', () => {
  assert.equal(Math.round(third.qps / first.qps), 9); // 463 ÷ 50 = 9.26
  assert.match(intro.story, /grows nine times/);
});

test('"triple" and "one request in three": Mission 2 has three times Mission 1\'s traffic, a third more than one machine carries', () => {
  assert.equal(second.qps, 3 * first.qps);
  // One S server running code and data carries 200 × 50% = 100 req/s; 1 − 100 ÷ 150 = 1/3 fails.
  const carries = SIZES.S.cap * COMPONENTS.web.alone.capFactor;
  assert.ok(Math.abs(1 - carries / second.qps - 1 / 3) < 1e-12);
  assert.match(chapters[0].debrief.next, /^Traffic is about to triple to 150 req\/s\. This machine can carry 100\. One request in three would fail\.$/);
});

test('"a million users": Mission 3 is built on 1,000,000 daily users', () => {
  assert.match(third.story, /1,000,000 daily active users/);
  assert.match(chapters[1].debrief.next, /a million users/);
  assert.match(chapters[2].screens[0].title, /a million users/);
});

test('Debrief 1\'s number is Mission 1\'s response time: about 100 ms at 50 req/s', () => {
  // (20 + 10) ms × 1 ÷ (1 − 50 ÷ 100) = 60 ms, plus the 40 ms internet round trip.
  assert.deepEqual(chapters[0].debrief.number, ['about 100 ms', 'response time at 50 req/s']);
});

test('Mission 2\'s hint says "takes 4× as long"', () => {
  assert.match(second.hint, /take 4× as long/);
  assert.doesNotMatch(second.hint, /longer/);
});

test('numbers of a million or more are written with the word ("40 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
