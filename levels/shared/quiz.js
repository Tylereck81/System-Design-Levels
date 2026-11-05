// Quiz messages that every level shares. Pure: nothing here reads game state.

/** Shown when the player scores below `pass`. */
export const failText = (pass) => `You need ${pass} to pass. Reread the lesson sections behind the questions you missed, then try again.`;

/** Shown when the player passes level `n`; `next` names level n + 1 as its menu shows it. */
export const passText = (n, next) => `Level ${n} is done. Level ${n + 1}, ${next}, is next: open it from the level menu at the top.`;
