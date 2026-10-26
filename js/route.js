// URL routes. Level 1 keeps the short form (#lesson, #build, #quiz); other levels use #level-2/build.
export function parseRoute(hash) {
  const h = (hash || '').replace(/^#/, '');
  const m = h.match(/^level-(\d+)(?:\/([a-z]+))?$/);
  if (m) return { level: Number(m[1]), tab: m[2] || null };
  return { level: 1, tab: h || null };
}

export const routeHash = (levelId, tab) => (levelId === 1 ? '#' + tab : `#level-${levelId}/${tab}`);
