// Level 17's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ID_BYTES, POST_BYTES, FRIENDS, STAR, feedOutcome } from '../../js/engine/feed.js';
import { feedService, feedCache } from '../../js/engine/kinds/feed.js';
import { COMPONENTS } from '../../js/engine/catalog.js';
import level from '../../levels/level-17.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, p, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [fast, star, nye] = level.missions;
const SCOPE = 'Scope it: how big is everyone\'s feed?';

test('the scope example: 20 million users × 300 entries is 96 GB as IDs, 6 TB as whole posts', () => {
  // 20,000,000 × 300 × 16 bytes = 96,000,000,000 bytes = 96 GB; × 1,000 bytes = 6,000,000,000,000 bytes = 6 TB.
  assert.deepEqual([ID_BYTES, POST_BYTES], [16, 1000]);
  const calc = block(SCOPE, 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.label, r.work, r.result]), [
    ['IDs only', '20 million users × 300 entries × 16 bytes', '96 GB'],
    ['Whole posts', '20 million users × 300 entries × 1,000 bytes', '6 TB'],
  ]);
  assert.match(calc.result, /fits in 96 GB of memory\. .* would need 6 TB\.$/);
});

test('the scope example differs from the mission\'s estimate (15 million × 500 × 16 bytes = 120 GB)', () => {
  // 15,000,000 × 500 × 16 = 120,000,000,000 bytes = 120 GB.
  assert.deepEqual([fast.gate.lo, fast.gate.hi], [120, 120]);
  assert.equal(feedOutcome({ fanout: 'write', workers: 4, idsOnly: true }, { reads: 0, posts: 0 }).cacheGB, 120);
  assert.doesNotMatch(JSON.stringify(section(SCOPE)), /120 GB|7\.5 TB/);
});

test('the New part cards read the prices the engine charges: $300 + $100 a worker, $2 a GB', () => {
  // 4 workers: $300 + 4 × $100 = $700. IDs only: 120 GB × $2 = $240.
  const svc = { type: 'feedsvc', fanout: 'write', workers: '4', inactive: 'all' };
  const cache = { type: 'feedcache', store: 'ids' };
  assert.equal(feedService.cost(svc), 700);
  assert.equal(feedCache.cost(cache, null, [svc, cache]), 240);
  assert.deepEqual(first.newParts.map((c) => [c.type, c.game]), [
    ['feedsvc', '$300 a month, plus $100 for each fanout worker.'],
    ['feedcache', 'A managed cache, $2 a month for each GB.'],
  ]);
  assert.equal(COMPONENTS.feedsvc.cost, 300);
});

test('feed loads outnumber posts 20 to 1: 3,000 loads and 150 posts a second', () => {
  // writes = 150 ÷ 3,150 of the traffic; 3,000 ÷ 150 = 20.
  assert.equal(fast.qps, 3150);
  assert.equal(fast.qps * (1 - fast.writes) / (fast.qps * fast.writes), 20);
  assert.match(block('Should a feed be built when you post or when you read?', 'p'), /outnumber new posts 20 to 1 here/);
  assert.deepEqual(first.debrief.number, ['20 to 1', 'feed loads to new posts']);
});

test('the fanout and star examples: 200 × 250 = 50,000 writes a second; 2 million ÷ 50,000 = 40 s', () => {
  const writes = block('How does a post reach friends\' feeds?', 'calc');
  assert.deepEqual(writes.rows.map((r) => [r.work, r.result]), [['200 posts/s × 250 friends', '50,000 writes/s']]);
  const starCalc = block('Why does one star\'s post slow everyone down?', 'calc');
  assert.deepEqual(starCalc.rows.map((r) => [r.work, r.result]), [['2 million writes ÷ 50,000 writes/s', '40 s']]);
});

test('the story and cards name the game: 300 friends, a 5 million follower star, 200 GB, 5 s, $2,000, midnight doubles posts', () => {
  assert.equal(FRIENDS, 300);
  assert.equal(STAR, 5e6);
  assert.match(level.lesson.intro.story, /around 300 friends.* 5 million followers\.$/);
  assert.equal(first.debrief.next, 'A singer with 5 million followers is about to post.');
  assert.deepEqual([fast.budget, star.budget, nye.budget], [2000, 2000, 2000]);
  assert.deepEqual(first.youWill.slice(1), [
    'make feeds fast with the feed cache under 200 GB',
    'survive the dinner rush with Response under 150 ms, for at most $2,000 a month',
  ]);
  assert.ok(fast.gate, 'Mission 1 asks for an estimate before Play');
  assert.deepEqual(level.experiments.map((e) => e.label), ['Dinner rush', 'A star posts', 'Midnight']);
  assert.equal(second.youWill[1], 'switch to the hybrid so every post reaches friends\' feeds within 5 seconds');
  assert.deepEqual(second.debrief.number, ['5 s', 'the most a post may take to reach friends\' feeds']);
  // "double the posts": midnight multiplies posts by the workload's surge.
  assert.equal(level.workload.surge, 2);
  assert.equal(third.youWill[0], 'press Midnight to double the posts');
});

test('the wrap-up numbers: 16 bytes an entry, 20 to 1', () => {
  assert.deepEqual(level.lesson.wrap.numbers, [['16 bytes', 'for one feed entry: a post ID and an author ID'], ['20 to 1', 'feed loads to new posts']]);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
