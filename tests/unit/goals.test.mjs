// The goal helpers every level shares (levels/shared/goals.js): their text, tests and shown values, and the four
// percentage formats the levels use. Expected strings are worked out by hand from the rules in each comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fmtPct, fmtMoney, servedAtLeast, servedGoal, latGoal, costGoal, spofGoal } from '../../levels/shared/goals.js';

const GOALS = new URL('../../levels/shared/goals.js', import.meta.url);
const targets = { latencyMs: 150, servedPct: 99 };

test('goals.js imports only the formatting helper, so level files stay loadable on their own', () => {
  const imports = [...readFileSync(fileURLToPath(GOALS), 'utf8').matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../../js/format.js']);
});

test('fmtPct: one decimal by default', () => {
  assert.equal(fmtPct(99.46), '99.5%');
  assert.equal(fmtPct(0), '0.0%');
  assert.equal(fmtPct(100), '100.0%');
});

test('fmtPct: scale 100 turns a 0–1 share into a percent', () => {
  assert.equal(fmtPct(0.123, { scale: 100 }), '12.3%'); // 100 × 0.123 = 12.3
});

test('fmtPct: whole numbers from wholeFrom up', () => {
  assert.equal(fmtPct(9.54, { wholeFrom: 10 }), '9.5%');
  assert.equal(fmtPct(37.6, { wholeFrom: 10 }), '38%');
  assert.equal(fmtPct(0, { wholeFrom: 10 }), '0.0%');
});

test('fmtPct: whole numbers, with one decimal only between 0% and 1%', () => {
  const PCT = { wholeUpTo: 0, wholeFrom: 1 };
  assert.equal(fmtPct(0, PCT), '0%');
  assert.equal(fmtPct(0.42, PCT), '0.4%');
  assert.equal(fmtPct(37.6, PCT), '38%');
});

test('fmtMoney: whole dollars, and millions shortened only when asked', () => {
  assert.equal(fmtMoney(1900), '$1,900');
  assert.equal(fmtMoney(1250000), '$1,250,000');
  assert.equal(fmtMoney(1250000, { millions: true }), '$1.25M'); // 1,250,000 ÷ 1,000,000 = 1.25
  assert.equal(fmtMoney(999999, { millions: true }), '$999,999');
});

test('servedGoal and servedAtLeast: the target share of requests, or the level\'s own wording', () => {
  const goal = servedGoal(targets);
  assert.equal(goal.id, 'served');
  assert.equal(goal.type, 'metric');
  assert.equal(goal.text, 'Serve at least 99% of requests');
  assert.equal(goal.test({ servedPct: 99 }), true);
  assert.equal(goal.test({ servedPct: 98.9 }), false);
  assert.equal(goal.val({ servedPct: 99.46 }), '99.5%');
  assert.equal(servedGoal(targets, { text: 'Deliver 99% of messages' }).text, 'Deliver 99% of messages');
  assert.equal(servedAtLeast(99)({ servedPct: 99 }), true);
  assert.equal(servedAtLeast(99)({ servedPct: 98.99 }), false);
});

test('latGoal: response time under the target, and none before any request is served', () => {
  const goal = latGoal(targets);
  assert.equal(goal.id, 'lat');
  assert.equal(goal.text, 'Response time under 150 ms');
  assert.equal(goal.test({ latency: null }), false);
  assert.equal(goal.val({ latency: null }), '—');
  assert.equal(goal.test({ latency: 149.6 }), true);
  assert.equal(goal.val({ latency: 149.6 }), '150 ms'); // rounded for display, tested unrounded
  assert.equal(goal.test({ latency: 150 }), false);
  assert.equal(latGoal(targets, { text: 'Suggestions in under 150 ms' }).text, 'Suggestions in under 150 ms');
});

test('costGoal: the design\'s monthly cost within the budget', () => {
  const goal = costGoal(1900);
  assert.equal(goal.id, 'cost');
  assert.equal(goal.type, 'struct');
  assert.equal(goal.text, 'Spend at most $1,900 per month');
  assert.equal(goal.test({ cost: 1900 }), true);
  assert.equal(goal.test({ cost: 1901 }), false);
  assert.equal(goal.val({}, { cost: 1901 }), '$1,901');
  assert.equal(costGoal(2500000, { millions: true }).text, 'Spend at most $2.50M per month');
});

test('spofGoal: no single point of failure', () => {
  const goal = spofGoal();
  assert.deepEqual([goal.id, goal.type, goal.text], ['spof', 'metric', 'No single point of failure']);
  assert.equal(goal.test({ spof: 0 }), true);
  assert.equal(goal.test({ spof: 1 }), false);
  assert.equal(goal.val({ spof: 2 }), '2');
});
