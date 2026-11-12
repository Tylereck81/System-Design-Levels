// The home page: what the game is, how a level works, and the course map with each level's state from its save.
// Loaded by boot.js for the bare address instead of a level; it reads saves but never writes one.
import { $, html, setHtml } from './dom.js';
import { LEVELS, PARTS, TOTAL_LEVELS, MOCK_LEVELS, saveKeyOf } from '../levels/index.js';
import { readStorage } from './storage.js';
import { routeHash } from './route.js';
import { progressOf, nextStep } from './progress.js';

// State is told by word and icon, never by colour alone.
const STATE = {
  done: { icon: '✓', word: 'Done' },
  started: { icon: '◐', word: 'In progress' },
  new: { icon: '○', word: 'Not started' },
};

const progress = LEVELS.map((l) => progressOf(readStorage(saveKeyOf(l.id))));
const next = nextStep(LEVELS, progress);
const anyStarted = progress.some((p) => p.state !== 'new');

function stateText(l, p) {
  const { word } = STATE[p.state];
  if (p.state === 'started') return `${word} · ${p.done} of ${p.total} missions`;
  return l.minutes ? `${word} · ${l.minutes} min` : word;
}

const levelItem = (l, p) => html`<li><a class="home-level" href="${routeHash(l.id, 'lesson')}">
  <span class="chip">${l.id}</span>
  <span class="home-level-text"><span class="home-level-name">${l.title}</span><span class="home-level-line">${l.line}</span></span>
  <span class="home-state" data-state="${p.state}"><span class="home-state-icon" aria-hidden="true">${STATE[p.state].icon}</span>${stateText(l, p)}</span>
</a></li>`;

function partHtml(part, n) {
  const ids = LEVELS.filter((l) => l.id >= part.first && l.id <= part.last);
  return html`<section class="home-part" aria-labelledby="part-${n}">
    <h2 id="part-${n}">Part ${n} · ${part.title}</h2>
    <p class="home-part-meta">Levels ${part.first} to ${part.last}</p>
    <ol class="home-levels">${ids.map((l) => levelItem(l, progress[LEVELS.indexOf(l)]))}</ol>
  </section>`;
}

setHtml($('view-home'), html`
  <h1 id="homeTitle">System Design Levels</h1>
  <p class="home-tagline">Ace your interview.</p>
  <p class="lede">Build an architecture, send traffic through it, and break it. ${TOTAL_LEVELS} levels, from one server to video and file sync.</p>
  <p><a class="btn primary" id="homeContinue" href="${next.href}">${anyStarted ? 'Continue' : 'Start'}: ${next.label} <span aria-hidden="true">→</span></a></p>
  <section class="home-how" aria-labelledby="howTitle">
    <h2 id="howTitle">How a level works</h2>
    <ol class="home-steps">
      <li>Read a part of the lesson.</li>
      <li>Do its mission.</li>
      <li>Come back and read on.</li>
      <li>Take the quiz.</li>
    </ol>
  </section>
  ${PARTS.map((part, i) => partHtml(part, i + 1))}
  <section class="home-part" aria-labelledby="mockTitle">
    <h2 id="mockTitle">Mock interview</h2>
    <p>A random problem from levels ${MOCK_LEVELS[0]} to ${MOCK_LEVELS.at(-1)} on a blank canvas, against a 45-minute clock.</p>
    <p><a class="btn" href="${routeHash('mock', 'lesson')}">Open the mock interview</a></p>
  </section>`);

$('view-home').hidden = false;
$('view-lesson').hidden = true;
document.querySelector('.tabs').hidden = true;
// The header shows only the product name: no way home from home, and no level to name.
$('homeBtn').hidden = true;
$('lvlTitle').hidden = true;
$('brand').hidden = false;
// Any other address opens a level: start again so boot.js loads its file.
window.addEventListener('hashchange', () => location.reload());
