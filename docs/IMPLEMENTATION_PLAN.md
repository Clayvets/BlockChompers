# BlockChompers -- v1 Playable Primitive Blockout: Implementation Plan

> On approval this document is committed verbatim as `docs/IMPLEMENTATION_PLAN.md` (Milestone 0). Work then proceeds milestone by milestone; each milestone ends with a short report and a proposed commit message, and waits for a go.

## Context

The repository is an architectural skeleton: every class in `src/` exposes its final public API with `// TODO(impl)` bodies, the intended contract lives in each method's JSDoc, and `tests/` holds 76 `it.todo` placeholders plus one real layering test. The goal is to turn that skeleton into a fully playable v1 blockout -- grid, perimeter track, units, 4xN reserve + 5 active slots, win/loss -- using only Three.js primitives, **without changing the architecture**: no new files beyond those listed here, no renamed public methods, no new dependencies.

## Ground rules and how each is enforced

| Rule | Enforcement |
|---|---|
| `src/core` + `src/config` pure and deterministic (no three, DOM, clocks, `Math.random`) | `tests/architecture/no-render-imports.test.js` already fails on any leak; the determinism test in M2 compares two full runs byte-for-byte. Identifiers named `performance`/`window`/`document` are avoided even as variable names, since the test greps identifiers. |
| Every value lives in `Config.js` | Every new tunable (epsilons, floors, layout offsets, colours, UI copy) is added to `Config`; core never carries a numeric literal other than 0/1/-1 and array indices. |
| Renderer only reads snapshots and events | `Renderer.sync(snapshot)` and `Renderer.bindEvents(bus)` stay the only inputs; `Renderer` never holds a reference to `GameManager`. `InputManager` is the only presentation class that calls a command (`activateUnit`). |
| `npm test` stays green after every milestone | M1 lands core with the existing tests still passing/todo; M2 converts todos; M3 adds no core changes that could regress. |

## Decisions resolved with the product owner

- `GameManager.getSnapshot()` stays the snapshot name (managers keep `toState()`); "getState()" in the brief is the generic term.
- Remaining capacity is shown as a **number sprite above each unit** (CanvasTexture on a `THREE.Sprite`, built into Three.js -- no dependency).
- After win or lose the overlay offers **Restart**, which reloads the same level. Level progression is out of scope.
- Locked mechanics (unchanged): one block per lane per pass; one shared entry corner; pass-through concurrency; lap completes when `distanceTraveled >= length`.

---

## Milestone 0 -- Commit the plan

Write this document to `docs/IMPLEMENTATION_PLAN.md`. Proposed commit: `docs: add v1 blockout implementation plan`.

---

## Milestone 1 -- Core logic (`src/config`, `src/core`)

### Config additions (all under existing sections)
- `timing.epsilon: 1e-9` -- the single tolerance used by the accumulator, lap completion and timer comparisons.
- `track.minMargin: 1` -- `Track` throws below this (margin 0 would overlap the grid and give length 0 for 1x1).
- `units.minCapacity: 1` -- level validation rejects lower (a capacity-0 unit could never eat and would only block a slot).
- `createConfig(overrides)`: recursive merge of plain objects (arrays/primitives replace), then deep freeze; never mutates `Config`.

### Track -- explicit ring of cells (`src/core/Track.js`)
Grid cell `(r, c)` has centre `(c + 0.5, r + 0.5)` in cell units, y down. The track is the ring of cells at distance `margin` outside the grid:

- N side: `y = -m + 0.5`, `x` from `-m + 0.5` to `cols + m - 1.5` (`cols + 2m - 1` cells)
- E side: `x = cols + m - 0.5`, `y` from `-m + 0.5` to `rows + m - 1.5`
- S side: `y = rows + m - 0.5`, `x` descending from `cols + m - 0.5` to `-m + 1.5`
- W side: `x = -m + 0.5`, `y` descending from `rows + m - 0.5` to `-m + 1.5`

**`length = 2(cols + 2m - 1) + 2(rows + 2m - 1)`** (1x3 grid, m=1 -> 12; 1x1 -> 8; 5x3 -> 20). Each cell: `{ x, y, side|null, laneIndex|null, facing, outward: {dx, dy}, isCorner }`. A cell has a lane iff its centre projects onto a grid column (N/S -> `laneIndex = x - 0.5`) or row (W/E -> `laneIndex = y - 0.5`); other cells (corners and, for `m >= 2`, the cells beside them) have `laneIndex: null`, `side: null` only at the four corners. `outward` is the side's outward normal; at corners the normalised diagonal of the two adjacent sides.

