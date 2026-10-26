// Entry point: load the level named in the URL, then start the game with it.
import { LEVELS } from '../levels/index.js';
import { parseRoute } from './route.js';
import { setLevel } from './level.js';

const wanted = parseRoute(location.hash).level;
const levelEntry = LEVELS.find(l => l.id === wanted) || LEVELS[0];
setLevel((await levelEntry.load()).default, levelEntry);
await import('./main.js');
