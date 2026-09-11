import { SINGLE_LANE, TWO_COLORS_3x3, PADDED_5x5 } from './grids.js';

const level = (id, grid, units) => ({ id, grid, units });
const unit = (color, capacity) => ({ color, capacity });
const units = (n, color, capacity) => Array.from({ length: n }, () => unit(color, capacity));

/**
 * Every fixture is BALANCED: per colour, unit capacities sum exactly to that colour's block count
 * (GameManager.validateLevel rejects anything else). A unit can therefore only park when its colour is
 * walled in behind another colour, so parking scenarios use walls, never spare capacity.
 *
 * Ring 1x3 (length 12) from SW, cw: 0 SW | 1 W0 | 2 NW | 3 N0 4 N1 5 N2 | 6 NE | 7 E0 | 8 SE | 9 S2 10 S1 11 S0
 * Ring 3x3 (length 16) from SW, cw: 0 SW | 1 W2 2 W1 3 W0 | 4 NW | 5 N0 6 N1 7 N2 | 8 NE | 9 E0 10 E1 11 E2 | 12 SE | 13 S2 14 S1 15 S0
 */

/** WIN at step 5: eats (0,0) at step 1, (0,1) at step 4, (0,2) at step 5 and dies as the grid clears. */
export const SINGLE_LANE_LEVEL = level('test-single-lane', SINGLE_LANE, [unit(1, 3)]);

/** Two same-colour runners share the W lane at step 1: slot order decides who eats (0,0). */
export const CONTENTION_LEVEL = level('test-contention', SINGLE_LANE, [unit(1, 1), unit(1, 2)]);

/** u0 eats (0,0) and dies at step 1; one block and u1 remain, so the game carries on. */
export const TWO_SINGLES_LEVEL = level('test-two-singles', [[1, 1]], units(2, 1, 1));

export const TWO_COLORS_LEVEL = level('test-two-colors', TWO_COLORS_3x3, [unit(1, 5), unit(2, 4)]);

/** Colour 2 shields (0,0) from W and N; u0 reaches its block only from N col1 (step 4). u1 then clears (0,0). */
export const SHIELDED_LEVEL = level('test-shielded', [[2, 1]], [unit(1, 1), unit(2, 1)]);

/** Padded 5x5: u0 skips empty / colour-2 lanes, eats (1,1) at step 4 and (3,3) at step 16; u1 stays in reserve. */
export const PADDED_LEVEL = level('test-padded', PADDED_5x5, [unit(1, 2), unit(2, 2)]);

const WALLED = [
  [2, 2, 2],
  [2, 1, 2],
  [2, 2, 2],
];

/**
 * Red centre walled in by 8 blue blocks. u0 (red 1) alone parks at step 16. Launched together (u0 in slot 0),
 * u0 always checks a lane before u1 (blue 8) opens it, so u0 still parks at 16 while u1 eats all 8 and dies at 14.
 */
export const WALLED_LEVEL = level('test-walled', WALLED, [unit(1, 1), unit(2, 8)]);

/** WALLED, blue split 1 + 7: u0 (blue 1) dies at step 1 freeing slot 0; u1 (red 1) parks in slot 1 at 16; u2 waits. */
export const DIE_AND_PARK_LEVEL = level('test-die-and-park', WALLED, [unit(2, 1), unit(1, 1), unit(2, 7)]);

/**
 * Both red blocks sit on the W row1 lane and are walled everywhere else: one lap (one block per lane per pass)
 * reaches only (1,0), so u0 (red 2) parks with 1. A second scan of W row1 would wrongly eat (1,1).
 */
export const STACKED_LEVEL = level('test-stacked', [
  [2, 2, 2],
  [1, 1, 2],
  [2, 2, 2],
], [unit(1, 2), unit(2, 7)]);

/** 3x7 (length 24): five walled red blocks. Five red units park and block every slot at step 24; u5 (blue 16) waits. */
export const ALL_BLOCKED_LEVEL = level('test-all-blocked', [
  [2, 2, 2, 2, 2, 2, 2],
  [2, 1, 1, 1, 1, 1, 2],
  [2, 2, 2, 2, 2, 2, 2],
], [...units(5, 1, 1), unit(2, 16)]);

/**
 * 5x5 (length 24) nested rings: red outer ring (16), blue ring (8), red centre (1). With u0 (blue 8) in slot 0 and
 * u1 (red 16) in slot 1, u1 eats the outer ring and dies at step 22 while u0, always a lane ahead of the openings,
 * parks with 8 at step 24. The remaining u2 (red 1) can no longer reach the centre: a dead end.
 */
export const DEAD_END_LEVEL = level('test-dead-end', [
  [1, 1, 1, 1, 1],
  [1, 2, 2, 2, 1],
  [1, 2, 1, 2, 1],
  [1, 2, 2, 2, 1],
  [1, 1, 1, 1, 1],
], [unit(2, 8), unit(1, 16), unit(1, 1)]);
