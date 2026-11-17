// Level 20's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_SERVERS, TRANSCODE_RATE, CDN_GB, OWN_GB, POPULAR, VIEWS_DAY, VIEW_GB, videoOutcome } from '../../js/engine/video.js';
import { COMPONENTS } from '../../js/engine/catalog.js';
import level from '../../levels/level-20.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, p, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [uploads, transcode, bill] = level.missions;
const SCOPE = 'Scope it: how much video, and what does it cost to stream?';
const CUT = 'How do you cut the streaming bill?';

test('the scope example: 3 million × 5% × 200 MB is 30 TB a day; 20 million views × 0.2 GB × $0.02 is $80,000', () => {
  // 3,000,000 × 5% = 150,000 videos; × 200 MB = 30,000,000 MB = 30 TB. 20,000,000 × 0.2 GB = 4,000,000 GB × $0.02 = $80,000.
  const calc = block(SCOPE, 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.label, r.work, r.result]), [
    ['Uploads a day', '3 million users × 5%', '150,000 videos'],
    ['Storage a day', '150,000 videos × 200 MB', '30 TB'],
    ['CDN a day', '20 million views × 0.2 GB × $0.02', '$80,000'],
  ]);
  assert.equal(calc.result, '30 TB of new video a day, and $80,000 a day to stream it from a CDN. Streaming is the biggest cost.');
  assert.match(section(SCOPE).hook, /Say: 3 million daily users, 5% upload one 200 MB video a day, and viewers watch 20 million videos a day of 0\.2 GB each\.$/);
});

test('the scope example differs from the mission\'s estimate (100 TB) and the quiz\'s bill ($120,000)', () => {
  // The mission: 4,000,000 × 10% × 250 MB = 100,000,000 MB = 100 TB. The quiz: 24,000,000 × 0.25 GB × $0.02 = $120,000.
  assert.deepEqual([uploads.gate.lo, uploads.gate.hi], [100, 100]);
  assert.equal(VIEWS_DAY * VIEW_GB * CDN_GB, 120000);
  assert.doesNotMatch(JSON.stringify(section(SCOPE)), /4 million|100 TB|120,000|24 million/);
});

test('the New part cards read the catalog and the engine: $800 for 4 API servers, $500 a server at 1 video a second', () => {
  assert.deepEqual([COMPONENTS.vupload.cost, API_SERVERS, COMPONENTS.transcoder.cost, TRANSCODE_RATE, CDN_GB, OWN_GB], [800, 4, 500, 1, 0.02, 0.002]);
  assert.deepEqual(first.newParts.map((c) => [c.type, c.game]), [
    ['vupload', '$800 a month for 4 servers and storage.'],
    ['transcoder', '$500 a month each. 1 video a second each.'],
    ['vserve', 'A CDN charges $0.02 a GB; your own servers about $0.002.'],
  ]);
});

test('Check yourself: 80% through 5 MB chunks resends one chunk; 7.5 uploads a second need 9 servers; $8,000 from own servers', () => {
  // 500 MB ÷ 5 MB = 100 chunks; 80% through, chunks 1 to 80 are stored, so only the 81st restarts.
  assert.equal(first.checks[0].options.find((o) => o.right).t, 'The chunk that was cut off, then the rest');
  // 7.5 ÷ 1 a server = 7.5, rounded up to 8; one spare makes 9. With one of 8 dead, 7 carry only 7 a second.
  const servers = second.checks[0];
  assert.deepEqual(servers.options.map((o) => o.t), ['8', '9', '15']);
  assert.equal(servers.options.find((o) => o.right).t, '9');
  // 20,000,000 × 0.2 GB × $0.002 = $8,000: a tenth of $80,000, because $0.002 is a tenth of $0.02.
  const own = third.checks[0];
  assert.equal(own.options.find((o) => o.right).t, '$8,000 a day');
  assert.equal(OWN_GB / CDN_GB, 0.1);
  assert.match(own.options.find((o) => o.right).why, /^A tenth of the price per GB/);
});

test('the mission cards: 99% published, $3.70M, $3.70M and $3.60M a month, views grow 20%', () => {
  assert.equal(level.targets.servedPct, 99);
  assert.deepEqual([uploads.budget, transcode.budget, bill.budget], [3700000, 3700000, 3600000]);
  assert.equal(first.youWill[2], 'survive patchy networks and publish 99% of uploads');
  assert.equal(first.youWill[3], 'stay within $3.70M a month');
  assert.equal(second.youWill[2], 'let a transcoding server die and still publish 99%, for at most $3.70M a month');
  assert.equal(third.youWill[1], 'get the month under $3.60M');
  assert.equal(third.youWill[2], 'let views grow 20% and keep the bill within budget');
  assert.equal(level.workload.growth, 1.2);
});

test('the done cards: 9.3 uploads a second at the peak; one spare transcoding server', () => {
  assert.equal(uploads.qps, 9.3);
  assert.deepEqual(first.debrief.number, ['9.3 a second', 'uploads at the peak']);
  // 9.3 a second needs 10 servers; with one dead, 10 left still carry it only if there were 11.
  assert.equal(videoOutcome({ presigned: true, chunks: true, workers: 11, retry: true }, { rate: 9.3, dies: true }).transcoded, 1);
  assert.ok(videoOutcome({ presigned: true, chunks: true, workers: 10, retry: true }, { rate: 9.3, dies: true }).transcoded < 0.99);
  assert.deepEqual(second.debrief.number, ['1 spare', 'transcoding server, so one can die']);
  assert.equal(third.debrief, undefined);
});

test('"the tail from your own storage servers": popular-only streaming fits the $3.60M month, even with 20% more views', () => {
  // 24,000,000 × 0.25 GB × 30 days = 180,000,000 GB. All CDN: × $0.02 = $3,600,000, plus $800 + 11 × $500 = $3,606,300.
  // Popular only: 180,000,000 × (80% × $0.02 + 20% × $0.002) = $2,952,000; × 1.2 = $3,542,400, plus $6,300 = $3,548,700.
  const design = { presigned: true, chunks: true, workers: 11, retry: true };
  const fixed = COMPONENTS.vupload.cost + 11 * COMPONENTS.transcoder.cost;
  assert.equal(POPULAR, 0.8);
  assert.ok(Math.round(videoOutcome(design, { rate: 9.3 }).bill) + fixed > bill.budget);
  assert.equal(Math.round(videoOutcome({ ...design, popularOnly: true }, { rate: 9.3, growth: 1.2 }).bill), 3542400);
  assert.ok(3542400 + fixed <= bill.budget);
  assert.match(block(CUT, 'p'), /at about \$0\.002 a GB instead of \$0\.02\.$/);
});

test('the wrap-up: $0.02 a GB and the example\'s $80,000 a day; the next level is file sync', () => {
  assert.deepEqual(level.lesson.wrap.numbers, [['$0.02', 'a GB to stream from a CDN, in the game'], ['$80,000', 'a day to stream the example\'s views from a CDN']]);
  assert.match(level.lesson.wrap.broken, /^Level 21 /);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
