// @ts-check
// Lesson parts that every level shows: the four interview steps, with the minutes from the mock interview's `STEPS`.
// Pure: it returns HTML strings.
import { STEPS } from '../mock-steps.js';

/**
 * The step cards: "Step 1 · 5–8 min", the step's name, then that step's text.
 * @param {string[]} texts  one text per step, in order
 * @returns {string}
 */
export function stepsGrid(texts) {
  if (texts.length !== STEPS.length) throw new Error(`stepsGrid needs ${STEPS.length} texts, got ${texts.length}`);
  const cards = STEPS.map((s, i) => {
    const minutes = s.min === s.max ? `${s.min}` : `${s.min}–${s.max}`;
    return `<div><span>Step ${i + 1} · ${minutes} min</span><b>${s.name}</b>${texts[i]}</div>`;
  });
  return `<div class="steps4">${cards.join('')}</div>`;
}

/**
 * A lesson's "How each mission maps to the interview" heading, source line and step cards.
 * @param {string[]} texts  what the player does in each step of this level, in order
 * @returns {string}
 */
export function lessonSteps(texts) {
  return `<h2>How each mission maps to the interview</h2>
      <p class="src">Interview loop · times for a 45-minute interview (formats vary by company)</p>
      ${stepsGrid(texts)}`;
}