Construction order: build cw from NW -> **reverse if `direction === 'ccw'`** -> rotate so the `entry.corner` cell is index 0 -> compute `facing` from each cell to its successor in the final order. Consequently **`entryT` is always 0**.

- `poseAt(t)`: `i = floor(t)`, `f = t - i`, lerp between `cell[i]` and `cell[(i+1) % n]`; `facing/side/outward/isCorner` from `cell[i]`.
- `laneAt(t)` = lane of `cell[floor(t) % n]`.
- `lanesCrossed(tFrom, tTo)` (`tTo` un-normalised, may exceed `length`): integer `k` from `floor(tFrom) + 1` to `floor(tTo)`; emit `{ side, laneIndex, tCenter: k }` (un-normalised `k`) for cells with a lane, in order.
- `laneSequence()`: every lane in traversal order from the entry (used by `Simulator`).
- `normalize`, `advance`, `isLapComplete(d) = d >= length - epsilon`, `getCorners()` -- API only; **the step loop never wraps `t` with `%`** (see numeric hygiene).

### GridManager
- `validate(matrix)`: errors -- not an array / empty / ragged / non-integer or negative / entirely `emptyValue`. Warnings -- none in v1 (colour-vs-inventory mismatch is checked in `GameManager.loadLevel`, which has both).
- `load`: deep copy, `rows/cols`, colour histogram (`Map<color, count>`), `version++` (**monotonic across reloads -- never reset to 0**).
- `laneCells(side, lane)`: start at the edge cell for that side/lane, step by `INWARD[side]` until outside.
- `peekFromEdge`: first cell with `value !== emptyValue`, else `null`.
- `consumeFromEdge(side, lane, color, { max })`: walk inward skipping empties; if the first block's colour differs -> `[]` untouched; else clear consecutive same-colour blocks up to `max` (`Infinity` = chain); update histogram, `version++`; return consumed cells outermost-first.
- `toState()`: memoised per `version`, **deep-frozen** (cells are row copies), and includes `remaining` (total blocks) so the HUD needs no counting.

### InventoryManager
- `load(defs)`: ids `u0, u1, ...`; capacity defaults to `units.defaultCapacity`; `reservePos = { col: i % reserveCols, row: floor(i / reserveCols) }`; `activeSlots` slots `{ index, status: 'free', unitId: null }`; `version++` (monotonic).
- `activate(id)`: RESERVE -> ACTIVE, lowest free slot, `unit.slotIndex`; `release`/`block` as documented; if `inventory.compactReserve`, re-lay remaining RESERVE units row-major after every activation.
- `getRunners()`: ACTIVE | RUNNING | EATING, **sorted by `slotIndex`** (slot order is the tie-break for same-lane contention -- a physically later runner can win a block; documented behaviour).
- `getSlots()` / `toState()` return copies; `reserveRows = ceil(unitCount / reserveCols)`.

### Unit, EventBus
- `Unit.consume(n)`: `capacity = max(0, capacity - n)`. `isRunner()`: ACTIVE | RUNNING | EATING. `toState()`: plain copy of all fields. `timer` becomes an **integer step counter** (see hygiene).
- `EventBus`: `Map<type, Set<handler>>`; `emit` iterates a copy of the set (handlers may unsubscribe mid-emit); `once` wraps and removes.

### GameManager
`loadLevel(level)`: `GridManager.validate` (throw `Error(errors.join('; '))`), reject `capacity < units.minCapacity`, `grid.load`, `track = new Track({ rows, cols, ...config.track })`, `inventory.load`, `stepCount = 0`, accumulator 0, phase IDLE -> PLAYING with `PHASE_CHANGED` and `LEVEL_LOADED` emitted immediately. `reset()` = `loadLevel(this.level)`.

`activateUnit(id)`: `canActivate` -> on failure emit `MOVE_REJECTED` immediately and return `{ ok: false, reason }`; on success `inventory.activate`, `unit.timer = launchSteps`, emit `UNIT_ACTIVATED` immediately, return `{ ok: true, slotIndex }`. **Commands emit synchronously; steps flush after.**

`canActivate(id)` reasons in order: `NOT_PLAYING`, `UNKNOWN_UNIT`, `NOT_IN_RESERVE`, `NO_FREE_SLOT`, `NO_TARGET` (only when `!rules.allowNoTargetActivation` and `grid.countRemaining(color) === 0`).

`update(dt)`: `dt = min(dt, timing.maxFrameDt)`; `acc += dt`; `while (acc >= fixedStep - epsilon) { step(); acc -= fixedStep; }`.

