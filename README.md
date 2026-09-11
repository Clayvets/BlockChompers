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

Goal: add juice on top of v2, meaning effects, UI animation and satisfying feedback, without touching the rules. All
of v3 is presentation. `src/core` and its tests are unchanged, effects react to snapshots and events, and every value
lives in `Config.render` or `Config.ui`.

### What changed

1. **Fixed layout (UI scaling fix).** Cause: the camera fitted its frustum to each level's bounds, so a big level
   zoomed everything out and shrank the slots, reserve, units and labels. Now one portrait design (`render.layout`)
   is fitted once per viewport, only the board (grid plus track ring) scales to its region, and everything else keeps
   one size on every level.

   | Level | Board incl. ring | cellSize | Cell on a 390 x 844 phone |
   |---|---|---|---|
   | Level 1 (Watermelon) | 20 x 19 | 0.46 | 17.9 px |
   | Panda | 24 x 26 | 0.3833 | 14.9 px |
   | Carrot | 25 x 41 | 0.2927 | 11.4 px |
   | Starter | 7 x 5 | 0.75 (clamped) | 29.3 px |

2. **Effects architecture.** `src/render/vfx/`: `VfxManager` listens to events and never touches game state, and
   `VfxFactory` is the only place that creates effect geometries and materials. Changing the projectile look (a ball
   today, bubbles later) means one factory method plus render config. Effects run on a presentation clock that stops
   while paused, follows `debug.timeScale`, and clears on restart and level change. Pure helpers live in
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
   flip, sway and fall for about 2.8 s, on their own canvas above the card. They fade out fast when the card closes.
7. **UI animations.** The HUD slides in at every level start and the level label slides to its new number. On a win
   the backdrop fades in, the card pops in with overshoot, and the title, a new "+$X" reward line and the button enter
   one after another. Continue or Play again plays the exit first and only then loads the next level, while the
   "+$X" flies to the money counter, which counts up with a punch. The lose card enters more softly and its title
   shakes. Buttons squash on press and bounce back. The "N/5" counter punches when it changes and flashes red at 0.
   The settings panel slides and fades. The board takes no input while an overlay animates.
8. **Performance and settings.** One InstancedMesh per effect type, preallocated to its cap and recycled oldest
   first; shared geometries and materials; only active instances are uploaded, once per frame. The effect and juice
   code allocates nothing per frame, and DOM animations touch only transform and opacity. Settings has "Effects: full
   / reduced": reduced cuts particle and confetti counts to 40% and drops the shake, and it is the default when the
   system asks for reduced motion. With `debug.enabled`, the debug panel adds FPS, draw calls, active particles and
   GPU memory.
9. **Tests.** 223 headless tests, up from 205 in v2: the layout, the easing curves, the tween scheduler (start, end,
   stagger, cancel) and the pool (acquire, release, recycle at cap). Core and its tests are unchanged.

### Why it improved feel

- **Feedback clarity.** In v2 a block simply vanished as a unit passed its lane. Now each hit is a visible shot from
  one unit to one block, the block reacts when the shot lands, the unit's number ticks down with each shot, and the
  "N/5" counter punches and flashes as room runs out.
- **Satisfaction.** Muzzle pops, white flashes, squash and shrink, and small spark bursts make every hit feel physical,
  and a unit that finishes its job pops instead of blinking out.
- **Reward moment.** Confetti in the level's own colours over the win card, the reward flying into the money and the
  count-up punch turn the payout into a moment instead of a number change.
- **UI flow.** Overshoot entrances and a short stagger lead the eye from title to reward to button. Exits finish
  before the next level loads, so nothing jumps, and a stray tap during a transition cannot launch a unit. Fixed-size
  controls keep tap targets and labels readable on the biggest level.
- **Performance.** On Carrot with five units firing, the frame loop runs at about 650 frames per second uncapped
  (about 1.5 ms per frame); effects add 2 draw calls to the board's 850 and confetti adds 1. GPU memory stays at 12
  geometries and 31 textures across 5 restarts. Reduced effects keep it comfortable for motion-sensitive players.

### Exact values tuned

