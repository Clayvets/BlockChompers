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

Goal (from the assignment): improve responsiveness and timing, meaning input, easing and pacing. v2 changes how and
when units move, not what wins or loses a level.

**How to compare:** play both versions from the same clone. The dependencies did not change, so no reinstall is needed.

```bash
git checkout v1-primitive    # play v1
npm run dev
git checkout primitive-core  # back to v2
```

### What changed

**Input**
- A tap is still handled on `pointerdown`, as in v1, but the unit now leaves at once: it is already flying toward the
  track in the next drawn frame, instead of waiting 0.25 s in a slot. It enters the track at the shared entry corner.
- The canvas sets `touch-action: none`, so the browser never holds a tap back for panning or zooming.
- Slots now only receive units that finish a lap with capacity left.

**Rules that came with it**
- **Limit:** a launch is allowed only while units moving + units parked < 5 (`inventory.activeSlots`). Moving units
  hold no slot.
- **Counter:** "N/5" shows 5 - (moving + parked), so it still drops by 1 on every launch.
- **Parking:** a unit that finishes a lap with capacity left parks in the leftmost free slot; the limit guarantees one.
- **Relaunch:** a relaunched parked unit frees its slot at once but keeps counting as moving. If it still has capacity
  after the lap, it parks again in the leftmost free slot.
- Win and lose rules are unchanged.

**Easing**
- **Launch curve:** the flight lifts off the reserve cell, curves across and meets the entry along the track, easing
  out over 260 ms. Units waiting for the follow distance hold on their own path behind the entry instead of stacking.
- **Acceleration:** a unit enters the track at 2 cells/s and eases up to cruise speed over 400 ms.
- **Rotation:** units turn smoothly toward their direction of travel, corners included. The logical path is unchanged.
- **Same easing everywhere:** one ease-out curve drives the launch, the relaunch, the return to a slot (v1 snapped) and
  the reserve shift (v1 slid linearly). Flying and returning units hop, so they draw over the units they pass.

**Pacing**
- **Track speed:** 4 to 6.4 cells per second.
- **Hit timing:** the pause per eaten block went from 0.15 to 0.1 s to match the new speed. Neither version draws
  projectiles, so this pause is the only hit timing.
- **Final rush:** when the last reserve unit launches, every moving unit, and any unit relaunched later, ramps up to
  1.8x speed over 700 ms. It starts once per level and emits `FINAL_RUSH_STARTED`.

**Tuning during v2**
- The brief set +40% (5.6 cells/s) as the starting speed. v2 ships 6.4 (+60%) with the hit pause scaled to match.
- v2 is a single commit, so the git log records no later fixes.

### Why it improved feel

- **Responsiveness.** In v1 a tap parked the unit in a slot for 0.25 s before it entered the track, so every tap felt
  late and took a detour through the slot row. In v2 the unit is on its way in the frame after the tap, and slots only
  hold parked units, so they read as a warning instead of a waiting room.
- **Flow.** In v1 units started at full speed, jumped back to their slot and turned each corner in a single frame. In
  v2 they curve in, pick up speed over 400 ms, glide into their slot and swing round corners, so motion reads as one
  continuous glide.
- **Pacing.** v1's loop was slow: a Level 1 lap took 18.5 s and a Carrot lap 32 s. In v2 they take 11.6 s and 20 s.
  Played one unit at a time, Level 1 drops from 3.3 to 2.1 minutes and Carrot from 12.1 to 7.6.
- **End-of-level tension.** In v1, once the reserve was empty, the player could only watch the last units crawl
  round. The final rush turns that wait into a short sprint to the finish, and its eased ramp keeps it readable.
- **Still deterministic and testable.** Acceleration and the final rush are game logic: each fixed step's speed comes
  from whole-step counters and the pure polynomial curves in `src/core/easing.js`, with no clock or randomness.
  Easing is presentation: the flight's duration is logic, but its curve, the return glide, the reserve shift and the
  turning live only in the renderer, which reads snapshots and never changes the game. Tests show that acceleration
  reaches cruise exactly at `units.accelMs`, that no lane is skipped at cruise or final-rush speed, that the rush
  starts exactly once, and that identical command scripts give deep-equal snapshots. The renderer's placement helpers
  are tested headless too, for 205 tests in all.

### Exact values tuned

Values are copied from `src/config/Config.js` at v1-primitive and on the current branch; "—" means the key is new in v2.

| Config key | v1 value | v2 value | Why |
|---|---|---|---|
| `inventory.activeSlots` | `5` | `5` | Same number, now a limit on units moving plus units parked; moving units hold no slot. |
| `track.launchSpacing` | `1` | `1` | Same follow distance; a launching unit now waits for it at the entry, not in a slot. |
| `timing.launchDelay` | `0.25` | removed | The wait in a slot before entering the track is gone. |
| `timing.launchToEntryMs` | — | `260` | Flight from the reserve cell or the slot to the entry, ms; the unit moves from the first frame. |
| `render.slotColors` | `{ free: 0x333333, occupied: 0x777777, blocked: 0xaa2222 }` | `{ free: 0x333333, blocked: 0xaa2222 }` | Moving units no longer hold a slot, so the occupied tint is gone. |
| `units.launchSpeed` | — | `2` | Speed on entering the track, cells/s, so the unit visibly picks up speed. |
| `units.accelMs` | — | `400` | Time from entering the track to cruise speed. |
| `units.accelEasing` | — | `'easeOutQuad'` | Quick pick-up that settles into cruise without a jolt. |
| `render.motionEasing` | — | `'easeOutCubic'` | One ease-out curve for launch, relaunch, return and reserve shift. |
| `render.launchLift` | — | `0.7` | Cells the flight rises off the reserve before turning, so it clears the other front units. |
| `render.launchCurve` | — | `0.5` | How early the flight lines up with the track, as a fraction of its depth below the entry. |
| `render.hopHeight` | — | `0.8` | Rise at mid-move, so a flying or returning unit draws over the units it passes. |
| `render.returnToSlotMs` | — | `280` | Glide from the entry corner into the parking slot, replacing v1's jump. |
| `timing.returnDuration` | `0.4` | removed | Declared in v1 but never read; replaced by `render.returnToSlotMs`. |
| `render.reserveShiftMs` | `160` | `160` | Same time per cell, now eased instead of linear. |
| `render.reserveShiftStaggerMs` | `60` | `60` | Same stagger; the first unit now also waits for the one that left. |
| `render.rotationDamping` | — | `18` | Turn rate per second: a turn is 90% done in about 130 ms, instead of v1's instant snap. |
| `track.speed` | `4` | `6.4` | Cruise speed, cells/s: +40% was the starting point; +60% brings a Level 1 lap from 18.5 to 11.6 s. |
| `timing.eatDuration` | `0.15` | `0.1` | Pause per eaten block, the only hit timing, scaled with the speed: still about 60% of a cell's travel time. |
| `rules.finalRushSpeedMultiplier` | — | `1.8` | Speed factor once the reserve is empty. |
| `rules.finalRushRampMs` | — | `700` | Ramp time, so the rush never jumps. |
| `rules.finalRushEasing` | — | `'easeInOutCubic'` | Gentle start and end of the ramp. |

## v3 – Polish

Goal: add juice on top of v2, meaning effects, UI animation, sound and satisfying feedback, plus a start screen,
without touching the rules. All of v3 is presentation. `src/core`, the level files and their tests are unchanged,
effects and sounds react to snapshots and events, and every value lives in `Config.render`, `Config.ui` or
`Config.debug`.

**How to compare:** each version is tagged, and all three use the same dependencies, so no reinstall is needed.

```bash
git checkout v1-primitive    # play v1
git checkout v2-feel         # play v2
git checkout v3-polish       # play v3
npm run dev                  # after any checkout
git checkout primitive-core  # back to the working branch
```

This note replaces the one in the v2 section: `primitive-core` now holds v3, so use `v2-feel` to play v2.

