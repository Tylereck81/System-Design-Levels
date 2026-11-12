// Entry point: the home page for the bare address; otherwise load the level named in the URL and start the game with it.
import { LEVELS, MOCK } from '../levels/index.js';
import { parseRoute } from './route.js';
import { setLevel, validateLevel } from './level.js';

const wanted = parseRoute(location.hash).level;
if (wanted === 'home') {
  await import('./home.js'); // loads no level: state.js reads one at import time
} else {
  const levelEntry = wanted === 'mock' ? MOCK : LEVELS.find(l => l.id === wanted) || LEVELS[0];
  const data = (await levelEntry.load()).default;
  const problems = validateLevel(data);
  if (problems.length) throw new Error(`Level ${levelEntry.id} is not valid: ${problems.join('; ')}`);
  setLevel(data, levelEntry);
  await import('./main.js');
}
