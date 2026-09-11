# BlockChompers

Hyper-casual browser puzzle game (Three.js + Vite, plain JavaScript). Units ride a one-way track around a pixel-art grid
and eat the outermost block of their colour on each lane they pass. Clear the grid to win.

## v1 – Primitive

Goal (from the assignment): gameplay matches the reference video using primitives only (boxes/spheres/planes), win
state included. v1 is a complete loop of three pixel-art levels with win, lose, money and a replayable cycle.

### How to run

```bash
npm install
npm run dev    # http://localhost:5173
npm test       # headless tests (Vitest)
```

Add `?level=<id>` to the dev URL to play one level on its own: `watermelon`, `panda`, `carrot` or `starter`
(for example `http://localhost:5173/?level=starter`).

### Controls

Mouse or touch; there are no keyboard shortcuts.

- **Launch:** click a unit in the front row of the reserve. It takes the lowest free slot and enters the track 0.25 s
  later, once the entry is clear.
- **Relaunch:** click a parked unit, or its red slot, to send it round again with the capacity it has left.
- **Pause:** the settings button (top left) pauses the game and offers Resume and Restart level.
- **End of level:** the win card's "Continue +$50" ("Play again +$50" on Level 3) pays and loads the next level. The
  lose card's "Retry" restarts the level.

### What changed

In build order:

1. **Core mechanics.** `GridManager` ingests each level as a 2D array (0 = empty, positive integers = colour ids, zero
   rows and columns are padding) and validates it. `Track` is a one-way clockwise ring one cell outside the grid, with
   one shared entry corner. A running unit fires inward on every lane it crosses and removes the outermost block if it
   matches its colour, one block per lane per pass, losing 1 capacity per block. The reserve has 4 columns and the
   play zone has 5 slots. A unit dies at 0 and frees its slot; a unit that ends its lap with capacity left parks and
   blocks its slot. Win when the grid is empty; lose when no move is left.
2. **Headless tests.** 104 tests drive the game through `GameManager` alone: a WIN, both LOSE reasons, and determinism
   (byte-identical snapshots and events across runs).
3. **Primitive renderer and input.** A strictly top-down `OrthographicCamera`. Blocks are boxes, track, slot and
   reserve tiles are flat planes, and units are 3-sided cones with a capacity number above them. Clicking a unit
   launches it. A debug HUD and a win/lose overlay with Restart.
4. **Bug fix: unbalanced levels.** Cause: a unit with more capacity than the blocks of its colour finished its lap,
   parked and blocked its slot for the rest of the level, and the colour check was only a dev warning. Fix:
   `GameManager.validateLevel` rejects a level unless, for every colour, the unit capacities add up exactly to that
   colour's block count. A level is therefore won only by running every unit down to 0.
5. **Minimal UI.** A top bar with the settings button (pause panel with Resume and Restart level), "Level N" and the
   money. The win card shows "Congratulations!" and "Continue +$50"; the lose card shows "Out of space" and "Retry"
   for either loss reason. Money and progression live in a pure core `ProgressManager`: the reward is paid once per
   win, and Retry or Restart pay nothing.
6. **Level: Watermelon.** The first level built from pixel art (17 x 18). Its palette, light-blue background and
   empty-tile colours live in `Config.render.levels`, keyed by level id, so the level file stays pure data. A test
   plays its scripted launch order to WIN.
7. **Interaction rules.** Only the front unit of each reserve column is pickable (core rejects the others and the
   renderer does not raycast them). When a unit leaves, the units behind it move up one cell, animated one at a time
   from front to back. A parked unit can be relaunched from its slot with its remaining capacity, keeping the slot,
   until it reaches 0. Lose became a deadlock check. Watermelon became Level 1 and the original first level became
   Starter.