Values are copied from `src/config/Config.js`; "—" means the key is new in v3.

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
| `render.vfx.reducedScale` | — | `0.4` | Reduced effects: 40% of the particles and confetti. |
| `render.vfx.projectile` | — | `{ size: 0.16, height: 1.2, trailEveryMs: 16, trailLifeMs: 140, trailSize: 0.45 }` | Ball size, draw height and its trail of sparks. |
| `render.vfx.muzzle` | — | `{ punch: 0.35, ms: 130 }` | Scale punch on the firing triangle. |
| `render.vfx.impact` | — | `{ flashMs: 55, squashMs: 70, shrinkMs: 120, squashY: 0.35, stretchXZ: 1.3 }` | White flash, squash, then shrink of a hit block. |
| `render.vfx.burst` | — | `{ lifeMs: 420, size: 0.28, speed: 5, gravity: 16, height: 1 }` | Spark life, size, speed and pull, in board cells. |
| `render.vfx.label` | — | `{ outMs: 170, outScale: 0.5, inMs: 260, inFrom: 0.45, flashMs: 200, flashColor: 0xffd24a }` | Old number fades and shrinks; new one pops with a gold flash. |
| `render.vfx.death` | — | `{ ms: 260, squashAt: 0.3, squash: 0.6, stretch: 1.35, burstCount: 10 }` | Squash, shrink and sparks at capacity 0. |
| `render.vfx.counter` | — | `{ punch: 0.4, punchMs: 240, flashColor: 0xff5252, flashMs: 600 }` | Counter punch on change, red flash at 0. |
| `render.vfx.confetti` | — | `{ count: 140, durationMs: 2800, width: 12, height: 7, speed: 1150, speedJitter: 0.35, spread: 0.45, gravity: 1500, drag: 0.9, spin: 14, sway: 40, fadeMs: 500, stopFadeMs: 180 }` | Count, time and motion of the win confetti (CSS pixels). |
| `ui.anim.overshoot` / `soft` / `exit` | — | `'cubic-bezier(0.34, 1.56, 0.64, 1)'` / `'cubic-bezier(0.22, 1, 0.36, 1)'` / `'cubic-bezier(0.55, 0, 1, 0.45)'` | Pop past the target, glide in, accelerate out. |
| `ui.anim.hudInMs` / `labelOutMs` / `labelInMs` / `labelShift` | — | `380` / `140` / `280` / `12` | HUD slide-in and the level label swap. |
| `ui.anim.backdropInMs` / `backdropOutMs` / `cardInMs` / `cardOutMs` | — | `220` / `180` / `420` / `200` | Result overlay in and out. |
| `ui.anim.cardFromScale` / `loseCardFromScale` | — | `0.6` / `0.88` | Win card pops from small; the lose card enters softer. |
| `ui.anim.itemInMs` / `itemStaggerMs` / `itemShift` | — | `280` / `80` / `16` | Title, reward and button enter one after another. |
| `ui.anim.shakeMs` / `shakePx` | — | `450` / `7` | Small shake on "Out of space" (off in reduced effects). |
| `ui.anim.buttonDownScale` / `buttonDownMs` / `buttonUpMs` | — | `0.9` / `70` / `280` | Squash on press, bounce on release. |
| `ui.anim.flyMs` / `countUpMs` / `moneyPunchScale` / `moneyPunchMs` | — | `620` / `520` / `1.35` / `340` | "+$X" flight and the money count-up punch. |
| `ui.anim.settingsInMs` / `settingsOutMs` / `settingsShift` | — | `260` / `180` / `28` | Settings panel slide and fade. |
| `ui.text.effectsFull` / `effectsReduced` | — | `'Effects: full'` / `'Effects: reduced'` | Settings toggle labels. |
| `ui.timing.fade` | `0.15` | removed | Replaced by ui.anim (the old CSS fade). |
| `debug.enabled` | — | `false` | Layout outlines and the debug panel. |
| `debug.timeScale` | — | `1` | Slow motion for the simulation and effects. |
| `debug.layoutColors` | — | `{ design: 0xffffff, boardRegion: 0x00e676, board: 0xffc400, slotsRegion: 0x00b0ff, reserveRegion: 0xff4081 }` | Outline colours. |
| `debug.panel` | — | `{ right: 8, bottom: 8, padding: 6, font: '11px ui-monospace, monospace', color: '#ffffff', background: 'rgba(0, 0, 0, 0.65)' }` | Debug panel style, bottom right. |
