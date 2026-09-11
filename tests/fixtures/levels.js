import { SINGLE_LANE, TWO_COLORS_3x3, PADDED_5x5 } from './grids.js';

const level = (id, grid, units) => ({ id, grid, units });
const unit = (color, capacity) => ({ color, capacity });
const units = (n, color, capacity) => Array.from({ length: n }, () => unit(color, capacity));

/** Ring for a 1x3 grid (length 12) from SW, cw: 0 SW | 1 W0 | 2 NW | 3 N0 4 N1 5 N2 | 6 NE | 7 E0 | 8 SE | 9 S2 10 S1 11 S0 */

/** WIN at step 5: eats (0,0) at step 1, (0,1) at step 4, (0,2) at step 5 and dies as the grid clears. */
export const SINGLE_LANE_LEVEL = level('test-single-lane', SINGLE_LANE, [unit(1, 3)]);

export const TWO_COLORS_LEVEL = level('test-two-colors', TWO_COLORS_3x3, [unit(1, 5), unit(2, 4)]);

/** LOSE at step 8 (all-slots-blocked): five wrong-colour units lap the 1x1 ring (length 8) and block every slot. */
export const LOSE_ALL_BLOCKED_LEVEL = level('test-lose-all-blocked', [[2]], units(5, 1, 1));

/** LOSE at step 1 (reserve-empty): the only unit eats one block and dies with one block left. */
export const LOSE_RESERVE_EMPTY_LEVEL = level('test-lose-reserve-empty', [[1, 1]], [unit(1, 1)]);

/** One wrong-colour unit: PLAYING through step 7, returns at step 8, then reserve-empty. */
export const LONE_RUNNER_LEVEL = level('test-lone-runner', [[2]], [unit(1, 1)]);

/** Same as LONE_RUNNER but two units, for launchSpacing. */
export const TWO_RUNNERS_LEVEL = level('test-two-runners', [[2]], units(2, 1, 1));

/** Six units on a 1x1 grid: the sixth activation must be rejected (5 slots). */
export const SIX_UNITS_LEVEL = level('test-six-units', [[2]], units(6, 1, 1));

/** u0 eats (0,0) at step 1 and keeps running; grid clears at step 1, both units return at step 8. */
export const WIN_WAITS_LEVEL = level('test-win-waits', [[1]], [unit(1, 2), unit(1, 5)]);

/** Two same-colour runners share the W lane at step 1: slot order decides who eats (0,0). */
export const CONTENTION_LEVEL = level('test-contention', SINGLE_LANE, [unit(1, 1), unit(1, 3)]);

/** Colour 2 shields (0,0) from the W and N sides; the colour-1 block is only reachable from N col1. */
export const SHIELDED_LEVEL = level('test-shielded', [[2, 1]], [unit(1, 3)]);

/** Padded 5x5: the first three W lanes are empty / other colour; (1,1) is eaten at step 4, (3,3) at step 16. */
export const PADDED_LEVEL = level('test-padded', PADDED_5x5, [unit(1, 2)]);

/** Capacity 5 on three blocks: finishes the lap with capacity 2 and returns. */
export const BIG_APPETITE_LEVEL = level('test-big-appetite', SINGLE_LANE, [unit(1, 5)]);

/** u0 dies at step 1 freeing slot 0; u1 (no target) returns to slot 1 at step 10. */
export const SLOT_MEMORY_LEVEL = level('test-slot-memory', [[1, 2]], [unit(1, 1), unit(3, 1)]);

/** 2x3 grid (length 14): u0 dies at step 2, u1 (no target) returns at step 14, u2 stays in reserve. */
export const MIXED_LEVEL = level('test-mixed', [[1, 1, 1], [2, 2, 2]], [unit(1, 1), unit(3, 1), unit(1, 5)]);

/** The single colour-1 block is walled in by colour 2: no unit can ever eat it. */
export const WALLED_LEVEL = level('test-walled', [[2, 2, 2], [2, 1, 2], [2, 2, 2]], [unit(1, 1)]);