### How to run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # headless tests (Vitest, in Node: no DOM or WebGL)
npm run build    # production bundle in dist/
npm run preview  # serve dist/ at http://localhost:4173
```

Node 22.12 or newer. The build warns that the bundle is over 500 kB: Three.js is bundled whole, and that is
expected. Add `?level=<id>` to the URL to play one level on its own: `watermelon`, `panda`, `carrot` or `starter`.
In `src/config/Config.js`, `debug.enabled: true` outlines the layout regions and shows a panel with the cellSize,
FPS, draw calls, particles, GPU memory and sound voices, and `debug.timeScale` slows the simulation, the effects and
the board sounds (0.25 is quarter speed).

### Controls

Mouse or touch; there are no keyboard shortcuts.

- **Start:** the start screen's Play button starts Level 1 and turns sound on (browsers allow audio only after a
  click).
- **Launch:** click a unit in the front row of the reserve. It flies straight to the track entry. The "N/5" counter
  shows how many more units can be out at once; at 0 the click is refused.
- **Relaunch:** click a parked unit, or its red slot, to send it round again with the capacity it has left.
- **Settings:** the button at the top left pauses the game and offers Resume, Restart level and "Sound: on / off".
- **End of level:** the win card shows the "+$50" reward and Continue ("Play again" on Level 3). The reward flies into
  the money and the next level loads. The lose card's Retry restarts the level.

### What changed

1. **Fixed layout (UI scaling fix).** Cause: the camera fitted its frustum to each level's bounds (grid, track, slots
   and reserve), so a big level zoomed everything out and shrank the slots, reserve, units and labels. Now one
   portrait design of 10 x 20 design units (`render.layout`) holds a region for the board, the slot row and the
   reserve. The camera fits that design once per viewport size, scaled uniformly with any extra space as margin, and
   never refits on a level change. Only the board (grid plus track ring) scales:
   `cellSize = min(boardRegion.w / boardCols, boardRegion.h / boardRows, maxCellSize)`, centred in its region. Blocks
   and track tiles scale with it. Slots, reserve cells, units, labels and the "N/5" counter keep one size on every
   level, so a unit no longer changes size between the reserve and the track. The math is a pure function,
   `src/render/layout/computeLayout.js` (no Three.js, no DOM, tested in Node), and the Renderer only consumes its
   result. With `debug.enabled`, the renderer outlines the regions and a new debug panel shows the level's cellSize.

   | Level | Board incl. ring (columns x rows) | cellSize | Cell on a 390 x 844 phone |
   |---|---|---|---|
   | Level 1 (Watermelon) | 20 x 19 | 0.46 | 17.9 px |
   | Panda | 24 x 26 | 0.3833 | 14.9 px |
   | Carrot | 25 x 41 | 0.2927 | 11.4 px |
   | Starter | 7 x 5 | 0.75 (clamped) | 29.3 px |

2. **Effects architecture.** `src/render/vfx/` holds three modules. `VfxManager` reacts to `BLOCK_CONSUMED` (a
   shot), `UNIT_DIED` (death sparks) and `LEVEL_LOADED` (clear everything). It borrows block meshes and unit positions
   through Renderer host methods and never touches game state. `VfxFactory` is the only place that creates effect
   geometries and materials, so changing the projectile look (a ball today, bubbles later) means one factory method
   plus render config. `ConfettiLayer` draws the win confetti. Effects run on a presentation clock that stops while
   paused, follows `debug.timeScale`, and clears on restart and level change. Pure helpers live in
   `src/render/anim/`: easing with overshoot curves, a pooled tween scheduler and a fixed-capacity pool.
3. **Projectiles.** When a unit eats a block, a small ball in its colour leaves the triangle's tip with a short trail
   of fading sparks and reaches the block in 110 ms, speeding up as it goes. The triangle punches its scale as it
   fires. Core has no separate "fired" event, so the shot is driven by `BLOCK_CONSUMED`.
4. **Block destruction.** The block stays until the shot lands, then flashes white, squashes flat and wide and shrinks
   away, while 6 sparks of its colour burst out, fall slightly, fade and shrink.
5. **Capacity numbers.** Each shot swaps the number: the old one fades and shrinks, the new one pops in with an
   overshoot and a gold flash. The label is redrawn only when the number changes. At 0 the triangle squashes, shrinks
   to nothing and bursts into sparks before it is removed.
6. **Win confetti.** When the win card appears, 140 rectangles in the level's palette burst from the bottom corners,
   flip, sway and fall for about 2.8 s. They are drawn on their own transparent canvas (`#canvas-fx`) above the card,
   and fade out fast when the card closes.
7. **UI animations.** The HUD slides in at every level start and the level label slides to its new number. On a win
   the backdrop fades in, the card pops in with overshoot, and the title, a new "+$X" reward line and the button enter
   one after another. The button now reads "Continue" or "Play again"; v1 and v2 put "+$50" on it. Pressing it plays
   the exit first and only then loads the next level, while the "+$X" flies to the money counter, which counts up
   with a punch. The lose card enters more softly and its title shakes. Buttons squash on press and bounce back. The
   "N/5" counter punches when it changes and flashes red at 0. The settings panel slides and fades. The board takes
   no input while an overlay animates.
8. **Performance and effects level.** One InstancedMesh per effect type (projectiles, sparks, confetti), preallocated
   to its cap in `render.vfx` and recycled oldest first. Geometries and materials are shared, and only active
   instances are uploaded, once per frame. The effect, juice and unit-placement code allocates nothing per frame: it
   reuses its vectors, matrices and colours, keeps pooled typed arrays, and the placement helpers write into reused
   objects. Capacity labels are redrawn only when the number changes, and DOM animations touch only transform and
   opacity. Effects are full by default (`render.vfx.effects`); reduced cuts particle and confetti counts to 40% and
   drops the shake. There is no in-game option: the game switches to reduced when the system asks for reduced
   motion. With `debug.enabled`, the debug panel adds FPS, draw calls, active particles, GPU memory and sound voices.
9. **Start screen.** On page load a flat card shows the title and a big Play button over the darkened first level,
   and the HUD is hidden. It enters like the win card: the backdrop fades in, the card pops with overshoot, and the
   title and button follow one after the other. Play squashes, the card plays its exit, and only then Level 1 loads,
   the HUD slides in and the game starts. The flow is a small pure state machine, `src/app/AppFlow.js`
   (MENU → PLAYING). `main.js` advances the simulation only through it, so nothing steps behind the title, and the
   board takes no input there. "Play again" after the last level is still a game command and never returns to the
   start screen.
10. **Settings.** The "Effects: full / reduced" button is gone and "Sound: on / off" takes its place. Off mutes the
    master gain and stops new sounds from being created.
11. **Sound architecture.** `src/audio/` holds an `AudioManager` that listens to game events and presentation cues,
    and a `SfxBank` that is the only place defining sounds. Cues (`src/app/Cues.js`) cover the moments that are not
    game events: UI actions from `UIManager` (taps, overlays entering and leaving, Play, the win and lose cards, each
    money tick) and visual moments from the Renderer (a projectile landing, a capacity number dropping, a death pop, a
    unit landing in its slot, the counter reaching 0). Every sound is synthesised with Web Audio from oscillators,
    filtered noise and simple envelopes, with no audio files. `SfxBank` can also play an audio file for any sound whose
    config entry names a `file`, loaded from `render.audio.assetsPath` (`assets/sfx/`, so the file goes in
    `public/assets/sfx/`). It uses the recipe until the file has loaded, or if it fails, so replacing a sound
    touches only `SfxBank` and config. The AudioContext is created and resumed inside the Play click, which satisfies
    the browser autoplay policy. One master gain, muted by the toggle, sits over an sfx volume gain. Board sounds
    follow pause, because they come from the simulation and the presentation clock, which both stop. They also play
    at `debug.timeScale` (longer and lower in slow motion). UI sounds stay in real time.
12. **Sounds.** All short and soft; every pitch, duration and volume is in `render.audio.sounds`.

    | Sound | When | What it is |
    |---|---|---|
    | `tap` | A button is pressed (not Play) | 55 ms sine blip sliding 720 → 480 Hz |
    | `whooshIn` / `whooshOut` | An overlay enters / leaves | Band-passed noise sweeping up / down |
    | `confirm` | Play | Two rising chime notes, C5 then G5 |
    | `launch` | A unit leaves the reserve or its slot | Soft rising noise whoosh, 190 ms |
    | `pew` | A unit fires (`BLOCK_CONSUMED`) | 85 ms triangle falling 1300 → 480 Hz, ±7% random pitch |
    | `pop` | The shot lands and the block breaks | 70 ms sine falling 900 → 220 Hz with a 14 ms high click; breaks less than 450 ms apart rise half a semitone each, up to 4 semitones |
    | `tick` | A capacity number drops (to 1 or more) | 28 ms high sine tick |
    | `unitPop` | A unit pops at capacity 0 | Bigger, lower pop (620 → 110 Hz) with a puff of air |
    | `park` | A returning unit lands in its slot | Soft 170 → 70 Hz thud |
    | `warn` | The "N/5" counter reaches 0 | Two quiet beeps |
    | `rush` | The final rush starts | 0.7 s rising swoosh over a tone rising 220 → 880 Hz |
    | `fanfare` | The win card appears, with the confetti | C5–E5–G5–C6 arpeggio |
    | `coin` | The money counts up | Bright upward chirp, rising with each coin |
    | `lose` | The lose card appears | Three soft falling notes, G4–E4–C4 |

13. **Audio optimization.** A pure scheduler (`src/audio/SfxScheduler.js`) decides whether a sound may start before
    any node exists. Nothing starts while muted. A sound retriggered within its `minIntervalMs` is skipped, and so is
    any sound once `render.audio.maxVoices` sounds are playing; nothing is ever queued. Skipped breaks still keep the
    combo going. Each sound creates its own nodes (oscillators, noise sources, filters, envelope gains), and they
    disconnect themselves when its last source ends. The only persistent nodes are the two gains, plus one shared
    white-noise buffer. Envelopes start from 0 and decay to -80 dB before a source stops, and every sound starts 10 ms
    ahead, so nothing clicks.
14. **Tests.** 236 headless tests in 25 files, up from 205 in v2. The 31 new ones cover:
    - `computeLayout` (7): the same slot, reserve, unit, label and counter rects on every level; every board inside
      its region and centred, with units on the ring clear of the slots and reserve; regions apart and inside the
      design; cellSize smaller for bigger grids and clamped for small ones; uniform scaling across viewport aspects.
    - Easing, tween scheduler and pool (11): curve end points and overshoot; tween start, end, stagger and cancel;
      pool acquire, release and recycle at cap.
    - `AppFlow` and `CueBus` (5): starts in MENU, Play moves to PLAYING, no simulation step in MENU, no way back.
    - `SfxScheduler` and `SfxBank` (8): voice cap, minimum interval, combo pitch rise and reset, mute, pitch jitter,
      and a length for every configured sound.

    The new helpers are checked to be free of Three.js, the DOM and clocks. Core, the level files and their tests are
    unchanged.
