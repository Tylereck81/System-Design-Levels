// Level 3's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIZES, T } from '../../js/engine/catalog.js';
import level from '../../levels/level-03.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const busy = 0.7; // the "every database under 70% busy" goal
const busyGoal = level.missions[0].goals.find((g) => g.id === 'dbbusy');

test('the busy limit the lesson names is the one the goal checks', () => {
  assert.equal(busyGoal.text, 'Every database under 70% busy');
  assert.ok(level.missions.every((m) => m.goals.includes(busyGoal)));
  assert.match(first.youWill[1], /under 70% busy/);
});

test('"the largest size you can rent": the level starts on the biggest database size', () => {
  const sizes = Object.keys(SIZES);
  assert.equal(level.startNodes.find((n) => n.type === 'db').size, sizes[sizes.length - 1]);
  assert.match(level.lesson.intro.story, /largest size you can rent/);
});

test('"just fits an L server": the sizing example is under the limit on L and over it on M', () => {
  // 900 reads/s ÷ 2 replicas = 450, + 100 writes/s = 550 queries/s. 550 ÷ 800 (L) = 69%; 550 ÷ 400 (M) = 138%.
  const calc = first.sections[2].body.find((b) => b.calc).calc;
  assert.match(calc.result, /^Each replica handles 550 queries a second, which just fits an L server\.$/);
  assert.ok(550 / SIZES.L.cap < busy);
  assert.ok(550 / SIZES.M.cap > busy);
});

test('"9 requests in 10 are reads" and "1 request in 5 will be a write" match the missions', () => {
  assert.equal(level.missions[0].writes, 0.1);
  assert.equal(level.missions[1].writes, 0.2);
  assert.match(first.sections[0].body[1].p, /9 requests in 10 are reads/);
  assert.match(first.debrief.next, /1 request in 5 will be a write/);
});

test('the estimate example: 6 million users × 18 requests is 625 writes a second at peak', () => {
  // 6,000,000 × 18 = 108,000,000 a day ÷ 86,400 s = 1,250 req/s; × 2 = 2,500 req/s at peak; ÷ 4 = 625 writes/s.
  const calc = second.sections[0].body.find((b) => b.calc).calc;
  assert.deepEqual(calc.rows.map((r) => r.result), ['108 million requests', '1,250 req/s', '2,500 req/s', '625 writes/s']);
  assert.equal(calc.result, 'Plan for about 625 writes and 1,875 reads a second.');
});

test('"no replica ever drops below 600": each row is reads shared out plus every write', () => {
  // 1,200 ÷ 2 + 600 = 1,200; 1,200 ÷ 3 + 600 = 1,000; 1,200 ÷ 6 + 600 = 800.
  const rows = second.sections[1].body.find((b) => b.table).table.rows;
  assert.deepEqual(rows, [['2', '600', '600', '1,200 queries/s'], ['3', '400', '600', '1,000 queries/s'], ['6', '200', '600', '800 queries/s']]);
});

test('Mission 2\'s debrief: 2,000 req/s with 1 in 5 writes is 400 writes a second', () => {
  assert.equal(second.debrief.number[0], '400 writes/s');
});

test('"within about a second" and "the lag is 1 second": the game\'s replicas run 1 second behind', () => {
  assert.equal(T.lag, 1);
  assert.match(third.sections[1].body[1].p, /the lag is 1 second\./);
  assert.match(third.sections[2].body[0].p, /within about a second/);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word ("6 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
