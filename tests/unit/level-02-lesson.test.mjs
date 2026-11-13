// Level 2's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import level from '../../levels/level-02.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second] = level.lesson.parts;

test('"more than double": Mission 2\'s traffic is more than twice Mission 1\'s', () => {
  assert.ok(level.missions[1].qps > 2 * level.missions[0].qps);
  assert.match(first.debrief.next, /more than double/);
});

test('"Run 4" in the N + 1 example: the pool is one more than the peak needs, and the rest still carry the peak', () => {
  // 900 req/s ÷ 400 req/s per M server = 2.25, rounded up to 3; plus the spare = 4. After a crash: 3 × 400 = 1,200 req/s.
  const calc = first.sections[1].body.find((b) => b.calc).calc;
  assert.match(calc.result, /^Run 4\. When one crashes, the 3 left carry 1,200 req\/s, more than the peak\.$/);
});

test('"bought four ways": one row per server size, each with the same total capacity', () => {
  // 1,600 req/s = 1 × XL (1,600) = 2 × L (800) = 4 × M (400) = 8 × S (200).
  const rows = second.sections[1].body.find((b) => b.table).table.rows;
  assert.deepEqual(rows.map((r) => r[0]), ['1 × XL', '2 × L', '4 × M', '8 × S']);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word ("8 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
