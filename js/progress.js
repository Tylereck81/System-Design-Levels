// Course progress for the home page, read from each level's own save without loading the level. Pure.
import { routeHash } from './route.js';
import { saveShapeOk } from './save-shape.js';

/**
 * @typedef {object} LevelProgress
 * @property {'done' | 'started' | 'new'} state  every mission done; a save exists; no usable save
 * @property {number} done   missions done
 * @property {number} total  missions in the level, as the save records them (0 when there is no save)
 */

/**
 * A level's progress from its saved text (null when there is none). A save that the level itself would not load
 * (not JSON, no mission list) counts as not started, since the level then starts fresh.
 * @param {string | null} text
 * @returns {LevelProgress}
 */
export function progressOf(text) {
  let src;
  try { src = text ? JSON.parse(text) : null; } catch { src = null; }
  const list = saveShapeOk(src) && Array.isArray(src.done) && src.mission < src.done.length ? src.done : null;
  if (!list) return { state: 'new', done: 0, total: 0 };
  const done = list.filter(Boolean).length; // as state.js load() reads it
  return { state: done === list.length ? 'done' : 'started', done, total: list.length };
}

/**
 * The next unfinished thing: the first level not done, in course order (its Build tab once it is started, else its
 * lesson), or the mock interview when every level is done.
 * @param {{ id: number, title: string }[]} levels
 * @param {LevelProgress[]} progress  one per level, in the same order
 * @returns {{ href: string, label: string }}
 */
export function nextStep(levels, progress) {
  const i = progress.findIndex((p) => p.state !== 'done');
  if (i < 0) return { href: routeHash('mock', 'lesson'), label: 'Mock interview' };
  const { id, title } = levels[i];
  return { href: routeHash(id, progress[i].state === 'started' ? 'build' : 'lesson'), label: `Level ${id} · ${title}` };
}
