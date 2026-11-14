// Level 4's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, SIZES, T } from '../../js/engine/catalog.js';
import level from '../../levels/level-04.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
const calcOf = (title) => section(title).body.find((b) => b.calc).calc;
/** The paragraphs of a section, joined, for checking a sentence wherever it sits. */
const prose = (title) => section(title).body.filter((b) => b.p).map((b) => b.p).join(' ');
const hitGoalOf = (i) => level.missions[i].goals.find((g) => g.id === 'hit');

test('"each replica costs as much as your largest server": the level starts on XL replicas, the largest size', () => {
  const sizes = Object.keys(SIZES);
  const replicas = level.startNodes.filter((n) => n.role === 'replica');
  assert.ok(replicas.length > 0 && replicas.every((n) => n.size === sizes[sizes.length - 1]));
  assert.match(level.lesson.intro.story, /costs as much as your largest server/);
});

test('the new part card: every cache size handles the same lookups, in a fraction of a millisecond', () => {
  const sizes = Object.values(COMPONENTS.cache.sizes);
  assert.ok(sizes.every((s) => s.cap === sizes[0].cap)); // "Each handles 10,000 lookups/s"
  assert.ok(T.cache < 1);
  assert.equal(first.newParts[0].game, '4 memory sizes, from 2 GB for $20 a month. Each handles 10,000 lookups/s.');
});

test('memory against disk: 10 ms is 100,000 times 100 ns', () => {
  // 10 ms = 10,000,000 ns; 10,000,000 ÷ 100 = 100,000.
  assert.match(prose('How does a web server use a cache?'), /about 100 nanoseconds, and finding data on a disk about 10 milliseconds, which is 100,000 times longer\./);
});

test('the sizing example: a quarter of 2,400 reads, and 3 GB for the hot 20% of 500,000 articles', () => {
  // 2,400 × (1 − 0.75) = 600, a quarter. 500,000 × 20% = 100,000; 100,000 × 30 KB = 3,000,000 KB = 3 GB.
  const calc = calcOf('How to size a cache');
  assert.deepEqual(calc.rows.map((r) => r.result), ['600 reads/s', '100,000 articles', '3 GB']);
  assert.match(calc.result, /^At a 75% hit rate the database sees a quarter of the reads\./);
});

test('the game\'s catalog follows the 80/20 rule the lesson states: 20% of it is the 4 GB the first mission accepts', () => {
  // 20 GB catalog × 20% = 4 GB, inside the estimate's accepted range.
  const { lo, hi } = level.missions[0].gate;
  const hot = level.workload.catalogGB * 0.2;
  assert.ok(hot >= lo && hot <= hi);
  assert.match(prose('What belongs in a cache?'), /80% of reads go to 20% of the items\./);
});

test('the hit-rate goals the mission cards name are the ones the missions check', () => {
  assert.deepEqual([0, 1, 2].map((i) => hitGoalOf(i).text), ['Cache hit rate at least 80%', 'Cache hit rate at least 80%', 'Cache hit rate at least 86%']);
  assert.match(first.youWill[2], /at least 80% for at most \$2,100 a month/);
  assert.match(third.youWill[0], /at least 86%/);
  // At 80% hits, 1 read in 1 ÷ (1 − 0.8) = 5 reaches the database.
  assert.deepEqual(first.debrief.number, ['80% hit rate', 'only 1 read in 5 reached the database']);
});

test('losing one of two caches: 2,000 reads at 90% hits send 200, then 1,100, and 2,000 with a single cache', () => {
  // 2,000 × 0.1 = 200; one cache lost halves the hit rate: 2,000 × (1 − 0.45) = 1,100; no cache: 2,000.
  // These are our example's numbers; that the game also halves the hit rate is pinned in tests/e2e/level-04.spec.js
  // ("with two caches, losing one halves the hit rate and the replica copes").
  const calc = calcOf('How to survive losing a cache');
  assert.deepEqual(calc.rows.map((r) => r.result), ['200 reads/s to the database', '1,100 reads/s to the database', '2,000 reads/s to the database']);
});

test('"which a short TTL cannot give": a 1-minute TTL caps the hit rate below 86%, a 10-minute one does not', () => {
  // A cached product is read every 10 s, so a share TTL ÷ (TTL + 10) of its reads find it fresh: 60 ÷ 70 = 85.7%.
  const cap = (ttl) => ttl / (ttl + level.workload.readGapSecs);
  assert.ok(cap(60) < 0.86);
  assert.ok(cap(600) > 0.86);
});

test('"within 1 minute": the flash sale passes at 60 seconds stale and not after', () => {
  const sale = level.experiments.find((e) => e.id === 'price-change');
  assert.equal(sale.expect({ staleSecs: 60 }), true);
  assert.equal(sale.expect({ staleSecs: 600 }), false);
  assert.match(third.youWill[1], /within 1 minute$/);
  assert.match(second.debrief.next, /change 300 prices/);
  assert.match(sale.on, /300 product prices/);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word ("6 million")', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