15. **Fixes and tuning during v3.** The layout fix (item 1) is the one fix commit; the other two commits are the
    effects and UI animation, then the start screen and sound. Along the way the win card's copy changed (item 7), the
    old CSS card fade (`ui.timing.fade`) gave way to the `ui.anim` animations, and the "Effects: full / reduced"
    button added with the effects was removed again with the sound work, leaving the effects level automatic. Some
    sounds began with a one-sample click, because a new gain node starts at full volume before its envelope takes
    over; every envelope now starts from 0.

### Why it improved feel

- **Feedback clarity** (projectiles, block hits, capacity numbers, counter). In v2 a block simply vanished as a unit
  passed its lane. Now each hit is a visible shot from one unit to one block, the block reacts when the shot lands,
  and the unit's number ticks down with each shot. The "N/5" counter punches when it changes and flashes red at 0,
  so the player sees what each unit did and how much room is left.
- **Satisfaction** (muzzle pop, flash, squash, sparks, death pop, button squash). Every hit feels physical, a unit
  that finishes its job pops instead of blinking out, and buttons give under the finger. A player whose system asks
  for reduced motion gets 40% of the sparks and confetti and no shake, with nothing to set up.
- **Reward moment** (confetti, reward flight, count-up, fanfare, coins). Confetti in the level's own colours bursts
  over the win card with a short fanfare. The "+$X" then flies into the money, which counts up with a punch and
  rising coin chirps. The payout becomes a moment instead of a number change.
- **UI flow** (start screen, overlay animations, settings). The start screen gives the game a clear beginning:
  nothing moves behind it, the Play click also turns sound on, and the HUD slides in with Level 1. Overshoot
  entrances and a short stagger lead the eye from title to reward to button. Exits finish before the next level
  loads, so nothing jumps, and a stray tap during a transition cannot launch a unit. Settings keeps only the option
  players change, sound, while the effects level follows the system's reduced-motion setting.
- **Consistency across levels** (fixed layout). Up to v2 the camera zoomed out on big levels. On a 375 x 812 phone,
  Panda's and Carrot's reserve targets shrank to about 12 CSS px and their capacity digits to 5 or 6 px (see the v1
  known limitations). Now only the board scales. The slots (37.5 px), reserve cells (28 px), units and capacity
  digits (about 8 px) keep the same size on every level, and a unit keeps its size from the reserve to the track, so
  what the player learns on Level 1 carries over to Carrot.
- **Audio feedback** (sound effects). Every action and every hit has a short, soft sound. A tap confirms a button, a
  whoosh a unit taking off. A pew marks the shot and a pop its impact, a tick the number dropping, and a thud a unit
  parking. Two quiet beeps say the counter hit 0, and a rising swoosh announces the final rush. A busy board still
  reads by ear. Breaks in a row rise in pitch, so a streak builds into a small crescendo, and the pew's small random
  pitch keeps repeats from sounding mechanical. Board sounds stop with the pause and follow `debug.timeScale`, so
  sound and picture stay in sync.
- **Performance** (instancing, pools, allocation-free loops, voice cap and throttling). Measured on Carrot in a
  desktop browser with the frame loop uncapped:
  - **Five units firing:** a frame takes about 1.5 ms (about 650 frames per second). The board draws in about 850
    calls; effects add 2.
  - **Win card:** the 140 confetti pieces cost 1 draw call, and the loop stays above 2,600 frames per second.
  - **Memory:** GPU memory stays at 12 geometries and 31 textures across 5 restarts.
  - **Sound:** it does not change the frame rate. In the same 8 s with five units firing, runs averaged 612 and
    631 fps muted, and 616 and 625 fps with sound. Of 241 sound requests, 97 played and the rest were skipped by
    `minIntervalMs`. At most 2 voices sounded at once, the output peaked at 0.25 of full scale, and audio used about
    1.2 ms of main-thread time per second.

### Exact values tuned

Values are copied from `src/config/Config.js` at v2-feel and now; "—" means the key is new in v3, and "removed" that
v3 dropped it. The table lists every key v3 added or removed; v3 changed no existing value. `render.unitSize` and
`render.launchLift` keep their values and are listed because their meaning changed.

