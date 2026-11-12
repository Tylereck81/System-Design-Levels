// Shared formatting helpers. None of them changes a number; they only write it as text.
export const fmt = (n) => Math.round(n).toLocaleString('en-US');

/**
 * A count for lesson text: a million or more is written with the word and is not rounded (1,200,000,000 →
 * "1.2 billion", 1,234,567 → "1.234567 million"); anything smaller is written as `fmt` writes it.
 */
export function count(n) {
  for (const [size, word] of /** @type {[number, string][]} */ ([[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million']])) {
    if (Math.abs(n) >= size) return `${+(n / size).toPrecision(15)} ${word}`;
  }
  return fmt(n);
}

/** A share as a percent, to six significant digits: 0.75 → "75%", 0.999999 → "99.9999%". */
export const percent = (share) => `${+(share * 100).toPrecision(6)}%`;

/** Milliseconds to one decimal place: 0.5 → "0.5 ms", 80 → "80 ms". */
export const ms = (value) => `${Math.round(value * 10) / 10} ms`;

/** A request rate, rounded to whole requests: 833.3 → "833 req/s". */
export const rate = (value) => `${fmt(value)} req/s`;
