# System Design Levels

A drag-and-drop game for practising system design interviews. Each level has a lesson, missions where you build an architecture and watch simulated traffic run through it, "break it" experiments, and a quiz.

**Status:** Level 1 of 21 is playable.

## Run it

Requires [Node.js](https://nodejs.org) (LTS).

```bash
npm install
npm start          # open http://localhost:4173
```

## Test it

```bash
npx playwright install chromium   # first time only
npm test
```

## Project layout

| Path | What it is |
|---|---|
| `index.html` | The page structure (currently Level 1) |
| `js/main.js` | Boot, tab routing and re-rendering after a change (the page's ES module entry point) |
| `js/state.js` | Game state and saved progress |
| `js/engine/` | Simulation model, canvas, dragging and connecting, request dots, simulation loop |
| `js/ui/` | Dashboard, inspector, mission panel, controls, log, lesson diagrams, quiz |
| `levels/level-01.js` | Everything specific to Level 1: components, rules, missions, quiz and text |
| `css/styles.css` | All styles: design tokens, light and dark themes, layout |
| `tests/` | Playwright tests (also run on GitHub on every push) |
