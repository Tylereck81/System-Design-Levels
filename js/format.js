// Shared formatting helpers. None of them changes a number; they only write it as text.
export const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** A share as a percent, to six significant digits: 0.75 → "75%", 0.999999 → "99.9999%". */
export const percent = (share) => `${+(share * 100).toPrecision(6)}%`;

/** Milliseconds to one decimal place: 0.5 → "0.5 ms", 80 → "80 ms". */
export const ms = (value) => `${Math.round(value * 10) / 10} ms`;

/** A request rate, rounded to whole requests: 833.3 → "833 req/s". */
export const rate = (value) => `${fmt(value)} req/s`;
