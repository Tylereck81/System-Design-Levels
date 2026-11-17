// Level 18's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONN_KB, SERVER_CONNS, OFFLINE, FRIENDS, HEARTBEAT_S, chatOutcome } from '../../js/engine/chat.js';
import { COMPONENTS } from '../../js/engine/catalog.js';
import level from '../../levels/level-18.js';
import next from '../../levels/level-19.js';
import { lessonWarnings } from '../../js/validate-lesson.js';

const [first, second, third] = level.lesson.parts;
const sections = level.lesson.parts.flatMap((p) => p.sections);
/** The section with this title, so reordering the parts or sections does not break a check. */
const section = (title) => sections.find((x) => x.title === title);
/** The first block of this kind (calc, p, …) in a section, so reordering its blocks does not break a check. */
const block = (title, kind) => section(title).body.find((b) => b[kind])[kind];
const [realtime, offline, dots] = level.missions;
const SCOPE = 'Scope it: how much memory do open connections need?';
const DOTS = 'Why does a green dot flicker, and how do you stop it?';

test('the scope example: 1.5 million connections × 10 KB is 15 GB, 2 servers and a spare', () => {
  // 1,500,000 × 10 KB = 15,000,000 KB = 15 GB. 15 GB ÷ 8 GB = 1.875, so 2 servers; + 1 spare = 3.
  // With one down, 15 GB ÷ 2 servers = 7.5 GB each, under 8 GB.
  assert.equal(CONN_KB, 10);
  assert.equal(SERVER_CONNS * CONN_KB, 8e6); // 800,000 × 10 KB = 8,000,000 KB = 8 GB a server
  const calc = block(SCOPE, 'calc');
  assert.deepEqual(calc.rows.map((r) => [r.label, r.work, r.result]), [
    ['Memory', '1.5 million connections × 10 KB', '15 GB'],
    ['Servers', '15 GB ÷ 8 GB each', '1.875, so 2 servers'],
    ['With a spare', '2 servers + 1 server', '3 servers'],
  ]);
  assert.equal(calc.result, '3 chat servers. With one down, the other 2 still hold every connection.');
  assert.match(section(SCOPE).hook, /groups up to 100, .* 1\.5 million users connected/);
});

test('the scope example differs from the mission\'s estimate (2 million × 10 KB = 20 GB)', () => {
  // 2,000,000 × 10 KB = 20,000,000 KB = 20 GB.
  assert.deepEqual([realtime.gate.lo, realtime.gate.hi], [20, 20]);
  assert.doesNotMatch(JSON.stringify(section(SCOPE)), /20 GB|2 million/);
});

test('the New part cards read the catalog: chat servers $300 each with 8 GB, the message store $500', () => {
  assert.deepEqual([COMPONENTS.chatsrv.cost, COMPONENTS.msgstore.cost], [300, 500]);
  assert.deepEqual(first.newParts.map((c) => [c.type, c.game]), [
    ['chatsrv', '$300 a month each. 8 GB of memory for connections.'],
    ['msgstore', '$500 a month.'],
  ]);
});

test('"within half a second" is the delay goal: 0.5 s passes, 0.6 s fails', () => {
  assert.match(level.lesson.intro.story, /within half a second/);
  const delay = realtime.goals.find((g) => g.id === 'delay');
  assert.equal(delay.text, 'Messages arrive within 0.5 s');
  assert.equal(delay.test({ chat: { delay: 0.5 } }), true);
  assert.equal(delay.test({ chat: { delay: 0.6 } }), false);
  assert.equal(first.youWill[1], 'switch to WebSocket so messages arrive within 0.5 seconds');
});

test('the mission cards: 99% delivered, $1,800 a month, and the three Break it events', () => {
  assert.equal(level.targets.servedPct, 99);
  assert.equal(first.youWill[2], 'let a chat server die and keep 99% of messages delivered');
  assert.deepEqual([realtime.budget, offline.budget, dots.budget], [1800, 1800, 1800]);
  for (const part of level.lesson.parts) assert.equal(part.youWill.at(-1), 'stay within $1,800 a month');
  assert.ok(realtime.gate, 'Mission 1 asks for an estimate before Play');
  assert.deepEqual(level.experiments.map((e) => e.id), ['dies', 'night', 'tunnel']);
});

test('the done cards: 10 KB a connection, 30% offline, 100 friends', () => {
  // 0.3 = 30%: chatOutcome reports that share offline outside the night test.
  assert.equal(OFFLINE, 0.3);
  assert.equal(chatOutcome({ protocol: 'ws', servers: 4, discovery: true, heartbeat: true, push: true }, { msgs: 0 }).offline, 0.3);
  assert.deepEqual(first.debrief.number, ['10 KB', 'of memory for each open connection']);
  assert.equal(first.debrief.next, '30% of recipients have their phone asleep when a message arrives.');
  assert.deepEqual(second.debrief.number, ['30%', 'of recipients were offline']);
  assert.equal(FRIENDS, 100);
  assert.match(second.debrief.next, /^Each user's green dot shows to 100 friends,/);
  assert.equal(third.debrief, undefined);
});

test('heartbeats every 5 s; a status change goes to 100 friends, or 20,000 in the example group (the quiz uses 50,000)', () => {
  assert.equal(HEARTBEAT_S, 5);
  const p = section(DOTS).body.filter((b) => b.p).map((b) => b.p);
  assert.match(p[0], /every few seconds \(5 here\)/);
  // 1 change × 100 friends = 100 messages; 1 change × 20,000 members = 20,000.
  assert.match(p[1], /with 100 friends, one change is 100 messages\. For a group of 20,000, one change would be 20,000\./);
  assert.match(level.quiz.questions[9].q, /50,000 members/);
});

test('Check yourself sums: 4 million × 10 KB = 40 GB on 6 servers; 20 changes × 300 friends = 6,000', () => {
  // 4,000,000 × 10 KB = 40 GB = 5 servers × 8 GB; with one down 5 must still carry it, so 6.
  const [servers] = first.checks;
  assert.equal(servers.options.find((o) => o.right).t, '6');
  assert.equal(Math.ceil((4e6 * CONN_KB) / (SERVER_CONNS * CONN_KB)) + 1, 6);
  // Offline and online 10 times = 20 changes, each to 300 friends.
  assert.equal(third.checks[0].options.find((o) => o.right).t, '6,000');
});

test('the wrap-up: 10 KB and 100 friends; the next level\'s 100 ms deadline', () => {
  assert.deepEqual(level.lesson.wrap.numbers, [['10 KB', 'of memory for one open connection (an assumption)'], ['100 friends', 'receive each status change']]);
  assert.equal(next.targets.latencyMs, 100);
  assert.match(level.lesson.wrap.broken, /in under 100 ms\.$/);
});

test('quiz review lines name the section that lists the question', () => {
  const sectionOf = new Map(level.lesson.parts.flatMap((p) => p.sections.flatMap((s) => (s.quiz || []).map((q) => [q, s.title]))));
  level.quiz.questions.forEach((q, i) => assert.equal(q.r, sectionOf.get(i), `question ${i}`));
});

test('numbers of a million or more are written with the word', () => {
  assert.deepEqual(lessonWarnings(level), []);
});
