// Reads a module's imports from its source, for the unit tests that keep engine modules free of import cycles.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ENGINE = new URL('../../js/engine/', import.meta.url);
/** The relative modules a file imports, from its import lines. */
export const importsOf = (url) => [...readFileSync(fileURLToPath(url), 'utf8').matchAll(/^import .* from '(\.{1,2}\/[^']+)';$/gm)].map((m) => m[1]);