`step(n = 1)` -- no-op returning `[]` unless phase is PLAYING; guarded against re-entrant `step()` from a listener. Per step, in this order:
1. **Launch** -- ACTIVE units in slot order: `timer -= 1`; when `<= 0`, if `track.launchSpacing > 0` and any RUNNING **or EATING** unit has `distanceTraveled < launchSpacing`, keep waiting; else `state = RUNNING`, `t = 0`, `distanceTraveled = 0`, `UNIT_LAUNCHED`. Newly launched units move in this same step.
2. **Move** -- RUNNING/EATING units in slot order. EATING: `timer -= 1`; if still `> 0` skip; else `RUNNING` and continue (moves this step; the sub-step remainder is discarded). RUNNING: `dist = track.speed * fixedStep`; `remaining = length - distanceTraveled`; if `dist >= remaining - epsilon` then `allowed = remaining` and this move completes the lap, else `allowed = dist`. `tFrom = t`, `tTo = tFrom + allowed`. For each lane in `lanesCrossed(tFrom, tTo)`: `consumed = grid.consumeFromEdge(side, lane, color, { max: rules.blocksPerLanePass })`; per consumed cell `unit.consume(1)` + `BLOCK_CONSUMED`; if capacity hits 0 -> `DEAD`, `inventory.release(slot)`, `UNIT_DIED`, `SLOT_FREED`, stop this unit. If something was consumed and `eatSteps > 0` -> `t = tCenter`, `distanceTraveled = tCenter`, `state = EATING`, `timer = eatSteps`, stop processing further lanes this step. Otherwise after all lanes: `t = tTo`, `distanceTraveled = tTo`; if this move completed the lap -> snap `distanceTraveled = length`, `state = RETURNED`, `inventory.block(slot)`, `UNIT_RETURNED`, `SLOT_BLOCKED`.
3. **Resolve** -- `isWon()` -> WON (`PHASE_CHANGED`, `LEVEL_WON { stepCount }`); else `isLost()` -> LOST (`PHASE_CHANGED`, `LEVEL_LOST { reason }`).
4. `stepCount++`; swap `#pendingEvents` for a fresh array, emit each on the bus in order, return the flushed array (never the internal one).

`isWon()`: `grid.isCleared() && (!rules.winWaitsForRunners || runners.length === 0)`.

`isLost()` (only when `runners.length === 0 && !grid.isCleared()`), reason precedence: `ALL_SLOTS_BLOCKED` if `!hasFreeSlot()`; `RESERVE_EMPTY` if `!hasReserve()`; `NO_VALID_MOVES` if no reserve unit passes `canActivate` (exact -- covers the `allowNoTargetActivation: false` stuck state) or if `rules.detectDeadEndsEarly && getValidMoves().length === 0` (heuristic). `getValidMoves()` is memoised on `(grid.version, inventory.version)`.

`getSnapshot()`: `{ phase, stepCount, grid: grid.toState(), track: { length, entryT, margin, direction, corners } | null, units: [ ...unit.toState(), pose: RUNNING|EATING ? track.poseAt(t) : null, progress: (initial - capacity) / initial ], slots: inventory.getSlots(), inventory: { reserveCols, reserveRows, version } }`. Plain JSON, cell units.

### Simulator
`simulateRun(snapshot, unitId, config)`: rebuild `new Track({ rows, cols, ...config.track })` and a throwaway `GridManager` loaded from `snapshot.grid.cells`; walk `track.laneSequence()` once applying `consumeFromEdge` with `rules.blocksPerLanePass` until capacity 0 -> `{ consumed, outcome, capacityLeft }`. `findValidMoves`: RESERVE units whose run consumes >= 1 block (single-unit heuristic; documented).

### Numeric hygiene (the invariants that make M2's determinism test pass)
- `entryT === 0`, so during a lap **`unit.t === unit.distanceTraveled`** and `t` is never wrapped with `%` in the step loop (`normalize` uses `%` only in its own API). The last segment is clamped to exactly `length - distanceTraveled` and then snapped to `length`; because index 0 is a corner (no lane), nothing in `(length - epsilon, length]` can be skipped.
- Launch and eat timers are integer step counts: `launchSteps = round(timing.launchDelay / fixedStep)`, `eatSteps = round(timing.eatDuration / fixedStep)` computed in `loadLevel`.
- `grid.version` / `inventory.version` are monotonic for the life of the manager (reload never resets them), so the renderer's cached versions cannot collide after `reset()`.
- Memoised states are deep-frozen; accidental mutation throws instead of corrupting later snapshots.

