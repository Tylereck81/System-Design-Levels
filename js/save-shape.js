// The checks on a saved design that need no level: state.js adds the level's own (component types, sizes, mission
// count), and the home page uses these alone to tell a save the level would load from one it would discard. Pure.

/**
 * True when `src` has the shape of a save: nodes with ids and positions, a Users node, connections between those
 * nodes, and a mission index.
 * @param {any} src
 */
export function saveShapeOk(src) {
  if (!src || typeof src !== 'object' || !Array.isArray(src.nodes) || !Array.isArray(src.edges)) return false;
  if (!src.nodes.every((n) => n && typeof n.id === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y))) return false;
  if (!src.nodes.some((n) => n.type === 'users')) return false;
  const ids = new Set(src.nodes.map((n) => n.id));
  if (!src.edges.every((e) => e && ids.has(e.from) && ids.has(e.to))) return false;
  return Number.isInteger(src.mission) && src.mission >= 0;
}
