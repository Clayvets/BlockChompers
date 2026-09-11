# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BlockChompers is a hyper-casual browser puzzle game built with Three.js (r185) and bundled with Vite 8. Plain JavaScript ES modules, no framework, no TypeScript. The codebase is currently an **architectural skeleton**: every class exposes its final public API with `// TODO(impl)` bodies, and the intended rules live in the JSDoc on each method. Fill bodies in only together with the matching test in `tests/core` (turn its `it.todo` into a real `it` first).

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

`npm run build` will warn that a chunk exceeds 500 kB once the renderer uses more of Three.js. Expected: Three.js is bundled whole. Not a failure.

## Architecture

**Layering rule:** `src/core/**` and `src/config/**` are pure -- no `three`, no DOM, no clock, no randomness. `tests/architecture/no-render-imports.test.js` fails if that is violated, so any test run catches it.

- `src/config/Config.js` -- the single frozen config. Core reads `grid/track/units/inventory/rules/timing`; `render` and `debug` are only for `src/render` and `src/ui`. `createConfig(overrides)` deep-merges for tests.
- `src/core/` -- `GameManager` orchestrates `GridManager` (matrix), `InventoryManager` (units, 4xN reserve, 5 active slots) and `Track` (perimeter math). `Unit` is dumb data. `Simulator.js` holds pure dry-runs over a snapshot. `createGame.js` is the one wiring point used by both `main.js` and the tests. `Sides.js` is the single source of truth for inward directions.
- `src/render/` -- `Renderer` is the Three.js bridge (strictly top-down `OrthographicCamera`); `PrimitiveFactory` is the reskin seam: swap it (same interface) to change the look.
- `src/input/InputManager.js` -- pointer -> `renderer.pick` -> `game.activateUnit`. `src/ui/UIManager.js` -- DOM overlay in `#ui-root`.
- `src/main.js` -- composition root and rAF loop: `game.update(dt)` -> `getSnapshot()` -> `renderer.sync` -> `ui.update` -> `renderer.render`.

**Contracts**
- Commands in: `activateUnit(id)` returns `{ ok, reason }` and never throws. State out: `getSnapshot()` is plain JSON in cell units with `grid.version` / `inventory.version` counters. Events out (`src/core/Events.js`) are flushed after each `step()` and are garnish only -- `Renderer.sync(snapshot)` alone must draw a correct picture.
- Fixed timestep: `update(dt)` accumulates into `step()`. `tests/helpers/createTestGame.js` sets speed 1 and fixedStep 1 so one `step()` is one cell of travel.
- Coordinates: `matrix[row][col]`, row 0 = top (N), col 0 = left (W); cell-unit origin at the grid's top-left, y down. Only the renderer multiplies by `render.cellSize`.
- Scanning is discrete: `Track.lanesCrossed(tFrom, tTo)` is the only scan trigger, so a lane is scanned exactly once per lap.

**Locked mechanics** (parameterised in `Config.rules` / `Config.track`): one block per lane per pass; one shared track entry point (`entry.corner`); pass-through concurrency with render-side sub-lanes per slot (`render.track.laneOffsetPerSlot`); a lap completes when `distanceTraveled >= length`, never by comparing `t` to `entryT`.

## Levels

`src/core/levels/*.js` export `{ id, grid: number[][], units: [{ color, capacity }] }`. `0` = empty, positive ints = colour ids; zero rows/cols are padding. `GridManager.validate` runs before `load`.

## AI prompt log

`.claude/settings.json` runs `.claude/hooks/log-prompt.js` on every `UserPromptSubmit`; it appends the prompt to `ai_logs/YYYY-MM-DD.txt` (committed). The hook always exits 0 so it can never block a prompt.

## Conventions

- Code, identifiers, comments and the HTML `lang` are English. The project started in Spanish; rename any leftover Spanish names.
- The canvas id `#canvas-game` and the overlay id `#ui-root` are shared between `index.html` and `src/main.js`; rename both or neither.
