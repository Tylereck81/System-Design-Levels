// The level being played. boot.js sets it before any game module runs, so they can read it at load time.
export let level = null;
export let entry = null; // the level's entry in levels/index.js (id, title)

export function setLevel(data, levelEntry) { level = data; entry = levelEntry; }