### Verification + report
`npm test` (existing 16 pass, 76 still todo), `npm run build`, and a scratch script (not committed) that loads `level01`, activates `u0` and steps until the phase changes. Proposed commit: `feat(core): implement grid, track, inventory and game loop`.

---

## Milestone 2 -- Headless tests (`tests/`)

### Helpers
- `createTestGame`: apply `createConfig` twice -- test base (`track.speed 1`, `timing { fixedStep 1, launchDelay 0, eatDuration 0 }`) then the caller's overrides -- so a partial `timing` override no longer wipes the base. Add `tests/helpers/playScript.js`? **No** -- `runUntil` + explicit `activateUnit` calls are enough; no new helper files.

### Scenario tests (`tests/core/GameManager.test.js`) -- hand-verified against the ring model (entry SW, cw, margin 1)
Ring for `[[1,1,1]]` (length 12) from SW: `0 SW, 1 W row0, 2 NW, 3 N col0, 4 N col1, 5 N col2, 6 NE, 7 E row0, 8 SE, 9 S col2, 10 S col1, 11 S col0`.
- **WIN** -- grid `[[1,1,1]]`, units `[{1, cap 3}]`, activate `u0`: step 1 consumes (0,0); step 4 consumes (0,1) (col0 lane is empty by then); step 5 consumes (0,2) -> `DEAD` and `WON` at `stepCount 5`; `slots[0]` free; events contain 3 `BLOCK_CONSUMED`, `UNIT_DIED`, `LEVEL_WON`.
- **LOSE A / all slots blocked** -- grid `[[2]]` (length 8), five `{1, cap 1}`, activate all five in step 0 (pass-through); all return at step 8 -> `LOST` with `ALL_SLOTS_BLOCKED` at `stepCount 8`; all five slots `blocked`; `canActivate` afterwards -> `NOT_PLAYING`.
- **LOSE B / reserve empty** -- grid `[[1,1]]`, one `{1, cap 1}` -> dies at step 1 with one block left -> `LOST` `RESERVE_EMPTY` at step 1.
- **No loss while running** -- grid `[[2]]`, one `{1, cap 1}`: PLAYING through step 7, `LOST RESERVE_EMPTY` at step 8.
- **winWaitsForRunners** -- grid `[[1]]`, `[{1, cap 2}, {1, cap 5}]`, both activated: `u0` eats at step 1 (slot order) -> WON at step 1 by default; with the flag, WON at step 8 when both have returned.
- **Determinism** -- two fresh games, identical command/step script -> `JSON.stringify` of every per-step snapshot and event list is equal. **update equivalence** -- override `timing.maxFrameDt: 100`; `update(3)` == three `step()` calls.
- Activation rejections, launch delay (`launchDelay 2` -> launches on step 2), pass-through activation while others run, slot-order contention on a shared lane, one-block-per-pass on `[[1,1,1]]` from the W side, empty/padded lanes ignored, return-to-same-slot.

### Unit tests -- every `it.todo` becomes a real `it`
- `Track.test.js`: pinned length formula; `entryT === 0` for every corner; lane indices per side on `ASYMMETRIC_4x2` (S/W descending); corners -> `null`; ccw mirrors and still starts at the entry; `lanesCrossed` across a corner, across the wrap (`tFrom 11, tTo 13` on length 12), several lanes per big step, no duplicate lane within one lap; `isLapComplete` uses distance, not `t`; `margin 0` throws.
- `GridManager.test.js`: all validation cases on the fixtures; deep copy; histogram; four `peekFromEdge` sides on `ASYMMETRIC_4x2`; padded lanes; `consumeFromEdge` max 1 vs `Infinity`, wrong colour untouched, version + `remaining`.
- `InventoryManager.test.js`: ids/layout/defaults/slot count; activate paths; release/block; `getRunners` order; `compactReserve`.
- `levels.test.js`: every shipped level validates and is not pre-won; every grid colour has a unit (assert via `loadLevel` not throwing and a warning list if introduced).
- `architecture` test unchanged.

### Verification + report
`npm test` -> 0 todo, 0 failed (expected ~95 tests). Proposed commit: `test(core): replace todos with headless win/lose scenarios and unit tests`.

---

## Milestone 3 -- Renderer, input, UI (`src/render`, `src/input`, `src/ui`, `src/main.js`)

