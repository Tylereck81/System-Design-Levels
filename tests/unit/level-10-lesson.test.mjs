// Level 10's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, T } from '../../js/engine/catalog.js';
import { limiterRule } from '../../js/engine/kinds/limiter.js';
import level from '../../levels/level-10.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, table, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [flood, edge, botnet] = level.missions;
/** A limiter node with these settings, as the inspector stores them. */
const limiter = (algo, bucket = '12', refill = '1') => ({ type: 'limiter', algo, bucket, refill });

test('the story: the API servers are autoscaled, so serving bots costs money', () => {
  assert.ok(level.startNodes.filter((n) => n.type === 'web').every((n) => n.scaling === 'auto'));
  assert.match(level.lesson.intro.story, /your autoscaled servers grow to serve them at your expense/);
});

test('the new part cards: a limiter is $100 and checks 6,000 req/s at 60 a minute a key; counters are $60, 50,000 ops/s', () => {
  assert.deepEqual([COMPONENTS.limiter.cost, COMPONENTS.limiter.cap, T.keyLimit], [100, 6000, 1]); // 1 a second × 60 = 60 a minute
  assert.equal(first.newParts[0].game, '$100 a month. Checks 6,000 req/s. The limit is 60 requests a minute for each key.');
  assert.deepEqual([COMPONENTS.counter.cost, COMPONENTS.counter.cap], [60, 50000]);
  assert.equal(third.newParts[0].game, '$60 a month. Handles 50,000 operations/s.');
});

test('the token bucket example: a full bucket of 10 passes 10 of 16, refuses 6, then 2 a second = 120 a minute', () => {
  const calc = block('How does a token bucket work?', 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.work, r.result]), [
    ['10 tokens in the bucket', '10 requests'],
    ['16 requests − 10 requests', '6 requests'],
    ['2 tokens/s', '120 requests a minute'],
  ]);
});

test('Check yourself: an empty bucket of 8 at 1 a second has 3 tokens after 3 seconds; filling it takes 8 seconds', () => {
  const options = first.checks[0].options;
  assert.deepEqual(options.map((o) => o.t), ['3', '8', '0']);
  assert.equal(options.findIndex((o) => o.right), 0);
  assert.match(options[1].why, /^It takes 8 seconds/);
  // The quiz's bucket is 5 at 1 a second, the mission's 12 at 1 a second: none of them is the lesson's 10 at 2.
  assert.match(level.quiz.questions[3].q, /holds 5 tokens and gets 1 more a second/);
});

test('Mission 1: a typed search is 12 requests in 2 seconds; a bucket of 12 lets it through and one of 4 does not', () => {
  assert.deepEqual([T.burst, T.burstSecs], [12, 2]);
  assert.equal(limiterRule(limiter('token', '12'), false).fb, 0); // 12 − 12 − 1 × 2 < 0: nothing blocked
  assert.equal(limiterRule(limiter('token', '4'), false).fb, 0.5); // (12 − 4 − 1 × 2) ÷ 12 = 6 ÷ 12
  assert.deepEqual(first.debrief.number, ['60 a minute', 'the most each key may send']);
});

test('the window edge: a fixed window passes twice the limit there, and a token bucket its bucket on top', () => {
  assert.equal(limiterRule(limiter('fixed'), true).q, 2);
  assert.equal(limiterRule(limiter('token', '12'), true).q, 1.2); // (12 + 60 × 1) ÷ 60
  for (const algo of ['slog', 'scount']) assert.equal(limiterRule(limiter(algo), true).q, 1);
  const p = section('How do bots get past a fixed window?').body.find((b) => b.p).p;
  assert.match(p, /^Each minute's counter says 100, so nothing is refused\. But 200 requests arrived in two seconds/);
  assert.deepEqual(second.debrief.number, ['2×', 'what a fixed window can pass at a window edge']);
  assert.equal(level.experiments[0].label, 'Burst at the window edge');
  assert.equal(second.youWill[0], 'press Burst at the window edge and watch what each algorithm lets through');
});

test('the sliding window counter example: 30 + 80 × 0.75 = 90, under 100 (the quiz uses 10, 6, 4 and 40%)', () => {
  const calc = block('How does a sliding window close the gap?', 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.work, r.result]), [
    ['100% − 25% into this minute', '75%'],
    ['30 requests + 80 requests × 0.75', '90 requests'],
  ]);
  assert.equal(calc.result, '90 is under the limit of 100, so the request passes.');
});

test('how many limiters: 700 × 20 = 14,000, + 4,500 = 18,500, ÷ 6,000 = 3.1, so 4; not an answer Mission 3 accepts', () => {
  const calc = block('How many rate limiters do you need?', 'calc');
  assert.deepEqual(calc.rows.map((r) => r.result), ['14,000 req/s', '18,500 req/s', '3.1, so 4 limiters']);
  const { lo, hi } = botnet.gate;
  assert.ok(4 > hi && 3.1 > hi, `the lesson's count is inside the estimate's ${lo} to ${hi}`);
});

test('Mission 3: the botnet is 400 keys at 22 a second, more than one limiter checks: 2,000 + 8,800 = 10,800 > 6,000', () => {
  assert.deepEqual(botnet.bot, { keys: 400, rate: 22 });
  assert.equal(second.debrief.next, 'A botnet is coming: 400 keys, 22 requests a second each. One limiter cannot check that many.');
  assert.ok(botnet.qps + botnet.bot.keys * botnet.bot.rate > COMPONENTS.limiter.cap);
});

test('shared counters: two limiters with their own counts give each key 60 × 2 = 120 a minute', () => {
  const p = section('Why must rate limiters share their counters?').body[0].p;
  assert.match(p, /allows the full 60 a minute\. The key gets 120\./);
  assert.match(botnet.story, /every key gets 120/);
});

test('the mission cards name what the missions check: 60 a minute, 150 ms, $2,100, $2,100, $2,300', () => {
  assert.equal(level.targets.latencyMs, 150);
  assert.deepEqual([flood.budget, edge.budget, botnet.budget], [2100, 2100, 2300]);
  assert.equal(flood.goals.find((g) => g.id === 'quota').text, 'No API key gets more than 60 requests a minute');
  assert.equal(first.youWill[2], 'keep Response under 150 ms for at most $2,100 a month');
  assert.equal(second.youWill[2], 'stay within $2,100 a month');
  assert.equal(third.youWill[2], 'hold every key to 60 requests a minute through the edge burst, for at most $2,300 a month');
  assert.ok(botnet.gate, 'Mission 3 asks for an estimate before Play');
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word ("50 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
