// Entry point: load the level named in the URL, then start the game with it.
import { LEVELS } from '../levels/index.js';
import { parseRoute } from './route.js';
import { setLevel, validateLevel } from './level.js';

const wanted = parseRoute(location.hash).level;
const levelEntry = LEVELS.find(l => l.id === wanted) || LEVELS[0];
const data = (await levelEntry.load()).default;
const problems = validateLevel(data);
if (problems.length) throw new Error(`Level ${levelEntry.id} is not valid: ${problems.join('; ')}`);
setLevel(data, levelEntry);
await import('./main.js');
