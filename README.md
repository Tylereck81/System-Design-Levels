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
| `index.html` | The game (currently Level 1 in a single file) |
| `tests/` | Playwright tests (also run on GitHub on every push) |
