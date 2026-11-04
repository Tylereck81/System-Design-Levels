// The component catalog stays free of dependencies, so js/state.js (and later every component kind) can import it
// without an import cycle: it may import only modules that import nothing themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENGINE = new URL('../../js/engine/', import.meta.url);
/** The relative modules a file imports, from its import lines. */
const importsOf = (url) => [...readFileSync(fileURLToPath(url), 'utf8').matchAll(/^import .* from '(\.{1,2}\/[^']+)';$/gm)].map((m) => m[1]);

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
