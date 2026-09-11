# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BlockChompers is a hyper-casual browser puzzle game built with Three.js (r185) and bundled with Vite 8. Plain JavaScript ES modules, no framework, no TypeScript. v1 is a playable primitive blockout (grid, perimeter track, units, 4xN reserve + 5 active slots, win/loss). `docs/IMPLEMENTATION_PLAN.md` records the design, the step order and the numeric invariants that keep core deterministic. Change core behaviour only together with a headless test in `tests/core`.

## Commands

```bash
npm install
npm run dev          # Vite dev server with HMR, http://localhost:5173
npm run build        # production bundle to dist/ (gitignored)
npm run preview      # serve dist/ at http://localhost:4173
npm test             # vitest run (node environment, no DOM)
npm run test:watch
npx vitest run tests/core/GridManager.test.js   # one file
npx vitest run -t "outermost block"             # by test name
```

`npm run build` warns that a chunk exceeds 500 kB. Expected: Three.js is bundled whole. Not a failure.

## Architecture

**Layering rule:** `src/core/**` and `src/config/**` are pure -- no `three`, no DOM, no clock, no randomness. `tests/architecture/no-render-imports.test.js` fails if that is violated, so any test run catches it.

- `src/config/Config.js` -- the single frozen config. Core reads `grid/track/units/inventory/rules/timing/progression`; `render`, `ui` and `debug` are only for `src/render` and `src/ui`. `createConfig(overrides)` deep-merges for tests.
- `src/core/` -- `GameManager` orchestrates `GridManager` (matrix), `InventoryManager` (units, 4xN reserve, 5 active slots) and `Track` (perimeter math). `ProgressManager` holds money and level progression (`getState()`). `Unit` is dumb data. `Simulator.js` holds pure dry-runs over a snapshot. `createGame.js` is the one wiring point used by both `main.js` and the tests. `Sides.js` is the single source of truth for inward directions.
- `src/render/` -- `Renderer` is the Three.js bridge (strictly top-down `OrthographicCamera`); `PrimitiveFactory` is the reskin seam: swap it (same interface) to change the look.
- `src/input/InputManager.js` -- pointer -> `renderer.pick` -> `game.activateUnit`. `src/ui/UIManager.js` -- flat DOM UI in `#ui-root`: top bar (settings, "Level N", money), pause panel, win/lose cards. It renders snapshots and turns clicks into GameManager commands; it keeps no game state.
- `src/main.js` -- composition root and rAF loop: `game.update(dt)` -> `getSnapshot()` -> `renderer.sync` -> `ui.update` -> `renderer.render`.

**Contracts**
- Commands in: `activateUnit`, `pause`, `resume`, `restartLevel`, `continueToNextLevel` return `{ ok, reason }` (`activateUnit` never throws). `continueToNextLevel` is the only way to earn money: valid only in WON, pays `progression.rewardPerLevel` once, then loads the next level. Level content loops after the last level while the level number keeps counting. Money is not persisted across page reloads. State out: `getSnapshot()` is plain JSON in cell units with `grid.version` / `inventory.version` counters, plus `paused` and `progress`. Events out (`src/core/Events.js`) are flushed after each `step()` and are garnish only -- `Renderer.sync(snapshot)` alone must draw a correct picture.
- Fixed timestep: `update(dt)` accumulates into `step()`. `tests/helpers/createTestGame.js` sets speed 1 and fixedStep 1 so one `step()` is one cell of travel.
- Coordinates: `matrix[row][col]`, row 0 = top (N), col 0 = left (W); cell-unit origin at the grid's top-left, y down. Only the renderer multiplies by `render.cellSize`.
- Scanning is discrete: `Track.lanesCrossed(tFrom, tTo)` is the only scan trigger, so a lane is scanned exactly once per lap.

**Locked mechanics** (parameterised in `Config.rules` / `Config.track`): one block per lane per pass; one shared track entry point (`entry.corner`); pass-through concurrency with render-side sub-lanes per slot (`render.track.laneOffsetPerSlot`); a lap completes when `distanceTraveled >= length`, never by comparing `t` to `entryT`.

## Levels

`src/core/levels/*.js` export `{ id, grid: number[][], units: [{ color, capacity }] }`. `0` = empty, positive ints = colour ids; zero rows/cols are padding. Level files are pure data (only `id`, `grid`, `units`; a test enforces it). Colour ids mean different colours per level: their hex values, the scene background and the empty ring/reserve tile colours live in `Config.render.levels[levelId]`, merged over the render defaults (the snapshot carries `levelId`). Every colour a level uses needs a palette entry (tested). The play order is `levels` in `src/core/levels/index.js`.

Reserve design: size each unit to what a solo lap can reach once the units before it have finished. `src/core/levels/watermelon.js` explains the method and `tests/core/watermelon.test.js` plays its scripted order to WIN under both the test timing and the shipped timing.

`GameManager.validateLevel` runs inside `loadLevel` before any state changes, and every failure is a hard error: grid structure, unit definitions, and **per-colour balance**. For each colour, the units' capacities must sum exactly to that colour's block count, so spare or missing capacity is rejected. As a consequence a level is won only by running every unit down to 0. A parked unit (one that finishes its lap with capacity left, because its colour is walled in) makes the level unwinnable. To make a unit park in a test, wall its colour in; never give it spare capacity.

## AI prompt log

`.claude/settings.json` runs `.claude/hooks/log-prompt.js` on every `UserPromptSubmit`; it appends the prompt to `ai_logs/YYYY-MM-DD.txt` (committed). The hook always exits 0 so it can never block a prompt.

## Conventions

- Code, identifiers, comments and the HTML `lang` are English. The project started in Spanish; rename any leftover Spanish names.
- The canvas id `#canvas-game` and the overlay id `#ui-root` are shared between `index.html` and `src/main.js`; rename both or neither.
- Every tunable lives in `Config.js`, including render layout and all UI copy, colours, sizes (px) and timings (`render`, `ui`). The stylesheet in `index.html` is layout-only; `UIManager` publishes `Config.ui` as CSS custom properties (`--ui-color-*`, `--ui-size-*`, `--ui-fade`) on `#ui-root`. v1 UI rule: plain DOM, solid colours, system font; no images, icon libraries or new dependencies.
- Runner sub-lanes: keep `render.track.laneOffsetPerSlot` at least the runner footprint and `render.label.worldSize`, or concurrent runners overlap on screen.
