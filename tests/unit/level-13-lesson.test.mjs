// Level 13's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS } from '../../js/engine/catalog.js';
import { DB_IDS, SNOW_IDS, CLOCK_BACK_MS } from '../../js/engine/ids.js';
import level from '../../levels/level-13.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, p, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [bits64, city, order] = level.missions;
const goal = (mission, id) => mission.goals.find((g) => g.id === id);
const BITS = 'How do you fit time, place and a counter into 64 bits?';

test('the new part card: $100 a month for each generator server, four methods', () => {
  assert.equal(COMPONENTS.idgen.cost, 100);
  assert.equal(first.newParts[0].game, '$100 a month for each server. Four methods to choose from.');
  assert.equal(level.components.idgen.choices.find((c) => c.key === 'method').options.length, 4);
});

test('the sizing example: 9,000 ÷ 4,000 = 2.25, so 3, plus a spare = 4; Mission 1 asks 12,000 at 5,000 each', () => {
  const calc = block('Why is one counter not enough?', 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.work, r.result]), [
    ['9,000 IDs/s ÷ 4,000 IDs/s', '2.25, so 3 servers'],
    ['3 servers + 1 server', '4 servers'],
  ]);
  // 3 × 4,000 = 12,000 with one of the 4 down.
  assert.equal(calc.result, '4 servers. With one down, the other 3 still make 12,000 IDs a second.');
  assert.equal(DB_IDS, 5000);
  assert.match(bits64.gate.prompt, /hands out 5,000 IDs a second\. The app needs 12,000 a second/);
});

test('step counters: the lesson\'s 4 servers (3, 7, 11), Check yourself\'s 5 (4, 9, 14), the quiz\'s 3 (2, 5, 8)', () => {
  assert.match(block('How can several counters avoid each other?', 'p'), /With 4 servers, the server that starts at 3 hands out 3, 7, 11\./);
  const options = first.checks[0].options;
  assert.equal(options.find((o) => o.right).t, '4, 9, 14'); // 4, 4 + 5, 4 + 10
  assert.match(level.quiz.questions[1].q, /^Multi-primary with 3 servers\. Server 2 starts at 2\./);
});

test('the 64-bit layout: 1 + 41 + 5 + 5 + 12 = 64; 2⁴¹ ms ≈ 69.7 years; 2¹² = 4,096 a ms; 2⁵ × 2⁵ = 1,024', () => {
  assert.equal(1 + 41 + 5 + 5 + 12, 64);
  assert.equal(goal(bits64, 'bits').text, 'IDs fit in 64 bits');
  // 2,199,023,255,552 ms ÷ 1,000 ÷ 3,600 ÷ 24 ÷ 365 = 69.73 years.
  assert.equal(Math.floor(2 ** 41 / 1000 / 3600 / 24 / 365), 69);
  assert.equal(SNOW_IDS, 4096 * 1000); // the game's generator makes the 4,096 a millisecond the lesson teaches
  assert.deepEqual(block(BITS, 'ul'), [
    '<b>Time</b> (41 bits): milliseconds since a start date you choose, the <b>epoch</b>. It lasts about 69 years.',
    '<b>Data center and machine</b> (5 + 5 bits): a number given to each generator when it starts. Room for 1,024 generators.',
    '<b>Sequence</b> (12 bits): a counter that restarts every millisecond. Room for 4,096 IDs each millisecond on each generator.',
  ]);
  assert.deepEqual(level.lesson.wrap.numbers, [
    ['69 years', 'what 41 bits of milliseconds last'],
    ['4,096', 'IDs each millisecond on one generator'],
    ['1,024 generators', 'allowed by 10 bits of machine number'],
  ]);
});

test('Check yourself: 10 sequence bits give 2¹⁰ = 1,024 IDs a millisecond, not 4,096', () => {
  assert.equal(2 ** 10, 1024);
  assert.equal(second.checks[0].options.find((o) => o.right).t, 'IDs each millisecond: 1,024 where it had 4,096');
});

test('the clock picture uses the game\'s set-back: 251 − 20 = 231; Check yourself says 30 ms, the quiz 5 ms', () => {
  assert.equal(CLOCK_BACK_MS, 20);
  const alt = section('What happens when a clock goes backwards?').body.find((b) => b.figure).alt;
  assert.equal(alt, 'A generator issues IDs at 250 and 251 milliseconds. A time correction sets its clock back to 231. The generator waits, issuing nothing, until the clock has passed 251 again, and then issues the next ID at 252.');
  assert.match(third.checks[0].q, /set back by 30 milliseconds/);
  assert.match(level.quiz.questions[8].q, /clock back 5 ms/);
});

test('the mission cards and done cards name what the missions check: 12,000 IDs/s, 64 bits, $1,900, the Break it buttons', () => {
  assert.deepEqual([bits64.budget, city.budget, order.budget], [1900, 1900, 1900]);
  assert.equal(goal(bits64, 'rate').text, 'Make 12,000 IDs a second (99% of requests served)');
  assert.equal(goal(order, 'ordered').text, 'An ID made later is always larger');
  assert.deepEqual(level.experiments.map((e) => e.label), ['A generator server fails', 'Add a generator server', 'Set a clock back']);
  assert.ok(bits64.gate, 'Mission 1 asks for an estimate before Play');
  assert.deepEqual(first.youWill.slice(1), [
    'make 12,000 unique IDs a second that are plain numbers and fit in 64 bits',
    'take a generator server down with the Break it button and still keep up',
    'stay within $1,900 a month',
  ]);
  assert.deepEqual([second.youWill[0], second.youWill[2]], [
    'press Add a generator server and see which methods repeat an ID',
    'keep every ID unique, numeric and within 64 bits, for at most $1,900 a month',
  ]);
  assert.deepEqual(third.youWill, ['make sure an ID made later is always larger', 'press Set a clock back and keep IDs unique and in order', 'stay within $1,900 a month']);
  assert.deepEqual(first.debrief.number, ['64 bits', 'the size every ID must fit in']);
  assert.deepEqual(second.debrief.number, ['1,024 generators', 'fit in the data center and machine fields']);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
