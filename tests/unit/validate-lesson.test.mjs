// js/validate-lesson.js validateLesson: each problem it reports, triggered on purpose on a small made-up lesson.
// (Every real level with a step lesson passing it is checked in levels.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLesson, lessonWarnings, wordCount, LIMITS } from '../../js/validate-lesson.js';

/** `n` words of text. */
const words = (n) => Array(n).fill('word').join(' ');
const check = () => ({
  kind: 'guess', q: 'Which one?',
  options: [{ t: 'This one', why: 'Because it is.', right: true }, { t: 'That one', why: 'It is not.' }],
});
/** A valid worked calculation with one row. */
const calc = (extra = {}) => ({
  formula: 'Total = boxes × apples in a box.',
  rows: [{ label: 'Apples', work: '2 boxes × 6 apples', result: '12 apples' }],
  result: 'You have 12 apples.', ...extra,
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
        step(4, { quiz: [1], body: [{ ol: ['First', 'Second'] }, { calc: calc() }, { assume: 'A game rule.' }] }),
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
  for (const minutes of [0, '5', NaN]) {
    assert.deepEqual(validateLesson(level((d) => { d.lesson.minutes = minutes; })), ['the lesson needs its reading time in minutes']);
  }
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
  // 40 + 2×20 + 2×10 + (9 + 1) + 10 = 120 words across p, ul, ol, a calculation's formula and result sentence, and
  // assume. A calculation's rows are a grid, like a table, and are not counted.
  const row = { label: words(20), work: `${words(20)} ms`, result: `${words(20)} ms` };
  const prose = [{ p: words(40) }, { ul: [words(20), words(20)] }, { ol: [words(10), words(10)] },
    { calc: { formula: words(9), rows: [row], result: 'word' } }, { assume: words(10) }];
  const at = (body) => level((d) => { steps(d)[3].body = body; });
  assert.deepEqual(validateLesson(at([...prose, { table: { head: [words(100)], rows: [[words(100)]] }, caption: words(50) }])), []);
  assert.deepEqual(validateLesson(at([...prose, { code: words(200) }])), []);
  assert.deepEqual(validateLesson(at([...prose, { p: '<b>one</b> more' }])), ['step 4: the body has 122 words, more than 120']);
  assert.deepEqual(validateLesson(at([...prose.slice(0, 3), { calc: { formula: words(9), rows: [row], result: 'two words' } }, prose[4]])), ['step 4: the body has 121 words, more than 120']);
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
  const types = 'p, ul, ol, table, code, calc, figure, assume';
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

test('a check with no kind or question', () => {
  assert.deepEqual(validateLesson(level((d) => { steps(d)[0].check.kind = 'quiz'; })), ['step 1: the check kind must be guess or turn']);
  assert.deepEqual(validateLesson(level((d) => { delete steps(d)[0].check.q; })), ['step 1: the check needs a question']);
});

test('a check with too few or too many options, not exactly one right, or an option without its text or a why', () => {
  const at = (edit) => validateLesson(level((d) => edit(steps(d)[0].check.options)));
  assert.deepEqual(at((o) => o.pop()), ['step 1: the check needs 2 or 3 options; it has 1']);
  assert.deepEqual(at((o) => o.push({ t: 'C', why: 'No.' })), []);
  assert.deepEqual(at((o) => o.push({ t: 'C', why: 'No.' }, { t: 'D', why: 'No.' })), ['step 1: the check needs 2 or 3 options; it has 4']);
  assert.deepEqual(at((o) => { o[1].right = true; }), ['step 1: the check has 2 right options, not exactly one']);
  assert.deepEqual(at((o) => { delete o[1].why; }), ['step 1: every check option needs a why']);
  assert.deepEqual(at((o) => { o[1].t = ''; }), ['step 1: every check option needs its text']);
});

test('a mission or quiz question no step uses, an index that does not exist, or a missing list', () => {
  assert.deepEqual(validateLesson(level((d) => { steps(d)[1].missions = []; })), ['mission index 1 is in no step\'s missions']);
  assert.deepEqual(validateLesson(level((d) => { steps(d)[3].quiz = []; })), ['quiz question index 1 is in no step\'s quiz']);
  assert.deepEqual(validateLesson(level((d) => { steps(d)[4].quiz = [2]; })), ['step 5: quiz question index 2 does not exist']);
  assert.deepEqual(validateLesson(level((d) => { delete steps(d)[4].missions; })), ['step 5: needs a mission list (it may be empty)']);
});

test('a recap bridge without one line per mission', () => {
  assert.deepEqual(validateLesson(level((d) => { d.lesson.recap.bridge.pop(); })), ['recap.bridge needs one line per mission (2); it has 1']);
  assert.deepEqual(validateLesson(level((d) => { d.lesson.recap.bridge = 'One line.'; })), ['recap.bridge needs one line per mission (2); it has none']);
});

test('recap numbers missing, empty, or not [value, meaning] pairs', () => {
  const msg = ['recap.numbers needs at least one [value, meaning] pair'];
  assert.deepEqual(validateLesson(level((d) => { delete d.lesson.recap.numbers; })), msg);
  assert.deepEqual(validateLesson(level((d) => { d.lesson.recap.numbers = []; })), msg);
  assert.deepEqual(validateLesson(level((d) => { d.lesson.recap.numbers = [['2×']]; })), msg);
  assert.deepEqual(validateLesson(level((d) => { delete d.lesson.recap; })), [...msg, 'recap.bridge needs one line per mission (2); it has none']);
});

test('a block not filled in as its type needs: each type names what is missing, and nothing throws', () => {
  const at = (block) => validateLesson(level((d) => { steps(d)[0].body.push(block); }));
  assert.deepEqual(at({ p: '' }), ['step 1: p block needs text']);
  assert.deepEqual(at({ ul: 'one item' }), ['step 1: ul block needs a list of text items']);
  assert.deepEqual(at({ ol: ['one', ''] }), ['step 1: ol block needs a list of text items']);
  const calcMsg = ['step 1: calc block needs a formula, a list of rows and a result sentence'];
  assert.deepEqual(at({ calc: '1 + 1 = 2' }), calcMsg);
  assert.deepEqual(at({ calc: calc({ formula: '' }) }), calcMsg);
  assert.deepEqual(at({ calc: calc({ rows: 'one row' }) }), calcMsg);
  assert.deepEqual(at({ calc: calc({ result: undefined }) }), calcMsg);
  assert.deepEqual(at({ assume: 3 }), ['step 1: assume block needs text']);
  const table = (t) => validateLesson(level((d) => { steps(d)[2].body[1] = t; }));
  const tableMsg = ['step 3: table block needs a head and rows with a cell for each heading'];
  assert.deepEqual(table({ table: { head: ['', 'B'], rows: [['1', '2']] } }), []); // an empty corner cell is fine
  assert.deepEqual(table({ table: { head: ['A', 'B'], rows: [['1']] } }), tableMsg);
  assert.deepEqual(table({ table: { head: ['A', 'B'], rows: [] } }), tableMsg);
  assert.deepEqual(table({ table: { head: ['A', 'B'], rows: [['1', '2']] }, caption: '' }), tableMsg);
  const code = (b) => validateLesson(level((d) => { steps(d)[4].body[1] = b; }));
  assert.deepEqual(code({ code: '' }), ['step 5: code block needs the code as text']);
  const figure = (edit) => validateLesson(level((d) => edit(steps(d)[0].body[0])));
  const figureMsg = ['step 1: figure block needs an svg id, alt text and a caption'];
  assert.deepEqual(figure((b) => { delete b.alt; }), figureMsg);
  assert.deepEqual(figure((b) => { b.caption = ' '; }), figureMsg);
  const types = 'p, ul, ol, table, code, calc, figure, assume';
  assert.deepEqual(at(null), [`step 1: a body block needs exactly one type from ${types}; it has keys none`]);
  assert.deepEqual(at('text'), [`step 1: a body block needs exactly one type from ${types}; it has keys none`]);
  assert.deepEqual(validateLesson(level((d) => { steps(d).push(null); })), ['step 6: is not a step object']);
});

test('a calculation has 1 to 4 rows', () => {
  const row = calc().rows[0];
  const rows = (n) => validateLesson(level((d) => { steps(d)[3].body[1] = { calc: calc({ rows: Array(n).fill(row) }) }; }));
  assert.deepEqual(rows(0), ['step 4: the calculation has 0 rows, not 1 to 4']);
  assert.deepEqual(rows(1), []);
  assert.deepEqual(rows(LIMITS.maxCalcRows), []);
  assert.deepEqual(rows(LIMITS.maxCalcRows + 1), ['step 4: the calculation has 5 rows, not 1 to 4']);
});

test('a calculation row with a missing part', () => {
  const row = calc().rows[0];
  const second = (r) => validateLesson(level((d) => { steps(d)[3].body[1] = { calc: calc({ rows: [row, r] }) }; }));
  assert.deepEqual(second({ ...row, label: '' }), ['step 4: calculation row 2 needs its label']);
  assert.deepEqual(second({ label: 'Apples', result: '12 apples' }), ['step 4: calculation row 2 needs its work']);
  assert.deepEqual(second({ label: 'Apples' }), ['step 4: calculation row 2 needs its work and result']);
  assert.deepEqual(second(null), ['step 4: calculation row 2 needs its label and work and result']);
});

test('a working or a result without a unit', () => {
  const row = calc().rows[0];
  const only = (r) => validateLesson(level((d) => { steps(d)[3].body[1] = { calc: calc({ rows: [{ ...row, ...r }] }) }; }));
  assert.deepEqual(only({ work: '2 × 6' }), ['step 4: calculation row 1: the work "2 × 6" has no unit']);
  assert.deepEqual(only({ result: '<b>12</b>' }), ['step 4: calculation row 1: the result "<b>12</b>" has no unit']);
  assert.deepEqual(only({ work: '2 × 6', result: '12' }), ['step 4: calculation row 1: the work "2 × 6" has no unit', 'step 4: calculation row 1: the result "12" has no unit']);
  // A word, a percent sign or a dollar sign is a unit.
  assert.deepEqual(only({ work: '100% − 0.1%', result: '99.9%' }), []);
  assert.deepEqual(only({ work: '2 × $40', result: '$80' }), []);
  assert.deepEqual(only({ work: '20 ms ÷ (1 − 0.75)', result: '80 ms' }), []);
});

test('more than one calculation in a step', () => {
  assert.deepEqual(validateLesson(level((d) => { steps(d)[3].body.push({ calc: calc() }); })), ['step 4: has 2 calculations; at most one']);
});

test('a warning for each number of a million or more written in digits', () => {
  assert.deepEqual(lessonWarnings(level()), []);
  const advice = 'is written in digits; use the word ("40 million", "1.2 billion")';
  const hook = (text) => lessonWarnings(level((d) => { steps(d)[1].hook = text; }));
  assert.deepEqual(hook('The app has 1,200,000,000 requests a day from 40000000 users.'), [`step 2: 1,200,000,000 ${advice}`, `step 2: 40000000 ${advice}`]);
  assert.deepEqual(hook('It has <b>1,000,000</b> users, or 2,000,000, soon.'), [`step 2: 1,000,000 ${advice}`, `step 2: 2,000,000 ${advice}`]);
  // Below a million, written with the word, or digits after a decimal point: no warning.
  assert.deepEqual(hook('999,999 users, 40 million users, 86,400 s and 0.0000001 of a second.'), []);
  // Every part of the lesson is read: its own fields, a calculation, a question, the recap.
  assert.deepEqual(lessonWarnings(level((d) => { d.lesson.promise = 'Serve 2,000,000 users.'; })), [`2,000,000 ${advice}`]);
  assert.deepEqual(lessonWarnings(level((d) => { d.lesson.recap.numbers[0][0] = '3,000,000'; })), [`3,000,000 ${advice}`]);
  assert.deepEqual(lessonWarnings(level((d) => { steps(d)[3].body[1].calc.rows[0].work = '4,000,000 boxes × 6 apples'; })), [`step 4: 4,000,000 ${advice}`]);
  assert.deepEqual(lessonWarnings(level((d) => { steps(d)[0].check.options[1].why = 'Not 5,000,000.'; })), [`step 1: 5,000,000 ${advice}`]);
  // Code is shown as written, so a long number in it is left alone.
  assert.deepEqual(lessonWarnings(level((d) => { steps(d)[4].body[1].code = 'GET /items/1234567'; })), []);
});
