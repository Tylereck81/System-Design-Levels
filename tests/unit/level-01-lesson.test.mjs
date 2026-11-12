// Level 1's lesson writes some game numbers as words ("nine times", "triple", "a million users"); these checks fail
// when the missions stop matching those words. The first debrief's "can carry 100" and "one request in three" are
// checked against the simulation in tests/integration/level-01.test.mjs. Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import level from '../../levels/level-01.js';
import { lessonWarnings } from '../../js/validate-lesson.js';
import { SIZES, COMPONENTS, sizesOf } from '../../js/engine/catalog.js';

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

test('"Traffic has tripled" opens Part 2', () => {
  assert.equal(second.qps, 3 * first.qps);
  assert.match(parts[1].lead, /^Traffic has tripled\./);
});

test('"You need three parts": Part 1 has three New part cards, and Part 2 adds the database before its own section', () => {
  assert.match(parts[0].lead, /You need three parts\.$/);
  assert.deepEqual(parts[0].newParts.map((c) => c.type), ['users', 'dns', 'web']);
  assert.deepEqual(parts[1].newParts.map((c) => [c.type, parts[1].sections[c.before].title]), [['db', 'Why give the database its own machine?']]);
});

test('"Four sizes", and "the same four sizes" for the database', () => {
  assert.equal(Object.keys(SIZES).length, 4);
  assert.deepEqual(sizesOf('web'), SIZES);
  assert.deepEqual(sizesOf('db'), SIZES);
  assert.match(parts[0].newParts[2].game, /^Four sizes\./);
  assert.match(parts[1].newParts[0].game, /in the same four sizes\.$/);
});

test('the database example is a blog with its own numbers, and never says which type fits the shop', () => {
  const section = parts[1].sections.find((s) => s.title === 'Which kind of database?');
  const text = JSON.stringify(section);
  // "three linked pieces" is the catalog's lookups for linked data in a NoSQL store.
  assert.equal(COMPONENTS.db.kinds.nosql.per, 3);
  assert.match(text, /three linked pieces/);
  // 120 pages a second: 120 × 1 = 120 fits the smallest server's 200; 120 × 3 = 360 does not. Mission 2 runs at 150.
  assert.match(text, /A blog showing 120 post pages a second/);
  assert.match(text, /120 queries\/s/);
  assert.match(text, /360 lookups\/s/);
  assert.ok(120 <= SIZES.S.cap && 360 > SIZES.S.cap);
  assert.notEqual(second.qps, 120);
  assert.doesNotMatch(text, /shop|order/i, 'the section does not use Mission 2\'s data');
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
