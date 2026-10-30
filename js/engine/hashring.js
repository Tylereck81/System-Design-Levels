// Where keys land in a cache cluster: hash % N, or a hash ring with one or more points (virtual nodes) per server.
// Servers are named A, B, C…; a server's points are the 32-bit hashes of "cache-A" (one point) or "cache-A#0",
// "cache-A#1"… (virtual nodes). Keys hash uniformly, so a server holds the share of the ring it owns.

const SPACE = 2 ** 32;
const memo = new Map();
const remember = (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };

/** 32-bit MurmurHash3 of a string. */
export function hash32(str) {
  let h = 0x9747b28c;
  for (let i = 0; i < str.length; i++) {
    let k = Math.imul(str.charCodeAt(i), 0xcc9e2d51);
    k = Math.imul((k << 15) | (k >>> 17), 0x1b873593);
    h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= str.length; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** The first `count` server names: A, B, C… */
export const serverNames = (count) => Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));

/** The ring's points for these servers, sorted by position: [position, server]. */
export function ringPoints(names, vnodes) {
  return remember(`p|${vnodes}|${names.join('')}`, () => {
    const pts = [];
    for (const s of names) for (let i = 0; i < vnodes; i++) pts.push([hash32(vnodes === 1 ? `cache-${s}` : `cache-${s}#${i}`), s]);
    return pts.sort((a, b) => a[0] - b[0]);
  });
}

// A key is stored on the first point clockwise from it (at or after its position, wrapping around).
function owner(pts, p) {
  let lo = 0, hi = pts.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][0] >= p) hi = m; else lo = m + 1; }
  return pts[lo % pts.length][1];
}

/** Share of the keys each server holds: { A: 0.2, … }. `method` is { mod: true } or { vnodes: v }. */
export function keyShares(names, method) {
  return remember(`s|${method.mod ? 'mod' : method.vnodes}|${names.join('')}`, () => {
    const sh = Object.fromEntries(names.map((s) => [s, 0]));
    if (method.mod) { for (const s of names) sh[s] = 1 / names.length; return sh; }
    const pts = ringPoints(names, method.vnodes);
    pts.forEach(([p, s], i) => { sh[s] += (p - (i ? pts[i - 1][0] : pts[pts.length - 1][0] - SPACE)) / SPACE; });
    return sh;
  });
}

/**
 * Share of the keys whose server changes when the cluster goes from servers `a` to servers `b`. With hash % N a key
 * with hash h is on a[h % N] before and b[h % N'] after; hashes are uniform, so one cycle of lcm(N, N') counts them
 * exactly. On a ring, a key moves when the owner of its position changes.
 */
export function movedShare(a, b, method) {
  return remember(`m|${method.mod ? 'mod' : method.vnodes}|${a.join('')}|${b.join('')}`, () => {
    if (method.mod) {
      const gcd = (x, y) => (y ? gcd(y, x % y) : x), L = a.length * b.length / gcd(a.length, b.length);
      let moved = 0;
      for (let h = 0; h < L; h++) if (a[h % a.length] !== b[h % b.length]) moved++;
      return moved / L;
    }
    const pa = ringPoints(a, method.vnodes), pb = ringPoints(b, method.vnodes);
    const cuts = [...new Set(pa.map((p) => p[0]).concat(pb.map((p) => p[0])))].sort((x, y) => x - y);
    let moved = 0;
    cuts.forEach((c, i) => { if (owner(pa, c) !== owner(pb, c)) moved += (c - (i ? cuts[i - 1] : cuts[cuts.length - 1] - SPACE)) / SPACE; });
    return moved;
  });
}

/** Where a key lands: its position on the ring (0 to 1) and its server. */
export function keyHome(key, names, method) {
  const h = hash32(key);
  return { pos: h / SPACE, server: method.mod ? names[h % names.length] : owner(ringPoints(names, method.vnodes), h) };
}
