// Level 15's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DNS_MS, DUP_SHARE, POLITE, THREADS, PAGE_MS, PAGES_MONTH, PAGE_KB, crawlOutcome, downloaderRate } from '../../js/engine/crawl.js';
import { COMPONENTS } from '../../js/engine/catalog.js';
import level from '../../levels/level-15.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, p, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [speed, polite, waste] = level.missions;
const SCOPE = 'Scope it: how much does a crawler download?';
const DNS = 'Why is a crawler slow when its servers are idle?';

test('the scope example: 3 billion × 100 KB = 300 TB a month, 14.4 PB in 4 years, about 1,157 pages a second', () => {
  // 3 × 10⁹ × 10⁵ bytes = 3 × 10¹⁴ bytes = 300 TB; 300 × 12 × 4 = 14,400 TB = 14.4 PB.
  // A 30-day month is 30 × 86,400 = 2,592,000 s; 3,000,000,000 ÷ 2,592,000 = 1,157.4.
  assert.equal(30 * 86400, 2_592_000);
  assert.equal(Math.round(3e9 / 2_592_000), 1157);
  const calc = block(SCOPE, 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.label, r.work, r.result]), [
    ['Each month', '3 billion pages × 100 KB', '300 TB'],
    ['In 4 years', '300 TB × 12 months × 4', '14.4 PB'],
    ['Pages a second', '3 billion pages ÷ 2.59 million s', '1,157 pages/s'],
  ]);
  assert.equal(calc.result, 'About 1,157 pages a second and 14.4 PB of storage. A month is about 2.6 million seconds.');
});

test('the scope example differs from the mission (2 billion × 300 KB = 600 TB) and from Check yourself (200 TB)', () => {
  // 2 × 10⁹ × 3 × 10⁵ bytes = 6 × 10¹⁴ bytes = 600 TB, the mission's estimate.
  assert.equal(PAGES_MONTH * PAGE_KB / 1e9, 600);
  assert.deepEqual([speed.gate.lo, speed.gate.hi], [600, 600]);
  // 1 billion × 200 KB = 2 × 10¹⁴ bytes = 200 TB.
  assert.equal(first.checks[0].options.find((o) => o.right).t, '200 TB');
});

test('DNS: one lookup at a time holds a machine to 1,000 ÷ lookup ms; its threads manage 200 pages a second', () => {
  // 100 threads ÷ 0.5 s a page = 200 pages a second; 1,000 ms ÷ 10 ms = 100; 1,000 ms ÷ 100 ms = 10.
  assert.equal(THREADS * 1000 / PAGE_MS, 200);
  assert.equal(COMPONENTS.downloader.cap, 200);
  assert.equal(DNS_MS, 10);
  assert.equal(downloaderRate({ dnsCache: false }), 100);
  // With a cache only 2% of pages need a lookup: 1,000 ÷ (0.02 × 10) = 5,000, so the threads' 200 is the limit.
  assert.equal(downloaderRate({ dnsCache: true }), 200);
  const calc = block(DNS, 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.label, r.work, r.result]), [
    ['Lookups take 10 ms', '1,000 ms ÷ 10 ms', '100 pages/s'],
    ['Lookups take 100 ms', '1,000 ms ÷ 100 ms', '10 pages/s'],
  ]);
  assert.equal(calc.result, 'The machine could manage 200 pages a second, but DNS holds it to 100, or 10 on a slow day.');
  assert.deepEqual(first.debrief.number, ['200 pages/s', 'one machine manages once DNS is cached']);
});

test('the New part cards read the catalog: downloader $200, 100 threads, 500 ms; parser $150, 2,000 pages/s; storage $300', () => {
  assert.deepEqual(first.newParts.map((c) => [c.type, c.game]), [
    ['downloader', '$200 a month each. 100 threads; a page takes 500 ms.'],
    ['parser', '$150 a month. Reads 2,000 pages/s.'],
    ['contentstore', '$300 a month.'],
  ]);
  assert.deepEqual(['downloader', 'parser', 'contentstore'].map((t) => COMPONENTS[t].cost), [200, 150, 300]);
});

test('politeness: a queue per host sends any site 1 request a second', () => {
  assert.equal(POLITE, 1);
  assert.equal(crawlOutcome({ perHost: true }, { rate: 800, flood: true }).hostRate, 1);
  assert.equal(second.youWill[0], 'send any site at most 1 request a second');
  assert.deepEqual(second.debrief.number, ['1 a second', 'the most any one site received']);
});

test('duplicates: 29% in the game, "about 30%" in the lesson; only "content seen?" keeps storage under 450 TB', () => {
  assert.equal(DUP_SHARE, 0.29);
  assert.match(second.debrief.next, /^About 30% of pages copy/);
  assert.deepEqual(level.lesson.wrap.numbers[1], ['30%', 'of pages are copies (an estimate)']);
  // 600 TB × (1 − 0.29) = 426 TB, under 450; the URL filter does not change storage.
  assert.equal(crawlOutcome({ dedup: true }, { rate: 800 }).storageTB, 426);
  assert.equal(crawlOutcome({ dedup: false, filter: true }, { rate: 800 }).storageTB, 600);
  assert.equal(third.youWill[0], 'turn on the check that keeps storage under 450 TB a month');
  assert.equal(waste.goals.find((g) => g.id === 'storage').text, 'Store at most 450 TB a month');
});

test('the mission cards name what the missions check: 800 pages a second, $1,500, the Break it buttons', () => {
  assert.deepEqual([speed.qps, polite.qps, waste.qps], [800, 800, 800]);
  assert.deepEqual([speed.budget, polite.budget, waste.budget], [1500, 1500, 1500]);
  assert.deepEqual(level.experiments.map((e) => e.label), ['DNS slows down', 'One site floods the frontier', 'The crawler finds a trap']);
  assert.ok(speed.gate, 'Mission 1 asks for an estimate before Play');
  assert.deepEqual(first.youWill.slice(1), [
    'connect downloaders, a parser and content storage, and download 800 useful pages a second',
    'let DNS slow down with the Break it button and keep crawling at full speed',
    'stay within $1,500 a month',
  ]);
  assert.equal(second.youWill[1], 'let one site flood the frontier and still download 800 pages a second');
  assert.equal(third.youWill[2], 'stay polite and within $1,500 a month');
});

test('the wrap-up numbers: 2.6 million seconds in a month, 30% copies', () => {
  assert.deepEqual(level.lesson.wrap.numbers, [['2.6 million', 'seconds in a month'], ['30%', 'of pages are copies (an estimate)']]);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