### Config additions
- `render.track.guideColor`, `render.lights { ambient, directional, directionalPosition }`, `render.unit { radialSegments, coneRadiusFactor }`, `render.label { canvasSize, fontSize, color, worldSize, yOffset }`, `render.inventory { slotsRowOffset, reserveRowOffset, tileColor }`, `render.pixelRatioMax`.
- `ui { hudBlocksLabel, winText, loseText, restartLabel, loseReasons { ... } }`.
- `debug.logEvents` -> `main.js` subscribes a `console.log` to every event when true.

### Layout (cell units, computed in `Renderer` from the snapshot, converted with `cellToWorld`)
- Track ring drawn from `snapshot.track.corners` by walking the rectangle cell by cell (`showGuide`).
- Inventory panel below the S side: `panelTop = rows + margin + inventory.gapBelowGrid`; active slots on one row at `panelTop + slotsRowOffset`, centred under the grid; reserve grid rows at `panelTop + reserveRowOffset + reservePos.row`, columns `reservePos.col`, centred.
- Unit poses: RESERVE -> reserve cell; ACTIVE / RETURNED -> its slot; RUNNING / EATING -> `pose.x/y + outward * laneOffsetPerSlot * slotIndex`; DEAD -> mesh removed. Heading: `rotation.y = atan2(-dz, dx)` from `facing`.
- `cellToWorld(x, y, h) = (x * cellSize, h, y * cellSize)`; camera looks down `-Y` with `up = (0, 0, -1)` so grid row 0 is at the top of the screen.

### Camera
`initOrthographicCamera()` creates the camera; `fitCamera(bounds)` (called from `sync` when the grid version changes, and from `resize`) sets the frustum: `halfW = max(bw/2 + padding, (bh/2 + padding) * aspect)`, `halfH = halfW / aspect`, centred on the union of the ring and the inventory panel.

### PrimitiveFactory
`block` -> `BoxGeometry(cellSize - gap, blockHeight, cellSize - gap)` + `MeshLambertMaterial(palette[color])`; `unit` -> a `Group` holding a `ConeGeometry` rotated to point +x (the "chomper") plus a capacity `Sprite` (CanvasTexture number) at `label.yOffset`, `userData = { kind: 'unit', id }`; `slot` -> flat `PlaneGeometry` tinted by `slotColors[status]`, `userData = { kind: 'slot', id: index }`; `trackTile` -> flat plane in `guideColor`; `label(text)` -> sprite factory used by `unit` and refreshed by `Renderer` when capacity changes; geometries/materials cached by key and disposed in `dispose()`.

### Renderer.sync(snapshot)
1. `grid.version` changed -> `buildGridFromState`, and on first build `buildTrack` + `fitCamera`.
2. `inventory.version` changed -> `buildInventory` (slot tints, reserve tiles).
3. Units: create missing meshes, remove DEAD ones, pose all, update the capacity label when `capacity` differs from the cached value.
`pick(ndc)`: `Raycaster.setFromCamera` against `#pickables` (unit groups, slots); walk up to the ancestor carrying `userData.kind`. `bindEvents`: v1 wires only `LEVEL_WON`/`LEVEL_LOST` for a tint flash on slots -- everything visible is snapshot-driven, as required.

### InputManager / UIManager / main.js
- `toNdc` from `canvas.getBoundingClientRect()`; `handlePointerDown` -> `pick` -> `kind === 'unit'` -> `activateUnit(id)`; ignored while disabled.
- `UIManager.mount` builds a HUD (`ui.hudBlocksLabel` + `grid.remaining`, slot status dots) and a hidden overlay (`pointer-events: auto`) with the win/lose text and a Restart button -> `onRestart` callback -> `game.reset()` -> `hideOverlay`; subscribes to `LEVEL_WON` / `LEVEL_LOST`; `update(snapshot)` refreshes the HUD; disables input while the overlay is up via `setEnabled(false)`.
- `main.js` already wires everything; add the `debug.logEvents` subscription.

### Verification + report
`npm test` green; `npm run build`; in the Browser pane on the running dev server: `level01` renders (grid, ring, 5 slots, reserve), clicking a reserve unit launches it, blocks disappear as it passes, capacity label counts down, a unit dies / returns and blocks its slot, win and lose overlays appear and Restart reloads. Console clean. Proposed commit: `feat(render): playable primitive blockout with input and HUD`.

---

## Out of scope for v1
Level progression, animations/tweens beyond the flash, sound, mobile layout, chain consume visuals, hint system (Simulator is used only for `NO_VALID_MOVES`).

## Checkpoints
Stop after M0, M1, M2 and M3 with a report + proposed commit message; ask before any new dependency or ambiguous rule. No commits are made without a go.
