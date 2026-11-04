# Simulation snapshot

`tests/model-snapshot.spec.js` checks that the simulation gives exactly the recorded result for every level, on the
designs the other tests build. It guards refactors: a change that should not alter the game's numbers must leave it
passing. It does not show that the numbers are right; the hand-computed tests (`model-golden.spec.js`, the level
specs) do that.

| Path | Holds |
|---|---|
| `designs/level-NN.json` | Designs recorded from the test suite, one per line, with the mission each was measured on. Each level's start design is added by the spec, so it is not listed here. Every playable level must have one (an empty list is fine). |
| `expected/level-NN.json` | One line per case: `m<mission>/d<design>/<experiment or calm>/<moment>` → the model's result (without the graph view) and the mission's goals (met or not, and the value shown). |
| `capture.js`, `collect.mjs` | Record and select the designs. |

Each design is measured with no experiment at two moments of the traffic's wobble and at its peak (and, when it has
queues, with 600 jobs waiting in each: `backlog/t0`), and with each of the level's experiments running: now, and at
the peak when the experiment has a required outcome. A crash is measured
on every component it could take down (`crash:<id>`), and a day at 03:00, 12:00 and 18:00 (`day@3h`).

What it does not cover: the frame loop (goal holding, experiment timers, mission completion), the animation, and the
page itself. The level specs test those.

## When it fails

The message lists the first values that differ, e.g. `m1/d3/calm/t0.node.w.ms: expected 80, got 84`.

- In a refactor: the change altered the simulation. Find out why and fix the code; do not update the snapshot.
- In a change to a formula or constant that the owner approved: update the expected files (below) in the same PR,
  and say in the PR which values changed and why.

## Update the expected results (approved rule changes only)

```bash
SDL_SNAPSHOT_UPDATE=1 npx playwright test model-snapshot --project=chromium
```

## Record the designs again (after adding a level or many new tests)

```bash
SDL_CAPTURE=1 npx playwright test --project=chromium   # records to test-results/snapshot-capture/
node tests/snapshot/collect.mjs                       # writes designs/, at most 16 per mission
SDL_SNAPSHOT_UPDATE=1 npx playwright test model-snapshot --project=chromium
```

A design is recorded when a test asks the model about it, or when its mission becomes verified. The snapshot spec
itself never records. Playwright empties `test-results/` when a run starts, so only that run's designs are collected. Do this on a commit
whose numbers are known to be right (normally `main`), never in the same PR as an engine change.
