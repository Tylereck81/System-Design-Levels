// Level 7's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, T } from '../../js/engine/catalog.js';
import level from '../../levels/level-07.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
const [pages, dark] = level.missions;

test('the new part card gives the catalog\'s data center: three sizes, 50 ms a page', () => {
  assert.deepEqual(Object.keys(COMPONENTS.dc.sizes), ['S', 'M', 'L']);
  assert.equal(T.dcPage, 50);
  assert.equal(first.newParts[0].game, 'Three sizes. A page takes about 50 ms inside it.');
});

test('"150 ms in real life, 120 ms in the game": the game\'s ocean round trip is 120 ms', () => {
  assert.equal(T.far, 120);
  assert.match(section('Why are pages still slow in America?').body[0].p, /about 150 ms in real life, 120 ms in the game/);
  assert.deepEqual(level.lesson.wrap.numbers[0], ['150 ms', 'a round trip across an ocean']);
});

test('"about 1 second later": data copied between data centers runs 1 second behind in the game', () => {
  assert.equal(T.dcLag, 1);
  assert.match(section('Why can the newest changes be missing?').body[1].p, /In the game it arrives about 1 second later\.$/);
  assert.deepEqual(level.lesson.wrap.numbers[1], ['1 second', 'for a change to reach the other data center, in the game']);
});

test('the start design is one L data center in Frankfurt with plain DNS, so a smaller Frankfurt and GeoDNS are steps the player takes', () => {
  const dcs = level.startNodes.filter((n) => n.type === 'dc');
  assert.deepEqual(dcs.map((n) => [n.region, n.size]), [['near', 'L']]);
  assert.equal(level.startNodes.find((n) => n.type === 'dns').routing, 'rr');
  assert.match(level.lesson.intro.story, /^Everything you have built stands in one building in Frankfurt\./);
});

test('the worked example: 1,650 + 1,350 pages/s is 55% and 45% of 3,000, and the survivor carries all 3,000', () => {
  // 3,000 × 55% = 1,650; 3,000 × 45% = 1,350; 1,650 + 1,350 = 3,000.
  const calc = section('How big must the surviving data center be?').body[0].calc;
  assert.deepEqual(calc.rows.map((r) => r.work), ['3,000 pages/s × 55%', '3,000 pages/s × 45%', '1,650 pages/s + 1,350 pages/s']);
  assert.deepEqual(calc.rows.map((r) => r.result), ['1,650 pages/s', '1,350 pages/s', '3,000 pages/s']);
  assert.equal(calc.result, 'Whichever one survives must carry all 3,000 pages a second.');
});

test('Check yourself: 7,500 pages/s over three data centers, one down, is 3,750 each; 2,500 and 7,500 are wrong', () => {
  // Normally 7,500 ÷ 3 = 2,500 each. With one down: 7,500 ÷ 2 = 3,750 each.
  const options = second.checks[0].options;
  assert.deepEqual(options.map((o) => o.t), ['2,500 pages/s', '3,750 pages/s', '7,500 pages/s']);
  assert.equal(options.findIndex((o) => o.right), 1);
});

test('the lesson\'s page counts are not answers the Mission 2 estimate accepts', () => {
  const { lo, hi } = dark.gate;
  for (const n of [1650, 1350, 3000, 2500, 3750, 7500]) assert.ok(n < lo || n > hi, `${n} is inside the estimate's ${lo} to ${hi}`);
});

test('the mission cards name the goals the missions check: under 100 ms, $3,100, then $3,500; 30% in America', () => {
  assert.equal(pages.goals[0].id, 'far-page');
  assert.equal(pages.goals[0].text, 'Pages reach shoppers in America in under 100 ms');
  assert.deepEqual([pages.budget, dark.budget], [3100, 3500]);
  assert.equal(first.youWill[2], 'get pages to shoppers in America in under 100 ms');
  assert.equal(first.youWill[3], 'resize Frankfurt for Europe alone, for at most $3,100 a month');
  assert.equal(second.youWill[3], 'finish with no single point of failure, for at most $3,500 a month');
  assert.ok(dark.gate, 'Mission 2 asks for an estimate before Play');
  assert.ok(dark.goals.some((g) => g.id === 'spof'));
  assert.equal(pages.far, 0.3);
  assert.deepEqual(first.debrief.number, ['30%', 'of shoppers are in America']);
});

test('"In the game the switch is immediate": GeoDNS is a routing setting, with no TTL to wait for', () => {
  const geo = level.components.dns.choices[0].options.find((o) => o.id === 'geo');
  assert.match(geo.note, /sends everyone to the healthy one when the other is down/);
  assert.match(section('What must be true for a failover to work?').body[1].p, /In the game the switch is immediate\.$/);
});

test('the wrap-up leads to Level 8: an upload takes 20 seconds of work', () => {
  assert.equal(T.job, 20000); // ms of one vCPU per upload
  assert.match(level.lesson.wrap.broken, /takes 20 seconds to process/);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word ("6 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
