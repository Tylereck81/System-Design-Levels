// @ts-check
// The mock interview: one of the real-system levels as a timed problem on a blank canvas.
// It borrows that level's components, simulation and Break-it experiments, but gives no missions, goals or hints:
// the player scopes, sketches, goes deep and stresses the design against a clock, then checks their own work.
/** @import { Level } from '../js/types.js' */
import { MOCK_LEVELS } from './index.js';
import { STEPS, PROBLEM_KEY } from './mock-steps.js';
import { stepsGrid } from './shared/lesson.js';
import { readStorage, writeStorage } from '../js/storage.js';

function chosenProblem() {
  const id = Number(readStorage(PROBLEM_KEY));
  if (MOCK_LEVELS.includes(id)) return id;
  const pick = MOCK_LEVELS[Math.floor(Math.random() * MOCK_LEVELS.length)];
  writeStorage(PROBLEM_KEY, String(pick));
  return pick;
}

/**
 * A mock interview level made from level `src` (its id `id`).
 * @param {Level} src
 * @param {number} id
 * @returns {Level}
 */
export function mockOf(src, id) {
  const users = src.startNodes.find((n) => n.type === 'users');
  const first = src.missions[0];
  // Traffic and request mix of the level's first mission, without its goals, estimate or hints.
  const mission = { ...first, title: src.mock.title, ref: 'Mock interview', story: src.mock.brief, goals: [], hint: '', takeaway: '' };
  delete mission.gate;
  delete mission.budget;
  return {
    ...src,
    id: 'mock',
    interview: { problem: id, title: src.mock.title, brief: src.mock.brief, checklist: src.mock.checklist },
    saveKey: `sdl-mock-${id}-v1`,
    saveVersion: 1,
    startNodes: [{ ...users }],
    startEdges: [],
    missions: [mission],
    quiz: { passScore: 0, questions: [], passText: '', failText: '' },
    lessonHtml: `
    <p class="label">Mock interview</p>
    <h1>${src.mock.title}</h1>
    <p class="lede">${src.mock.brief}</p>
    <div class="goals-box">
      <div><b>You have</b>45 minutes and a blank canvas with that problem's parts.</div>
      <div><b>You get</b>No goals and no hints: the simulation shows what your design can carry.</div>
      <div><b>At the end</b>Check your answer against the list of points an interviewer looks for.</div>
    </div>
    <section>
      <h2>How it works</h2>
      <p class="src">Interview loop · 45 minutes</p>
      ${stepsGrid(STEPS.map((s) => s.tip))}
      <p>Start the timer on the Build tab and move to the next step yourself. A step turns amber when it runs over. Talk through your choices out loud, as you would to an interviewer.</p>
    </section>`,
    drawFigures() {},
  };
}

const id = chosenProblem();
export default mockOf((await import(`./level-${id}.js`)).default, id);
