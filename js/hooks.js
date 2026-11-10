// Functions main.js owns that other modules call back into: re-render after a change, and switch tabs.
// main.js registers them at boot; other modules import `hooks` from here instead of importing main.js, so no module
// depends on the app's entry point. This file imports nothing.

const NAMES = ['afterChange', 'afterDesignChange', 'renderTabs', 'setTab'];

const notRegistered = (name) => () => { throw new Error(`hooks.${name} was called before main.js registered it`); };

/**
 * @type {{
 *   afterChange: (forceFit?: boolean) => void,
 *   afterDesignChange: (opts?: { keepResults?: boolean }) => void,
 *   renderTabs: () => void,
 *   setTab: (tab: string, focusTab?: boolean) => void,
 * }}
 */
export const hooks = Object.fromEntries(NAMES.map(name => [name, notRegistered(name)]));

/** Called once by main.js before the first render, with all four functions. */
export function registerHooks(fns) {
  for (const name of NAMES) {
    if (typeof fns[name] !== 'function') throw new Error(`registerHooks: ${name} is missing`);
    hooks[name] = fns[name];
  }
}
