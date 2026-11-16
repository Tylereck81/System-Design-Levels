// Level 14's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREATE_QUERIES } from '../../js/engine/links.js';
import level from '../../levels/level-14.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, p, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [shortLinks, count, priv] = level.missions;
const SCOPE = 'Scope it: how long must a short code be?';

test('the scope example: 25 million a day × 365 × 5 years ≈ 45.6 billion links; 62⁵ is too few, 62⁶ enough', () => {
  assert.equal(25e6 * 365 * 5, 45_625_000_000);
  assert.equal(62 ** 5, 916_132_832);
  assert.equal(62 ** 6, 56_800_235_584);
  const calc = block(SCOPE, 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.label, r.work, r.result]), [
    ['Links in all', '25 million a day × 365 days × 5 years', '45.6 billion links'],
    ['5 characters', '62 to the power 5', '916 million codes: too few'],
    ['6 characters', '62 to the power 6', '56.8 billion codes: enough'],
  ]);
  assert.ok(calc.rows.every((r) => r.approx), 'each result is rounded, so it is shown with ≈');
  assert.match(calc.result, /^Six characters hold every link for 5 years\./);
});

test('the load: 25 million ÷ 86,400 ≈ 289 new links a second, × 10 = 2,890 clicks; the game has 10 clicks a link', () => {
  assert.equal(Math.round(25e6 / 86400), 289);
  assert.match(block(SCOPE, 'p'), /about 289 a second\. With clicks to new links at 10 to 1, that is about 2,890 clicks a second\./);
  // 1 request in 11 is a new link: 10 clicks for each.
  for (const m of [shortLinks, count]) assert.equal(m.writes, 1 / 11);
  assert.deepEqual(first.debrief.number, ['10 to 1', 'clicks to new links']);
});

test('Check yourself: 2 billion links need 6 characters (the mission\'s 219 billion need 7)', () => {
  // 62⁵ = 916,132,832 is under 2 billion; 62⁶ = 56,800,235,584 is over it.
  assert.equal(first.checks[0].options.find((o) => o.right).t, '6');
  assert.match(shortLinks.gate.prompt, /about 219 billion in all/);
  assert.deepEqual([shortLinks.gate.lo, shortLinks.gate.hi], [7, 7]);
});

test('base 62: 12345 = 3 × 62² + 13 × 62 + 7 → "3d7", and 12346 → "3d8"; the quiz uses 20000', () => {
  assert.equal(3 * 62 ** 2 + 13 * 62 + 7, 12345);
  const calc = block('How to turn an ID into a short code', 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.work, r.result]), [
    ['ID 12,345 ÷ 62', '199, remainder 7 → 7'],
    ['what is left, 199 ÷ 62', '3, remainder 13 → d'],
    ['what is left, 3 ÷ 62', '0, remainder 3 → 3'],
  ]);
  assert.equal(calc.result, 'ID 12,345 becomes the code "3d7".');
  assert.match(section('How do you make codes nobody can guess?').hook, /after "3d7" comes "3d8"/);
  assert.match(level.quiz.questions[3].q, /20000/);
});

test('a hash keeps 7 characters, a database check doubles the queries for a new link, a Bloom filter does not', () => {
  assert.deepEqual(CREATE_QUERIES, { base62: 1, hash: 2, bloom: 1.01 });
  const code = level.components.web.choices.find((c) => c.key === 'code');
  assert.equal(code.options.find((o) => o.id === 'hash').sub, 'first 7 characters');
  assert.match(section('How do you make codes nobody can guess?').body.find((b) => b.p).p, /Keep its first 7 characters\./);
});

test('the mission cards name what the missions check: 99% served, 150 ms, $1,300, the Break it buttons', () => {
  assert.deepEqual([shortLinks.budget, count.budget, priv.budget], [1300, 1300, 1300]);
  assert.deepEqual(level.experiments.map((e) => e.label), ['A link goes viral', 'A script creates links']);
  assert.ok(shortLinks.gate, 'Mission 1 asks for an estimate before Play');
  assert.deepEqual(first.youWill.slice(2), ['let a link go viral and keep Served at least 99%', 'stay within $1,300 a month']);
  assert.deepEqual(second.youWill.slice(1), ['press A script creates links and keep the service up with a per-account limit', 'stay within $1,300 a month']);
  assert.equal(third.youWill[2], 'let a link go viral and keep Response under 150 ms, for at most $1,300 a month');
  assert.equal(priv.goals.find((g) => g.id === 'lat').text, 'Response time under 150 ms');
});

test('the wrap-up numbers: 62 characters, 56.8 billion codes of 6, 10 clicks to a new link', () => {
  assert.deepEqual(level.lesson.wrap.numbers, [
    ['62', 'characters a code can use'],
    ['56.8 billion', 'codes of 6 characters'],
    ['10 to 1', 'clicks to new links'],
  ]);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
