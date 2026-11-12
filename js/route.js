// URL routes. The address with nothing after it is the home page. Level 1 keeps the short form (#lesson, #build,
// #quiz); other levels use #level-2/build, and the mock interview #mock/build.
// Addresses are read without regard to case and may end with a slash, e.g. #LEVEL-2/ or #level-2/Build.
export function parseRoute(hash) {
  const h = decodeURIComponent((hash || '').replace(/^#/, '')).toLowerCase().replace(/\/+$/, '');
  if (!h) return { level: 'home', tab: null };
  const m = h.match(/^level-(\d+)(?:\/([a-z]*))?$/);
  if (m) return { level: Number(m[1]), tab: m[2] || null };
  const k = h.match(/^mock(?:\/([a-z]*))?$/);
  if (k) return { level: 'mock', tab: k[1] || null };
  return { level: 1, tab: h || null };
}

/** Show `hash` in the address bar without a new history entry (some embedded pages forbid it: then nothing changes). */
export function replaceHash(hash) {
  try { history.replaceState(null, '', hash); } catch { /* the address bar keeps its old value */ }
}

export const routeHash = (levelId, tab) => (levelId === 1 ? '#' + tab : levelId === 'mock' ? `#mock/${tab}` : `#level-${levelId}/${tab}`);
