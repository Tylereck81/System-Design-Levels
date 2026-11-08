// tests/unit/: Node tests (npm run test:unit) of single modules and the level data, no page.
// A new file here is added to the test:unit script by name.
// The component catalog stays free of dependencies, so js/state.js (and later every component kind) can import it
// without an import cycle: it may import only modules that import nothing themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE, importsOf } from './imports.mjs';

test('catalog.js imports only modules that import nothing', () => {
  const catalog = new URL('catalog.js', ENGINE);
  for (const spec of importsOf(catalog)) {
    assert.deepEqual(importsOf(new URL(spec, catalog)), [], `${spec} must not import anything`);
  }
});

test('catalog.js loads on its own, without a level or a page', async () => {
  const { SIZES, T, COMPONENTS, choiceOf, sizesOf, countOf } = await import(new URL('catalog.js', ENGINE));
  assert.ok(Object.keys(SIZES).length > 0 && Object.values(T).every(Number.isFinite));
  assert.ok(Object.values(COMPONENTS).every((c) => typeof c.role === 'string'), 'every component type has a role');
  assert.equal(choiceOf({ type: 'web' }, 'scaling'), COMPONENTS.web.choices.scaling.default);
  assert.equal(sizesOf('web'), SIZES);
  assert.equal(countOf({ type: 'web' }), 1);
});

test('state.js imports the catalog, not components.js', () => {
  const specs = importsOf(new URL('../state.js', ENGINE));
  assert.ok(specs.includes('./engine/catalog.js'));
  assert.ok(!specs.includes('./engine/components.js'), 'state.js and components.js would import each other again');
});
