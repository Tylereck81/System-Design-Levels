// js/validate-lesson.js validateLesson: each problem it reports, triggered on purpose on a small made-up lesson.
// (Every real level with a step lesson passing it is checked in levels.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLesson, wordCount, LIMITS } from '../../js/validate-lesson.js';

/** `n` words of text. */
const words = (n) => Array(n).fill('word').join(' ');
const check = () => ({
  kind: 'guess', q: 'Which one?',
  options: [{ t: 'This one', why: 'Because it is.', right: true }, { t: 'That one', why: 'It is not.' }],
});
const step = (n, extra = {}) => ({
  title: `Why step ${n}?`, hook: 'A short problem.', body: [{ p: 'A short <b>body</b>.' }], takeaway: 'One idea.',
  missions: [], quiz: [], ...extra,
});

/**
 * A valid level: 5 steps that use every block type, 3 checks, 2 missions and 2 quiz questions, each used by a step,
 * and one figure the level draws. `change` edits a fresh copy.
 */
function level(change = (d) => d) {
  const d = {
    missions: [{}, {}],
    quiz: { questions: [{}, {}] },
    drawFigures({ $, figNode }) { const svg = $('figOne'); svg.textContent = ''; figNode(svg, 'web', 10, 20, 'Web server'); },
    lesson: {
      kicker: 'Level 9 · Test', title: 'A made-up lesson', promise: 'By the end you will know one thing.', minutes: 5,
      rules: 'Requests take 10 ms.',
      steps: [
        step(1, { check: check(), missions: [0], body: [{ figure: 'figOne', alt: 'One box.', caption: 'One box' }, { p: 'Text.' }] }),
        step(2, { check: { ...check(), kind: 'turn' }, missions: [1] }),
        step(3, { check: check(), quiz: [0], body: [{ ul: ['One', 'Two'] }, { table: { head: ['A', 'B'], rows: [['1', '2']] } }] }),
        step(4, { quiz: [1], body: [{ ol: ['First', 'Second'] }, { example: ['1 + 1 = 2'], note: 'Simple.' }, { assume: 'A game rule.' }] }),
        step(5, { body: [{ p: 'An example request.' }, { code: 'GET /items/1' }] }),
      ],
      recap: { numbers: [['2×', 'a number to remember']], bridge: ['Mission 1 in one line.', 'Mission 2 in one line.'] },
    },
  };
  change(d);
  return d;
}
const steps = (d) => d.lesson.steps;

test('a valid lesson has no problems', () => {
  assert.deepEqual(validateLesson(level()), []);
});

test('words are counted with inline markup stripped, and a symbol alone is not a word', () => {
  assert.equal(wordCount('<b>busy</b> = load ÷ capacity'), 3);
  assert.equal(wordCount('one&nbsp;two <code>GET /items</code>'), 4);
  assert.equal(wordCount('300 req/s → 75%'), 3);
});

test('a missing kicker, title, promise, rules or minutes', () => {
  for (const key of ['kicker', 'title', 'promise', 'rules']) {
    assert.deepEqual(validateLesson(level((d) => { delete d.lesson[key]; })), [`the lesson needs a ${key}`]);
  }
  assert.deepEqual(validateLesson(level((d) => { d.lesson.minutes = 0; })), ['the lesson needs its reading time in minutes']);
});

test('fewer than 5 or more than 8 steps', () => {
  assert.deepEqual(validateLesson(level((d) => { steps(d).pop(); })), ['the lesson has 4 steps, not 5 to 8']);
  assert.deepEqual(validateLesson(level((d) => { steps(d).push(step(6), step(7), step(8)); })), []);
  assert.deepEqual(validateLesson(level((d) => { steps(d).push(step(6), step(7), step(8), step(9)); })), ['the lesson has 9 steps, not 5 to 8']);
});

test('a title that is not a question', () => {
  assert.deepEqual(validateLesson(level((d) => { steps(d)[1].title = 'Step two'; })), ['step 2: the title must be a question ending in "?"']);
});

test('a missing hook, or one over the word limit', () => {
  assert.deepEqual(validateLesson(level((d) => { delete steps(d)[0].hook; })), ['step 1: needs a hook']);
  assert.deepEqual(validateLesson(level((d) => { steps(d)[0].hook = words(LIMITS.hookWords); })), []);
  assert.deepEqual(validateLesson(level((d) => { steps(d)[0].hook = words(LIMITS.hookWords + 1); })), ['step 1: the hook has 51 words, more than 50']);
});

test('a promise over the word limit', () => {
  assert.deepEqual(validateLesson(level((d) => { d.lesson.promise = words(LIMITS.promiseWords); })), []);
  assert.deepEqual(validateLesson(level((d) => { d.lesson.promise = words(LIMITS.promiseWords + 1); })), ['the promise has 61 words, more than 60']);
});

test('an empty body', () => {
  assert.deepEqual(validateLesson(level((d) => { steps(d)[4].body = []; })), ['step 5: needs a body']);
});

