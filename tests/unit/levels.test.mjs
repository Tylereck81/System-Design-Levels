// The level data contract, checked in Node without a browser: every level file loads, passes validateLevel, has a
// unique save key, and has a fair quiz; every mock interview is valid. Run with `npm run test:unit` (part of `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, MOCK_LEVELS } from '../../levels/index.js';
import { validateLevel } from '../../js/level.js';

const QUESTIONS = 10;
const OPTIONS = 4;
const PASS_SCORE = 8;
const MAX_SAME_LETTER = 3; // no answer letter (A–D) is right more than 3 times
// The right answer must not be the longest option, so length gives nothing away. The first three levels' quizzes are
// older and still have a few; their counts may only go down. A tie for longest is not counted.
const LONGEST_RIGHT_ALLOWED = { 1: 3, 2: 2, 3: 1 };

/** Import a module; an error is returned instead of thrown, so it fails one test, by name, and the others still run. */
const attempt = async (load) => { try { return { value: await load() }; } catch (error) { return { error }; } };

const levels = await Promise.all(LEVELS.map(async (entry) => {
  const { value, error } = await attempt(entry.load);
  return { entry, data: value?.default, error };
}));
const loaded = levels.filter((l) => l.data);
// levels/mock.js imports one real level when it loads, so it can fail with it.
const mockModule = await attempt(() => import('../../levels/mock.js'));

/** Index of the longest option; the first one wins a tie. */
const longestIndex = (options) => options.reduce((best, o, i) => (o.length > options[best].length ? i : best), 0);
const isPositiveInteger = (v) => Number.isInteger(v) && v > 0;

for (const { entry, data, error } of levels) {
  test(`Level ${entry.id}: loads, passes validateLevel and has its save versions`, () => {
    assert.ifError(error);
    assert.deepEqual(validateLevel(data), []);
    assert.equal(data.saveKey, `sdl-level${entry.id}-v1`);
    assert.ok(isPositiveInteger(data.saveVersion), 'saveVersion is a positive integer');
    // quizVersion is optional: without it the quiz shares saveVersion (js/state.js).
    if (data.quizVersion !== undefined) assert.ok(isPositiveInteger(data.quizVersion), 'quizVersion is a positive integer');
  });

  test(`Level ${entry.id}: quiz is complete, balanced and not guessable by length`, { skip: !!error }, () => {
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
    const allowed = LONGEST_RIGHT_ALLOWED[entry.id] ?? 0;
    assert.ok(longestIsRight <= allowed, `the right answer is the longest option ${longestIsRight} times (at most ${allowed})`);
  });
}

test('no two levels have the same answer key', () => {
  const byKey = new Map();
  for (const { entry, data } of loaded) {
    const key = data.quiz.questions.map((q) => q.a).join('');
    assert.ok(!byKey.has(key), `Level ${entry.id} has the same answer key as Level ${byKey.get(key)}`);
    byKey.set(key, entry.id);
  }
});

// A mock interview is built from one real level; the game picks which at random, so each is built here.
const mocks = mockModule.value
  ? loaded.filter(({ entry }) => MOCK_LEVELS.includes(entry.id)).map(({ entry, data }) => ({ id: entry.id, data: mockModule.value.mockOf(data, entry.id) }))
  : [];

test('every mock interview problem has a level and passes validateLevel', () => {
  assert.ifError(mockModule.error);
  assert.deepEqual(mocks.map((m) => m.id), MOCK_LEVELS);
  for (const { id, data } of mocks) {
    assert.deepEqual(validateLevel(data), [], `mock interview from Level ${id}`);
    assert.equal(data.saveKey, `sdl-mock-${id}-v1`);
  }
});

test('save keys are unique', () => {
  const keys = loaded.map(({ data }) => data.saveKey).concat(mocks.map(({ data }) => data.saveKey));
  assert.equal(new Set(keys).size, keys.length);
});
