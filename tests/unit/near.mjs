// Float comparison for the hand-worked engine numbers: equal up to a relative error of 1e-9 (exact for Infinity).
import assert from 'node:assert/strict';

export function near(actual, expected, message) {
  if (!Number.isFinite(expected)) return assert.equal(actual, expected, message);
  const ok = Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
  assert.ok(ok, message ?? `expected ${expected}, got ${actual}`);
}

/** Checks each field of `expected` against `actual` with near() for numbers and equal() for the rest. */
export function fields(actual, expected) {
  for (const [k, v] of Object.entries(expected)) {
    if (typeof v === 'number') near(actual[k], v, `${k}: expected ${v}, got ${actual[k]}`);
    else assert.equal(actual[k], v, `${k}: expected ${v}, got ${actual[k]}`);
  }
}
