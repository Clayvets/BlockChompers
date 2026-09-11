# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BlockChompers is a hyper-casual browser puzzle game built with Three.js (r185) and bundled with Vite 8. Plain JavaScript ES modules, no framework, no TypeScript. v1 is a playable primitive blockout (grid, perimeter track, units, 4xN reserve + 5 parking slots, win/loss); v2 adds feel (direct launch, acceleration, eased motion, final rush). `docs/IMPLEMENTATION_PLAN.md` records the v1 design, the step order and the numeric invariants that keep core deterministic (its slot-first launch was replaced in v2: see Locked mechanics below and the README v2 section). Change core behaviour only together with a headless test in `tests/core`.

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
- `src/core/` -- `GameManager` orchestrates `GridManager` (matrix), `InventoryManager` (units, 4xN reserve, 5 active slots) and `Track` (perimeter math). `ProgressManager` holds money and level progression (`getState()`). `Unit` is dumb data. `easing.js` holds the pure polynomial easing curves that core (acceleration, final rush) and render share. `Simulator.js` holds pure dry-runs over a snapshot. `createGame.js` is the one wiring point used by both `main.js` and the tests. `Sides.js` is the single source of truth for inward directions.
- `src/render/` -- `Renderer` is the Three.js bridge (strictly top-down `OrthographicCamera`); `PrimitiveFactory` is the reskin seam: swap it (same interface) to change the look. Layout is a fixed portrait design (`Config.render.layout`, design units = world units): `layout/computeLayout.js` (pure, tested in `tests/render`) returns every rect, the per-level board cellSize and origin, and the camera view; the camera never refits on a level change and only the board scales. Slots, reserve cells, units and labels keep their layout size on every level. `trackPlacement.js` and `launchPlacement.js` are the pure placement helpers (track path; launch flight, entry queue, return glide), tested headless in `tests/render`.
- `src/input/InputManager.js` -- pointer -> `renderer.pick` -> `game.activateUnit`. `src/ui/UIManager.js` -- flat DOM UI in `#ui-root`: top bar (settings, "Level N", money), pause panel, win/lose cards. It renders snapshots and turns clicks into GameManager commands; it keeps no game state.
- `src/main.js` -- composition root and rAF loop: `game.update(dt)` -> `getSnapshot()` -> `renderer.sync` -> `ui.update` -> `renderer.render`.

**Contracts**
- Commands in: `activateUnit`, `launchFromSlot`, `pause`, `resume`, `restartLevel`, `continueToNextLevel` return `{ ok, reason }` (the two launch commands never throw; their rejections emit `LAUNCH_REJECTED`). `continueToNextLevel` is the only way to earn money: valid only in WON, pays `progression.rewardPerLevel` once, then loads the next level. The progression is a cycle: after the last level it wraps to Level 1 with the money kept; `getState().isLastLevel` is true on the last level, where the win card says "Play again" (same command). Money is not persisted across page reloads. State out: `getSnapshot()` is plain JSON in cell units with `grid.version` / `inventory.version` counters, plus `paused`, `progress`, `stepAlpha` (fraction of the next step, for render interpolation), `launchSteps`, `finalRush` and `inventory.inUse` / `inventory.available`. Slot changes also emit `SLOT_STATE_CHANGED` (`{ slotIndex, from, to, slots }`; statuses are only `free` and `blocked`), and emptying the reserve emits `FINAL_RUSH_STARTED` once per level. Events out (`src/core/Events.js`) are flushed after each `step()` and are garnish only -- `Renderer.sync(snapshot)` alone must draw a correct picture.
- Fixed timestep: `update(dt)` accumulates into `step()`. `tests/helpers/createTestGame.js` sets speed 1 and fixedStep 1 and turns off the launch flight, eat pause, acceleration and final-rush speed-up, so one `step()` is one cell of travel.
- Coordinates: `matrix[row][col]`, row 0 = top (N), col 0 = left (W); cell-unit origin at the grid's top-left, y down. Only the renderer maps cell units to world, through the level's cellSize and board origin from `src/render/layout/computeLayout.js`.
- Scanning is discrete: `Track.lanesCrossed(tFrom, tTo)` is the only scan trigger, so a lane is scanned exactly once per lap.

