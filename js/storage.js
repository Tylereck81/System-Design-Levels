// Browser storage that never throws. Storage can be missing (private mode, blocked cookies) or full; the game then
// plays on without saving. Imports nothing, so level files and any module can use it.

/** The stored string for `key`, or null when there is none or storage can't be read. */
export function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Store `value` under `key`. Returns false when storage is unavailable or full. */
export function writeStorage(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

/** Forget what is stored under `key`. */
export function removeStorage(key) {
  try { localStorage.removeItem(key); } catch { /* nothing stored that can be read either */ }
}
