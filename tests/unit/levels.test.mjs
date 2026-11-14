// The level data contract, checked in Node without a browser: every level file loads, passes validateLevel (and
// validateLesson when its lesson is written as data), has a unique save key, and has a fair quiz; every mock interview is valid. Run with `npm run test:unit` (part of `npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, MOCK_LEVELS, PARTS, TOTAL_LEVELS, saveKeyOf } from '../../levels/index.js';
import { validateLevel, lessonMinutes } from '../../js/level.js';
import { validateLesson, lessonWarnings, newPartProblems } from '../../js/validate-lesson.js';

const QUESTIONS = 10;
const OPTIONS = 4;
const PASS_SCORE = 8;
const MAX_SAME_LETTER = 3; // no answer letter (A–D) is right more than 3 times
// The right answer must not be the longest option, so length gives nothing away. When options tie for longest, the
// first of them counts as the longest. The quizzes of Levels 2 and 3 are older and still have a few: these are their
// exact counts, so fixing one of those quizzes means lowering its number here, and it can never go back up.
const LONGEST_RIGHT_EXACT = { 2: 2, 3: 1 };

/** Import a module; an error is returned instead of thrown, so it fails one test, by name, and the others still run. */
const attempt = async (load) => { try { return { value: await load() }; } catch (error) { return { error }; } };

const levels = await Promise.all(LEVELS.map(async (entry) => {
  const { value, error } = await attempt(entry.load);
  return { entry, data: value?.default, error };
}));
const loaded = levels.filter((l) => l.data);
// The checks across levels skip a level whose quiz is missing: its own quiz test already fails, by name.
const withQuiz = loaded.filter(({ data }) => Array.isArray(data.quiz?.questions));
// levels/mock.js imports one real level when it loads, so it can fail with it.
const mockModule = await attempt(() => import('../../levels/mock.js'));

/** Index of the longest option; the first one wins a tie. */
const longestIndex = (options) => options.reduce((best, o, i) => (o.length > options[best].length ? i : best), 0);
const isPositiveInteger = (v) => Number.isInteger(v) && v > 0;

for (const { entry, data, error } of levels) {
  test(`Level ${entry.id}: loads, passes validateLevel and has its save versions`, (t) => {
    assert.ifError(error);
    assert.deepEqual(validateLevel(data), []);
    if (data.lesson) {
      assert.deepEqual(validateLesson(data), [], 'the lesson passes validateLesson');
      for (const warning of lessonWarnings(data)) t.diagnostic(`lesson warning: ${warning}`); // advice; it never fails a level
    }
    assert.equal(data.saveKey, `sdl-level${entry.id}-v1`);
    assert.equal(saveKeyOf(entry.id), data.saveKey, 'the home page reads progress under the level\'s own key');
    assert.ok(typeof entry.line === 'string' && entry.line.length > 0 && entry.line.length <= 80, 'a one-line description of at most 80 characters');
    // The home page shows minutes only for a one-page lesson, where they are the lesson's time: "Start here" and its parts.
    const minutes = data.lesson?.parts ? lessonMinutes(data.lesson) : undefined;
    assert.equal(entry.minutes, minutes, 'the index\'s minutes match the lesson (or both are absent)');
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
    const legacy = LONGEST_RIGHT_EXACT[entry.id];
    if (legacy === undefined) assert.equal(longestIsRight, 0, `the right answer is the longest option ${longestIsRight} times`);
    else assert.equal(longestIsRight, legacy, `the right answer is the longest option ${longestIsRight} times: set LONGEST_RIGHT_EXACT[${entry.id}] to it only if it went down`);
  });
}

test('every component has a New part card in the first level that has it (levels not yet on one page are skipped)', () => {
  assert.equal(loaded.length, LEVELS.length, 'every level loaded, so "first level" is right');
  assert.deepEqual(newPartProblems(loaded.map(({ data }) => data)), []);
});

test('every HTML lesson shows the four interview steps once, with the minutes of a 45-minute interview', () => {
  // Written out by hand: 5–8 + 10–12 + 15–20 + 5 minutes is 35–45, which fits in 45.
  const headers = ['Step 1 · 5–8 min</span><b>Scope it</b>', 'Step 2 · 10–12 min</span><b>Sketch it</b>',
    'Step 3 · 15–20 min</span><b>Go deep</b>', 'Step 4 · 5 min</span><b>Stress it</b>'];
  for (const { entry, data } of loaded.filter(({ data }) => data.lessonHtml !== undefined)) {
    assert.equal(data.lessonHtml.split('class="steps4"').length - 1, 1, `Level ${entry.id}: one step block`);
    for (const h of headers) assert.ok(data.lessonHtml.includes(h), `Level ${entry.id}: ${h}`);
  }
});

test('no two levels have the same answer key', () => {
  const byKey = new Map();
  for (const { entry, data } of withQuiz) {
    const key = data.quiz.questions.map((q) => q.a).join('');
    assert.ok(!byKey.has(key), `Level ${entry.id} has the same answer key as Level ${byKey.get(key)}`);
    byKey.set(key, entry.id);
  }
});

// A mock interview is built from one real level; the game picks which at random, so each is built here.
const mocks = mockModule.value
  ? loaded.filter(({ entry }) => MOCK_LEVELS.includes(entry.id)).map(({ entry, data }) => {
    try { return { id: entry.id, data: mockModule.value.mockOf(data, entry.id) }; } catch (error) { return { id: entry.id, error }; }
  })
  : [];

test('every mock interview problem has a level and passes validateLevel', () => {
  assert.ifError(mockModule.error);
  assert.deepEqual(mocks.map((m) => m.id), MOCK_LEVELS);
  for (const { id, data, error } of mocks) {
    assert.ifError(error);
    assert.deepEqual(validateLevel(data), [], `mock interview from Level ${id}`);
    assert.equal(data.saveKey, `sdl-mock-${id}-v1`);
  }
});

test('save keys are unique', () => {
  // A missing key fails its level's own test, so only the keys that exist are compared.
  const keys = [...loaded, ...mocks].map(({ data }) => data?.saveKey).filter((k) => typeof k === 'string');
  assert.equal(new Set(keys).size, keys.length);
});

test('the parts cover every level once, in order', () => {
  assert.equal(LEVELS.length, TOTAL_LEVELS);
  assert.deepEqual(LEVELS.map((l) => l.id), Array.from({ length: TOTAL_LEVELS }, (_, i) => i + 1));
  const covered = PARTS.flatMap((p) => Array.from({ length: p.last - p.first + 1 }, (_, i) => p.first + i));
  assert.deepEqual(covered, LEVELS.map((l) => l.id));
});
