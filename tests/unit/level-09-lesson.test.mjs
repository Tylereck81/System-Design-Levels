// Level 9's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIZES, COMPONENTS } from '../../js/engine/catalog.js';
import level from '../../levels/level-09.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, table, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [split, famous, room] = level.missions;

test('the story: 60% of queries are writes, and the primary is already the largest size', () => {
  assert.equal(split.writes, 0.6);
  assert.match(level.lesson.intro.story, /^Listeners play, follow and like all day, so 60% of your database queries are now writes\./);
  assert.equal(Object.keys(SIZES).at(-1), 'XL');
  assert.equal(level.startNodes.find((n) => n.role === 'primary').size, 'XL');
  assert.match(level.lesson.intro.story, /already the largest server you can rent/);
});

test('the new part cards: shards are chosen in the inspector; NoSQL is $200, 20,000 lookups/s, 3 ms', () => {
  // The number of shards and the key are inspector choices; the size is every sized component's size picker.
  const inspector = level.components.shards.choices.map((c) => c.key);
  assert.ok(inspector.includes('count') && inspector.includes('key'));
  assert.ok(COMPONENTS.shards.sized);
  assert.equal(first.newParts[0].game, 'You choose the number of shards, their size and the shard key.');
  assert.deepEqual([COMPONENTS.nosql.cost, COMPONENTS.nosql.cap, COMPONENTS.nosql.base], [200, 20000, 3]);
  assert.equal(third.newParts[0].game, '$200 a month. Takes 20,000 lookups/s, 3 ms each.');
});

test('which shard: 2,347 = 4 × 586 + 3, so account 2,347 is on shard 3 (the quiz uses 1006)', () => {
  const calc = block('How does sharding split a database?', 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.work, r.result]), [['ID 2,347 ÷ 4 shards', '586, remainder 3']]);
  assert.equal(calc.result, 'Account 2,347 lives on shard 3. Every query for it goes there and nowhere else.');
});

test('the shard count example: L takes 800/s, 800 × 0.7 = 560, 2,500 ÷ 560 = 4.5, so 5 shards', () => {
  assert.equal(SIZES.L.cap, 800);
  const calc = block('How many shards do you need?', 'calc');
  assert.deepEqual(calc.rows.map((r) => r.work), ['800 queries/s × 0.7', '2,500 queries/s ÷ 560 queries/s']);
  assert.deepEqual(calc.rows.map((r) => r.result), ['560 queries/s', '4.5, so 5 shards']);
});

test('Check yourself: XL takes 1,600/s, 1,600 × 0.7 = 1,120, 9,000 ÷ 1,120 = 8.04, so 9; 6 (9,000 ÷ 1,600) and 8 are wrong', () => {
  assert.equal(SIZES.XL.cap, 1600);
  const options = first.checks[0].options;
  assert.deepEqual(options.map((o) => o.t), ['6', '8', '9']);
  assert.equal(options.findIndex((o) => o.right), 2);
  assert.match(options[2].why, /= 8\.04, rounded up to 9/);
});

test('the lesson\'s shard counts are not answers the Mission 1 estimate accepts', () => {
  const { lo, hi } = split.gate;
  for (const n of [5, 6, 8, 9]) assert.ok(n < lo || n > hi, `${n} is inside the estimate's ${lo} to ${hi}`);
});

test('resharding from 3 to 4: of every 12 keys only 0, 1 and 2 stay, so 9 of 12 = 75% move', () => {
  const calc = block('What does adding a shard cost?', 'calc');
  assert.deepEqual(calc.rows.map((r) => r.result), ['3 keys', '9 keys = 75%']);
  const rows = block('What does adding a shard cost?', 'table').rows;
  assert.deepEqual(rows.map((r) => r[3]), ['no', 'no', 'no', 'yes', 'yes', 'yes']);
  // The game's own "Add a shard" reports N ÷ (N + 1): 3 ÷ 4 = 75%.
  assert.match(level.experiments[0].observed({ shardCount: 3 }), /puts 75% of accounts/);
});

test('the mission cards name what the missions check: under 70% busy, 150 ms, $2,500, $3,500, $3,900', () => {
  assert.ok(split.gate, 'Mission 1 asks for an estimate before Play');
  assert.equal(split.goals.find((g) => g.id === 'shards').text, 'No database shard above 70% busy');
  assert.equal(level.targets.latencyMs, 150);
  assert.deepEqual([split.budget, famous.budget, room.budget], [2500, 3500, 3900]);
  assert.equal(first.youWill[3], 'keep Response under 150 ms for at most $2,500 a month');
  assert.equal(second.youWill[2], 'keep every shard under 70% busy for at most $3,500 a month');
  assert.equal(third.youWill[1], 'keep every shard under 70% busy for at most $3,900 a month');
});

test('Mission 2: three hot accounts take 20%, and the inspector gives each a shard of its own', () => {
  assert.equal(famous.hot, 0.2);
  assert.deepEqual(first.debrief.number, ['70%', 'the most any shard should be busy']);
  assert.deepEqual(second.debrief.number, ['20%', 'of all queries went to three accounts']);
  const hot = level.components.shards.choices.find((c) => c.key === 'hot');
  assert.equal(hot.options.find((o) => o.id === 'own').name, 'A shard for each');
});

test('Mission 3: traffic grows to 4,500 queries/s, plays and likes go to NoSQL, and Add a shard is the break-it', () => {
  assert.equal(room.qps, 4500);
  assert.equal(second.debrief.next, 'Traffic is growing to 4,500 queries a second. The shards are filling up again.');
  assert.ok(room.goals.some((g) => g.id === 'nosql'));
  assert.equal(level.experiments[0].label, 'Add a shard');
  assert.equal(third.youWill[2], 'press Add a shard and see how much data that would have moved');
});

test('the wrap-up\'s numbers: 70% busy, 75% of rows move from 3 to 4 shards', () => {
  assert.deepEqual(level.lesson.wrap.numbers, [
    ['70%', 'the most any shard should be busy'],
    ['75%', 'of rows move when 3 shards become 4 with key % N'],
  ]);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word ("50 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
