// Level 11's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS } from '../../js/engine/catalog.js';
import { serverNames, movedShare, keyShares } from '../../js/engine/hashring.js';
import level from '../../levels/level-11.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, p, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [lose, add, sale] = level.missions;
const { ring } = COMPONENTS;
/** Every server name but one. */
const without = (n, name) => serverNames(n).filter((s) => s !== name);

test('the story: five cache servers placed by the remainder rule', () => {
  const cluster = level.startNodes.find((n) => n.type === 'ring');
  assert.deepEqual([cluster.count, cluster.hashing], ['5', 'mod']);
  assert.match(level.lesson.intro.story, /^Creator profiles are cached on five servers\./);
});

test('the new part card: up to 10 cache servers, each 10,000 lookups/s whatever its size', () => {
  assert.ok(Object.values(ring.sizes).every((s) => s.cap === 10000));
  assert.equal(first.newParts[0].game, 'Up to 10 servers. Each handles 10,000 lookups/s.');
});

test('the remainder rule, 8 servers to 7: 7 of every 56 hash values stay, 49 ÷ 56 = 87.5% move, as the game counts', () => {
  const calc = block('Why does losing one cache server make almost every key miss?', 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.work, r.result]), [
    ['hash values 0 to 6 of every 56 values', '7 values'],
    ['56 values − 7 values', '49 values = 87.5%'],
  ]);
  assert.equal(movedShare(serverNames(8), without(8, 'C'), { mod: true }), 0.875);
  // Mission 1 asks about 5 to 4 (80%), and 87.5 is not an answer its estimate accepts.
  assert.equal(movedShare(serverNames(5), without(5, 'C'), { mod: true }), 0.8);
  assert.ok(87.5 > lose.gate.hi);
});

test('a ring with 2 million profiles on 8 servers moves 250,000; the remainder rule 1.75 million, seven times as many', () => {
  const calc = block('How many keys move on a ring?', 'calc');
  assert.deepEqual(calc.rows.map((r) => r.result), ['250,000 profiles = 12.5%', '1.75 million profiles']);
  assert.equal(1.75e6 / 250000, 7);
  assert.equal(calc.result, 'The ring moves one share. The remainder rule moves seven.');
});

test('Mission 1\'s done card: C owns a small arc of a one-point ring, and E more than half of it', () => {
  const shares = keyShares(serverNames(5), { vnodes: 1 });
  assert.ok(shares.C < 1 / 5, `C owns ${shares.C}`);
  assert.ok(shares.E > 0.5, `E owns ${shares.E}`);
  assert.equal(first.debrief.next, 'C\'s section of the ring happened to be small. Another server owns more than half the ring.');
});

test('virtual nodes: four times as many points halves the spread (1 ÷ √v)', () => {
  assert.equal(Math.sqrt(4), 2);
  assert.match(block('How do virtual nodes even out the shares?', 'p'), /Four times as many points roughly halves the spread\./);
});

test('Check yourself: one of 6 servers fails, and its arcs go to the other five', () => {
  const check = second.checks[0];
  assert.match(check.q, /^A ring has 6 servers with 200 virtual nodes each\./);
  assert.equal(check.options.find((o) => o.right).t, 'To all five other servers, in small pieces'); // 6 − 1 = 5
});

test('the storm: 6,000 × 0.9 ÷ 4 = 1,350 and ÷ 8 = 675; eight M servers cost and hold what four L servers do', () => {
  const calc = block('How big is the storm when a server fails?', 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.work, r.result]), [
    ['6,000 reads/s × 0.9 ÷ 4', '1,350 reads/s'],
    ['6,000 reads/s × 0.9 ÷ 8', '675 reads/s'],
  ]);
  assert.deepEqual([8 * ring.sizes.M.cost, 8 * ring.sizes.M.mem], [4 * ring.sizes.L.cost, 4 * ring.sizes.L.mem]);
  assert.match(block('How big is the storm when a server fails?', 'p'), /Eight servers of half the size cost about the same as four/);
});

test('Check yourself: 5,000 × 0.8 ÷ 10 = 400; the quiz uses 9,000, 95% and 6, the mission 3,800, 98% and 5', () => {
  const options = third.checks[0].options;
  assert.deepEqual(options.map((o) => o.t), ['500 reads/s', '400 reads/s', '4,000 reads/s']);
  assert.equal(options.findIndex((o) => o.right), 1);
  assert.match(level.quiz.questions[9].q, /9,000 reads\/s with 95% hits\. One of 6 servers fails/);
});

test('the sale doubles the traffic: 2,000 to 4,000 requests a second', () => {
  assert.deepEqual([lose.qps, add.qps, sale.qps], [2000, 2000, 4000]);
  assert.equal(second.debrief.next, 'The sale doubles the traffic to 4,000 requests a second. One server\'s share of misses is now more than the database can take.');
});

test('the mission cards name what the missions check: 25% moved, 10% spread, 150 ms, $1,400, $1,400, $1,700', () => {
  assert.equal(level.targets.latencyMs, 150);
  assert.deepEqual([lose.budget, add.budget, sale.budget], [1400, 1400, 1700]);
  assert.equal(lose.goals.find((g) => g.id === 'lose-c').text, 'Break it: server C fails; at most 25% of keys move');
  assert.equal(add.goals.find((g) => g.id === 'spread').text, 'Busiest cache server at most 10% above the average');
  assert.deepEqual(first.youWill.slice(2), ['let server C fail: at most 25% of keys may move', 'keep Response under 150 ms for at most $1,400 a month']);
  assert.deepEqual(second.youWill.slice(1), ['raise the virtual nodes until the busiest server is at most 10% above the average', 'add a server: at most 25% of keys may move', 'stay within $1,400 a month']);
  assert.deepEqual(third.youWill.slice(1), ['keep the busiest server at most 10% above the average', 'let server C fail during the sale and stay above the Served target', 'stay within $1,700 a month']);
  assert.ok(lose.gate, 'Mission 1 asks for an estimate before Play');
});

test('the wrap-up\'s number is the one the first section works out', () => {
  assert.deepEqual(level.lesson.wrap.numbers[1], ['87.5%', 'of keys move when 8 servers become 7 with hash % N']);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word ("2 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
