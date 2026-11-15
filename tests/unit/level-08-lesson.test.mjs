// Level 8's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, T } from '../../js/engine/catalog.js';
import level from '../../levels/level-08.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
const [slow, deploy, rush] = level.missions;

test('"a thousand times more": an upload is 20 s of one vCPU, a page 20 ms of a web server', () => {
  // 20,000 ms ÷ 20 ms = 1,000.
  assert.equal(T.job, 20000);
  assert.equal(T.web, 20);
  assert.equal(T.job / T.web, 1000);
  assert.equal(section('Why does one slow job hurt everyone?').hook, 'A page takes a web server 20 ms of work. An upload takes 20 seconds: a thousand times more.');
});

test('"which takes milliseconds": publishing a message takes 2 ms', () => {
  assert.equal(T.publish, 2);
  assert.match(section('What does a message queue do?').body[2].p, /which takes milliseconds/);
});

test('the new part cards give the catalog\'s queue, workers and monitoring: $50, 10,000 messages/s, four sizes from 2 to 16 vCPUs, $30', () => {
  assert.deepEqual(Object.keys(COMPONENTS.worker.sizes), ['S', 'M', 'L', 'XL']);
  assert.deepEqual(first.newParts.map((c) => c.game), [
    '$50 a month. Takes 10,000 messages/s.',
    'Four sizes, from 2 to 16 vCPUs. One upload takes 20 seconds of one vCPU.',
  ]);
  assert.equal(second.newParts[0].game, '$30 a month. Connect it to the queue.');
});

test('the sizing example: 2 jobs/s × 6 s = 12 vCPUs, and 12 ÷ 4 = 3 workers with 4 vCPUs', () => {
  assert.equal(COMPONENTS.worker.sizes.M.cpu, 4);
  const calc = section('How many workers keep up?').body[0].calc;
  assert.deepEqual(calc.rows.map((r) => r.work), ['2 jobs/s × 6 s each', '12 vCPUs ÷ 4 vCPUs']);
  assert.deepEqual(calc.rows.map((r) => r.result), ['12 vCPUs', '3 workers']);
});

test('Check yourself: 0.5 jobs/s × 30 s = 15 vCPUs; 30 and 60 (30 ÷ 0.5) are wrong', () => {
  const options = first.checks[0].options;
  assert.deepEqual(options.map((o) => o.t), ['30 vCPUs', '15 vCPUs', '60 vCPUs']);
  assert.equal(options.findIndex((o) => o.right), 1);
});

test('the backlog example: 3 − 2 = 1 job/s, 3,600 after an hour, 3,600 ÷ 2 = 1,800 s = 30 minutes', () => {
  const calc = section('What does the length of the queue tell you?').body[0].calc;
  assert.deepEqual(calc.rows.map((r) => r.work), ['3 jobs/s − 2 jobs/s', '1 job/s × 3,600 s', '3,600 jobs ÷ 2 jobs/s']);
  assert.deepEqual(calc.rows.map((r) => r.result), ['1 job/s', '3,600 jobs waiting', '1,800 s = 30 minutes']);
  assert.equal(calc.result, 'After one hour, a new upload waits 30 minutes, and it gets worse every second.');
});

test('the lesson\'s vCPU counts are not answers the Mission 1 estimate accepts', () => {
  const { lo, hi } = slow.gate;
  for (const n of [12, 15, 30, 60]) assert.ok(n < lo || n > hi, `${n} is inside the estimate's ${lo} to ${hi}`);
});

test('the mission cards name what the missions check: the estimate, under 1 second, under 150 ms, $2,300', () => {
  assert.ok(slow.gate, 'Mission 1 asks for an estimate before Play');
  assert.equal(slow.goals.find((g) => g.id === 'upload').text, 'Creators hear back in under 1 second');
  assert.equal(level.targets.latencyMs, 150);
  assert.deepEqual([slow.budget, deploy.budget, rush.budget], [2300, 2300, 2300]);
  assert.equal(first.youWill[2], 'get creators an answer in under 1 second, with Response under 150 ms for everyone else');
  assert.equal(first.youWill[3], 'stay within $2,300 a month');
  assert.equal(third.youWill[2], 'stay within $2,300 a month');
  assert.ok(level.connections.ok['queue|web'] && level.connections.ok['queue|worker'], 'web servers → queue → workers');
  assert.deepEqual(first.debrief.number, ['20 vCPUs', 'busy for every upload a second']); // 1 upload/s × 20 s
});

test('Mission 2: monitoring on the queue and a crash of every worker are goals', () => {
  assert.ok(deploy.goals.some((g) => g.id === 'watch'));
  assert.ok(deploy.goals.some((g) => g.id === 'crash-workers'));
  assert.equal(level.connections.ok['monitor|queue'].to, 'queue');
});

test('"three times as many" and "triple the uploads": the Monday rush multiplies uploads by 3', () => {
  assert.equal(level.experiments.find((e) => e.id === 'upload-rush').uploadFactor, 3);
  assert.ok(rush.goals.some((g) => g.id === 'upload-rush'));
  assert.match(second.debrief.next, /three times as many episodes/);
  assert.match(third.youWill[1], /triple the uploads/);
});

test('"a group grows to at most 10 workers": the autoscaled choice runs 1 to 10', () => {
  assert.equal(T.maxCopies, 10);
  const auto = level.components.worker.choices[0].options.find((o) => o.id === 'auto');
  assert.equal(auto.sub, '1 to 10, by queue');
  assert.equal(section('How to let the workers follow the queue').body[1].assume, 'In the game a group grows to at most 10 workers, so the size you pick still matters.');
});

test('the wrap-up\'s numbers: 20 seconds an upload, 3,600 seconds an hour', () => {
  assert.deepEqual(level.lesson.wrap.numbers, [
    ['20 seconds', 'of one vCPU to process an upload, in the game'],
    ['3,600', 'seconds in an hour, for turning a rate into a backlog'],
  ]);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word ("6 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
