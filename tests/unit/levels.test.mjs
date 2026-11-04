// The level data contract, checked in Node without a browser: every level file loads, passes validateLevel, has a
// unique save key, and has a fair quiz. Run with `npm run test:unit` (part of `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, MOCK } from '../../levels/index.js';
import { validateLevel } from '../../js/level.js';

const QUESTIONS = 10;
const OPTIONS = 4;
const PASS_SCORE = 8;
const MAX_SAME_LETTER = 3; // no answer letter (A–D) is right more than 3 times
// How often the right answer may be the longest option, so length gives nothing away. Levels 1–4 were written when
// up to 3 were allowed; every later level has none, and keeps none.
const longestRightAllowed = (id) => (id <= 4 ? 3 : 0);

const levels = await Promise.all(LEVELS.map(async (entry) => ({ entry, data: (await entry.load()).default })));
const mock = (await MOCK.load()).default;

/** Index of the longest option; the first one wins a tie. */
const longestIndex = (options) => options.reduce((best, o, i) => (o.length > options[best].length ? i : best), 0);
const isPositiveInteger = (v) => Number.isInteger(v) && v > 0;

for (const { entry, data } of levels) {
  test(`Level ${entry.id}: data passes validateLevel and has its save versions`, () => {
    assert.deepEqual(validateLevel(data), []);
    assert.equal(data.saveKey, `sdl-level${entry.id}-v1`);
    assert.ok(isPositiveInteger(data.saveVersion), 'saveVersion is a positive integer');
    // quizVersion is optional: without it the quiz shares saveVersion (js/state.js).
    if (data.quizVersion !== undefined) assert.ok(isPositiveInteger(data.quizVersion), 'quizVersion is a positive integer');
  });

  test(`Level ${entry.id}: quiz is complete, balanced and not guessable by length`, () => {
    const { questions, passScore } = data.quiz;
    assert.equal(questions.length, QUESTIONS);
    assert.equal(passScore, PASS_SCORE);
    const timesRight = [0, 0, 0, 0];
    let longestIsRight = 0;
    questions.forEach((q, i) => {
      const where = `question ${i + 1}`;
      for (const field of ['q', 'e', 'r']) assert.ok(typeof q[field] === 'string' && q[field].trim(), `${where}: ${field} is text`);
      assert.equal(q.o.length, OPTIONS, `${where}: ${OPTIONS} options`);
      assert.ok(q.o.every((o) => typeof o === 'string' && o.trim()), `${where}: every option is text`);
      assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < OPTIONS, `${where}: the answer is one of the options`);
      timesRight[q.a]++;
      if (longestIndex(q.o) === q.a) longestIsRight++;
    });
    assert.ok(Math.max(...timesRight) <= MAX_SAME_LETTER, `answer letters A–D are right ${timesRight.join(', ')} times`);
    assert.ok(longestIsRight <= longestRightAllowed(entry.id), `the right answer is the longest option ${longestIsRight} times`);
  });
}

test('no two levels have the same answer key', () => {
  const byKey = new Map();
  for (const { entry, data } of levels) {
    const key = data.quiz.questions.map((q) => q.a).join('');
    assert.ok(!byKey.has(key), `Level ${entry.id} has the same answer key as Level ${byKey.get(key)}`);
    byKey.set(key, entry.id);
  }
});

test('save keys are unique', () => {
  const keys = levels.map(({ data }) => data.saveKey).concat(mock.saveKey);
  assert.equal(new Set(keys).size, keys.length);
});

test('the mock interview passes validateLevel', () => {
  assert.deepEqual(validateLevel(mock), []);
  assert.match(mock.saveKey, /^sdl-mock-\d+-v1$/);
});
