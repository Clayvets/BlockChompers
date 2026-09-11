# BlockChompers

Hyper-casual browser puzzle game (Three.js + Vite, plain JavaScript). Units ride a one-way track around a pixel-art grid
and eat the outermost block of their colour on each lane they pass. Clear the grid to win.

```bash
npm install
npm run dev    # http://localhost:5173
npm test       # headless tests (Vitest)
npm run build
```

## Rules (v1)

- **Launching:** only the front unit of each reserve column can be picked. It takes the lowest free slot of the 5 and
  the units behind it in its column move up one cell. A counter next to the slot row shows the free slots ("N/5").
- **Moving:** units follow the track path exactly and keep at least `track.launchSpacing` between each other, along the
  track only: a unit waits behind one that stops to eat. They are never drawn side by side.
- **Eating:** one block per lane per pass. A unit dies at capacity 0 and frees its slot.
- **Parking and relaunching:** a unit that finishes its lap with capacity left parks and blocks its slot. Clicking it
  relaunches it with the capacity it has left, keeping its slot.
- **Balance:** for every colour, the units' capacities add up exactly to that colour's block count.
- **Win and lose:** checked at the end of every step, win first. Win: the grid is empty. Lose with
  `slots_blocked` when every slot is blocked and nothing moves (with `rules.loseMode: 'deadlock'`, only if no parked unit
  could hit a block), or with `out_of_units` when the reserve is empty, nothing moves, blocks remain and no parked unit
  could hit a block. A parked unit "could hit" when its colour is the first non-empty cell of some lane.

## Levels (v1)

1. **Watermelon** (17 x 18, 20 units)
2. **Panda** (24 x 22, 15 units)
3. **Carrot** (39 x 23, 25 units)

The three levels form a cycle. Winning Level 3 shows "Play again +$X": it pays the reward and loads Level 1 again with the
money kept. **Starter** (the first prototype level) stays outside the cycle.

Debug level select: `?level=<id>` plays any level on its own, e.g. `http://localhost:5173/?level=starter`.
Ids: `watermelon`, `panda`, `carrot`, `starter`.

## v1 values

Gameplay values from `src/config/Config.js` (every tunable lives there).

| Config key | v1 value | Meaning |
|---|---|---|
| `track.margin` | 1 | Cells between the grid edge and the track |
| `track.direction` | cw | Loop direction (top-down view) |
| `track.speed` | 4 | Unit speed, cells per second |
| `track.entry.corner` | SW | Shared entry corner; a lap runs from here back to here |
| `track.launchSpacing` | 1 | Minimum gap between runners, along the track only: a launch waits for it and a runner never closes in beyond it (0 = pass-through) |
| `units.defaultCapacity` | 5 | Capacity when a level omits it |
| `units.minCapacity` | 1 | Lowest capacity a level may use |
| `inventory.reserveCols` | 4 | Reserve columns (rows follow the unit count) |
| `inventory.activeSlots` | 5 | Active slots |
| `inventory.frontOnlyPick` | true | Only the front unit of each reserve column can be launched; the column moves up when it leaves |
| `rules.blocksPerLanePass` | 1 | Blocks a unit may eat from one lane per pass |
| `rules.winWaitsForRunners` | false | A cleared grid wins only once no unit is moving |
| `rules.allowNoTargetActivation` | true | Allow launching a unit whose colour has no blocks left |
| `rules.allowRelaunchParked` | true | A parked unit can be relaunched from its slot, keeping capacity and slot |
| `rules.loseMode` | allSlotsBlocked | allSlotsBlocked: lose as soon as every slot is blocked and nothing moves. deadlock: only if no parked unit could hit a block |
| `timing.fixedStep` | 0.016667 | Logic step, seconds |
| `timing.maxFrameDt` | 0.1 | Longest frame the logic catches up on, seconds |
| `timing.launchDelay` | 0.25 | Slot to track, seconds |
| `timing.eatDuration` | 0.15 | Pause per eaten block, seconds |
| `progression.startingMoney` | 0 | Money at the start |
| `progression.rewardPerLevel` | 50 | Paid once per won level, on Continue / Play again |
| `render.reserveShiftMs` | 160 | Reserve shift: time for a unit to glide one cell, ms |
| `render.reserveShiftStaggerMs` | 60 | Reserve shift: delay after the unit ahead starts, ms |
| `render.slotCounter.offsetX` | 1.4 | Free-slot counter "N/5": cells right of the last slot |
| `render.slotCounter.offsetY` | 0 | Free-slot counter: cells below the slot row |
| `render.slotCounter.height` | 0.7 | Free-slot counter: text height, cells |
| `render.levels.panda.background` (new) | #9CC3D5 | Panda scene background (palette and tile colours: render.levels.panda) |
| `render.levels.carrot.background` (new) | #9CC3D5 | Carrot scene background (palette and tile colours: render.levels.carrot) |
| `ui.text.playAgain` (new) | Play again | Win button on the last level of the cycle, instead of Continue |
| `debug.levelParam` (new) | level | URL parameter of the debug level select (?level=<id>); empty = off |

Removed earlier: `inventory.compactReserve` (replaced by the column shift), `rules.detectDeadEndsEarly` (replaced by
`rules.loseMode`) and `render.track.laneOffsetPerSlot` (units are no longer drawn side by side).
