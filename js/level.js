// The level being played. boot.js sets it before any game module runs, so they can read it at load time.
export let level = null;
export let entry = null; // the level's entry in levels/index.js (id, title)

export function setLevel(data, levelEntry) { level = data; entry = levelEntry; }

// event: something happens (e.g. a price change); only its outcome is checked.
// day: plays 24 hours of traffic in `secs` seconds; it counts when its outcome held all day.
const EXP_KINDS = ['crash', 'spike', 'event', 'day'];

/** Problems that would make a level misbehave silently. An empty list means the level is fine. */
export function validateLevel(data) {
  const problems = [], ids = new Set();
  for (const e of data.experiments || []) {
    if (ids.has(e.id)) problems.push(`two experiments use the id "${e.id}"`);
    ids.add(e.id);
    if (!EXP_KINDS.includes(e.kind)) problems.push(`experiment "${e.id}" has unknown kind "${e.kind}"`);
    if (e.kind === 'crash' && typeof e.target !== 'function' && typeof e.targets !== 'function') problems.push(`crash experiment "${e.id}" needs a target or targets function`);
    if (e.kind === 'day' && !(e.secs > 0 && Array.isArray(data.workload?.day) && data.workload.day.length === 24)) problems.push(`day experiment "${e.id}" needs secs and a 24-hour workload.day`);
  }
  data.missions.forEach((M, i) => {
    for (const g of M.goals) if (g.type === 'exp' && !ids.has(g.id)) problems.push(`Mission ${i + 1} goal "${g.id}" has no matching experiment`);
  });
  return problems;
}