8. **Bug fixes: drift and the missing lose condition.**
   - *Units drifting off the track.* Cause: the renderer offset each runner sideways by
     `render.track.laneOffsetPerSlot` times its slot index (up to 2.56 cells), so runners in higher slots sat outside
     the track. Fix: each unit is drawn at its own distance along the track, interpolated between logic steps and
     converted with `Track.positionAt()`, so it follows the path through corners. Spacing now exists only along the
     track, as a 1-cell follow distance (`track.launchSpacing`).
   - *Missing lose condition.* Cause: lose required a full deadlock, so any parked unit whose colour was still first
     on some lane kept the level alive, even with all 5 slots blocked. Fix: `rules.loseMode`, default
     `'allSlotsBlocked'`, loses as soon as every slot is blocked and nothing moves. Lose is checked after win each
     step and `LEVEL_LOST` fires once.
   - The same step added the "N/5" free-slot counter next to the slot row, updated on the new `SLOT_STATE_CHANGED`
     event.
9. **Levels: Panda, Carrot and the cycle.** The progression is Level 1 (Watermelon, 17 x 18, 20 units), Panda
   (24 x 22, 15 units) and Carrot (39 x 23, 25 units), each built from pixel art. Winning Level 3 shows "Play again
   +$50", pays the reward and loads Level 1 with the money kept. Starter (3 x 5, 5 units) stays outside the cycle and
   loads with `?level=starter`. Capacity labels squeeze to fit 3 digits.
10. **Tests today.** 185 headless tests in 18 files, run in Node with no DOM or WebGL. They cover each manager, WIN and
    LOSE scenarios, determinism, picks and relaunches, follow distance, both lose modes, the slot counter, level
    validation, the progression cycle, and that every drawn runner lies on the track path. Each progression level
    plays a scripted launch order to WIN under both the fast test timing and the shipped timing. An architecture test
    fails if core imports Three.js or the DOM.

### Why it improved feel

- **Top-down orthographic camera, flat colours.** With no perspective every cell is the same size on screen and each
  track cell lines up with the row or column it scans, so the player sees which block a lane exposes. Colour is the
  only thing to read: the lights are set so palette colours render true, and each primitive has one job (boxes are
  blocks, planes are tiles and slots, a cone points where a unit is heading).
- **Per-level palettes and backgrounds.** Each level has its own palette, background and empty-tile colour, keyed by
  level id. Mid-tone backgrounds and darker tiles keep both black outlines and white blocks readable, and the solid
  top bar keeps the HUD readable on light scenes.
- **Fixed timestep and determinism.** Logic runs in fixed 1/60 s steps whatever the frame rate, and core has no clock
  or randomness. The same clicks always give the same result, a slow frame cannot skip a lane scan, and tests replay
  whole levels exactly.
- **One-way track pacing.** Every unit enters at the same corner and travels the same way at 4 cells per second, so
  the player can predict its next hit. A short pause per eaten block and a 1-cell follow distance keep units in single
  file and make each hit visible. The renderer interpolates each unit's distance along the track between logic
  steps, so motion is smooth at any refresh rate and follows corners instead of cutting them.
- **Capacity labels and the slot counter.** Each unit shows its remaining capacity, counting down with every block it
  eats. The "N/5" counter and the red tint of blocked slots show how close the player is to "Out of space".
- **Overlay timing.** The win or lose card waits 0.6 s after the event, so the last hit or the last parked unit stays
  visible while the background takes a green or red tint. The card then fades in over 0.15 s and blocks input to the
  board.
- **Strict core/render separation.** Core holds only data and rules. The renderer and UI read snapshots and events
  and send commands, `PrimitiveFactory` is the one place meshes are made, and every visual value lives in
  `Config.render` and `Config.ui`. v2, v3 and the Fish of Fortune reskin can therefore be config and presentation
  changes only, while the headless tests keep guarding the rules.

### Exact values tuned

Values are copied from `src/config/Config.js`. Layer: **core** is read by the deterministic game logic; **render** is
presentation only (`src/render` and the DOM UI in `src/ui`).