| Config key | v2 value | v3 value | Why |
|---|---|---|---|
| `render.layout.designWidth` / `designHeight` | — | `10` / `20` | The fixed portrait design; 1:2 fits a phone below the HUD. |
| `render.layout.boardRegion` | — | `{ x: 0.4, y: 0.4, w: 9.2, h: 12 }` | Where the board scales to fit; margins leave room for units on the ring. |
| `render.layout.slotsRegion` | — | `{ x: 0.4, y: 12.9, w: 9.2, h: 1 }` | Band for the 5 parking slots and the counter. |
| `render.layout.reserveRegion` | — | `{ x: 0.4, y: 14.35, w: 9.2, h: 5.25 }` | 7 reserve rows, enough for Carrot. |
| `render.layout.slotSize` / `reserveCellSize` | — | `1` / `0.75` | Slot and reserve pitch: 39 px and 29 px targets on a 390 px phone. |
| `render.layout.unitSize` / `labelSize` | — | `0.6` / `0.45` | One unit and label size everywhere. |
| `render.layout.counter` | — | `{ x: 8.3, y: 13.4, height: 0.55 }` | "N/5" counter, right of the slots. |
| `render.layout.maxCellSize` | — | `0.75` | Cap for small boards; a unit is then 0.8 of a cell. |
| `render.cellSize` | `1` | removed | Replaced by the per-level cellSize. |
| `render.camera.padding` | `1` | removed | The design has its own margins. |
| `render.inventory.gapBelowGrid` / `slotGap` / `slotsRowOffset` / `reserveRowOffset` | `0.6` / `0.2` / `0.5` / `2.1` | removed | Replaced by the layout regions. |
| `render.label.worldSize` | `0.6` | removed | Replaced by render.layout.labelSize. |
| `render.slotCounter.offsetX` / `offsetY` / `height` | `1.4` / `0` / `0.7` | removed | Replaced by render.layout.counter. |
| `render.unitSize` | `0.8` | `0.8` | No longer drawn; a core test still compares the follow distance with it. |
| `render.launchLift` | `0.7` | `0.7` | Same value, now in design units. |
| `render.projectileTravelMs` | — | `110` | Short enough to feel instant, long enough to see. |
| `render.projectileEasing` | — | `'easeInQuad'` | Speeds up into the hit. |
| `render.blockBurstCount` | — | `6` | Readable burst; low because big levels break hundreds of blocks. |
| `render.vfx.maxProjectiles` / `maxParticles` / `maxConfetti` | — | `48` / `600` / `160` | Preallocated caps; the oldest instance is recycled. |
| `render.vfx.effects` | — | `'full'` | Default effects level; reduced only when the system asks for reduced motion. |
| `render.vfx.reducedScale` | — | `0.4` | Reduced effects: 40% of the particles and confetti. |
| `render.vfx.projectile` | — | `{ size: 0.16, height: 1.2, trailEveryMs: 16, trailLifeMs: 140, trailSize: 0.45 }` | Ball size, draw height and its trail of sparks. |
| `render.vfx.muzzle` | — | `{ punch: 0.35, ms: 130 }` | Scale punch on the firing triangle. |
| `render.vfx.impact` | — | `{ flashMs: 55, squashMs: 70, shrinkMs: 120, squashY: 0.35, stretchXZ: 1.3 }` | White flash, squash, then shrink of a hit block. |
| `render.vfx.burst` | — | `{ lifeMs: 420, size: 0.28, speed: 5, gravity: 16, height: 1 }` | Spark life, size, speed and pull, in board cells. |
| `render.vfx.label` | — | `{ outMs: 170, outScale: 0.5, inMs: 260, inFrom: 0.45, flashMs: 200, flashColor: 0xffd24a }` | Old number fades and shrinks; new one pops with a gold flash. |
| `render.vfx.death` | — | `{ ms: 260, squashAt: 0.3, squash: 0.6, stretch: 1.35, burstCount: 10 }` | Squash, shrink and sparks at capacity 0. |
| `render.vfx.counter` | — | `{ punch: 0.4, punchMs: 240, flashColor: 0xff5252, flashMs: 600 }` | Counter punch on change, red flash at 0. |
| `render.vfx.confetti` | — | `{ count: 140, durationMs: 2800, width: 12, height: 7, speed: 1150, speedJitter: 0.35, spread: 0.45, gravity: 1500, drag: 0.9, spin: 14, sway: 40, fadeMs: 500, stopFadeMs: 180 }` | Count, time and motion of the win confetti (CSS pixels). |
| `render.audio.masterVolume` / `sfxVolume` | — | `1` / `0.8` | Master gain (the Sound toggle mutes it) over the sfx bus. |
| `render.audio.muted` | — | `false` | Sound starts on. |
| `render.audio.muteFadeMs` | — | `60` | Mute ramp, so the toggle never clicks. |
| `render.audio.lookaheadMs` | — | `10` | A sound never starts in the audio thread's past. |
| `render.audio.maxVoices` | — | `12` | Sounds playing at once; Carrot with five units peaks at 2. |
| `render.audio.comboWindowMs` / `comboSemitones` / `comboMaxSteps` | — | `450` / `0.5` / `8` | One unit's breaks stay in a combo; up to 4 semitones higher, reset after a pause. |
| `render.audio.envelopeFloor` | — | `0.0001` | Envelopes reach -80 dB before a source stops. |
| `render.audio.noiseBufferMs` | — | `1000` | The one white-noise buffer every noise layer loops over. |
| `render.audio.assetsPath` | — | `'assets/sfx/'` | Where a sound with a `file` loads from. |
| `render.audio.sounds.tap` | — | `{ minIntervalMs: 40, tone: { freq: 720, freqEnd: 480, attackMs: 2, ms: 55, volume: 0.22 } }` | Short soft blip on a button. |
| `render.audio.sounds.whooshIn` | — | `{ minIntervalMs: 120, noise: { freq: 350, freqEnd: 1600, q: 0.9, attackMs: 90, ms: 260, volume: 0.3 } }` | Overlay enters: noise sweeping up, with a swell. |
| `render.audio.sounds.whooshOut` | — | `{ minIntervalMs: 120, noise: { freq: 1400, freqEnd: 320, q: 0.9, attackMs: 30, ms: 200, volume: 0.26 } }` | Overlay leaves: shorter sweep down. |
| `render.audio.sounds.confirm` | — | `{ minIntervalMs: 250, notes: { hz: [523.25, 783.99], stepMs: 80, noteMs: 150, lastNoteMs: 360, attackMs: 4, volume: 0.24 } }` | Play: a rising fifth. |
| `render.audio.sounds.launch` | — | `{ minIntervalMs: 60, noise: { freq: 420, freqEnd: 1800, q: 1.2, attackMs: 50, ms: 190, volume: 0.34 } }` | Soft whoosh as a unit takes off. |
| `render.audio.sounds.pew` | — | `{ minIntervalMs: 45, pitchJitter: 0.07, tone: { freq: 1300, freqEnd: 480, attackMs: 2, ms: 85, volume: 0.07 } }` | Quiet, quick shot; jitter keeps repeats from sounding identical. |
| `render.audio.sounds.pop` | — | `{ minIntervalMs: 40, combo: true, tone: { freq: 900, freqEnd: 220, attackMs: 1, ms: 70, volume: 0.2 }, click: { freq: 3500, q: 0.7, attackMs: 1, ms: 14, volume: 0.08 } }` | Crisp break: the loudest board sound, rising with the combo. |
| `render.audio.sounds.tick` | — | `{ minIntervalMs: 55, tone: { freq: 2200, freqEnd: 2000, attackMs: 1, ms: 28, volume: 0.05 } }` | Barely there, so it never masks the pop. |
| `render.audio.sounds.unitPop` | — | `{ minIntervalMs: 60, tone: { freq: 620, freqEnd: 110, attackMs: 2, ms: 190, volume: 0.26 }, puff: { freq: 2000, freqEnd: 400, q: 0.7, attackMs: 2, ms: 110, volume: 0.12 } }` | Bigger, lower pop at capacity 0. |
| `render.audio.sounds.park` | — | `{ minIntervalMs: 60, tone: { freq: 170, freqEnd: 70, attackMs: 3, ms: 130, volume: 0.28 }, puff: { freq: 600, freqEnd: 200, q: 0.7, attackMs: 2, ms: 45, volume: 0.06 } }` | Soft low thud into the slot. |
| `render.audio.sounds.warn` | — | `{ minIntervalMs: 800, notes: { hz: [466.16, 466.16], stepMs: 150, noteMs: 100, attackMs: 6, volume: 0.1 } }` | Subtle two-beep warning at 0/5. |
| `render.audio.sounds.rush` | — | `{ minIntervalMs: 1000, noise: { freq: 260, freqEnd: 3200, q: 1.1, attackMs: 450, ms: 700, volume: 0.3 }, tone: { freq: 220, freqEnd: 880, attackMs: 450, ms: 700, volume: 0.05 } }` | Rising swoosh that builds with the speed-up. |
| `render.audio.sounds.fanfare` | — | `{ minIntervalMs: 1000, notes: { hz: [523.25, 659.25, 783.99, 1046.5], stepMs: 95, noteMs: 170, lastNoteMs: 600, attackMs: 4, volume: 0.2 } }` | Short cheerful arpeggio with the confetti. |
| `render.audio.sounds.coin` | — | `{ minIntervalMs: 70, combo: true, tone: { freq: 1320, freqEnd: 1760, attackMs: 1, ms: 60, volume: 0.08 } }` | About 7 chirps per count-up, each a little higher. |
| `render.audio.sounds.lose` | — | `{ minIntervalMs: 1000, notes: { hz: [392, 329.63, 261.63], stepMs: 200, noteMs: 220, lastNoteMs: 560, attackMs: 8, volume: 0.16 } }` | Soft descending notes, not a buzzer. |
| `ui.anim.overshoot` / `soft` / `exit` | — | `'cubic-bezier(0.34, 1.56, 0.64, 1)'` / `'cubic-bezier(0.22, 1, 0.36, 1)'` / `'cubic-bezier(0.55, 0, 1, 0.45)'` | Pop past the target, glide in, accelerate out. |
| `ui.anim.hudInMs` / `labelOutMs` / `labelInMs` / `labelShift` | — | `380` / `140` / `280` / `12` | HUD slide-in and the level label swap. |
| `ui.anim.backdropInMs` / `backdropOutMs` / `cardInMs` / `cardOutMs` | — | `220` / `180` / `420` / `200` | Result overlay in and out. |
| `ui.anim.cardFromScale` / `loseCardFromScale` | — | `0.6` / `0.88` | Win card pops from small; the lose card enters softer. |
| `ui.anim.itemInMs` / `itemStaggerMs` / `itemShift` | — | `280` / `80` / `16` | Title, reward and button enter one after another. |
| `ui.anim.shakeMs` / `shakePx` | — | `450` / `7` | Small shake on "Out of space" (off in reduced effects). |
| `ui.anim.buttonDownScale` / `buttonDownMs` / `buttonUpMs` | — | `0.9` / `70` / `280` | Squash on press, bounce on release. |
| `ui.anim.flyMs` / `countUpMs` / `moneyPunchScale` / `moneyPunchMs` | — | `620` / `520` / `1.35` / `340` | "+$X" flight and the money count-up punch. |
| `ui.anim.settingsInMs` / `settingsOutMs` / `settingsShift` | — | `260` / `180` / `28` | Settings panel slide and fade. |
| `ui.text.title` / `play` | — | `'BlockChompers'` / `'Play'` | Start screen copy. |
| `ui.text.soundOn` / `soundOff` | — | `'Sound: on'` / `'Sound: off'` | Settings sound toggle labels. |
| `ui.colors.titleBackdrop` / `title` | — | `'rgba(12, 12, 18, 0.86)'` / `'#ffd24a'` | Darker start backdrop with the first level faintly behind; gold title. |
| `ui.sizes.startCardWidth` / `startTitleFont` / `playFont` / `playPadY` | — | `320` / `34` / `22` / `16` | Wider start card, big title and big Play button. |
| `ui.timing.fade` | `0.15` | removed | Replaced by ui.anim (the old CSS fade). |
| `debug.enabled` | — | `false` | Layout outlines and the debug panel. |
| `debug.timeScale` | — | `1` | Slow motion for the simulation and effects. |
| `debug.layoutColors` | — | `{ design: 0xffffff, boardRegion: 0x00e676, board: 0xffc400, slotsRegion: 0x00b0ff, reserveRegion: 0xff4081 }` | Outline colours. |
| `debug.panel` | — | `{ right: 8, bottom: 8, padding: 6, font: '11px ui-monospace, monospace', color: '#ffffff', background: 'rgba(0, 0, 0, 0.65)' }` | Debug panel style, bottom right. |

### Known limitations and deviations

- **Resolved since v1.** Shots and returns are animated (v2 added the return glide, v3 the shots). There is sound, and
  there is a start screen. The slots, reserve and labels keep one size on every level, which fixes v1's tiny phone
  targets.
- **Still true from v1 and v2.** Parked units can be relaunched, the default lose rule ends a level when all 5 slots
  are blocked, and runners queue behind each other. Art fidelity is unchanged, and so is v2's pacing: Carrot takes
  about 7.6 minutes played one unit at a time.
- **No persistence or level select.** Money, progress and the Sound setting reset on reload. The start screen has only
  Play; `?level=<id>` still plays any level on its own.
- **No "fired" event.** Core has no `UNIT_FIRED`, so the shot, the muzzle pop and the pew start on `BLOCK_CONSUMED`,
  in the step where the unit eats the block. The block itself waits for the shot to land.
- **Refused clicks give no feedback.** A click at 0/5, or on a unit behind the front of its column, shows and plays
  nothing; the presentation does not use `LAUNCH_REJECTED` yet.
- **Units are larger than small board cells.** Runners are drawn at the constant unit size, 22.5 px long on a 375 px
  phone, while Carrot's board cells are 11 px. Neighbouring runners can therefore overlap on the track, because the
  1-cell follow distance is measured in board cells.
- **Effects level.** Reduced effects come only from the system's reduced-motion setting; by request, there is no
  in-game option.
- **Performance was measured on a desktop browser** with the frame loop uncapped, not on a phone. The board still
  uses one mesh per block and tile, about 850 draw calls on Carrot; instancing the board is the next step if low-end
  phones struggle.
- **Allocation-free covers the presentation code.** Core's `getSnapshot()` still builds a fresh snapshot every frame
  by design, and the Renderer builds a short level-signature string each frame.
- **Sound.** All 15 sounds are synthesised, and no audio files ship. During a pause, board sounds already playing
  finish (the longest, the rush, lasts 0.7 s); only new ones wait. `debug.timeScale` is a config value, and the DOM
  UI and its sounds keep real time.

## Styled – Fish of Fortune

The Fish of Fortune look arrives in steps:
- **3D step 1:** the artist's fish replaces the triangle units, and the artist's canal replaces the flat track tiles.
- **2D step 1:** the key art, with its painted title, and an image Play button replace the flat start screen.
- **2D step 2:** a painted gameplay background, the HUD from the HUD sheet and glass slot tiles. The reserve shows only
  3 rows, which leaves room for bigger fish with a smaller capacity number.

