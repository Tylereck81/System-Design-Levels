// Level 19's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_HIT, API_CAP, SHARD_CAP, LETTER_TOP, typeaheadOutcome } from '../../js/engine/typeahead.js';
import { COMPONENTS } from '../../js/engine/catalog.js';
import level from '../../levels/level-19.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, p, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [under, uneven, trend] = level.missions;
const SCOPE = 'Scope it: how many requests does typing make?';
const CUT = 'How to cut the requests that reach you';

test('the scope example: 8 million × 6 searches × 20 characters is about 11,111 a second, 22,222 at the peak', () => {
  // 8,000,000 × 6 × 20 = 960,000,000 a day. 960,000,000 ÷ 86,400 = 11,111.1, so 11,111; × 2 = 22,222.
  const calc = block(SCOPE, 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.label, r.work, r.result]), [
    ['A day', '8 million × 6 searches × 20 characters', '960 million requests'],
    ['Average', '960 million requests ÷ 86,400 s', '11,111 req/s'],
    ['Peak', '11,111 req/s × 2', '22,222 req/s'],
  ]);
  assert.equal(calc.result, 'About 22,222 requests a second at peak: every character typed is a request.');
  assert.match(section(SCOPE).hook, /top 5, .* 8 million users who search 6 times a day and type 20 characters each time\.$/);
});

test('the scope example differs from the mission\'s estimate (12 million × 8 × 25 ≈ 27,800)', () => {
  // 12,000,000 × 8 × 25 = 2,400,000,000 a day ÷ 86,400 = 27,778, inside the accepted 27,000 to 28,500.
  assert.ok(under.gate.lo <= 27778 && 27778 <= under.gate.hi);
  assert.doesNotMatch(JSON.stringify(section(SCOPE)), /12 million|27,8|55,6/);
});

test('Check yourself: 5 million × 10 × 20 ÷ 86,400 is about 11,600, not the lesson\'s or the mission\'s number', () => {
  // 5,000,000 × 10 × 20 = 1,000,000,000 a day ÷ 86,400 = 11,574, about 11,600. Searches alone: 50,000,000 ÷ 86,400 = 579.
  const [estimate] = first.checks;
  assert.equal(estimate.options.find((o) => o.right).t, 'About 11,600');
  assert.equal(Math.round(5e6 * 10 * 20 / 86400 / 100) * 100, 11600);
  assert.equal(Math.round(5e6 * 10 / 86400 / 10) * 10, 580);
});

test('the New part cards read the catalog: API servers $200 and 12,000 requests/s, trie shards $300 and 25,000 lookups/s', () => {
  assert.deepEqual([COMPONENTS.tapi.cost, API_CAP, COMPONENTS.trie.cost, SHARD_CAP], [200, 12000, 300, 25000]);
  assert.deepEqual(first.newParts.map((c) => [c.type, c.game]), [
    ['tapi', '$200 a month each. Handle 12,000 requests/s.'],
    ['trie', '$300 a month for each shard. 25,000 lookups/s each.'],
  ]);
});

test('"under 100 ms" is the latency goal, and browsers answer 30% of keystrokes', () => {
  assert.equal(level.targets.latencyMs, 100);
  assert.match(level.lesson.intro.story, /in under 100 ms,/);
  assert.equal(first.youWill[1], 'get suggestions out in under 100 ms');
  // 30% answered by the browser: 1,000 keystrokes, 700 reach the servers.
  assert.equal(BROWSER_HIT, 0.3);
  assert.equal(typeaheadOutcome({ browser: true, apis: 1, method: 'topk', shards: 1, map: true, rebuild: 'weekly' }, { qps: 1000 }).reach, 700);
  assert.equal(block(CUT, 'p'), 'In the game, browser caching saves about 30% of keystrokes.');
  assert.deepEqual(first.debrief.number, ['30%', 'of keystrokes answered by the browser']);
});

test('the mission cards: $2,400, $2,400 and $2,700 a month, election night 1.6×', () => {
  assert.deepEqual([under.budget, uneven.budget, trend.budget], [2400, 2400, 2700]);
  assert.equal(first.youWill[3], 'stay within $2,400 a month');
  assert.equal(second.youWill[2], 'survive election night for at most $2,400 a month');
  assert.equal(third.youWill[2], 'stay within $2,700 a month');
  assert.equal(level.experiments.find((e) => e.id === 'peak').factor, 1.6);
  assert.match(first.debrief.next, /^Election night brings 1\.6 times the traffic,/);
  assert.deepEqual(second.debrief.number, ['1.6×', 'the traffic on election night']);
  assert.equal(third.debrief, undefined);
});

test('"three shards carried what equal ranges could not" on election night, within $2,400', () => {
  // 55,600 × 1.03 (the peak the game measures) × 1.6 = 91,628.8 keystrokes; 70% reach the servers: 64,140.16.
  // 6 API servers × 12,000 = 72,000 take them all. A shard map: 64,140.16 ÷ 3 = 21,380 per shard, under 25,000.
  // Equal letter ranges: 45% × 64,140.16 = 28,863 on the busiest, over 25,000. Four letter shards: 36% = 23,090,
  // under 25,000, but 6 × $200 + 4 × $300 + $100 = $2,500, over $2,400. The map: 6 × $200 + 3 × $300 + $100 = $2,200.
  const qps = 55600 * 1.03 * 1.6;
  const design = { browser: true, apis: 6, method: 'topk', rebuild: 'weekly' };
  assert.equal(typeaheadOutcome({ ...design, shards: 3, map: true }, { qps }).served, 1);
  assert.ok(typeaheadOutcome({ ...design, shards: 3, map: false }, { qps }).served < 0.99);
  assert.equal(LETTER_TOP[3], 0.45);
  assert.equal(6 * COMPONENTS.tapi.cost + 4 * COMPONENTS.trie.cost + 100, 2500);
  assert.equal(6 * COMPONENTS.tapi.cost + 3 * COMPONENTS.trie.cost + 100, 2200);
  assert.match(second.debrief.saw, /three shards carried what equal ranges could not/);
});

test('"within an hour": an hourly rebuild passes the freshness goal, a daily one does not', () => {
  const fresh = trend.goals.find((g) => g.id === 'fresh');
  assert.equal(fresh.test({ typeahead: { staleH: 1 } }), true);
  assert.equal(fresh.test({ typeahead: { staleH: 24 } }), false);
  assert.equal(third.youWill[0], 'rebuild the trie often enough that a new trending search shows up within an hour');
});

test('the wrap-up: the top 5 at every node and 30% from the browser; the next level is video', () => {
  assert.deepEqual(level.lesson.wrap.numbers, [['top 5', 'searches stored at every node'], ['30%', 'of keystrokes answered by the browser, in the game']]);
  assert.match(level.lesson.wrap.broken, /^Level 20 /);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
