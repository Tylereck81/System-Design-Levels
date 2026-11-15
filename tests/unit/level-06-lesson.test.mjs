// Level 6's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, T } from '../../js/engine/catalog.js';
import level from '../../levels/level-06.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
const calcOf = (title) => section(title).body.find((b) => b.calc).calc;

test('the new part card and the wrap-up give the catalog\'s session store: $150, 10,000 lookups/s, 3 ms', () => {
  const store = COMPONENTS.session;
  assert.deepEqual([store.cost, store.cap, store.base], [150, 10000, 3]);
  assert.equal(first.newParts[0].game, '$150 a month. Handles 10,000 lookups/s, 3 ms each.');
  assert.deepEqual(second.debrief.number, ['3 ms', 'added to a page for the session lookup']);
  assert.deepEqual(level.lesson.wrap.numbers[1], ['3 ms', 'for a session lookup, in the game']);
});

test('"the wrong server half the time": the missions start with two web servers taken in turn', () => {
  const webs = level.startNodes.filter((n) => n.type === 'web');
  const lbs = level.startNodes.filter((n) => n.type === 'lb');
  assert.equal(webs.length, 2); // round robin over 2 servers: every other page lands on the one without the cart
  assert.ok(lbs.every((n) => n.algo === 'rr'));
  assert.match(first.lead, /^Two web servers, one load balancer/);
});

test('the autoscaler\'s target is the game\'s 60%', () => {
  assert.equal(T.scaleAt, 0.6);
  assert.match(section('What does an autoscaler do?').body[1].p, /In the game the target is 60% busy/);
  assert.deepEqual(level.lesson.wrap.numbers[0], ['60%', 'how busy the autoscaler keeps each server, in the game']);
});

test('the worked example: 1,800 req/s on 800 req/s servers at 60% is 4 servers, and 1 at night', () => {
  // 800 × 0.6 = 480 req/s usable. 1,800 ÷ 480 = 3.75, rounded up to 4. At night 20%: 360 ÷ 480 = 0.75, so 1.
  const calc = calcOf('How many servers run at the peak?');
  assert.deepEqual(calc.rows.map((r) => r.result), ['480 req/s', '3.75, so 4 servers', '0.75, so 1 server']);
  assert.equal(calc.result, '4 servers in the evening and 1 at night, where a fixed design would run 4 all day.');
});

test('Check yourself: 2,000 req/s on 200 req/s servers at 60% is 17, with 10 and 16 as the wrong answers', () => {
  // 200 × 0.6 = 120 req/s usable. 2,000 ÷ 120 = 16.7, rounded up to 17. At 100% busy: 2,000 ÷ 200 = 10.
  const options = third.checks[0].options;
  assert.deepEqual(options.map((o) => o.t), ['10', '17', '16']);
  assert.equal(options.findIndex((o) => o.right), 1);
  assert.match(options[1].why, /2,000 ÷ 120 = 16\.7, rounded up\.$/);
});

test('the lesson\'s server counts are not answers the Mission 3 estimate accepts', () => {
  const { lo, hi } = level.missions[2].gate;
  for (const n of [4, 1, 10, 16, 17]) assert.ok(n < lo || n > hi, `${n} is inside the estimate's ${lo} to ${hi}`);
});

test('the day picture: traffic is lowest at 04:00 and highest at 20:00, as its alt text says', () => {
  const day = level.workload.day;
  assert.equal(day.indexOf(Math.min(...day)), 4);
  assert.equal(day.indexOf(Math.max(...day)), 20);
});

test('the mission cards name the goals the missions check: 99% served, $3,300, then $2,900, a 4,000 req/s peak', () => {
  const [carts, update, nights] = level.missions;
  assert.equal(level.targets.servedPct, 99);
  assert.deepEqual([carts.budget, update.budget, nights.budget], [3300, 3300, 2900]);
  assert.ok(level.missions.every((m) => m.qps === 4000));
  assert.ok(nights.gate, 'Mission 3 asks for an estimate before Play');
  assert.equal(first.youWill[2], 'keep Served at least 99% for at most $3,300 a month');
  assert.match(second.youWill[2], /for at most \$3,300 a month$/);
  assert.match(third.youWill[2], /the bill is at most \$2,900 a month$/);
  assert.match(second.debrief.next, /^Traffic peaks at 4,000 req\/s in the evening/);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word ("6 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