| Config key | Value | Layer | Why |
|---|---|---|---|
| `track.speed` | `4` | core | Cells per second: a unit crosses about four lanes a second, and a Level 1 lap (74 cells) takes 18.5 s. |
| `track.direction` | `'cw'` | core | One-way loop: every unit meets the lanes in the same order. |
| `track.margin` | `1` | core | Track offset: the ring runs one cell outside the grid. |
| `track.entry.corner` | `'SW'` | core | One shared entry; a lap runs from this corner back to it. |
| `track.launchSpacing` | `1` | core | Entry spacing and follow distance along the track. At least `render.unitSize`, so units never overlap. |
| `timing.fixedStep` | `1 / 60` | core | Fixed logic step (s), so outcomes never depend on the frame rate. |
| `timing.maxFrameDt` | `0.1` | core | Longest frame the logic catches up on (s), so a hidden tab does not trigger a burst of steps. |
| `timing.launchDelay` | `0.25` | core | Slot to track (s): the unit is seen in its slot before it runs. |
| `timing.eatDuration` | `0.15` | core | Pause per eaten block (s), so each hit reads. |
| `inventory.reserveCols` | `4` | core | Reserve width; rows follow the level's unit count. |
| `inventory.activeSlots` | `5` | core | Strict size of the play zone; the "N/5" counter and the lose rule count against it. |
| `rules.blocksPerLanePass` | `1` | core | Shots per lane pass: a unit strips a colour one layer at a time instead of chaining inward. |
| `inventory.frontOnlyPick` | `true` | core | Only the front unit of each reserve column can be launched. |
| `rules.allowRelaunchParked` | `true` | core | A parked unit goes back on the track from its slot with its remaining capacity. |
| `rules.loseMode` | `'allSlotsBlocked'` | core | Lose as soon as all 5 slots are blocked and nothing moves, so a board full of parked units ends the level. `'deadlock'` also requires that no parked unit could hit a block. |
| `rules.winWaitsForRunners` | `false` | core | Win the moment the grid is empty. |
| `progression.startingMoney` | `0` | core | Money at the start of a session. |
| `progression.rewardPerLevel` | `50` | core | Paid once per won level, on Continue or Play again. |
| `render.reserveShiftMs` | `160` | render | Time for a reserve unit to glide up one cell (ms). |
| `render.reserveShiftStaggerMs` | `60` | render | Delay after the unit ahead starts (ms): units move up one by one and never overlap. |
| `render.gap` | `0.08` | render | Gap between block boxes, so each pixel of the art reads as a cell. |
| `render.unitSize` | `0.8` | render | Unit cone length in cells, below the 1-cell follow distance. |
| `render.lights.ambientIntensity` / `directionalIntensity` | `2` / `1.5` | render | Keeps palette colours true under physically based lighting. |
| `render.background` / `render.palette` | `0x000000` / `{ 1: 0xff5c5c, 2: 0x4cb5ff }` | render | Defaults for a level without its own entry (Starter). |
| `render.levels.watermelon.palette` | `{ 1: 0x000000, 2: 0xff5a78, 3: 0xf50f3c, 4: 0xffffff, 5: 0x23ab57, 6: 0x0f8a3c }` | render | Colours of the reference art. |
| `render.levels.watermelon.background` | `0xc5ecfb` | render | The art's own light blue; black blocks read on it. |
| `render.levels.watermelon.track.guideColor` / `inventory.tileColor` / `track.entryColor` | `0x5f97b3` / `0x5f97b3` / `0x467d99` | render | Mid-blue empty tiles: black units about 6.6:1 and white about 3.2:1 (a light tile left white at 1.7:1). |
| `render.levels.panda.palette` | `{ 1: 0x0a0a0a, 2: 0xffffff, 3: 0x2c6b1a }` | render | Colours of the reference art. |
| `render.levels.carrot.palette` | `{ 1: 0x0a0a0a, 2: 0x8ec7a2, 3: 0xf48d72, 4: 0xea7352, 5: 0xffffff, 6: 0xf4c6df }` | render | Colours of the reference art. |
| `render.levels.panda.background`, `render.levels.carrot.background` | `0x9cc3d5` | render | Mid-tone, so black and white blocks both read. |
| `render.levels.panda` and `.carrot`: `track.guideColor` / `inventory.tileColor` / `track.entryColor` | `0x4d86a3` / `0x4d86a3` / `0x3a6e88` | render | Darker empty tiles: black units about 5.2:1 and white about 4:1. |
| `render.slotColors` | `{ free: 0x333333, occupied: 0x777777, blocked: 0xaa2222 }` | render | Slot state at a glance; a parked unit's slot turns red. |
| `render.label.worldSize` | `0.6` | render | Capacity label size in cells. |
| `render.label.color` / `outline` / `outlineWidth` | `'#ffffff'` / `'#000000'` / `8` | render | White digits with a black outline read on every palette colour. |
| `render.slotCounter.offsetX` / `offsetY` / `height` | `1.4` / `0` / `0.7` | render | "N/5" counter position (cells from the last slot) and text height. |
| `render.endTint` | `{ won: 0x0b2410, lost: 0x2a0b0b }` | render | Green or red background tint when the level ends. |
| `ui.timing.winOverlayDelay` / `loseOverlayDelay` | `0.6` / `0.6` | render | Seconds before the card appears, so the last move stays visible. |
| `ui.timing.fade` | `0.15` | render | Card fade-in (s). |
| `ui.colors.bar` | `'#15151d'` | render | Solid top bar, readable on light backgrounds. |
| `ui.sizes.barHeight` | `56` | render | Top bar height (px); the board is kept below it. |
| `ui.sizes.font` / `titleFont` | `16` / `26` | render | Body and card-title text (px). |
| `ui.sizes.iconButton` | `40` | render | Settings button size (px). |
| `ui.sizes.cardWidth` / `cardPadding` | `280` / `24` | render | Pause, win and lose cards (px). |
| `ui.sizes.barPadding` / `gap` / `radius` | `12` / `12` / `10` | render | Bar and card spacing and corner radius (px). |
| `ui.sizes.buttonPadY` / `buttonPadX` | `10` / `20` | render | Button padding (px). |
| `ui.sizes.iconBarWidth` / `iconBarHeight` / `iconBarGap` | `18` / `2` / `4` | render | Three-bar settings icon drawn in plain DOM, no image (px). |

