// Level 12's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS } from '../../js/engine/catalog.js';
import { REPLICA_MS } from '../../js/engine/quorum.js';
import level from '../../levels/level-12.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, p, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [seats, carts, fast] = level.missions;
const goal = (mission, id) => mission.goals.find((g) => g.id === id);
const store = level.startNodes.find((n) => n.type === 'kv');

test('the story: the store starts with three copies of everything', () => {
  assert.equal(store.n, '3');
  assert.match(level.lesson.intro.story, /keeps three copies of everything/);
  assert.match(level.components.users.desc, /concert tickets/);
});

test('the new part card: $150 a month for each copy', () => {
  assert.equal(COMPONENTS.kv.cost, 150);
  assert.equal(first.newParts[0].game, '$150 a month for each copy. You set N, W and R.');
});

test('the quorum example: N = 5, W = 3 gives R = 5 − 3 + 1 = 3, and 3 + 3 = 6 > 5; Mission 1 asks about N = 3, W = 2', () => {
  const title = 'How do W and R make a read see the latest write?';
  assert.deepEqual(block(title, 'calc').rows.map((r) => [r.work, r.result]), [
    ['5 replicas − 3 replicas + 1', 'R = 3 replicas'],
    ['3 replicas + 3 replicas', '6 replicas, more than 5'],
  ]);
  // The picture draws the same example, so it does not show Mission 1's answer (R = 2) or the quiz's N = 3, W = R = 2.
  assert.equal(block(title, 'figure'), 'figQuorum');
  assert.match(section(title).body.find((b) => b.figure).alt, /^Of 5 replicas, a write has reached replicas 1, 2 and 3\. A read asks replicas 3, 4 and 5\./);
  assert.deepEqual([seats.gate.lo, seats.gate.hi], [2, 2]);
  assert.match(seats.gate.prompt, /N = 3 replicas, and a write waits for W = 2/);
  assert.match(level.quiz.questions[1].q, /^N = 3, W = 2, R = 2\./);
});

test('Check yourself: N = 5, W = 4 needs R = 2 (4 + 1 = 5 is not more than 5; 4 + 2 = 6 is)', () => {
  const options = first.checks[0].options;
  assert.deepEqual(options.map((o) => o.t), ['R = 1', 'R = 2', 'R = 5']);
  assert.equal(options.findIndex((o) => o.right), 1);
  assert.match(first.checks[0].q, /N = 5 copies and a write waits for W = 4/);
});

test('the vector clock example differs from the quiz\'s, and both conflict', () => {
  assert.match(block('How do the copies agree again afterwards?', 'p'), /^Example: versions \[A:1, B:2\] and \[A:2, B:1\]\./);
  assert.match(level.quiz.questions[5].q, /\[A:2, B:1\] and \[A:2, C:1\]/);
});

test('W and R decide the wait: with N = 3, R = 1 takes the nearest replica (2 ms), R = 2 the second (4 ms), R = 3 the third (10 ms)', () => {
  assert.deepEqual(REPLICA_MS.slice(0, 3), [2, 4, 10]);
  const table = block('How to tune W and R for what the store does most', 'table');
  assert.deepEqual(table.rows.map((r) => r.slice(0, 3)), [
    ['W = 3, R = 1', 'Fast', 'Slow, and fail if any replica is down'],
    ['W = 2, R = 2', 'Medium', 'Medium'],
    ['W = 1, R = 3', 'Slow', 'Fast'],
    ['W = 1, R = 1', 'Fast', 'Fast'],
  ]);
});

test('storage: 50 million × 20 KB = 1 billion KB = 1 TB, × 3 replicas = 3 TB; the quiz uses 200 million carts of 10 KB', () => {
  const calc = block('How does one node keep a write safe?', 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.work, r.result]), [
    ['50 million seat maps × 20 KB', '1 TB'],
    ['1 TB × 3 replicas', '3 TB'],
  ]);
  assert.equal(50e6 * 20, 1e9);
  assert.match(level.quiz.questions[9].q, /^200 million carts, 10 KB each, N = 3\./);
});

test('the mission cards and done cards name what the missions check: 3 replicas, 2 confirmations, 99%, 2 ms, 150 ms, $1,300', () => {
  assert.equal(level.targets.latencyMs, 150);
  assert.deepEqual([seats.budget, carts.budget, fast.budget], [1300, 1300, 1300]);
  assert.equal(goal(seats, 'replicas').text, 'Every key kept on at least 3 replicas');
  assert.equal(goal(carts, 'durable').text, 'Each cart change confirmed by at least 2 replicas');
  assert.equal(goal(fast, 'fastread').text, 'Seat reads answered by the store in 2 ms');
  assert.equal(REPLICA_MS[0], 2);
  assert.deepEqual(first.youWill.slice(1), [
    'set W and R so no read returns an old seat map, with every key on at least 3 replicas',
    'split the network with the Break it button: errors are allowed, old seat maps are not',
    'keep Response under 150 ms for at most $1,300 a month',
  ]);
  assert.deepEqual(second.youWill.slice(1), ['keep every cart change confirmed by at least 2 replicas', 'split the network and still serve at least 99% of requests', 'stay within $1,300 a month']);
  assert.deepEqual([third.youWill[0], third.youWill[2]], ['get seat-map reads answered by the store in 2 ms', 'stay within $1,300 a month']);
  assert.deepEqual(second.debrief.number, ['2 replicas', 'confirmed every cart change']);
  assert.match(second.debrief.next, /answer those reads in 2 ms/);
  assert.ok(seats.gate, 'Mission 1 asks for an estimate before Play');
});

test('the wrap-up\'s N = 3 is the store\'s', () => {
  assert.deepEqual(level.lesson.wrap.numbers[1], [`N = ${store.n}`, 'a common number of copies']);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word ("50 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
