// The level being played. boot.js sets it before any game module runs, so they can read it at load time.
export let level = null;
export let entry = null; // the level's entry in levels/index.js (id, title)

export function setLevel(data, levelEntry) { level = data; entry = levelEntry; }
/** True when the level's lesson is written on one page: one part per mission, each ending with its mission's card. */
export const inParts = () => !!level?.lesson && 'parts' in level.lesson;
/** A one-page lesson's time in minutes: "Start here", when it has one, and every part. */
export const lessonMinutes = (lesson) => (lesson.start?.minutes ?? 0) + lesson.parts.reduce((n, p) => n + p.minutes, 0);

// event: something happens (e.g. a price change); only its outcome is checked.
// day: plays 24 hours of traffic in `secs` seconds; it counts when its outcome held all day.
const EXP_KINDS = ['crash', 'spike', 'event', 'day'];
/** The order every mission is played in; a guide step names the one it belongs to (`GuideStep.word`). */
export const GUIDE_ORDER = ['Add', 'Connect', 'Edit', 'Play', 'Read'];
/** The most words a guide note may have, its title included. */
export const GUIDE_WORDS = 35;
const words = (t) => t.split(/\s+/).filter(Boolean).length;

/** Problems with mission `i`'s guide steps (types.js `GuideStep`). A text written as a function is checked by the level tests. */
function guideProblems(guide, i) {
  if (!Array.isArray(guide) || !guide.length) return [`Mission ${i + 1} guide must be a list of steps`];
  const problems = [];
  guide.forEach((st, k) => {
    const at = `Mission ${i + 1} guide step ${k + 1}`;
    if (!GUIDE_ORDER.includes(st.word)) problems.push(`${at} has word "${st.word}", not one of ${GUIDE_ORDER.join(', ')}`);
    if (typeof st.title !== 'string' || !st.title) problems.push(`${at} needs a title`);
    if (typeof st.text !== 'string' && typeof st.text !== 'function') problems.push(`${at} needs a text`);
    if (typeof st.at !== 'string' && typeof st.at !== 'function') problems.push(`${at} needs an "at" selector`);
    if (st.done !== undefined && typeof st.done !== 'function') problems.push(`${at} has a "done" that is not a function`);
    if (typeof st.text === 'string' && words(`${st.title} ${st.text}`) > GUIDE_WORDS) problems.push(`${at} is over ${GUIDE_WORDS} words`);
  });
  return problems;
}

/** Problems that would make a level misbehave silently (a step lesson's own checks are in validate-lesson.js). An empty list means the level is fine. */
export function validateLevel(data) {
  const problems = [], ids = new Set();
  if ((data.lesson === undefined) === (data.lessonHtml === undefined)) problems.push('a level needs exactly one of lesson and lessonHtml');
  for (const e of data.experiments || []) {
    if (ids.has(e.id)) problems.push(`two experiments use the id "${e.id}"`);
    ids.add(e.id);
    if (!EXP_KINDS.includes(e.kind)) problems.push(`experiment "${e.id}" has unknown kind "${e.kind}"`);
    if (e.kind === 'crash' && typeof e.target !== 'function' && typeof e.targets !== 'function') problems.push(`crash experiment "${e.id}" needs a target or targets function`);
    if (e.kind === 'day' && !(e.secs > 0 && Array.isArray(data.workload?.day) && data.workload.day.length === 24)) problems.push(`day experiment "${e.id}" needs secs and a 24-hour workload.day`);
  }
  data.missions.forEach((M, i) => {
    for (const g of M.goals) if (g.type === 'exp' && !ids.has(g.id)) problems.push(`Mission ${i + 1} goal "${g.id}" has no matching experiment`);
    if (M.guide !== undefined) problems.push(...guideProblems(M.guide, i));
  });
  return problems;
}
