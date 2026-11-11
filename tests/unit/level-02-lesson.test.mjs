// Level 2's lesson writes some game facts as words; these checks fail when the level stops matching them.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIZES } from '../../js/engine/catalog.js';
import level from '../../levels/level-02.js';

test('"the next size up is also the last size": the start web server is one size below the largest', () => {
  const sizes = Object.keys(SIZES);
  const start = level.startNodes.find((n) => n.type === 'web').size;
  assert.equal(sizes.indexOf(start), sizes.length - 2);
  assert.match(level.lesson.steps[0].hook, /next size up\. It is also the last size/);
});

test('"Traffic grows", not "doubles": Mission 2 is not exactly twice Mission 1', () => {
  assert.notEqual(level.missions[1].qps, 2 * level.missions[0].qps);
  assert.match(level.lesson.recap.bridge[1], /^Traffic grows to /);
});
