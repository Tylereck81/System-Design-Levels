// js/format.js: fmt rounds to a whole number and groups thousands with commas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt } from '../../js/format.js';

test('thousands are grouped with commas', () => {
  assert.equal(fmt(999), '999');
  assert.equal(fmt(1000), '1,000');
  assert.equal(fmt(1234567), '1,234,567');
});

test('decimals round to the nearest whole number, halves up', () => {
  assert.equal(fmt(1234.4), '1,234');
  assert.equal(fmt(1234.5), '1,235');
  assert.equal(fmt(0.5), '1');
  assert.equal(fmt(2.499), '2');
});

test('zero', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(0.4), '0');
});

test('negative values keep their sign; halves still round up, towards +∞ (Math.round)', () => {
  assert.equal(fmt(-5), '-5');
  assert.equal(fmt(-1234.6), '-1,235');
  assert.equal(fmt(-1234.5), '-1,234'); // Math.round(-1234.5) = -1234
});

test('very large values are written out in full, not in e-notation', () => {
  assert.equal(fmt(1e9), '1,000,000,000');
  assert.equal(fmt(1e15), '1,000,000,000,000,000');
  assert.equal(fmt(1e21), '1,000,000,000,000,000,000,000');
});
