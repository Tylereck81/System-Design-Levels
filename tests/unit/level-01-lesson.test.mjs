// Level 1's lesson writes some game numbers as words ("Traffic triples", "a million users"); these checks fail when
// the missions stop matching those words. Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import level from '../../levels/level-01.js';

test('"Traffic triples": Mission 2 has three times the traffic of Mission 1', () => {
  assert.equal(level.missions[1].qps, 3 * level.missions[0].qps);
  assert.match(level.lesson.recap.bridge[1], /^Traffic triples\./);
});

test('"a million users": Mission 3 is built on 1,000,000 daily users', () => {
  assert.match(level.missions[2].story, /1,000,000 daily active users/);
  assert.match(level.lesson.steps[6].hook, /a million users/);
});