### Architecture

- **Core** (`src/core`, `src/config`): pure, deterministic JavaScript with no Three.js, DOM, clock or randomness; an
  architecture test enforces it. `GameManager` is the only thing that changes game state. It drives `GridManager`
  (the matrix), `Track` (the ring), `InventoryManager` (reserve and slots) and `ProgressManager` (money and levels).
- **Commands in:** `activateUnit`, `launchFromSlot`, `pause`, `resume`, `restartLevel` and `continueToNextLevel`
  each return `{ ok, reason }`.
- **State out:** `getSnapshot()` returns plain JSON in cell units, with version counters. The renderer can draw a
  correct frame from a snapshot alone.
- **Events out:** flushed after each logic step (for example `SLOT_STATE_CHANGED`, `LEVEL_WON`). Presentation uses
  them for one-off reactions such as the end tint, the counter refresh and showing a card, never for board state.
- **Presentation:** `Renderer` (Three.js, with `PrimitiveFactory` as the reskin seam), `InputManager` (pointer, then
  raycast, then command) and `UIManager` (DOM top bar and cards). `src/main.js` wires them together and runs the
  loop: `update(dt)`, `getSnapshot()`, `renderer.sync`, `ui.update`, `render`.

### Known limitations and deviations

- **Parked units are not permanent.** The original brief had a returning unit block its slot for good; v1 lets it
  relaunch (`rules.allowRelaunchParked`).