Everything else is exactly as in v3: the settings, win and lose overlays, the "N/5" counter, blocks, empty ring and
reserve tiles, effects and sound. `src/core`, the level files and their tests are unchanged, and so are `VfxFactory`
and `SfxBank`; the capacity rules are untouched (only the number's size changed). `AppFlow` still goes from MENU to
PLAYING, with Play loading Level 1.

### 3D asset pipeline

**Source.** The artist's Blender 4.3 files stay outside the repo, and the export never modifies them:

| File | Contents | Exported |
|---|---|---|
| `Art.blend` | The fish: `Mesh_0` (1,634 triangles) skinned to `Armature_Fish` (10 bones), material `M_Fish_Clean` with packed 2048² base-colour and roughness/metallic textures, and the actions `Fish_Idle`, `Fish_Swim` and `Fish_Bubble_Spit` | `fish.glb` |
| `Fish_Rail.blend` | The rail: one fused 8 x 8 m loop (`Fish_Rail_Track`) with its water (`Fish_Rail_Water`), 36 flow chevrons animated through shape keys, a path curve, a preview camera and two lights | the track pieces |

**Export command.** Point the script at Blender and at the folder holding the .blend files:

```bash
BLENDER_PATH="C:/Program Files/Blender Foundation/Blender 4.3/blender.exe" ART_DIR="C:/Users/<you>/Downloads/Art" npm run export:models
```

`npm run export:models` runs `tools/blender/export_glb.py` headless in Blender once per job listed in
`tools/blender/models.json`, then validates the output with `npm run validate:models`. Blender opens each .blend in
memory, and the script never saves it: every change (the downscaled textures, the flattened water, the cut pieces)
exists only in that Blender session. Running it again writes byte-identical GLBs.

**Export settings** (Blender 4.3 glTF exporter):

| Setting | Value |
|---|---|
| Format and axes | GLB, Y-up (Blender +Z becomes glTF +Y) |
| Objects | Only the ones the manifest lists; no cameras, lights or extras |
| Modifiers | Applied; the fish's armature is kept as a skin (up to 4 influences per vertex, rest pose) |
| Textures | Embedded PNG. The fish's two textures are downscaled from 2048² to 512² (`textureSize`); the originals stay in the .blend |
| Animation | Fish: every action as its own clip (`ACTIONS` mode, sampled every frame). Track: none |
| Compression | None (no Draco) |
| Pivots | The fish is centred on its bounding box. Each track piece sits at the canal centre of its cell |

**The track cut.** The rail is one loop, so the export cuts the pieces out of it with bisect planes (Blender metres,
top view, y up):
- **Straight piece:** one canal cell of the south side, from x -0.625 to 0.625, from the outer edge (y -4.0) in to the
  canal's inner edge (y -2.2).
- **Corner piece:** the south-east corner, x 2.2 to 4.0 and y -4.0 to -2.2.
- **Dropped:** the inner rim, the pool and the walls standing in the inner cut plane, so the canal meets the board's
  first cells directly.
- **Scale and pivot:** each piece is moved so the canal centre of its cell (the rail's path, 2.825 m out) is the
  origin, then scaled by 1 / 1.25 (the canal width). One game cell is then 1 unit and the canal spans [-0.5, 0.5]
  across. In the GLB, a straight piece's outer rim points +Z and the corner's rims +X and +Z.
- **Chevron:** the chevron nearest the south side's centre, turned 180° to point +X.
- **Safety check:** the export fails if the rail no longer matches these numbers, meaning the path is off the canal
  centre or the water edges have moved.

**Water colour.** Blender builds the water's base colour from procedural nodes (a Voronoi pattern into a colour ramp),
which glTF cannot carry. The export routes that colour through an Emission shader, bakes it in Cycles at 64² over 4
frames of its animation, and averages it into a flat base colour: linear (0.358, 0.873, 0.986), #a1f0fd. The water's
emission and the transmission of the water (0.45) and outer rim (0.25) are exported as they are.

**Output folder: `public/assets/models/`**

| File | Size | Contents |
|---|---|---|
| `fish.glb` | 474.7 KB | 1 skinned mesh, 1,634 triangles, 10 joints, 2 textures (512² PNG, 210 + 162 KB), animations Fish_Idle 2.04 s, Fish_Swim 1.04 s, Fish_Bubble_Spit 1.67 s |
| `track_straight.glb` | 4.6 KB | 36 triangles, materials Mat_OuterRim, Mat_CanalBed, Mat_CanalWater; 1 x 1.44 cells, 0.52 cell high |
| `track_corner.glb` | 6.5 KB | 93 triangles, same materials; 1.44 x 1.44 cells |
| `track_chevron.glb` | 1.5 KB | 2 triangles, emissive Mat_Chevrons (strength 2.4) |

`tools/glb/validate-models.mjs` checks each file with no dependencies: glTF magic and version 2, the JSON chunk,
buffer and accessor ranges, embedded images and their size, and no Draco. It prints meshes, materials, textures,
animations, bounding box and size. `tools/blender/inspect_blend.py` inventories a .blend read-only, and
`tools/blender/render_reference.py` renders the art from the game's top-down view for comparison.

### 2D asset pipeline (start screen)

**Source.** Two images, committed in `assets/ui/source/` so the processing can be rerun. The script only reads them.
The start screen art and the button were AI-generated with Gemini.

| File | Contents |
|---|---|
| `start_screen.jfif` | JPEG, 1536 x 2752 (24:43): the portrait key art, with the "BLOCK CHOMPERS" title painted in |
| `button_green.jfif` | JPEG, 1984 x 2120: a glossy green pill (1123 x 353 px) on a grey textured studio background, with a baked shadow |

**Command.** `npm run process:ui` runs `tools/ui/process_ui.py` (Python + Pillow) with the settings in
`tools/ui/ui_assets.json`. The runner (`tools/ui/process-ui.mjs`) uses the `PYTHON` environment variable, else the
project venv `tools/ui/.venv` (gitignored), else `python3` or `python`. One-time setup; any Python 3 works, and this
machine used Blender 4.3's bundled Python 3.11:

```bash
"C:/Program Files/Blender Foundation/Blender 4.3/4.3/python/bin/python.exe" -m venv tools/ui/.venv
```

```bash
tools/ui/.venv/Scripts/python -m pip install pillow
```

Running it again writes byte-identical files (Pillow 12.3.0). `npm run process:ui -- --font-preview` renders the
font comparison sheet; it needs the candidate TTFs from github.com/google/fonts in `tools/ui/.cache/fonts/`
(gitignored).

**Background.** Converted to WebP at quality 85 and scaled down to `maxWidth` 1080 px, keeping its aspect (24:43).

**Button background removal.** The grey background is textured and the JPEG bleeds colour into it, so a plain
colour key would leave a fringe and cut the highlights. The script works from the pill's shape instead:
1. **Key the outline.** A pixel counts when it is green and not light (G − max(R, B) > 20 and luma < 140) or very dark
   (luma < 70), because the thin outline turns almost neutral black in places. The grey background and its baked
   shadow are neither, so the shadow drops out with the background; the CSS drop shadow replaces it.
2. **Fill the shape.** The pill is convex, so its matte is the convex hull of those pixels, drawn at 4x and averaged
   down. That gives a smooth, anti-aliased outline, and every pixel inside is opaque, so the glossy highlights (some
   reach the edge) stay intact.
3. **Remove the fringe.** Each pixel of the outermost opaque ring takes the per-channel minimum of itself and its inner
   neighbours; the outline is darker than both sides, so this only removes the background's grey. The
   semi-transparent edge pixels take the colour of the nearest opaque ones, the art's own dark outline, so no grey or
   pale fringe remains.
4. **Crop and scale.** Cropped to the pill plus 6 px of padding, scaled to 800 px wide with premultiplied alpha, and
   alpha below 5 is cleared (resampling ringing).

**Output**

| File | Size | Contents |
|---|---|---|
| `public/assets/ui/start_bg.webp` | 252.6 KB | 1080 x 1935, aspect 0.558 |
| `public/assets/ui/button_green.png` | 220.2 KB | 800 x 257 RGBA, aspect 3.11 |
| `public/assets/fonts/TitanOne-Regular-latin.woff2` | 10.5 KB | Titan One, Latin subset |
| `public/assets/fonts/TitanOne-OFL.txt` | 4.3 KB | Its licence |
| `tools/ui/preview_button.png` | 137.6 KB | The cutout over a dark and a light background, with two corners zoomed 4x |
| `tools/ui/preview_fonts.png` | 487.7 KB | "Play" in the three candidate fonts next to the painted title |

**Font.** The label uses Titan One by Rodrigo Fuenzalida, licensed under the SIL Open Font License 1.1 (licence text
in `public/assets/fonts/TitanOne-OFL.txt`). Of the three OFL candidates (Titan One, Lilita One, Bagel Fat One), it is
the closest to the painted title's weight and roundness and reads best at button size. Luckiest Guy was ruled out:
it is Apache-2.0, not OFL. The `.woff2` is Google Fonts' Latin subset, downloaded once from fonts.gstatic.com and
self-hosted, so the game runs offline and loads no CDN.

### 2D asset pipeline (gameplay background, HUD, slots)

**Source.** Two more images in `assets/ui/source/`, only read by the script. The gameplay background was
AI-generated with Gemini.

| File | Contents |
|---|---|
| `gameplay_bg.jfif` | JPEG, 1536 x 2752 (24:43, like the start art): an underwater scene with a painted framed basin in the middle |
| `hud_sheet.png` | PNG, 656 x 456, already transparent: the coin bar with the coin over its left end, the round settings button, and one glass slot tile |

`npm run process:ui` processes them with the start screen art; `npm run process:ui -- --only gameplay` or
`--only hud` runs one group. Running it again writes byte-identical files.

**Background.** Converted to WebP at quality 85 and scaled to `maxWidth` 1170 px, so 3x phones (390 CSS px x 3) are
not upscaled. The painted frame, measured by eye on a 2.5% grid (about ±1%), is x 26.0%, y 35.5%, 47.5% wide and
26.5% tall of the image, centred at (49.75%, 48.75%); `tools/ui/preview_gameplay_bg.png` outlines it.

**HUD sheet.** It has no background to remove, but its alpha is almost binary, so every edge is a jagged pixel step.
Each element gets a new matte drawn at 4x and averaged down, and the matte's pixels that are not fully opaque in the
sheet take the colour of the nearest opaque ones (the art's own outline), so there is no fringe:
- **Settings button and slot tile:** the convex hull of their pixels (a circle and a rounded square). The sheet has a
  single tile, used as is.
- **Coin icon:** a circle fitted to its left half, which the bar does not cover (diameter 173 px).
- **Bars:** the sheet has one bar, with its left end hidden under the coin. The right end cap is mirrored to make the
  left one, and the straight middle, which only changes vertically, is stretched to length. The coin bar's rebuilt
  left end stays hidden under the coin, so coin bar + coin icon recompose the sheet. The sheet has no level bar:
  `level_bar.png` is the same pill at aspect 3.0 until the real one is exported from Figma.
- **Shadows:** the sheet has no baked shadows; a soft CSS drop shadow (`ui.hud.dropShadow`) goes under the HUD pieces.

**Output**

| File | Size | Contents |
|---|---|---|
| `public/assets/ui/gameplay_bg.webp` | 211.1 KB | 1170 x 2096, aspect 0.558 |
| `public/assets/ui/hud/settings_button.png` | 30.4 KB | 178 x 178 |
| `public/assets/ui/hud/level_bar.png` | 49.0 KB | 419 x 143 (rebuilt pill, aspect 2.93 with padding) |
| `public/assets/ui/hud/coin_bar.png` | 43.0 KB | 306 x 143 |
| `public/assets/ui/hud/coin_icon.png` | 24.5 KB | 178 x 178; on the coin bar: centre (-0.022, 0.495) of the bar image, width 1.245 x its height |
| `public/assets/ui/hud/slot_tile.png` | 43.2 KB | 209 x 210 |
| `tools/ui/preview_hud.png` | 543.9 KB | Every cutout over a dark and a light background, bar + coin next to the sheet's original, edges zoomed 4x |
| `tools/ui/preview_gameplay_bg.png` | | The background with the measured frame outlined |

**Resolution.** On a 390 x 844 phone at devicePixelRatio 2, nothing is upscaled: the HUD pieces have about 1.9x the
pixels they are drawn at (settings 45 CSS px, bars 37 px tall, coin 46 px), the slot tile 2.2x (47 px), the
background 1.5x.
At devicePixelRatio 3 the bars get close to 1:1 (1.3x). A 3x export from Figma would sharpen the sheet's edges and
provide the real level bar.

### In the game

- **Loading.** `src/render/assets/AssetLoader.js` loads every GLB once, before the start screen appears; there is no
  loading screen. A file that fails logs a console error naming it, and that model falls back to its primitive.
- **Factory.** `src/render/StyledFactory.js` extends `PrimitiveFactory`, replaces only unit and track creation, and is
  swapped in at the composition root (`main.js`).
- **Fish.**
  - Each unit is a `SkeletonUtils` clone (geometry and textures shared), centred and sized from its bounding box, and
    turned 180° to face the unit's heading.
  - It turns with the existing rotation damping. Labels, effects, the death pop and slot parking work unchanged,
    because the fish lives inside the same unit group as the cone did.
  - It plays Swim while moving and Idle in the reserve and slots, through an AnimationMixer on the presentation clock,
    so it stops while paused and follows `debug.timeScale`.
  - **Size:** a fish is `render.layout.unitSize` long unless that would make it wider than `canalFit` of its one-cell
    canal:

    | Level | cellSize | Fish length | Width / canal |
    |---|---|---|---|
    | Level 1 | 0.46 | 0.600 | 0.73 |
    | Panda | 0.383 | 0.549 | 0.80 |
    | Carrot | 0.293 | 0.419 | 0.80 |

  - **Tint:** one shared material per palette colour, patched with `onBeforeCompile`. The texture's mid-gray body takes
    the palette colour, darker details stay darker, light areas (eye whites, fins, highlights) fade back to the
    texture, and a contrast rim outlines black and white fish. The fish is not tone-mapped, so its body matches its
    blocks (red #f50f3c gives a lit side of #ff4856 and a shaded side of #ac1f2e).
- **Track.** `src/render/layout/computeTrackPieces.js` (pure) returns one piece per ring cell, with its position,
  rotation (outer rim outward) and travel heading for clockwise or counter-clockwise tracks. The straights and the 4
  corners are one InstancedMesh per piece type and material: 6 draw calls in place of v3's one mesh per ring tile.
  The entry corner is tinted through its instance colour. The chevrons are one more InstancedMesh, flowing along the
  canal's rounded centre line in the travel direction at the rail's speed (one spacing every 2 s).
- **Lighting.** The GLB meshes sit on their own layer. The Renderer draws them first under `render.lighting`, taken
  from Fish_Rail.blend's sun, world and fill light, with AgX tone mapping like the .blend files. It then draws
  everything else as in v3, under the v3 lights with no tone mapping and without clearing the depth buffer. Labels
  and effects draw in that v3 pass. Blocks, empty tiles, slots, reserve cells and the background are unchanged: the
  same snapshot (units left out) rendered through both factories on Level 1, Panda and Carrot gives no differing
  pixel outside the canal's band around the ring. The camera stays the strictly top-down orthographic one.
- **Disposal.** Fish clones (skeleton, mixer) and track instances are disposed on restart and level change; the
  loaded GLBs stay cached.
- **Start screen.**
  - **Loading.** `main.js` awaits `src/ui/startScreenArt.js` together with the GLBs, before the UI mounts. It loads
    both images through `AssetLoader.loadImage` (each decoded with `img.decode()`) and the font as a `FontFace` from
    config, waiting on `document.fonts.load`, so the label never flashes in a fallback font. If any of the three fails,
    the console names the file and the flat v3 start screen is shown instead.
  - **Layout.** The art is contained in the viewport (`object-fit: contain`), so the whole image and its painted title
    are always visible and never stretched. The space around it shows the same image cover-fitted, blurred and
    darkened. The pure `src/ui/layout/computeStartScreenLayout.js` returns the image rect and the button rect. The
    button's centre and width are fractions of the displayed art, so it stays on the same spot of the art at any size.
    Its height follows the PNG's aspect, and the label size is a fraction of its height.
  - **Play button.** A real `<button>` with `button_green.png` as its background and "Play" centred on it: white Titan
    One with a dark green outline (`-webkit-text-stroke` behind the letters via `paint-order`), a soft text shadow and a
    CSS drop shadow under the pill.
    - It breathes while idle (a small scale loop, off with reduced effects), brightens on hover, and squashes on
      pointerdown and bounces on release with the v3 button animation.
    - It is focused on show, so Enter and Space play at once. Its focus ring appears once the keyboard is used.
    - Play runs the v3 flow: the PLAY cue inside the click (the AudioContext starts there), the start screen's exit
      animation, then Level 1.
  - **Text title.** `ui.text.title` is no longer drawn over the art: it is the document title and the start screen's
    `aria-label`.
- **Loading (2D step 2).** `main.js` loads the background, the four HUD images (decoded) and the slot texture with the
  GLBs, and Titan One once for the start screen, the HUD and the capacity numbers. Each part falls back on its own,
  with a console error naming the file: the flat level colours, the flat v3 HUD bar, or the flat slots.
- **Gameplay background.** `src/ui/GameBackground.js` draws it in the DOM beneath the game canvas, which is transparent
  when the art loaded (`Renderer.setBackgroundArt`).
  - As on the start screen, the art is contained in the portrait design frame (`src/ui/layout/containRect.js`), never
    cropped or stretched, and a blurred, darkened cover copy of it fills the rest of the viewport.
  - Where the copy shows beside the art (above and below it on phones, also at the sides on wide screens), the art's
    edge fades into it (`edgeFade`), so there is no seam.
  - It replaces the per-level flat backgrounds, which stay as the fallback; the win and lose tint of v3 applies to the
    flat backgrounds only.
- **Board panel.** A translucent rounded panel sits behind the board (grid and canal), drawn before the canal so the
  water blends over it.
  - It is a mid-tone teal like v3's level backgrounds. Over the art under a board it keeps black and white blocks
    above 3:1 contrast on 95% of the area (black 3.5:1 and white 3.2:1 at worst, about 4.3:1 typically). A dark panel
    made white blocks pop but dropped black to 1.6:1.
  - At 75% opacity it also quiets the painted frame under the board.
- **Painted frame offset.** The board stays in `boardRegion`. The painted frame is smaller and lower: in design units
  it is a 4.75 x 4.75 square centred at (4.98, 9.78), while `boardRegion` is 9.2 x 13.75 centred at (5.0, 7.23). The
  frame's centre is 2.55 units (100 px on a 390 px phone) below the board's, and it sits behind the board's lower half.
- **HUD.** DOM, in v3's positions: the settings button top-left, the level bar centred, the coin bar top-right with
  the coin over its left end, as in the sheet.
  - Its sizes are design units: the Renderer keeps the design below a HUD band of `ui.hud.band` units
    (`setHudBand`), and `screenFrame()` tells the UI how many pixels a unit is. So the HUD keeps the same proportions to
    the board on every level and viewport.
  - Settings is a real `<button>` with the v3 squash and bounce, a `:focus-visible` ring, and it opens the settings
    panel.
  - The bars are static containers with no fill or progress: only their text changes. It is white Titan One with a dark
    outline, like the Play button, and it shrinks to fit its box when the amount grows.
  - The v3 animations stay: the HUD slides in, the level label swaps, and the money counts up with a punch. The "+$X"
    reward now lands on the coin icon.
- **Slots.** The glass tile is a textured plane `layout.slotSize` wide (transparent, sRGB). The texture is shared, with
  one material per status: free is untinted, blocked is tinted red. Parking, the "N/5" counter and the slot tints work as
  before.
- **Reserve: 3 visible rows.** Only the first `layout.reserveVisibleRows` (3) rows of each column are drawn. Deeper
  units are hidden, never picked and not animated. This frees the space of 4 reserve rows for bigger reserve cells and
  fish and a bigger board, and the smaller number reads better on the bigger fish.
  - The pure `src/render/layout/computeReserveVisibility.js` gives the visible units with their row, and the entering
    ones. It runs only when the inventory changes.
  - When a column moves up, its units glide with the v3 easing and stagger. The unit reaching row 3 comes from half a
    cell below and fades in over `reserveEnterMs`, using opacity and position only (no stencil or clipping). While it
    fades, its fish uses a private copy of its tinted material.
- **Bigger fish, smaller numbers.**
  - A unit is `layout.unitSize` (1.0) long in the reserve and in a slot, the same on every level.
  - On the track a fish still fits its one-cell canal: it shrinks to `trackScale()` along its launch flight and grows
    back on its return glide. Its width is 0.80 of the canal on Level 1, Panda and Carrot (0.659, 0.549 and 0.48 long).
  - The capacity number's digits are `labelFontScale` (0.45) x the fish's width tall: 0.25 units on a 0.56-wide fish,
    about the absolute size of v3's number on a fish 67% longer.
  - On a fish shrunk for the canal the number stays at least `labelMinHeight` (0.2) tall, so it is readable.
  - The number is Titan One in white with a dark outline, drawn only when it changes. The v3 number swap and the death
    pop scale with the fish.

**Layout change** (design units, the same on every level):

| | Before | After |
|---|---|---|
| `unitSize` (fish length in the reserve and slots) | 0.6 | 1.0 |
| `reserveRegion` | x 0.4, y 14.35, 9.2 x 5.25 (7 rows of 0.75) | x 0.4, y 15.95, 9.2 x 3.75 (3 rows of 1.25) |
| `slotsRegion` / `slotSize` | y 12.9, h 1 / 1.0 | y 14.45, h 1.2 / 1.2 |
| `boardRegion` | x 0.4, y 0.4, 9.2 x 12 | x 0.4, y 0.35, 9.2 x 13.75 |
| Board cell: Level 1 / Panda / Carrot | 0.46 / 0.383 / 0.293 | 0.46 / 0.383 / 0.335 (the two wide boards are limited by the width) |
| Capacity number | `labelSize` 0.45 (sprite) | `labelFontScale` 0.45 x fish width (digits), `labelMinHeight` 0.2 |
| "N/5" counter | (8.3, 13.4), 0.55 high | (8.85, 15.05), 0.6 high |

### New config keys

| Config key | Value | Why |
|---|---|---|
| `render.models.fish.url` | `'assets/models/fish.glb'` | The exported fish. |
| `render.models.fish.scale` / `canalFit` | `1` / `0.8` | Length unitSize x scale, width at most 80% of the canal. |
| `render.models.fish.rotationOffset` / `yOffset` | `180` / `0` | The model faces -X; units head +X. |
| `render.models.fish.tintMaterialNames` | `['M_Fish_Clean']` | The one material in Art.blend. |
| `render.models.fish.toneMapped` | `false` | Fish show their palette colour like the blocks; AgX dulled a #f50f3c fish to #b03e3f. |
| `render.models.fish.tint` | `{ strength: 1, bodyLuminance: 0.22, highlightStart: 0.35, highlightEnd: 0.75, minLuminance: 0.02, rim: 0.35, rimPower: 2.5, rimSwitch: 0.35, rimLight: 0xffffff, rimDark: 0x0b2233 }` | Body gray = palette colour (the texture's body is linear 0.18 to 0.22), light areas stay light, black lifted a little, contrast rim for black and white. |
| `render.models.fish.animations` | `{ swim: 'Fish_Swim', idle: 'Fish_Idle', fadeMs: 200, swimSpeed: 1, idleSpeed: 1 }` | Clips and cross-fade. |
| `render.models.track.straightUrl` / `cornerUrl` / `chevronUrl` | `'assets/models/track_straight.glb'` / `'assets/models/track_corner.glb'` / `'assets/models/track_chevron.glb'` | The exported pieces. |
| `render.models.track.transmissionAsOpacity` / `transmissionWeight` | `true` / `0.65` | Transparency instead of three.js transmission (an extra scene render each frame); 0.65 matches the Blender reference render's water and rim. |
| `render.models.track.entryTint` | `0xb4c8dc` | Entry corner about 25 levels darker, like v3's entry tile. |
| `render.models.track.chevrons` | `{ spacing: 0.481, periodMs: 2000, cornerRadius: 0.382 }` | The rail's chevron spacing, flow speed and corner radius, in cells. |
| `render.lighting.layer` | `1` | Layer that keeps the model lights on the GLB meshes only. |
| `render.lighting.toneMapping` / `exposure` | `'agx'` / `1` | The .blend files use Blender's AgX view. |
| `render.lighting.hemisphere` | `{ sky: 0xa1bfd9, ground: 0x8198b1, intensity: 1 }` | Fish_Rail.blend's world (0.07, 0.1, 0.14) plus its blue fill light from above. |
| `render.lighting.directional` | `{ color: 0xfffdf6, intensity: 4.2, position: [-0.161, 0.641, 0.751] }` | Fish_Rail.blend's sun: 4.2 W/m², warm, from the south and above. |

Start screen (`ui.startScreen`; the flat v3 fallback keeps its `ui.text`, `ui.colors` and `ui.sizes` keys):

| Config key | Value | Why |
|---|---|---|
| `ui.startScreen.background` / `button` | `'assets/ui/start_bg.webp'` / `'assets/ui/button_green.png'` | The processed images. |
| `ui.startScreen.font` | `{ family: 'Titan One', url: 'assets/fonts/TitanOne-Regular-latin.woff2', fallback: 'system-ui, sans-serif' }` | The self-hosted label font. |
| `ui.startScreen.backdrop` | `{ blurPx: 18, brightness: 0.55, saturate: 1.1, scale: 1.1, color: '#0b2a3d' }` | The blurred, darkened copy around the art; scale hides the blur's soft edge, and color shows before the image paints. |
| `ui.startScreen.playButton.centerX` / `centerY` / `widthPct` | `0.5` / `0.875` / `0.46` | On the sand, between the block stack and the bottom props, clear of the title and the fish. |
| `ui.startScreen.playButton.labelSize` / `labelOffsetY` | `0.47` / `-0.1` | Titan One's capitals at 34% of the button height (its caps are 0.72 em), centred on the pill. |
| `ui.startScreen.playButton.labelColor` / `outlineColor` / `outlineWidth` | `'#ffffff'` / `'#1f5843'` / `0.17` | White label, the pill's dark rim green as the outline; the stroke width is in em, and half of it shows. |
| `ui.startScreen.playButton.shadow` | `'0 0.09em 0.1em rgba(0, 0, 0, 0.45)'` | Soft text shadow, like the title's depth. |
| `ui.startScreen.playButton.dropShadow` | `{ offsetY: 0.14, blur: 0.16, color: 'rgba(40, 26, 6, 0.5)' }` | The pill's shadow on the sand, in em, so it scales with the button. |
| `ui.startScreen.playButton.hoverBrightness` | `1.08` | Hover brightens the pill and the label. |
| `ui.startScreen.playButton.pulseScale` / `pulsePeriodMs` | `1.04` / `1600` | The idle breathing. |
| `ui.startScreen.playButton.focusColor` / `focusWidth` / `focusOffset` | `'#ffffff'` / `3` / `2` | The keyboard focus ring (px). |

Gameplay background, HUD, slots and layout (2D step 2; the layout values changed are in the table above):

| Config key | Value | Why |
|---|---|---|
| `render.layout.reserveVisibleRows` | `3` | Reserve rows drawn; deeper units are hidden and come up as their column moves. |
| `render.layout.labelFontScale` / `labelMinHeight` | `0.45` / `0.2` | Capacity digits' height as a fraction of the fish's width, and their floor on a fish shrunk for the canal. |
| `render.reserveEnterOffset` / `reserveEnterMs` | `0.5` / `260` | The unit entering row 3 starts half a cell below and fades in over 260 ms. |
| `render.label.font` / `outline` / `outlineWidth` | `'40px "Titan One", system-ui, sans-serif'` / `'#10202c'` / `9` | The capacity number in Titan One, white with a dark outline (canvas px). |
| `render.slotTile` | `{ url: 'assets/ui/hud/slot_tile.png', tint: { free: 0xffffff, blocked: 0xff8a8a } }` | The glass tile and its tint per slot status. |
| `render.backgroundArt` | `{ url: 'assets/ui/gameplay_bg.webp', frame: [0.26, 0.355, 0.475, 0.265], backdrop: { blurPx: 18, brightness: 0.55, saturate: 1.1, scale: 1.1, color: '#0b2a3d' }, edgeFade: 0.04 }` | The art, its measured painted frame, the blurred copy around it and the edge fade into it. |
| `render.boardPanel` | `{ color: 0x3d7896, opacity: 0.75, radius: 0.35, padding: 0.3 }` | The mid-tone panel behind the board: black and white blocks both above 3:1. |
| `ui.hud.band` / `padding` | `1.4` / `0.3` | The HUD band above the design and the distance from the viewport's sides, in design units. |
| `ui.hud.settings` | `{ url: 'assets/ui/hud/settings_button.png', size: 1.15 }` | The round settings button. |
| `ui.hud.levelBar` | `{ url: 'assets/ui/hud/level_bar.png', aspect: 419 / 143, height: 0.95 }` | The level bar; a real export only needs its file, aspect and height. |
| `ui.hud.coinBar` / `coin` | `{ url: 'assets/ui/hud/coin_bar.png', aspect: 306 / 143, height: 0.95 }` / `{ url: 'assets/ui/hud/coin_icon.png', centerX: -0.0218, centerY: 0.495, size: 1.2448 }` | The coin bar, and the coin over its left end as in the sheet. |
| `ui.hud.text` | `{ size: 0.44, offsetY: -0.08, color: '#ffffff', outlineColor: '#0b3550', outlineWidth: 0.17, shadow: '0 0.08em 0.1em rgba(0, 0, 0, 0.45)', levelInsets: [0.1, 0.1], coinInsets: [0.36, 0.1] }` | The bars' text, styled like the Play button, and its box inside each bar (the coin covers the coin bar's left part). |
| `ui.hud.dropShadow` | `{ offsetY: 0.05, blur: 0.08, color: 'rgba(0, 20, 40, 0.45)' }` | Soft shadow under the HUD pieces, in design units. |
| `ui.hud.focusColor` / `focusWidth` / `focusOffset` | `'#ffffff'` / `3` / `2` | The settings button's focus ring (px). |

### Checks

- **Tests.** 293 headless tests. The 3D step added 21:
  - `computeTrackPieces`: every ring cell covered once with corners in the 4 corners on every level, rims outward,
    headings along core Track travel for cw and ccw, and the chevron loop.
  - The exported pieces placed side by side: identical top surfaces across every joint, with no step and no hole.
  - The size normalisation.
  - GLB validation of every exported file.

  The start screen added 28:
  - `computeStartScreenLayout` on portrait, square and landscape viewports: the art fits inside the viewport, keeps
    its aspect and is centred; the button stays at the same relative spot and inside the art, even for edge or
    oversized settings; the label scales with the button.
  - `startScreenArt.js` with stand-in loaders: each failed image or font gives the v3 fallback and a console error
    naming the file.
  - `src/ui/layout` joins `src/core` and `src/config` in the architecture test: no DOM, Three.js, clock or randomness.

  2D step 2 added 8:
  - `computeReserveVisibility`: at most 3 visible rows per column; after a pick the column moves up and the right unit
    becomes visible and entering; short and empty columns; a restart does not count as entering; a real Carrot game
    (7 rows deep) reveals the next unit of the picked column.
  - `computeLayout`: exactly 3 reserve rows that fit the reserve rect, a bigger `unitSize` than before that still fits
    its cell and slot, and (existing tests) deep-equal slot, reserve and unit rects on every level with every board
    inside `boardRegion`.
- **Gameplay screens (2D step 2).** Checked in the browser at 390 x 844, 768 x 1024 and 1920 x 1080, on Level 1, Panda
  and Carrot.
  - The background is under everything, contained and never stretched, and fades into its blurred copy.
  - The HUD matches the sheet and stays crisp. Settings squashes and opens the paused panel, the level label swaps,
    the money counts up, the reward's flight ends on the coin's centre, and a long amount shrinks to fit its box.
  - The slots show the glass tiles, and the reserve shows exactly 3 rows. The unit entering row 3 fades in while
    rising the last half cell.
  - The fish are bigger and their number is smaller relative to them. Black and white blocks read on all three levels.
  - Hiding the background, the settings image and the slot tile brought back the flat colours, the flat v3 bar and the
    flat slots, each with a console error naming the file.
  - Performance, same harness and canvas as below, Carrot with five units firing: CPU 2.4 ms per frame (2.2 before),
    4.2–4.3 ms with the GPU wait (4.4–4.6 before), 632 draw calls (663 before), GPU textures 44 (59 before). Hidden
    reserve fish are neither drawn nor animated.
- **Start screen.** Checked in the browser at 390 x 844, 768 x 1024 and 1920 x 1080. The title is fully visible and
  the button's centre sits at (0.500, 0.875) of the art at every size: 179 x 58 px on the phone, 263 x 84 px on the
  tablet, 277 x 89 px on the desktop.
  - Mouse and touch pointers squash and bounce the button, and a click plays: the AudioContext starts inside it, the
    exit animation runs and Level 1 loads with the HUD, board, slots and reserve exactly as before.
  - Hiding `start_bg.webp` brought up the flat v3 start screen, with a console error naming the file.
  - The in-app browser could not send a real Enter or Space key, so keyboard activation was checked up to the focused
    `<button>` receiving the keys unblocked; the browser turns those keys into its click.
- **Performance.** Carrot, desktop browser, 765 x 599 canvas. One script drives both factories the same way: it
  launches a unit whenever fewer than five are moving and measures 600 frames after 120 warm-up frames.

  | | v3 | Styled |
  |---|---|---|
  | CPU per frame (logic, sync, render calls) | 1.5 ms | 2.2 ms |
  | Frame including the wait for the GPU | 2.3–3.1 ms | 4.4–4.6 ms |
  | Draw calls | 784 | 663 |

  - **Where the extra time goes:** hiding the 25 fish brings the styled frame back to v3's (3.1 ms against 3.0 ms in
    the same batch); hiding the track saves only 0.2 ms. Most of the fish cost comes after the draw calls are
    submitted: each fish is a skinned PBR draw that uploads its bone texture every frame.
  - **In the running game** (frame loop uncapped, CPU and GPU overlapping): styled runs at 478–485 fps (2.0 ms) with
    672 draw calls on average. The earlier v3 sound checks measured 612–696 fps. Both stay far inside a 60 Hz frame
    (16.7 ms).
  - **Memory:** GPU memory stays at 14 geometries and 58 textures across 5 restarts. It returns to the same count on
    every level change (44 on Level 1, 34 on Panda, 54 on Carrot); textures scale with the units, which each have
    their own label canvases and bone texture.
- **Compared with Blender** (the same top-down view of the south-east corner):

  | Element | Blender | In game |
  |---|---|---|
  | Water | #94b5bd | #8fb5c5 |
  | Rim | #8badb8 | #87acba |

  The fish shape, proportions, pose and the chevrons match. The differences:
  - The water's Voronoi pattern is flattened to its average colour.
  - There are no shadows; Blender's EEVEE casts the fish's and the inner rim's.
  - The inner rim and the pool are left out.
  - An untinted fish renders about 19 levels darker than Blender's AgX, because the fish is not tone-mapped.

### Known limitations

- **Level bar rebuilt, pending Figma export.** The HUD sheet has no level bar: `level_bar.png` is the coin bar's pill
  rebuilt by the processing script. The real export can replace the file; if its shape differs, only
  `ui.hud.levelBar.aspect` and `height` change.
- **Painted frame offset.** The painted frame covers under a fifth of the board region's area (4.75 x 4.75 against
  9.2 x 13.75 design units) and its centre is 2.55 units below the region's. The board is not moved or shrunk to match; the backing panel quiets the frame behind it.
- **Numbers on track fish.** On the track a fish shrinks to fit its canal, but its number keeps `labelMinHeight`, so on
  small canals (Carrot) the number is nearly as wide as the fish.
- **Low contrast on the flat fallback.** Without the background art, the rail's pale water sits on the levels'
  light-blue backgrounds with less contrast than v3's darker ring tiles.
- **Fish overlap when close.** Runners keep one cell apart (`track.launchSpacing`), and a fish on the track is longer
  than a cell on every level (0.66 on Level 1's 0.46 cells), so fish right behind each other overlap end to end.
- **Fish cost.** On Carrot, the skinned fish about double the time the GPU still needs once a frame is submitted (see
  Performance). Visible idle fish in the reserve and slots still animate and upload their skeletons every frame.
- **HUD sheet resolution.** The sheet is small: its pieces have about 1.9x the pixels they are drawn at on a 2x phone,
  but only 1.3x on a 3x one, and its edges were rebuilt from hard, pixel-stepped alpha. A 3x export would be sharper.
- **Background art bands.** The art (24:43) is shorter than the design frame, so on phones about 45 px of its blurred
  copy show above and below it, and its edge fades there (the HUD sits on the upper band, the reserve's last row on
  the lower one).
- **No end tint on the art.** v3 tints the flat background on a win or a loss; the art is not tinted.
- **Blurred bands on wide screens.** The art is 24:43, so on a 16:9 desktop the blurred copy fills about two thirds of
  the width (start screen and gameplay).
- **Latin-only font.** The self-hosted Titan One covers Google Fonts' Latin subset only; other characters fall back to
  the system font.
- **Busy sand.** The Play button covers the key, a pink cube and the edge of the treasure chest in the art.
- **Focus ring timing.** Browsers that ignore `focus({ focusVisible: false })` show the ring from the start.
