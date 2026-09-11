# BlockChompers

Hyper-casual browser puzzle game (Three.js + Vite, plain JavaScript). Units ride a one-way track around a pixel-art grid
and eat the outermost block of their colour on each lane they pass. Clear the grid to win.

```bash
npm install
npm run dev    # http://localhost:5173
npm test       # headless core tests (Vitest)
npm run build
```

## Rules (v1)

- **Launching:** only the front unit of each reserve column can be picked. It takes the lowest free slot of the 5 and
  the units behind it in its column move up one cell.
- **Eating:** one block per lane per pass. A unit dies at capacity 0 and frees its slot.
- **Parking and relaunching:** a unit that finishes its lap with capacity left parks and blocks its slot. Clicking it
  relaunches it with the capacity it has left, keeping its slot.
- **Balance:** for every colour, the units' capacities add up exactly to that colour's block count.
- **Win and lose:** a level is won when the grid is empty. It is lost on a deadlock: blocks remain, no unit is moving,
  no reserve unit can take a free slot, and no parked unit's colour is first on any lane. The reason is
  `slots-blocked` when every slot is taken, `out-of-units` otherwise.
- **Levels:** play order is Watermelon, then Starter; the order loops after the last level.

## v1 values

Gameplay values from `src/config/Config.js` (every tunable lives there).

| Config key | v1 value | Meaning |
|---|---|---|
| `track.margin` | 1 | Cells between the grid edge and the track |
| `track.direction` | cw | Loop direction (top-down view) |
| `track.speed` | 4 | Unit speed, cells per second |
| `track.entry.corner` | SW | Shared entry corner; a lap runs from here back to here |
| `track.launchSpacing` | 0 | Minimum cells between launches (0 = off) |
| `units.defaultCapacity` | 5 | Capacity when a level omits it |
| `units.minCapacity` | 1 | Lowest capacity a level may use |
| `inventory.reserveCols` | 4 | Reserve columns (rows follow the unit count) |
| `inventory.activeSlots` | 5 | Active slots |
| `inventory.frontOnlyPick` (new) | true | Only the front unit of each reserve column can be launched; the column moves up when it leaves |
| `rules.blocksPerLanePass` | 1 | Blocks a unit may eat from one lane per pass |
| `rules.winWaitsForRunners` | false | A cleared grid wins only once no unit is moving |
| `rules.allowNoTargetActivation` | true | Allow launching a unit whose colour has no blocks left |
| `rules.allowRelaunchParked` (new) | true | A parked unit can be relaunched from its slot, keeping capacity and slot |
| `timing.fixedStep` | 0.016667 | Logic step, seconds |
| `timing.maxFrameDt` | 0.1 | Longest frame the logic catches up on, seconds |
| `timing.launchDelay` | 0.25 | Slot to track, seconds |
| `timing.eatDuration` | 0.15 | Pause per eaten block, seconds |
| `progression.startingMoney` | 0 | Money at the start |
| `progression.rewardPerLevel` | 50 | Paid once per won level, on Continue |
| `render.reserveShiftMs` (new) | 160 | Reserve shift: time for a unit to glide one cell, ms |
| `render.reserveShiftStaggerMs` (new) | 60 | Reserve shift: delay after the unit ahead starts, ms |

Removed in this version: `inventory.compactReserve` (replaced by the column shift) and `rules.detectDeadEndsEarly`
(LOSE is now exactly the deadlock above).