- **Lose rule.** By default the level is lost when all 5 slots are blocked and nothing moves, even if a parked unit
  could still score. `rules.loseMode: 'deadlock'` gives the stricter "no valid moves" rule. With balanced levels and
  relaunching on, `out_of_units` cannot happen, so `slots_blocked` is the only reachable loss.
- **Runners queue.** Units keep a 1-cell follow distance and wait behind a unit that is eating, instead of passing
  through each other as first designed.
- **No shot or return effects.** A matching block disappears when a unit crosses its lane, and a unit that ends its
  lap jumps straight to its slot (`timing.returnDuration` is not used yet).
- **Primitives.** Units are 3-sided cones so their heading reads. Labels and the counter are text on sprites, and
  the HUD is DOM. The brief names boxes, spheres and planes.
- **Art fidelity.** Only `assets/reference/panda.jpeg` is in the repo, and Panda matches it cell for cell. Watermelon
  and Carrot were checked visually against images outside the repo. Watermelon keeps 12 flesh cells that the art
  shades darker red as plain red, by choice.
- **Phones.** In portrait (375 x 812) Panda and Carrot fit, but capacity digits are about 5 to 6 CSS px tall and
  reserve tap targets about 12 CSS px.
- **Long levels.** Played one unit at a time at shipped speed, Panda takes about 6 minutes and Carrot about 12.
- **No persistence or menus.** Money and progress reset on reload, and there is no level-select screen, only
  `?level=<id>`.
- **No sound.** There are no visual effects beyond the reserve shift, the end tint and the card fade.

## v2 – Feel

Goal: make v1 feel responsive and fluid without changing what wins or loses a level. Everything here builds on v1;
the v1 section above still describes v1 as it was.

### What changed

1. **Launch straight to the track.** Tapping a front reserve unit sends it on a short flight to the track entry; it no
   longer stops in a slot first. Slots only receive units that finish a lap with capacity left, and those park in the
   leftmost free slot. The 5-slot limit now counts units moving plus units parked: a launch is refused when that sum is
   5, and the "N/5" counter shows 5 minus that sum, so it still drops by 1 on every launch. A relaunched unit frees its
   slot at once but keeps counting while it moves. Unit states are now reserve, launching (flying to the entry),
   running, eating, returned (parked) and dead. The lose rules are unchanged.
2. **Faster track.** Cruise speed went from 4 to 6.4 cells per second: +40% was the starting point, and +60% is where
   the laps stopped feeling long. The bite pause shrank with it, from 0.15 to 0.1 s. Lanes are still scanned
   discretely, so no lane is skipped at cruise or at final-rush speed.
3. **Glide instead of stiff movement.** Units react on pointerdown, and the canvas no longer lets the browser handle
   touch gestures. The launch flight lifts off the reserve and curves into the entry along the track, easing out over
   260 ms. Units that must wait for the follow distance hold on their own path behind the entry instead of stacking. On
   the track a unit starts at 2 cells per second and eases up to cruise over 400 ms; this is logic, deterministic and
   tested. The return to a slot, the relaunch and the reserve shift use the same ease-out curve, and moving units hop
   so they draw over the units they pass. Units turn smoothly toward their direction of travel, corners included; the
   logical path is unchanged.
4. **Final rush.** When the last reserve unit launches, every moving unit, and any unit relaunched afterwards, speeds
   up to 1.8x over 700 ms with an ease-in-out ramp. It starts once per level, emits `FINAL_RUSH_STARTED` and is part
   of the deterministic simulation.
5. **Tests.** 205 headless tests, up from 185. New ones cover a launch that takes no slot and the moving-plus-parked
   limit, the counter formula, parking in the leftmost free slot, acceleration reaching cruise at `units.accelMs`,
   every lane scanned once per lap at cruise and rush speed, the rush starting exactly once when the reserve empties,
   deep-equal snapshots for identical command scripts on the shipped config, and the render helpers for the flight,
   the entry queue and the return glide. The v1 WIN and LOSE scenarios pass with the same step counts, because the
   test base turns the new motion off; tests that described the old slot-first launch were rewritten.

