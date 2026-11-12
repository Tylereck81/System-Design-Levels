// js/format.js: fmt rounds to a whole number and groups thousands with commas; percent, ms and rate build on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, count, percent, ms, rate } from '../../js/format.js';

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

test('percent keeps six significant digits and drops trailing zeros', () => {
  assert.equal(percent(0.75), '75%');
  assert.equal(percent(0.9), '90%'); // 0.9 × 100 is 90.00000000000001 in floating point
  assert.equal(percent(0.999999), '99.9999%');
  assert.equal(percent(0.000001), '0.0001%');
});

test('ms rounds to one decimal place', () => {
  assert.equal(ms(0.5), '0.5 ms');
  assert.equal(ms(80), '80 ms');
  assert.equal(ms(4.16), '4.2 ms');
});

test('rate rounds to whole requests and groups thousands', () => {
  assert.equal(rate(833.3), '833 req/s');
  assert.equal(rate(1204), '1,204 req/s');
});

test('count: a million or more is written with the word and never rounded; less is written as fmt writes it', () => {
  assert.equal(count(999999), '999,999');
  assert.equal(count(1000000), '1 million');
  assert.equal(count(1500000), '1.5 million');
  assert.equal(count(40000000), '40 million');
  assert.equal(count(1234567), '1.234567 million');
  assert.equal(count(999999999), '999.999999 million');
  assert.equal(count(1200000000), '1.2 billion');
  assert.equal(count(3500000000000), '3.5 trillion');
  assert.equal(count(86400), '86,400');
});