**Locked mechanics** (parameterised in `Config.rules` / `Config.track`): one block per lane per pass; one shared track entry point (`entry.corner`); runners keep `track.launchSpacing` between each other along the track (a launching unit waits at the entry for it and a runner waits behind a unit that is eating; 0 = pass-through) and runners move front to back each step (ties: launch order); a lap completes when `distanceTraveled >= length`, never by comparing `t` to `entryT`. Only the front unit of each reserve column can be launched (`inventory.frontOnlyPick`; enforced in core with `NOT_FRONT` and in the renderer, which raycasts only fronts, parked units and blocked slots). When a unit leaves, its column moves up one cell (`RESERVE_SHIFTED`; logic is instant, the renderer animates it with `render.reserveShiftMs` / `reserveShiftStaggerMs`). A launch flies straight to the entry (`LAUNCHING` for `timing.launchToEntryMs`) and needs (moving + parked) < `inventory.activeSlots`; moving units hold no slot, a unit that finishes a lap with capacity left parks in the leftmost free slot, and the "N/5" counter is activeSlots - (moving + parked). A parked unit can be relaunched from its slot (`rules.allowRelaunchParked`, `launchFromSlot`): it keeps its capacity, its slot becomes free at once, and it still counts while it moves. Speed on the track is a pure function of whole-step counters: the acceleration ramp (`units.launchSpeed` -> `track.speed` over `units.accelMs`) times the final-rush factor (1 -> `rules.finalRushSpeedMultiplier` over `rules.finalRushRampMs` once the reserve is empty). LOSE (checked after WIN at the end of every step, fired once): `slots_blocked` when every slot is blocked and nothing moves (`rules.loseMode: 'deadlock'` additionally requires that no parked unit could hit a block), `out_of_units` when the reserve is empty, nothing moves, blocks remain and no parked unit could hit a block. "Could hit" = relaunch allowed and the colour is first on some lane (`GridManager.exposedColors`).

## Levels

`src/core/levels/*.js` export `{ id, grid: number[][], units: [{ color, capacity }] }`. `0` = empty, positive ints = colour ids; zero rows/cols are padding. Level files are pure data (only `id`, `name`, `grid`, `units`; a test enforces it). Ids are content ids (`watermelon`, `starter`), not positions. Colour ids mean different colours per level: their hex values, the scene background and the empty ring/reserve tile colours live in `Config.render.levels[levelId]`, merged over the render defaults (the snapshot carries `levelId`). Every colour a level uses needs a palette entry (tested). The progression is `levels` in `src/core/levels/index.js` (Watermelon -> Panda -> Carrot); `levelLibrary` holds every level, including Starter outside the cycle, and `?level=<id>` (`Config.debug.levelParam`, `src/debug/levelParam.js`) plays any of them on its own.

Reserve design: each unit is sized to what a solo lap can reach once the units before it have finished; Panda and Carrot use the fewest such laps (a search over which colour to launch next). `tests/core/watermelon.test.js` and `tests/core/newLevels.test.js` play each scripted order to WIN under both the test timing and the shipped timing.

`GameManager.validateLevel` runs inside `loadLevel` before any state changes, and every failure is a hard error: grid structure, unit definitions, and **per-colour balance**. For each colour, the units' capacities must sum exactly to that colour's block count, so spare or missing capacity is rejected. As a consequence a level is won only by running every unit down to 0. A unit parks when it finishes its lap with capacity left because its colour is walled in; it blocks its slot until relaunched. With balanced levels and relaunching on, `out_of_units` cannot happen (an exposed colour always has a living, parked unit), so the reachable LOSE is `slots_blocked`. To make a unit park in a test, wall its colour in; never give it spare capacity.

## AI prompt log

`.claude/settings.json` runs `.claude/hooks/log-prompt.js` on every `UserPromptSubmit`; it appends the prompt to `ai_logs/YYYY-MM-DD.txt` (committed). The hook always exits 0 so it can never block a prompt.

## Conventions

- Code, identifiers, comments and the HTML `lang` are English. The project started in Spanish; rename any leftover Spanish names.
- The canvas id `#canvas-game` and the overlay id `#ui-root` are shared between `index.html` and `src/main.js`; rename both or neither.
- Every tunable lives in `Config.js`, including render layout and all UI copy, colours, sizes (px) and timings (`render`, `ui`). The stylesheet in `index.html` is layout-only; `UIManager` publishes `Config.ui` as CSS custom properties (`--ui-color-*`, `--ui-size-*`, `--ui-fade`) on `#ui-root`. v1 UI rule: plain DOM, solid colours, system font; no images, icon libraries or new dependencies.
- Runners are drawn exactly on the track path: `src/render/trackPlacement.js` interpolates each unit's own `prevDistance` -> `distanceTraveled` by `stepAlpha` and converts it with `Track.positionAt()`. Never offset them sideways; spacing is `track.launchSpacing` along the track. `tests/render/trackPlacement.test.js` checks every drawn runner is on the path. Launch flights, the entry queue and the return glide come from `src/render/launchPlacement.js`; every easing name, duration, damping and curve value lives in `Config` (`render.motionEasing`, `render.rotationDamping`, ...).
