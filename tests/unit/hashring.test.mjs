// js/engine/hashring.js: the hash, the ring's points, key shares and keys moved, checked against the rules by hand.
// The hash runs MurmurHash3's per-block mixing once per character (not per 4 bytes), so published test vectors don't
// apply: it is checked against a second, independent implementation in BigInt arithmetic written from the same steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash32, serverNames, ringPoints, keyShares, movedShare, keyHome } from '../../js/engine/hashring.js';
import { near } from './near.mjs';

const M = 2n ** 32n, mul = (a, b) => (a * b) % M, rotl = (x, r) => ((x << BigInt(r)) | (x >> BigInt(32 - r))) % M;
function reference(str) {
  let h = 0x9747b28cn;
  for (const ch of str) {
    let k = mul(BigInt(ch.charCodeAt(0)), 0xcc9e2d51n);
    k = mul(rotl(k, 15), 0x1b873593n);
    h = rotl(h ^ k, 13);
    h = (mul(h, 5n) + 0xe6546b64n) % M;
  }
  h ^= BigInt(str.length);
  h ^= h >> 16n; h = mul(h, 0x85ebca6bn); h ^= h >> 13n; h = mul(h, 0xc2b2ae35n); h ^= h >> 16n;
  return Number(h);
}

test('hash32 matches the reference on empty, short and server-point strings', () => {
  for (const s of ['', 'a', 'key-42', 'cache-A', 'cache-B#0', 'cache-Z#199']) assert.equal(hash32(s), reference(s), s);
});

test('serverNames: A, B, C…', () => {
  assert.deepEqual(serverNames(3), ['A', 'B', 'C']);
  assert.deepEqual(serverNames(0), []);
});

test('ringPoints: one point "cache-A" per server, or v points "cache-A#i", sorted by position', () => {
  const one = ringPoints(['A', 'B'], 1);
  assert.deepEqual([...one].sort((x, y) => x[1].localeCompare(y[1])), [[hash32('cache-A'), 'A'], [hash32('cache-B'), 'B']]);
  const many = ringPoints(['A', 'B', 'C'], 50);
  assert.equal(many.length, 150); // 3 × 50
  assert.ok(many.some(([p, s]) => s === 'C' && p === hash32('cache-C#49')));
  for (let i = 1; i < many.length; i++) assert.ok(many[i - 1][0] <= many[i][0]);
});

test('keyShares: hash % N splits evenly; one ring point owns the arc before it', () => {
  assert.deepEqual(keyShares(['A', 'B', 'C', 'D'], { mod: true }), { A: 0.25, B: 0.25, C: 0.25, D: 0.25 });
  assert.deepEqual(keyShares(['A'], { vnodes: 1 }), { A: 1 });
  // Two points a < b: the second owns (b − a) / 2³², the first the rest of the circle.
  const a = hash32('cache-A'), b = hash32('cache-B'), lo = Math.min(a, b), hi = Math.max(a, b);
  const sh = keyShares(['A', 'B'], { vnodes: 1 }), later = a > b ? 'A' : 'B';
  near(sh[later], (hi - lo) / 2 ** 32);
  near(sh.A + sh.B, 1);
  // Many virtual nodes even the shares out: each of 4 servers within 0.1 of 1 / 4.
  for (const v of Object.values(keyShares(['A', 'B', 'C', 'D'], { vnodes: 100 }))) assert.ok(Math.abs(v - 0.25) < 0.1, String(v));
});

test('movedShare with hash % N: count one cycle of lcm(N, N′) by hand', () => {
  // 3 → 4 servers, lcm 12: h = 0, 1, 2 stay (A/A, B/B, C/C); h = 3…11 all differ → 9 / 12.
  near(movedShare(['A', 'B', 'C'], ['A', 'B', 'C', 'D'], { mod: true }), 0.75);
  near(movedShare(['A', 'B', 'C', 'D'], ['A', 'B', 'C'], { mod: true }), 0.75);
  // Drop B from A, B, C (lcm 6): h = 0 A/A and h = 5 C/C stay; 1 B/C, 2 C/A, 3 A/C, 4 B/A move → 4 / 6.
  near(movedShare(['A', 'B', 'C'], ['A', 'C'], { mod: true }), 4 / 6);
  near(movedShare(['A', 'B'], ['A', 'B'], { mod: true }), 0);
});

test('movedShare on a ring: only the keys the added or removed server owns move', () => {
  for (const vnodes of [1, 100]) {
    const abcd = keyShares(['A', 'B', 'C', 'D'], { vnodes }), abc = keyShares(['A', 'B', 'C'], { vnodes });
    near(movedShare(['A', 'B', 'C'], ['A', 'B', 'C', 'D'], { vnodes }), abcd.D, `add D, ${vnodes} vnodes`);
    near(movedShare(['A', 'B', 'C'], ['A', 'C'], { vnodes }), abc.B, `remove B, ${vnodes} vnodes`);
    near(movedShare(['A', 'B', 'C'], ['A', 'B', 'C'], { vnodes }), 0);
  }
});

test('keyHome: position h / 2³²; server names[h % N], or the first ring point at or after h', () => {
  const names = ['A', 'B', 'C'], h = hash32('user:7');
  assert.deepEqual(keyHome('user:7', names, { mod: true }), { pos: h / 2 ** 32, server: names[h % 3] });
  const pts = ringPoints(names, 10), next = pts.find(([p]) => p >= h) ?? pts[0];
  assert.equal(keyHome('user:7', names, { vnodes: 10 }).server, next[1]);
});