test('a body over the word limit: prose blocks count, the table, code or figure caption does not', () => {
  // 40 + 2×20 + 2×10 + (9 + 1) + 10 = 120 words across p, ul, ol, example lines and note, and assume.
  const prose = [{ p: words(40) }, { ul: [words(20), words(20)] }, { ol: [words(10), words(10)] },
    { example: [words(9)], note: 'word' }, { assume: words(10) }];
  const at = (body) => level((d) => { steps(d)[3].body = body; });
  assert.deepEqual(validateLesson(at([...prose, { table: { head: [words(100)], rows: [[words(100)]] }, caption: words(50) }])), []);
  assert.deepEqual(validateLesson(at([...prose, { code: words(200) }])), []);
  assert.deepEqual(validateLesson(at([...prose, { p: '<b>one</b> more' }])), ['step 4: the body has 122 words, more than 120']);
  assert.deepEqual(validateLesson(at([...prose.slice(0, 3), { example: [words(9)], note: 'two words' }, prose[4]])), ['step 4: the body has 121 words, more than 120']);
});

test('more than one table, code sample or figure in a step', () => {
  const d = level((d) => { steps(d)[2].body.push({ code: 'GET /' }); });
  assert.deepEqual(validateLesson(d), ['step 3: has 2 tables, code samples or figures; at most one']);
});

test('a takeaway that is missing or not one sentence', () => {
  const at = (takeaway) => validateLesson(level((d) => { steps(d)[0].takeaway = takeaway; }));
  assert.deepEqual(at(undefined), ['step 1: needs a takeaway']);
  assert.deepEqual(at('One idea. Then another.'), ['step 1: the takeaway must be one sentence']);
  assert.deepEqual(at('No full stop'), ['step 1: the takeaway must be one sentence']);
  assert.deepEqual(at('Busy at 99.9% means slow: 4× at <b>75%</b>.'), []);
});

test('a block of an unknown type, or with two types', () => {
  const at = (block) => validateLesson(level((d) => { steps(d)[0].body.push(block); }));
  const types = 'p, ul, ol, table, code, example, figure, assume';
  assert.deepEqual(at({ quote: 'Hi' }), [`step 1: a body block needs exactly one type from ${types}; it has keys quote`]);
  assert.deepEqual(at({ p: 'Hi', assume: 'Hi' }), [`step 1: a body block needs exactly one type from ${types}; it has keys p, assume`]);
});

test('a figure the level does not draw, or a drawFigures that fails', () => {
  assert.deepEqual(validateLesson(level((d) => { steps(d)[0].body[0].figure = 'figTwo'; })), ['step 1: figure "figTwo" is not drawn by the level\'s drawFigures']);
  assert.deepEqual(validateLesson(level((d) => { delete d.drawFigures; })), ['step 1: figure "figOne" is not drawn by the level\'s drawFigures']);
  const broken = level((d) => { d.drawFigures = () => { throw new Error('oops'); }; });
  assert.deepEqual(validateLesson(broken), ['drawFigures failed while listing its figures: oops']);
});

test('more than one check in a step, or fewer than 3 in the lesson', () => {
  assert.deepEqual(validateLesson(level((d) => { steps(d)[3].check = [check(), check()]; })), ['step 4: has more than one check; at most one']);
  assert.deepEqual(validateLesson(level((d) => { delete steps(d)[2].check; })), ['the lesson has 2 checks, fewer than 3']);
});

test('a check with too few or too many options, not exactly one right, or an option without a why', () => {
  const at = (edit) => validateLesson(level((d) => edit(steps(d)[0].check.options)));
  assert.deepEqual(at((o) => o.pop()), ['step 1: the check needs 2 or 3 options; it has 1']);
  assert.deepEqual(at((o) => o.push({ t: 'C', why: 'No.' })), []);
  assert.deepEqual(at((o) => o.push({ t: 'C', why: 'No.' }, { t: 'D', why: 'No.' })), ['step 1: the check needs 2 or 3 options; it has 4']);
  assert.deepEqual(at((o) => { o[1].right = true; }), ['step 1: the check has 2 right options, not exactly one']);
  assert.deepEqual(at((o) => { delete o[1].why; }), ['step 1: every check option needs a why']);
});

test('a mission or quiz question no step uses, an index that does not exist, or a missing list', () => {
  assert.deepEqual(validateLesson(level((d) => { steps(d)[1].missions = []; })), ['mission index 1 is in no step\'s missions']);
  assert.deepEqual(validateLesson(level((d) => { steps(d)[3].quiz = []; })), ['quiz question index 1 is in no step\'s quiz']);
  assert.deepEqual(validateLesson(level((d) => { steps(d)[4].quiz = [2]; })), ['step 5: quiz question index 2 does not exist']);
  assert.deepEqual(validateLesson(level((d) => { delete steps(d)[4].missions; })), ['step 5: needs a mission list (it may be empty)']);
});

test('a recap bridge without one line per mission', () => {
  assert.deepEqual(validateLesson(level((d) => { d.lesson.recap.bridge.pop(); })), ['recap.bridge needs one line per mission (2); it has 1']);
  assert.deepEqual(validateLesson(level((d) => { delete d.lesson.recap; })), ['recap.bridge needs one line per mission (2); it has none']);
});