### Why each change improves feel

- **Responsiveness.** A tap now sends the unit toward the track on the very next frame, instead of parking it in a slot
  for 0.25 s. Pointerdown plus disabled touch gestures means no browser delay between the finger and the unit. Slots
  now only mean "parked", so they read as a warning, not as a waiting room.
- **Flow.** Eased flights, returns and reserve shifts replace snaps and linear slides. The acceleration ramp removes the
  jump to full speed at the entry, damped turning rounds the corners, and a burst of taps forms a neat queue.
- **Pacing.** Laps are about 37% shorter: 11.6 s instead of 18.5 s on Level 1, and 20 s instead of 32 s on Carrot.
  Played strictly one unit at a time, Level 1 drops from 3.3 to 2.1 minutes and Carrot from 12.1 to 7.6. The shorter
  bite keeps v1's stop-and-go rhythm at the higher speed.
- **End-of-level tension.** Once the reserve is empty the player can only watch. The final rush turns that wait into a
  short sprint to the finish, and the eased ramp keeps it readable.

### Exact values tuned

Values are copied from `src/config/Config.js`; "new" means the key did not exist in v1.

| Config key | v1 value | v2 value | Why |
|---|---|---|---|
| `track.speed` | `4` | `6.4` | Cruise speed, cells/s. +40% was the starting point; +60% brings a Level 1 lap to 11.6 s. |
| `timing.eatDuration` | `0.15` | `0.1` | Bite pause, scaled with the speed so a bite still takes about 60% of a cell's travel time. |
| `timing.launchDelay` | `0.25` | removed | The wait in a slot before entering the track is gone. |
| `timing.launchToEntryMs` | new | `260` | Flight from the reserve (or the slot) to the entry, ms: short, about as long as the old slot wait. |
| `units.launchSpeed` | new | `2` | Speed on entering the track, cells/s, so the unit visibly picks up speed. |
| `units.accelMs` | new | `400` | Time from entering the track to cruise speed. |
| `units.accelEasing` | new | `'easeOutQuad'` | Quick pick-up that settles into cruise without a jolt. |
| `rules.finalRushSpeedMultiplier` | new | `1.8` | Rush speed factor once the reserve is empty. |
| `rules.finalRushRampMs` | new | `700` | Ramp time, so the rush never jumps. |
| `rules.finalRushEasing` | new | `'easeInOutCubic'` | Gentle start and end of the ramp. |
| `render.motionEasing` | new | `'easeOutCubic'` | One curve for launch, relaunch, return and reserve shift (v1: snaps and a linear shift). |
| `render.launchLift` | new | `0.7` | Cells the flight rises off the reserve before turning, so it clears the other front units. |
| `render.launchCurve` | new | `0.5` | How early the flight lines up with the track, as a fraction of its depth below the entry. |
| `render.hopHeight` | new | `0.8` | Height of the hop, so a flying or returning unit draws over the units it passes. |
| `render.returnToSlotMs` | new | `280` | Glide from the entry corner into the parking slot (v1: an instant jump). |
| `timing.returnDuration` | `0.4` | removed | Declared in v1 but never read; replaced by `render.returnToSlotMs`. |
| `render.rotationDamping` | new | `18` | Turn rate per second: a turn is 90% done in about 130 ms (v1: instant). |
| `render.reserveShiftMs` | `160` | `160` | Same length, now eased instead of linear. |
| `render.reserveShiftStaggerMs` | `60` | `60` | Same stagger; the first shift now also waits for the departing unit. |
| `render.slotColors.occupied` | `0x777777` | removed | Moving units no longer hold a slot. |
| `inventory.activeSlots` | `5` | `5` | Same number, now a limit on units moving plus units parked. |

## v3 – Polish
