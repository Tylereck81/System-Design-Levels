// URL routes. Level 1 keeps the short form (#lesson, #build, #quiz); other levels use #level-2/build.
// Addresses are read without regard to case and may end with a slash, e.g. #LEVEL-2/ or #level-2/Build.
export function parseRoute(hash) {
  const h = decodeURIComponent((hash || '').replace(/^#/, '')).toLowerCase().replace(/\/+$/, '');
  const m = h.match(/^level-(\d+)(?:\/([a-z]*))?$/);
  if (m) return { level: Number(m[1]), tab: m[2] || null };
  return { level: 1, tab: h || null };
}

export const routeHash = (levelId, tab) => (levelId === 1 ? '#' + tab : `#level-${levelId}/${tab}`);
