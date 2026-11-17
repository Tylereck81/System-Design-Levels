// Level 16's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARES, SEND_MS, OPT_OUT, notifyOutcome } from '../../js/engine/notify.js';
import { COMPONENTS } from '../../js/engine/catalog.js';
import level from '../../levels/level-16.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, p, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [channels, respect, never] = level.missions;
const SCOPE = 'Scope it: how many notifications a second?';

test('the scope example: 8 + 3 + 4 = 15 million a day, about 174 a second, 348 at the peak, 4 workers then 5', () => {
  // 15,000,000 ÷ 86,400 = 173.6, about 174; 174 × 2 = 348; 348 ÷ 100 a worker = 3.48, so 4 workers, and 5 to spare.
  assert.equal(Math.round(15e6 / 86400), 174);
  assert.equal(COMPONENTS.nworker.cap, 100);
  const calc = block(SCOPE, 'calc');
  assert.equal(calc.formula, 'Rate = notifications a day ÷ 86,400, then × 2 for the peak.');
  assert.deepEqual(calc.rows.map((r) => [r.label, r.work, r.result]), [
    ['A day', '8 million + 3 million + 4 million', '15 million notifications'],
    ['Average', '15 million ÷ 86,400 s', '174 a second'],
    ['Peak', '174 a second × 2', '348 a second'],
  ]);
  assert.equal(calc.result, 'Plan for about 348 a second. At 100 a second for each worker, 4 workers only just keep up; plan 5.');
});

test('the scope example differs from the mission (20 million a day, about 231 a second)', () => {
  // 12 + 2 + 6 = 20 million; 20,000,000 ÷ 86,400 = 231.5.
  assert.deepEqual([channels.gate.lo, channels.gate.hi], [230, 232]);
  assert.doesNotMatch(block(SCOPE, 'calc').result, /231|463/);
});

test('the New part cards read the catalog: server $150, 2,000 requests/s; queues $50; workers $90, 100 a second', () => {
  // A worker sends one notification at a time, 10 ms each: 1,000 ÷ 10 = 100 a second.
  assert.equal(1000 / SEND_MS, 100);
  assert.deepEqual(first.newParts.map((c) => [c.type, c.game]), [
    ['notifier', '$150 a month. Takes 2,000 requests/s.'],
    ['nqueue', '$50 a month.'],
    ['nworker', '$90 a month each. Sends 100 a second.'],
    ['provider', 'No monthly cost here.'],
  ]);
  assert.equal(COMPONENTS.provider.cost, 0);
});

test('a queue per channel: three queues; an SMS outage leaves push and email on time', () => {
  assert.equal(Object.keys(SHARES).length, 3);
  assert.deepEqual(first.debrief.number, ['3 queues', 'one per channel']);
  // 5 workers on a queue per channel, the SMS provider down: every push and email still goes out.
  assert.equal(notifyOutcome({ perChannel: true, workers: 5 }, { rate: 460, smsDown: true }).others, 1);
});

test('opt-outs: 5% of requests, skipped by the check', () => {
  assert.equal(OPT_OUT, 0.05);
  assert.match(first.debrief.next, /^5% of requests are for users who switched that channel off/);
  assert.match(section('Who decides whether a user gets a notification?').hook, /Here 5% of requests/);
  assert.deepEqual(second.debrief.number, ['5%', 'of requests skipped because the user opted out']);
  assert.equal(notifyOutcome({ workers: 5, check: true }, { rate: 460 }).optSent, 0);
});

test('the mission cards name what the missions check: 99% on time, $700, the Break it buttons', () => {
  assert.deepEqual([channels.budget, respect.budget, never.budget], [700, 700, 700]);
  assert.equal(level.targets.servedPct, 99);
  assert.deepEqual(level.experiments.map((e) => e.label), ['SMS provider goes down', 'Marketing sends a blast', 'Workers crash']);
  assert.ok(channels.gate, 'Mission 1 asks for an estimate before Play');
  assert.deepEqual(first.youWill.slice(1), [
    'connect notification servers, queues, workers and providers, and send 99% on time',
    'take the SMS provider down: push and email must stay on time',
    'stay within $700 a month',
  ]);
  assert.equal(second.youWill[2], 'stay within $700 a month');
  assert.equal(third.youWill[2], 'stay within $700 a month');
});

test('the wrap-up numbers: 86,400 seconds in a day, 5% opted out', () => {
  assert.deepEqual(level.lesson.wrap.numbers, [['86,400', 'seconds in a day'], ['5%', 'of requests were for users who opted out']]);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
