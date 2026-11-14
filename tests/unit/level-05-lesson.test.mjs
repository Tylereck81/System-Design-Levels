// Level 5's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, T } from '../../js/engine/catalog.js';
import level from '../../levels/level-05.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
const calcOf = (title) => section(title).body.find((b) => b.calc).calc;
const prose = (title) => section(title).body.filter((b) => b.p).map((b) => b.p).join(' ');

test('the story\'s 30% of shoppers in America is every mission\'s share of far shoppers', () => {
  assert.ok(level.missions.every((m) => m.far === 0.3));
  assert.match(level.lesson.intro.story, /^The shop now sells in America, and 30% of your shoppers/);
});

test('"half of all requests are files": every mission sends half its requests as files', () => {
  assert.ok(level.missions.every((m) => m.files === 0.5));
  assert.match(level.lesson.last, /half of all requests are files/);
  assert.match(first.debrief.saw, /lost about half their traffic/);
});

test('the round trips the lesson names are the game\'s: 40 ms near Frankfurt, 120 ms from America', () => {
  assert.equal(T.rtt, 40);
  assert.equal(T.far, 120);
  assert.match(prose('Why is the shop slow for shoppers far away?'), /shoppers near Frankfurt are 40 ms away and shoppers in America 120 ms\./);
});

test('the new part card and the wrap-up price the CDN at the catalog\'s $0.02 per GB', () => {
  assert.equal(COMPONENTS.cdn.perGB, 0.02);
  assert.equal(first.newParts[0].game, '$0.02 for each GB it sends.');
  assert.deepEqual(first.debrief.number, ['$0.02 per GB', 'what the CDN charges for data sent']);
});

test('the cost example: 400 files/s of 30 KB is 12 MB/s, 1.04 TB a day, about 31 TB and $620 a month', () => {
  // 400 × 30 KB = 12,000 KB/s = 12 MB/s. 12 MB/s × 86,400 s = 1,036,800 MB = 1.04 TB a day.
  // 1.0368 TB × 30 = 31.1 TB, about 31 TB = 31,000 GB. 31,000 GB × $0.02 = $620.
  const calc = calcOf('How much does a CDN cost?');
  assert.deepEqual(calc.rows.map((r) => r.result), ['12 MB/s', '1.04 TB', '31 TB', '$620 a month']);
  assert.match(calc.result, /^About 31 TB and \$620 a month\./);
});

test('Check yourself: 10 TB at $0.02 per GB is $200, with $0.2 and $2,000 as the wrong answers', () => {
  // 10 TB = 10,000 GB; 10,000 × $0.02 = $200.
  const options = first.checks[0].options;
  assert.deepEqual(options.map((o) => o.t), ['$0.2', '$200', '$2,000']);
  assert.equal(options.findIndex((o) => o.right), 1);
});

test('the mission cards name the goals the missions check: files under 60 ms, $3,100, Response under 150 ms', () => {
  const far = level.missions[0].goals.find((g) => g.id === 'far');
  assert.equal(far.test({ farFileMs: 59.9 }), true);
  assert.equal(far.test({ farFileMs: 60 }), false);
  assert.ok(level.missions.every((m) => m.budget === 3100));
  assert.equal(level.targets.latencyMs, 150);
  assert.match(first.youWill[2], /under 60 ms$/);
  assert.match(first.youWill[3], /\$3,100 a month with Response under 150 ms$/);
  assert.match(second.youWill[2], /at most \$3,100 a month$/);
  assert.match(third.youWill[0], /under 60 ms/);
  assert.deepEqual(second.debrief.number, ['99%', 'still served with the CDN down']);
});

test('"within 1 minute": the new logo passes at 60 seconds stale and not after', () => {
  const logo = level.experiments.find((e) => e.id === 'new-logo');
  assert.equal(logo.expect({ fileStaleSecs: 60 }), true);
  assert.equal(logo.expect({ fileStaleSecs: 600 }), false);
  assert.match(third.youWill[1], /within 1 minute$/);
  assert.match(second.debrief.next, /within 1 minute\.$/);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word ("6 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
