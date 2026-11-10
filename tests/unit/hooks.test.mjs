// js/hooks.js: main.js's functions that other modules call. A call before main.js registers them fails loudly, and
// registering checks that all four are given. The tests share one module instance, so they run in this order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hooks, registerHooks } from '../../js/hooks.js';

const NAMES = ['afterChange', 'afterDesignChange', 'renderTabs', 'setTab'];

test('before registration, each hook throws and names itself', () => {
  for (const name of NAMES) assert.throws(() => hooks[name](), new RegExp(`hooks\\.${name} was called before`));
});

test('registering without one of the four throws and names the missing one', () => {
  const noop = () => {};
  assert.throws(() => registerHooks({ afterChange: noop, afterDesignChange: noop, renderTabs: noop }), /setTab is missing/);
});

test('after registration, each hook calls the registered function with its arguments', () => {
  const calls = [];
  registerHooks(Object.fromEntries(NAMES.map(name => [name, (...args) => calls.push([name, ...args])])));
  hooks.afterChange(true);
  hooks.afterDesignChange({ keepResults: true });
  hooks.renderTabs();
  hooks.setTab('quiz', true);
  assert.deepEqual(calls, [
    ['afterChange', true],
    ['afterDesignChange', { keepResults: true }],
    ['renderTabs'],
    ['setTab', 'quiz', true],
  ]);
});
